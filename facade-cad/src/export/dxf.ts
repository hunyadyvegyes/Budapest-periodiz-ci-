// DXF writer.
//  * R2000 (AC1015, default): full table/object structure with handles and owners, layers with
//    colour, linetype and lineweight (group 370), LWPOLYLINE with bulges for arched openings,
//    per-entity lineweight overrides, $INSUNITS = mm when scaled.
//  * R12 (AC1009): maximum compatibility fallback (no lineweights in the format).
// Validated in the test-suite by reading the files back with ezdxf and running its auditor.
import { Drawing, Entity, LAYER_DEFS, LayerName, LayerSettings, LineType, snapLineweight } from '../drawing/types';
import { cadTransform, layerLw } from './geometry';

export interface DxfOptions { version?: 'R2000' | 'R12'; layers?: LayerSettings; includeHiddenLayers?: boolean }

const LTYPES: { name: LineType; desc: string; pattern: number[] }[] = [
  { name: 'CONTINUOUS', desc: 'Solid line', pattern: [] },
  { name: 'DASHED', desc: 'Dashed __ __ __', pattern: [12.7, -6.35] },
  { name: 'CENTER', desc: 'Center ____ _ ____', pattern: [31.75, -6.35, 6.35, -6.35] },
  { name: 'HIDDEN', desc: 'Hidden __ __ __', pattern: [6.35, -3.175] },
];
const ltName = (t: LineType) => (t === 'CONTINUOUS' ? 'Continuous' : t);

class W {
  lines: string[] = [];
  g(code: number, value: string | number) {
    this.lines.push(String(code).padStart(3, ' '), typeof value === 'number' ? fmt(value) : value);
  }
  toString() { return this.lines.join('\r\n') + '\r\n'; }
}
/** DXF text: ± as %%p, other non-ASCII as \U+XXXX (understood by AutoCAD R2000+ and most readers). */
const dxfText = (t: string) => t.replace(/±/g, '%%p').replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, (c) => '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));

function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(6);
  return s.replace(/\.?0+$/, '') || '0';
}

export function exportDXF(d: Drawing, opt: DxfOptions = {}): string {
  return (opt.version ?? 'R2000') === 'R12' ? exportR12(d, opt) : exportR2000(d, opt);
}

function entitiesFor(d: Drawing, opt: DxfOptions): Entity[] {
  if (opt.includeHiddenLayers || !opt.layers) return d.entities;
  return d.entities.filter((e) => opt.layers![e.layer]?.visible !== false || e.layer === '00_REFERENCE' || e.layer === '18_QC_REVIEW');
}

function extents(d: Drawing) {
  const { X, Y } = cadTransform(d);
  return { minX: X(d.bounds.x0), minY: Y(d.bounds.y1), maxX: X(d.bounds.x1), maxY: Y(d.bounds.y0) };
}

// ------------------------------------------------------------------ R2000

function exportR2000(d: Drawing, opt: DxfOptions): string {
  const w = new W();
  let next = 0x30;
  const h = () => (next++).toString(16).toUpperCase();
  const { X, Y, k } = cadTransform(d);
  const ext = extents(d);
  const ents = entitiesFor(d, opt);

  // pre-allocate handles referenced across sections
  const H = {
    vportTbl: h(), vport: h(), ltypeTbl: h(), ltByBlock: h(), ltByLayer: h(), layerTbl: h(), styleTbl: h(), styleStd: h(),
    viewTbl: h(), ucsTbl: h(), appidTbl: h(), appidAcad: h(), dimTbl: h(), dimStd: h(), brTbl: h(), brModel: h(), brPaper: h(),
    blkModel: h(), endModel: h(), blkPaper: h(), endPaper: h(),
    root: h(), groups: h(), layouts: h(), layoutModel: h(), layoutPaper: h(), plotStyles: h(), plotNormal: h(), mlineDict: h(), mlineStd: h(),
  };
  const ltHandles = new Map(LTYPES.map((l) => [l.name, h()]));
  const layerHandles = new Map<string, string>([['0', h()], ...LAYER_DEFS.map((l) => [l.name, h()] as [string, string])]);

  // ---- HEADER
  w.g(0, 'SECTION'); w.g(2, 'HEADER');
  w.g(9, '$ACADVER'); w.g(1, 'AC1015');
  w.g(9, '$DWGCODEPAGE'); w.g(3, 'ANSI_1252');
  w.g(9, '$INSBASE'); w.g(10, 0); w.g(20, 0); w.g(30, 0);
  w.g(9, '$EXTMIN'); w.g(10, ext.minX); w.g(20, ext.minY); w.g(30, 0);
  w.g(9, '$EXTMAX'); w.g(10, ext.maxX); w.g(20, ext.maxY); w.g(30, 0);
  w.g(9, '$LIMMIN'); w.g(10, ext.minX); w.g(20, ext.minY);
  w.g(9, '$LIMMAX'); w.g(10, ext.maxX); w.g(20, ext.maxY);
  w.g(9, '$LTSCALE'); w.g(40, d.mmPerPx ? 20 : Math.max(0.5, (ext.maxX - ext.minX) / 1500));
  w.g(9, '$CLAYER'); w.g(8, '0');
  w.g(9, '$CELTYPE'); w.g(6, 'ByLayer');
  w.g(9, '$CELWEIGHT'); w.g(370, -1);
  w.g(9, '$LWDISPLAY'); w.g(290, 1);
  w.g(9, '$INSUNITS'); w.g(70, d.mmPerPx ? 4 : 0);
  w.g(9, '$MEASUREMENT'); w.g(70, 1);
  w.g(9, '$HANDSEED'); w.g(5, 'FFFFF'); // patched below
  w.g(0, 'ENDSEC');
  const handseedIdx = w.lines.length - 3;

  // ---- CLASSES
  w.g(0, 'SECTION'); w.g(2, 'CLASSES'); w.g(0, 'ENDSEC');

  // ---- TABLES
  w.g(0, 'SECTION'); w.g(2, 'TABLES');
  const table = (name: string, handle: string, count: number, extra?: () => void) => {
    w.g(0, 'TABLE'); w.g(2, name); w.g(5, handle); w.g(330, '0'); w.g(100, 'AcDbSymbolTable'); w.g(70, count); extra?.();
  };
  const rec = (type: string, handle: string, owner: string, sub: string) => {
    w.g(0, type); w.g(type === 'DIMSTYLE' ? 105 : 5, handle); w.g(330, owner); w.g(100, 'AcDbSymbolTableRecord'); w.g(100, sub);
  };
  // VPORT
  table('VPORT', H.vportTbl, 1);
  rec('VPORT', H.vport, H.vportTbl, 'AcDbViewportTableRecord');
  w.g(2, '*Active'); w.g(70, 0); w.g(10, 0); w.g(20, 0); w.g(11, 1); w.g(21, 1);
  w.g(12, (ext.minX + ext.maxX) / 2); w.g(22, (ext.minY + ext.maxY) / 2); w.g(13, 0); w.g(23, 0); w.g(14, 10); w.g(24, 10); w.g(15, 10); w.g(25, 10);
  w.g(16, 0); w.g(26, 0); w.g(36, 1); w.g(17, 0); w.g(27, 0); w.g(37, 0);
  w.g(40, (ext.maxY - ext.minY) * 1.1); w.g(41, Math.max(0.5, (ext.maxX - ext.minX) / Math.max(1e-9, ext.maxY - ext.minY))); w.g(42, 50);
  w.g(43, 0); w.g(44, 0); w.g(50, 0); w.g(51, 0); w.g(71, 0); w.g(72, 100); w.g(73, 1); w.g(74, 3); w.g(75, 0); w.g(76, 0); w.g(77, 0); w.g(78, 0);
  w.g(0, 'ENDTAB');
  // LTYPE
  table('LTYPE', H.ltypeTbl, LTYPES.length + 2);
  for (const [name, hh] of [['ByBlock', H.ltByBlock], ['ByLayer', H.ltByLayer]]) {
    rec('LTYPE', hh, H.ltypeTbl, 'AcDbLinetypeTableRecord'); w.g(2, name); w.g(70, 0); w.g(3, ''); w.g(72, 65); w.g(73, 0); w.g(40, 0);
  }
  for (const lt of LTYPES) {
    rec('LTYPE', ltHandles.get(lt.name)!, H.ltypeTbl, 'AcDbLinetypeTableRecord');
    w.g(2, ltName(lt.name)); w.g(70, 0); w.g(3, lt.desc); w.g(72, 65); w.g(73, lt.pattern.length);
    w.g(40, lt.pattern.reduce((a, b) => a + Math.abs(b), 0));
    for (const p of lt.pattern) { w.g(49, p); w.g(74, 0); }
  }
  w.g(0, 'ENDTAB');
  // LAYER
  table('LAYER', H.layerTbl, LAYER_DEFS.length + 1);
  const layerRec = (name: string, color: number, lt: string, lw: number, plot: boolean, on: boolean) => {
    rec('LAYER', layerHandles.get(name)!, H.layerTbl, 'AcDbLayerTableRecord');
    w.g(2, name); w.g(70, 0); w.g(62, on ? color : -color); w.g(6, lt); w.g(290, plot ? 1 : 0); w.g(370, lw); w.g(390, H.plotNormal);
  };
  layerRec('0', 7, 'Continuous', -3, true, true);
  for (const L of LAYER_DEFS) {
    const lw = Math.round(snapLineweight(layerLw(L.name as LayerName, opt.layers)) * 100);
    const on = opt.layers ? opt.layers[L.name as LayerName]?.visible !== false : L.name !== '18_QC_REVIEW';
    layerRec(L.name, L.color, L.name === '15_FLOOR_LEVELS' ? 'DASHED' : 'Continuous', lw, L.plot, on);
  }
  w.g(0, 'ENDTAB');
  // STYLE
  table('STYLE', H.styleTbl, 1);
  rec('STYLE', H.styleStd, H.styleTbl, 'AcDbTextStyleTableRecord');
  w.g(2, 'Standard'); w.g(70, 0); w.g(40, 0); w.g(41, 1); w.g(50, 0); w.g(71, 0); w.g(42, 2.5); w.g(3, 'txt'); w.g(4, '');
  w.g(0, 'ENDTAB');
  table('VIEW', H.viewTbl, 0); w.g(0, 'ENDTAB');
  table('UCS', H.ucsTbl, 0); w.g(0, 'ENDTAB');
  table('APPID', H.appidTbl, 1);
  rec('APPID', H.appidAcad, H.appidTbl, 'AcDbRegAppTableRecord'); w.g(2, 'ACAD'); w.g(70, 0);
  w.g(0, 'ENDTAB');
  table('DIMSTYLE', H.dimTbl, 1, () => { w.g(100, 'AcDbDimStyleTable'); w.g(71, 0); });
  rec('DIMSTYLE', H.dimStd, H.dimTbl, 'AcDbDimStyleTableRecord'); w.g(2, 'Standard'); w.g(70, 0); w.g(340, H.styleStd);
  w.g(0, 'ENDTAB');
  table('BLOCK_RECORD', H.brTbl, 2);
  rec('BLOCK_RECORD', H.brModel, H.brTbl, 'AcDbBlockTableRecord'); w.g(2, '*Model_Space'); w.g(340, H.layoutModel); w.g(70, 0); w.g(280, 1); w.g(281, 0);
  rec('BLOCK_RECORD', H.brPaper, H.brTbl, 'AcDbBlockTableRecord'); w.g(2, '*Paper_Space'); w.g(340, H.layoutPaper); w.g(70, 0); w.g(280, 1); w.g(281, 0);
  w.g(0, 'ENDTAB');
  w.g(0, 'ENDSEC');

  // ---- BLOCKS
  w.g(0, 'SECTION'); w.g(2, 'BLOCKS');
  for (const [name, bh, eh, br, paper] of [['*Model_Space', H.blkModel, H.endModel, H.brModel, false], ['*Paper_Space', H.blkPaper, H.endPaper, H.brPaper, true]] as const) {
    w.g(0, 'BLOCK'); w.g(5, bh); w.g(330, br); w.g(100, 'AcDbEntity'); if (paper) w.g(67, 1); w.g(8, '0');
    w.g(100, 'AcDbBlockBegin'); w.g(2, name); w.g(70, 0); w.g(10, 0); w.g(20, 0); w.g(30, 0); w.g(3, name); w.g(1, '');
    w.g(0, 'ENDBLK'); w.g(5, eh); w.g(330, br); w.g(100, 'AcDbEntity'); if (paper) w.g(67, 1); w.g(8, '0'); w.g(100, 'AcDbBlockEnd');
  }
  w.g(0, 'ENDSEC');

  // ---- ENTITIES
  w.g(0, 'SECTION'); w.g(2, 'ENTITIES');
  const head = (type: string, e: Entity) => {
    w.g(0, type); w.g(5, h()); w.g(330, H.brModel); w.g(100, 'AcDbEntity'); w.g(8, e.layer);
    if (e.ltype && e.ltype !== 'CONTINUOUS') w.g(6, ltName(e.ltype));
    if (e.lw !== undefined) w.g(370, Math.round(snapLineweight(e.lw) * 100));
  };
  for (const e of ents) {
    switch (e.type) {
      case 'line':
        head('LINE', e); w.g(100, 'AcDbLine');
        w.g(10, X(e.a.x)); w.g(20, Y(e.a.y)); w.g(30, 0); w.g(11, X(e.b.x)); w.g(21, Y(e.b.y)); w.g(31, 0);
        break;
      case 'poly':
        head('LWPOLYLINE', e); w.g(100, 'AcDbPolyline'); w.g(90, e.pts.length); w.g(70, e.closed ? 1 : 0); w.g(43, 0);
        e.pts.forEach((p, i) => { w.g(10, X(p.x)); w.g(20, Y(p.y)); const b = e.bulges?.[i]; if (b) w.g(42, b); });
        break;
      case 'arc':
        head('ARC', e); w.g(100, 'AcDbCircle'); w.g(10, X(e.c.x)); w.g(20, Y(e.c.y)); w.g(30, 0); w.g(40, e.r * k);
        w.g(100, 'AcDbArc'); w.g(50, e.a0); w.g(51, e.a1);
        break;
      case 'circle':
        head('CIRCLE', e); w.g(100, 'AcDbCircle'); w.g(10, X(e.c.x)); w.g(20, Y(e.c.y)); w.g(30, 0); w.g(40, e.r * k);
        break;
      case 'text': {
        head('TEXT', e); w.g(100, 'AcDbText');
        w.g(10, X(e.p.x)); w.g(20, Y(e.p.y)); w.g(30, 0); w.g(40, e.h * k); w.g(1, dxfText(e.text));
        w.g(7, 'Standard');
        const al = e.align === 'center' ? 1 : e.align === 'right' ? 2 : 0;
        if (al) { w.g(72, al); w.g(11, X(e.p.x)); w.g(21, Y(e.p.y)); w.g(31, 0); }
        w.g(100, 'AcDbText');
        break;
      }
    }
  }
  w.g(0, 'ENDSEC');

  // ---- OBJECTS
  w.g(0, 'SECTION'); w.g(2, 'OBJECTS');
  const dict = (handle: string, owner: string, entries: [string, string][], type = 'DICTIONARY') => {
    w.g(0, type); w.g(5, handle); w.g(330, owner); w.g(100, 'AcDbDictionary'); w.g(281, 1);
    for (const [k2, v] of entries) { w.g(3, k2); w.g(350, v); }
  };
  dict(H.root, '0', [['ACAD_GROUP', H.groups], ['ACAD_LAYOUT', H.layouts], ['ACAD_MLINESTYLE', H.mlineDict], ['ACAD_PLOTSTYLENAME', H.plotStyles]]);
  dict(H.groups, H.root, []);
  dict(H.layouts, H.root, [['Model', H.layoutModel], ['Layout1', H.layoutPaper]]);
  dict(H.mlineDict, H.root, [['Standard', H.mlineStd]]);
  dict(H.plotStyles, H.root, [['Normal', H.plotNormal]], 'ACDBDICTIONARYWDFLT');
  w.g(100, 'AcDbDictionaryWithDefault'); w.g(340, H.plotNormal);
  w.g(0, 'ACDBPLACEHOLDER'); w.g(5, H.plotNormal); w.g(330, H.plotStyles);
  // MLINESTYLE Standard
  w.g(0, 'MLINESTYLE'); w.g(5, H.mlineStd); w.g(330, H.mlineDict); w.g(100, 'AcDbMlineStyle'); w.g(2, 'Standard'); w.g(70, 0); w.g(3, '');
  w.g(62, 256); w.g(51, 90); w.g(52, 90); w.g(71, 2);
  w.g(49, 0.5); w.g(62, 256); w.g(6, 'BYLAYER'); w.g(49, -0.5); w.g(62, 256); w.g(6, 'BYLAYER');
  const layout = (handle: string, name: string, tab: number, br: string) => {
    w.g(0, 'LAYOUT'); w.g(5, handle); w.g(330, H.layouts);
    w.g(100, 'AcDbPlotSettings'); w.g(1, ''); w.g(2, 'none_device'); w.g(4, ''); w.g(6, '');
    w.g(40, 0); w.g(41, 0); w.g(42, 0); w.g(43, 0); w.g(44, 0); w.g(45, 0); w.g(46, 0); w.g(47, 0); w.g(48, 0); w.g(49, 0);
    w.g(140, 0); w.g(141, 0); w.g(142, 1); w.g(143, 1); w.g(70, 688); w.g(72, 1); w.g(73, 0); w.g(74, 5); w.g(7, ''); w.g(75, 16); w.g(147, 1); w.g(148, 0); w.g(149, 0);
    w.g(100, 'AcDbLayout'); w.g(1, name); w.g(70, 1); w.g(71, tab);
    w.g(10, 0); w.g(20, 0); w.g(11, 420); w.g(21, 297); w.g(12, 0); w.g(22, 0); w.g(32, 0);
    w.g(14, ext.minX); w.g(24, ext.minY); w.g(34, 0); w.g(15, ext.maxX); w.g(25, ext.maxY); w.g(35, 0);
    w.g(146, 0); w.g(13, 0); w.g(23, 0); w.g(33, 0); w.g(16, 1); w.g(26, 0); w.g(36, 0); w.g(17, 0); w.g(27, 1); w.g(37, 0); w.g(76, 0);
    w.g(330, br);
  };
  layout(H.layoutModel, 'Model', 0, H.brModel);
  layout(H.layoutPaper, 'Layout1', 1, H.brPaper);
  w.g(0, 'ENDSEC');
  w.g(0, 'EOF');
  w.lines[handseedIdx] = next.toString(16).toUpperCase();
  return w.toString();
}

// ------------------------------------------------------------------ R12

function exportR12(d: Drawing, opt: DxfOptions): string {
  const w = new W();
  const { X, Y, k } = cadTransform(d);
  const ext = extents(d);
  w.g(0, 'SECTION'); w.g(2, 'HEADER');
  w.g(9, '$ACADVER'); w.g(1, 'AC1009');
  w.g(9, '$EXTMIN'); w.g(10, ext.minX); w.g(20, ext.minY); w.g(30, 0);
  w.g(9, '$EXTMAX'); w.g(10, ext.maxX); w.g(20, ext.maxY); w.g(30, 0);
  w.g(9, '$LTSCALE'); w.g(40, d.mmPerPx ? 20 : 1);
  w.g(0, 'ENDSEC');
  w.g(0, 'SECTION'); w.g(2, 'TABLES');
  w.g(0, 'TABLE'); w.g(2, 'LTYPE'); w.g(70, LTYPES.length);
  for (const lt of LTYPES) {
    w.g(0, 'LTYPE'); w.g(2, ltName(lt.name)); w.g(70, 0); w.g(3, lt.desc); w.g(72, 65); w.g(73, lt.pattern.length);
    w.g(40, lt.pattern.reduce((a, b) => a + Math.abs(b), 0));
    for (const p of lt.pattern) w.g(49, p);
  }
  w.g(0, 'ENDTAB');
  w.g(0, 'TABLE'); w.g(2, 'LAYER'); w.g(70, LAYER_DEFS.length + 1);
  w.g(0, 'LAYER'); w.g(2, '0'); w.g(70, 0); w.g(62, 7); w.g(6, 'Continuous');
  for (const L of LAYER_DEFS) {
    const on = opt.layers ? opt.layers[L.name as LayerName]?.visible !== false : L.name !== '18_QC_REVIEW';
    w.g(0, 'LAYER'); w.g(2, L.name); w.g(70, 0); w.g(62, on ? L.color : -L.color); w.g(6, L.name === '15_FLOOR_LEVELS' ? 'DASHED' : 'Continuous');
  }
  w.g(0, 'ENDTAB');
  w.g(0, 'ENDSEC');
  w.g(0, 'SECTION'); w.g(2, 'ENTITIES');
  for (const e of entitiesFor(d, opt)) {
    const lt = () => { if (e.ltype && e.ltype !== 'CONTINUOUS') w.g(6, ltName(e.ltype)); };
    switch (e.type) {
      case 'line':
        w.g(0, 'LINE'); w.g(8, e.layer); lt(); w.g(10, X(e.a.x)); w.g(20, Y(e.a.y)); w.g(30, 0); w.g(11, X(e.b.x)); w.g(21, Y(e.b.y)); w.g(31, 0);
        break;
      case 'poly':
        w.g(0, 'POLYLINE'); w.g(8, e.layer); lt(); w.g(66, 1); w.g(10, 0); w.g(20, 0); w.g(30, 0); w.g(70, e.closed ? 1 : 0);
        e.pts.forEach((p, i) => { w.g(0, 'VERTEX'); w.g(8, e.layer); w.g(10, X(p.x)); w.g(20, Y(p.y)); w.g(30, 0); const b = e.bulges?.[i]; if (b) w.g(42, b); });
        w.g(0, 'SEQEND'); w.g(8, e.layer);
        break;
      case 'arc':
        w.g(0, 'ARC'); w.g(8, e.layer); w.g(10, X(e.c.x)); w.g(20, Y(e.c.y)); w.g(30, 0); w.g(40, e.r * k); w.g(50, e.a0); w.g(51, e.a1);
        break;
      case 'circle':
        w.g(0, 'CIRCLE'); w.g(8, e.layer); w.g(10, X(e.c.x)); w.g(20, Y(e.c.y)); w.g(30, 0); w.g(40, e.r * k);
        break;
      case 'text': {
        w.g(0, 'TEXT'); w.g(8, e.layer); w.g(10, X(e.p.x)); w.g(20, Y(e.p.y)); w.g(30, 0); w.g(40, e.h * k); w.g(1, dxfText(e.text));
        const al = e.align === 'center' ? 1 : e.align === 'right' ? 2 : 0;
        if (al) { w.g(72, al); w.g(11, X(e.p.x)); w.g(21, Y(e.p.y)); w.g(31, 0); }
        break;
      }
    }
  }
  w.g(0, 'ENDSEC');
  w.g(0, 'EOF');
  return w.toString();
}
