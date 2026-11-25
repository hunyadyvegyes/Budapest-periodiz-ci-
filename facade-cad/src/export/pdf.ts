// Minimal vector PDF writer (single page, PDF 1.4): lines with real line weights, dashes and text.
import { Pt } from '../core/geom';
import { Drawing, LAYER_DEFS, LayerSettings } from '../drawing/types';
import { arcPoints, autoScale, entityLw, flattenPoly, paperLayout, visibleEntities } from './geometry';

const MM = 72 / 25.4;
const n = (v: number) => (Math.round(v * 100) / 100).toString();
const pdfStr = (s: string) => '(' + s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, (c) => (c === '±' ? '\\261' : c === '–' ? '-' : c === '°' ? '\\260' : '?')) + ')';

export function exportPDF(d: Drawing, layers?: LayerSettings, opt: { scaleDenom?: number } = {}): Uint8Array {
  const paper = paperLayout(d, d.mmPerPx ? { scaleDenom: opt.scaleDenom ?? autoScale(d) } : { fitWidthMm: 380 });
  const W = paper.wMm * MM, H = paper.hMm * MM;
  // PDF y-axis points up
  const T = (p: Pt): Pt => ({ x: ((p.x - paper.ox) * paper.px2mm + paper.marginMm) * MM, y: H - ((p.y - paper.oy) * paper.px2mm + paper.marginMm) * MM });
  const ents = visibleEntities(d, layers);
  const ops: string[] = ['1 J 1 j 0 0 0 RG 0 0 0 rg'];
  for (const L of LAYER_DEFS) {
    const es = ents.filter((e) => e.layer === L.name);
    if (!es.length) continue;
    ops.push(`% layer ${L.name}`);
    for (const e of es) {
      if (e.type === 'text') {
        const p = T(e.p), size = e.h * paper.px2mm * MM;
        const approxW = e.text.length * size * 0.5;
        const x = e.align === 'center' ? p.x - approxW / 2 : e.align === 'right' ? p.x - approxW : p.x;
        ops.push(`BT /F1 ${n(size)} Tf ${n(x)} ${n(p.y)} Td ${pdfStr(e.text)} Tj ET`);
        continue;
      }
      let pts: Pt[];
      if (e.type === 'line') pts = [e.a, e.b];
      else if (e.type === 'poly') pts = flattenPoly(e.pts, e.closed, e.bulges);
      else if (e.type === 'arc') pts = arcPoints(e.c, e.r, e.a0, e.a1);
      else pts = arcPoints(e.c, e.r, 0, 360);
      const tp = pts.map(T);
      ops.push(`${n(entityLw(e, layers) * MM)} w ${e.ltype === 'DASHED' ? '[8 4] 0 d' : '[] 0 d'}`);
      ops.push(`${n(tp[0].x)} ${n(tp[0].y)} m ` + tp.slice(1).map((p) => `${n(p.x)} ${n(p.y)} l`).join(' ') + (e.type === 'poly' && e.closed ? ' h S' : ' S'));
    }
  }
  const content = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Title (Facade elevation) /Producer (facade-cad) /Creator (facade-cad) >>`,
  ];
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // all content is ASCII except the binary comment; encode as latin1 so byte offsets match
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
