// FacadeModel + detail level -> vector Drawing.
// Every level is generated from the same semantic model, so level switches are instant and
// edits made to the model carry over to all levels.
import { Pt, Rect, median } from '../core/geom';
import { Band, FacadeModel, Opening, openingInner } from '../core/model';
import { cleanup } from './cleanup';
import { DetailLevel, Drawing, Entity, LayerName, LineType } from './types';

export interface GenerateOptions { mmPerPx: number | null; title?: string; annotate?: boolean }

class Builder {
  ents: Entity[] = [];
  constructor(public level: DetailLevel) {}
  line(id: string, layer: LayerName, a: Pt, b: Pt, o: { lw?: number; ltype?: LineType; src?: string } = {}) {
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) return;
    this.ents.push({ type: 'line', id, layer, a, b, ...o });
  }
  poly(id: string, layer: LayerName, pts: Pt[], closed: boolean, o: { lw?: number; ltype?: LineType; src?: string; bulges?: number[] } = {}) {
    if (pts.length < 2) return;
    this.ents.push({ type: 'poly', id, layer, pts, closed, ...o } as Entity);
  }
  rect(id: string, layer: LayerName, r: Rect, o: { lw?: number; src?: string } = {}) {
    if (r.w < 0.5 || r.h < 0.5) return;
    this.poly(id, layer, [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }], true, o);
  }
  text(id: string, p: Pt, h: number, text: string, align: 'left' | 'center' | 'right' = 'left', layer: LayerName = '17_ANNOTATION') {
    this.ents.push({ type: 'text', id, layer, p, h, text, align });
  }
}

// ------------------------------------------------------------------ opening geometry

/** Outline of an opening (rect or arched head) as a closed polyline with bulges (CAD convention). */
export function openingOutline(r: Rect, archRise?: number, round?: boolean): { pts: Pt[]; bulges: number[] } {
  const x0 = r.x, x1 = r.x + r.w, y0 = r.y, y1 = r.y + r.h;
  if (!archRise || archRise < 1) return { pts: [{ x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y0 }, { x: x0, y: y0 }], bulges: [0, 0, 0, 0] };
  const c = r.w / 2;
  const f = round ? c : Math.min(archRise, c);
  const ys = y0 + f; // springing line
  // BL -> BR -> right springing -(arc over the top)-> left springing -> close
  return { pts: [{ x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: ys }, { x: x0, y: ys }], bulges: [0, 0, f / c, 0] };
}

/** Top y of the (possibly arched) inner outline at x. */
function archTopAt(inner: Rect, rise: number, x: number): number {
  if (rise < 1) return inner.y;
  const c = inner.w / 2, f = Math.min(rise, c), R = (c * c + f * f) / (2 * f);
  const dx = x - (inner.x + c);
  return inner.y + (R - Math.sqrt(Math.max(0, R * R - dx * dx)));
}

function emitOpening(b: Builder, o: Opening) {
  const L = b.level;
  const isDoor = o.kind !== 'window' && o.kind !== 'shopfront';
  const rise = o.arch?.rise ?? 0;
  const round = o.arch?.type === 'round';
  const outer = openingOutline(o.rect, rise, round);
  b.poly(`${o.id}:outline`, '03_OPENINGS', outer.pts, true, { bulges: outer.bulges, src: o.id });
  if (L === 1) return;

  const inner = openingInner(o);
  const innerRise = rise > 0 ? Math.max(0, rise - o.frame) : 0;
  const innerOut = openingOutline(inner, innerRise, round);
  if (o.frame >= 1) b.poly(`${o.id}:frame`, '06_FRAMES', innerOut.pts, true, { bulges: innerOut.bulges, src: o.id });
  if (L === 3 && o.frame >= 3) {
    // frame components: outer frame / casing split
    const mid = { x: o.rect.x + o.frame / 2, y: o.rect.y + o.frame / 2, w: o.rect.w - o.frame, h: o.rect.h - o.frame };
    const mo = openingOutline(mid, rise > 0 ? rise - o.frame / 2 : 0, round);
    b.poly(`${o.id}:frame2`, '06_FRAMES', mo.pts, true, { bulges: mo.bulges, src: o.id, lw: 0.09 });
  }
  // subdivisions
  const maxM = Math.max(0, ...o.mullionStrength), maxT = Math.max(0, ...o.transomStrength);
  const majorM = o.mullions.filter((_, i) => L === 3 || o.mullionStrength[i] >= 0.5 * maxM);
  const majorT = o.transoms.filter((_, i) => L === 3 || o.transomStrength[i] >= 0.5 * maxT);
  const bar = Math.max(1, o.frame * 0.7);
  const springY = inner.y + innerRise;
  const xs = [inner.x, ...majorM.map((m) => inner.x + m * inner.w).sort((a, c) => a - c), inner.x + inner.w];
  const ys = [inner.y, ...majorT.map((t) => inner.y + t * inner.h).filter((y) => y > springY - 1 || !innerRise).sort((a, c) => a - c), inner.y + inner.h];
  const layer: LayerName = isDoor ? '05_DOORS' : '06_FRAMES';
  xs.slice(1, -1).forEach((x, i) => {
    const top = archTopAt(inner, innerRise, x);
    if (isDoor && bar < 2) { b.line(`${o.id}:m${i}`, layer, { x, y: top }, { x, y: inner.y + inner.h }, { src: o.id }); return; }
    for (const s of [-1, 1]) b.line(`${o.id}:m${i}${s > 0 ? 'r' : 'l'}`, layer, { x: x + (s * bar) / 2, y: archTopAt(inner, innerRise, x + (s * bar) / 2) }, { x: x + (s * bar) / 2, y: inner.y + inner.h }, { src: o.id });
    void top;
  });
  ys.slice(1, -1).forEach((y, i) => {
    for (const s of [-1, 1]) b.line(`${o.id}:t${i}${s > 0 ? 'b' : 't'}`, layer, { x: inner.x, y: y + (s * bar) / 2 }, { x: inner.x + inner.w, y: y + (s * bar) / 2 }, { src: o.id });
  });
  // sashes / panes
  if (!isDoor) {
    const sash = Math.max(0.8, o.frame * 0.45);
    for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
      const px0 = xs[i] + (i ? bar / 2 : 0), px1 = xs[i + 1] - (i + 1 < xs.length - 1 ? bar / 2 : 0);
      const py0 = ys[j] + (j ? bar / 2 : 0), py1 = ys[j + 1] - (j + 1 < ys.length - 1 ? bar / 2 : 0);
      if (px1 - px0 < 3 || py1 - py0 < 3) continue;
      const pane = { x: px0 + sash, y: py0 + sash, w: px1 - px0 - 2 * sash, h: py1 - py0 - 2 * sash };
      const inArch = innerRise > 0 && j === 0 && py0 < springY - 1;
      if (inArch) {
        // arched top pane: follow the arch
        const pts: Pt[] = [];
        const n = 12;
        for (let k = 0; k <= n; k++) { const x = pane.x + (pane.w * k) / n; pts.push({ x, y: Math.max(pane.y, archTopAt(inner, innerRise, x) + sash) }); }
        pts.push({ x: pane.x + pane.w, y: pane.y + pane.h }, { x: pane.x, y: pane.y + pane.h });
        b.poly(`${o.id}:p${i}_${j}`, '04_WINDOWS', pts, true, { src: o.id });
      } else b.rect(`${o.id}:p${i}_${j}`, '04_WINDOWS', pane, { src: o.id });
      if (L === 3 && pane.w > 6 && pane.h > 6 && !inArch) {
        const g = Math.max(0.6, sash * 0.6);
        b.rect(`${o.id}:g${i}_${j}`, '04_WINDOWS', { x: pane.x + g, y: pane.y + g, w: pane.w - 2 * g, h: pane.h - 2 * g }, { src: o.id, lw: 0.09 });
      }
    }
  }
  if (L === 3) o.handles.forEach((h, i) => b.poly(`${o.id}:h${i}`, '04_WINDOWS', [{ x: h.x, y: h.y - 2 }, { x: h.x, y: h.y + 3 }], false, { src: o.id }));
  // sill and hood
  if (o.sill) {
    const s = o.sill;
    b.rect(`${o.id}:sill`, '10_CORNICES', s, { src: o.id });
    if (L === 3 && s.h >= 3) b.line(`${o.id}:sill2`, '10_CORNICES', { x: s.x, y: s.y + s.h * 0.4 }, { x: s.x + s.w, y: s.y + s.h * 0.4 }, { src: o.id, lw: 0.09 });
  }
  if (o.hood) b.rect(`${o.id}:hood`, '10_CORNICES', o.hood, { src: o.id });
}

// ------------------------------------------------------------------ bands etc.

function emitBand(b: Builder, band: Band) {
  const L = b.level, x0 = band.x0, x1 = band.x1;
  const lines = [...band.lines].sort((a, c) => a - c);
  const id = band.id;
  if (L === 1) {
    if (band.kind === 'cornice') {
      b.line(`${id}:top`, '10_CORNICES', { x: x0, y: band.y0 }, { x: x1, y: band.y0 }, { src: id });
      if (band.y1 - band.y0 > 2) b.line(`${id}:bot`, '10_CORNICES', { x: x0, y: band.y1 }, { x: x1, y: band.y1 }, { src: id });
    } else if (band.kind === 'plinth' || band.kind === 'string_course') {
      b.line(`${id}:c`, '10_CORNICES', { x: x0, y: band.y0 }, { x: x1, y: band.y0 }, { src: id });
    }
    return;
  }
  let pick = lines;
  if (L === 2 && lines.length > 3) pick = [lines[0], lines[Math.floor(lines.length / 2)], lines[lines.length - 1]];
  pick.forEach((y, i) => {
    const last = i === pick.length - 1;
    // shadow line under projecting elements is drawn heavier (depth cue)
    b.line(`${id}:l${i}`, '10_CORNICES', { x: x0, y }, { x: x1, y }, { src: id, lw: last && band.projecting ? 0.35 : undefined });
  });
  if (L === 3 && band.projecting && band.y1 - band.y0 > 3) {
    // returns at the facade edges
    b.line(`${id}:rl`, '10_CORNICES', { x: x0, y: band.y0 }, { x: x0, y: band.y1 }, { src: id });
    b.line(`${id}:rr`, '10_CORNICES', { x: x1, y: band.y0 }, { x: x1, y: band.y1 }, { src: id });
  }
}

/** Horizontal line at y minus the x-intervals covered by `holes`. */
function clippedH(y: number, x0: number, x1: number, holes: Rect[]): [number, number][] {
  let segs: [number, number][] = [[x0, x1]];
  for (const h of holes) {
    if (y < h.y || y > h.y + h.h) continue;
    const next: [number, number][] = [];
    for (const [a, c] of segs) {
      if (h.x + h.w <= a || h.x >= c) { next.push([a, c]); continue; }
      if (h.x > a) next.push([a, h.x]);
      if (h.x + h.w < c) next.push([h.x + h.w, c]);
    }
    segs = next;
  }
  return segs.filter(([a, c]) => c - a > 1);
}

function emitMaterials(b: Builder, m: FacadeModel, holes: Rect[]) {
  for (const z of m.materials) {
    if (z.pattern === 'tiles') {
      // tile courses clipped to the roof polygon
      const rf = (x: number) => {
        const L = m.roof.line;
        for (let i = 1; i < L.length; i++) if (x <= L[i].x) { const t = (x - L[i - 1].x) / (L[i].x - L[i - 1].x || 1); return L[i - 1].y + t * (L[i].y - L[i - 1].y); }
        return L[L.length - 1].y;
      };
      z.courses.forEach((y, i) => {
        let a = -1;
        for (let x = m.facade.x0; x <= m.facade.x1 + 1; x += 1) {
          const inside = x <= m.facade.x1 && rf(x) < y - 1;
          if (inside && a < 0) a = x;
          if (!inside && a >= 0) { b.line(`${z.id}:c${i}_${a}`, '13_HATCHING', { x: a, y }, { x: x - 1, y }); a = -1; }
        }
      });
      continue;
    }
    z.courses.forEach((y, i) => {
      clippedH(y, z.rect.x, z.rect.x + z.rect.w, holes).forEach(([a, c], k) => b.line(`${z.id}:c${i}_${k}`, '13_HATCHING', { x: a, y }, { x: c, y }));
    });
    if (z.pattern === 'brick' && z.jointSpacing && z.courses.length > 1) {
      const sp = z.jointSpacing;
      for (let i = 0; i + 1 < z.courses.length; i++) {
        const y0 = z.courses[i], y1 = z.courses[i + 1];
        for (let x = z.rect.x + ((i % 2) * sp) / 2; x < z.rect.x + z.rect.w; x += sp) {
          if (holes.some((h) => x >= h.x && x <= h.x + h.w && y1 >= h.y && y0 <= h.y + h.h)) continue;
          b.line(`${z.id}:j${i}_${Math.round(x)}`, '13_HATCHING', { x, y: y0 }, { x, y: y1 });
        }
      }
    }
  }
}

// ------------------------------------------------------------------ main

export function generateDrawing(m: FacadeModel, level: DetailLevel, opt: GenerateOptions): Drawing {
  const b = new Builder(level);
  const f = m.facade, fw = f.x1 - f.x0;
  // reference frame
  b.rect('ref:frame', '00_REFERENCE', { x: 0, y: 0, w: m.width, h: m.height });
  // building outline (silhouette incl. roof) and ground line
  b.poly('outline', '01_BUILDING_OUTLINE', m.outline, true, { src: 'outline' });
  b.line('ground', '12_GROUND', { x: f.x0 - 0.04 * fw, y: f.ground }, { x: f.x1 + 0.04 * fw, y: f.ground }, { src: 'ground' });
  // roof
  if (m.roof.pitched) b.line('roof:eave', '09_ROOF', { x: f.x0, y: m.roof.eaveY }, { x: f.x1, y: m.roof.eaveY }, { src: 'roof' });
  if (level >= 2) b.poly('roof:line', '09_ROOF', m.roof.line, false, { src: 'roof' });
  // floor levels
  m.floors.forEach((fl) => {
    if (fl.index === 0) return;
    b.line(`floor${fl.index}`, '15_FLOOR_LEVELS', { x: f.x0, y: fl.y }, { x: f.x1, y: fl.y }, { ltype: 'DASHED', src: `floor${fl.index}` });
  });
  // bands
  for (const band of m.bands) emitBand(b, band);
  // verticals
  if (level >= 2) for (const v of m.verticals) {
    if (v.kind === 'downpipe') {
      b.rect(`${v.id}:pipe`, '16_DRAINAGE', { x: v.x0, y: v.y0, w: Math.max(1, v.x1 - v.x0), h: v.y1 - v.y0 }, { src: v.id });
      if (level === 3) for (let y = v.y0 + (v.y1 - v.y0) * 0.2; y < v.y1 - 4; y += (v.y1 - v.y0) * 0.2) b.line(`${v.id}:br${Math.round(y)}`, '16_DRAINAGE', { x: v.x0 - 1.5, y }, { x: v.x1 + 1.5, y }, { src: v.id });
    } else if (v.kind === 'pilaster' || v.kind === 'column') {
      b.line(`${v.id}:l`, '14_COLUMNS_PILASTERS', { x: v.x0, y: v.y0 }, { x: v.x0, y: v.y1 }, { src: v.id });
      b.line(`${v.id}:r`, '14_COLUMNS_PILASTERS', { x: v.x1, y: v.y0 }, { x: v.x1, y: v.y1 }, { src: v.id, lw: 0.35 });
      if (level === 3) v.lines.forEach((x, i) => b.line(`${v.id}:f${i}`, '14_COLUMNS_PILASTERS', { x, y: v.y0 }, { x, y: v.y1 }, { src: v.id, lw: 0.09 }));
    } else b.line(`${v.id}:e`, '02_WALLS', { x: v.x0, y: v.y0 }, { x: v.x0, y: v.y1 }, { src: v.id });
  }
  // openings
  for (const o of m.openings) emitOpening(b, o);
  // balconies
  for (const k of m.balconies) {
    const slab = { x: k.x0, y: k.slabTop, w: k.x1 - k.x0, h: Math.max(1, k.slabBottom - k.slabTop) };
    b.rect(`${k.id}:slab`, '07_BALCONIES', slab, { src: k.id });
    if (level === 1) {
      b.rect(`${k.id}:rail`, '08_RAILINGS', { x: k.x0, y: k.railTop, w: k.x1 - k.x0, h: k.slabTop - k.railTop }, { src: k.id });
      continue;
    }
    const rail = Math.max(1.5, (k.slabTop - k.railTop) * 0.08);
    b.line(`${k.id}:rt`, '08_RAILINGS', { x: k.x0, y: k.railTop }, { x: k.x1, y: k.railTop }, { src: k.id, lw: 0.18 });
    b.line(`${k.id}:rt2`, '08_RAILINGS', { x: k.x0, y: k.railTop + rail }, { x: k.x1, y: k.railTop + rail }, { src: k.id });
    b.line(`${k.id}:end0`, '08_RAILINGS', { x: k.x0, y: k.railTop }, { x: k.x0, y: k.slabTop }, { src: k.id });
    b.line(`${k.id}:end1`, '08_RAILINGS', { x: k.x1, y: k.railTop }, { x: k.x1, y: k.slabTop }, { src: k.id });
    if (k.railing === 'balusters' || k.railing === 'bars') {
      const posts = regularPosts(k.posts);
      const pw = posts.length > 1 ? Math.max(1, (posts[1] - posts[0]) * (k.railing === 'balusters' ? 0.35 : 0.15)) : 2;
      posts.forEach((x, i) => {
        if (level === 3 && pw >= 1.5) {
          b.line(`${k.id}:p${i}l`, '08_RAILINGS', { x: x - pw / 2, y: k.railTop + rail }, { x: x - pw / 2, y: k.slabTop }, { src: k.id });
          b.line(`${k.id}:p${i}r`, '08_RAILINGS', { x: x + pw / 2, y: k.railTop + rail }, { x: x + pw / 2, y: k.slabTop }, { src: k.id });
        } else b.line(`${k.id}:p${i}`, '08_RAILINGS', { x, y: k.railTop + rail }, { x, y: k.slabTop }, { src: k.id });
      });
      if (level === 3) b.line(`${k.id}:br`, '08_RAILINGS', { x: k.x0, y: k.slabTop - rail }, { x: k.x1, y: k.slabTop - rail }, { src: k.id });
    }
  }
  // ornaments
  if (level >= 2) for (const n of m.ornaments) {
    const paths = level === 3 ? n.paths : n.paths.slice(0, 1);
    paths.forEach((p, i) => b.poly(`${n.id}:${i}`, '11_DECORATIVE_DETAILS', p, dist2(p[0], p[p.length - 1]) < 4, { src: n.id }));
  }
  // materials (level 2: zone boundaries as material transitions; level 3: coursing)
  const holes = m.openings.flatMap((o) => [o.rect, o.sill, o.hood].filter(Boolean) as Rect[])
    .concat(m.balconies.map((k) => ({ x: k.x0, y: k.railTop, w: k.x1 - k.x0, h: k.slabBottom - k.railTop })));
  if (level === 2) for (const z of m.materials) if (z.pattern !== 'tiles') {
    for (const y of [z.rect.y, z.rect.y + z.rect.h]) clippedH(y, f.x0, f.x1, holes).forEach(([a, c], k) => b.line(`${z.id}:edge${Math.round(y)}_${k}`, '02_WALLS', { x: a, y }, { x: c, y }, { src: z.id }));
  }
  if (level === 3) emitMaterials(b, m, holes);
  // user lines
  for (const u of m.userLines) b.poly(u.id, u.layer as LayerName, u.pts, u.closed, { src: u.id });
  // QC markers
  for (const o of m.openings) if (o.confidence < 0.5 || o.source === 'inferred') b.rect(`qc:${o.id}`, '18_QC_REVIEW', { x: o.rect.x - 3, y: o.rect.y - 3, w: o.rect.w + 6, h: o.rect.h + 6 }, { src: o.id });
  for (const r of m.occlusions) b.rect(`qc:occ${Math.round(r.x)}_${Math.round(r.y)}`, '18_QC_REVIEW', r);
  if (opt.annotate !== false) annotate(b, m, opt);

  const suppressed = new Set(m.suppressed);
  const kept = b.ents.filter((e) => !suppressed.has(e.id));
  const { entities, duplicatesRemoved, merged } = cleanup(kept);
  const xs = m.outline.map((p) => p.x), ys = m.outline.map((p) => p.y);
  return {
    entities, level, mmPerPx: opt.mmPerPx, origin: { x: f.x0, y: f.ground },
    bounds: { x0: Math.min(...xs) - 0.06 * fw, y0: Math.min(...ys) - 0.05 * fw, x1: Math.max(...xs) + 0.12 * fw, y1: f.ground + 0.1 * fw },
    stats: { duplicatesRemoved, merged },
  };
}

const dist2 = (a: Pt, b: Pt) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Detected baluster positions are noisy: snap them to a regular spacing when they clearly are regular. */
export function regularPosts(posts: number[]): number[] {
  if (posts.length < 4) return posts;
  const sp = posts.slice(1).map((x, i) => x - posts[i]);
  const m = median(sp);
  if (sp.filter((s) => Math.abs(s - m) < 0.3 * m).length < sp.length * 0.7) return posts;
  const n = Math.round((posts[posts.length - 1] - posts[0]) / m);
  const step = (posts[posts.length - 1] - posts[0]) / Math.max(1, n);
  return Array.from({ length: n + 1 }, (_, i) => posts[0] + i * step);
}

function annotate(b: Builder, m: FacadeModel, opt: GenerateOptions) {
  const f = m.facade, fw = f.x1 - f.x0;
  const th = Math.max(6, fw * 0.012);
  const xl = f.x1 + 0.03 * fw;
  const fmt = (px: number) => {
    if (!opt.mmPerPx) return '';
    const v = (px * opt.mmPerPx) / 1000;
    return (v >= 0 ? '+' : '') + v.toFixed(2);
  };
  const mark = (id: string, y: number, label: string) => {
    b.line(`${id}:tick`, '17_ANNOTATION', { x: f.x1 + 0.01 * fw, y }, { x: xl + th * 5, y });
    b.poly(`${id}:tri`, '17_ANNOTATION', [{ x: xl, y }, { x: xl - th * 0.45, y: y - th * 0.7 }, { x: xl + th * 0.45, y: y - th * 0.7 }], true);
    b.text(`${id}:txt`, { x: xl + th * 0.8, y: y - th * 0.35 }, th, label);
  };
  mark('lvl:ground', f.ground, opt.mmPerPx ? '±0.00' : 'GL');
  m.floors.forEach((fl) => { if (fl.index > 0) mark(`lvl:f${fl.index}`, fl.y, opt.mmPerPx ? `${fmt(f.ground - fl.y)}${fl.estimated ? ' (est.)' : ''}` : `FL ${fl.index}`); });
  mark('lvl:eave', m.roof.eaveY, opt.mmPerPx ? fmt(f.ground - m.roof.eaveY) : 'EAVE');
  const top = Math.min(...m.roof.line.map((p) => p.y));
  if (m.roof.pitched) mark('lvl:top', top, opt.mmPerPx ? fmt(f.ground - top) : 'TOP');
  const ty = f.ground + th * 3;
  b.text('title', { x: f.x0, y: ty }, th * 1.3, opt.title ?? 'FACADE ELEVATION');
  b.text('scale', { x: f.x0, y: ty + th * 2 }, th * 0.8, opt.mmPerPx ? `Scaled from photograph – dimensions in mm (estimated accuracy, see report)` : 'UNSCALED – arbitrary units (no reference dimension given)');
  if (opt.mmPerPx) {
    // 5 m scale bar
    const len = 5000 / opt.mmPerPx;
    const y = ty + th * 3.5, x = f.x0;
    b.line('sbar:base', '17_ANNOTATION', { x, y }, { x: x + len, y });
    for (let i = 0; i <= 5; i++) b.line(`sbar:t${i}`, '17_ANNOTATION', { x: x + (len * i) / 5, y: y - th * 0.4 }, { x: x + (len * i) / 5, y: y + th * 0.4 });
    b.text('sbar:0', { x, y: y + th * 1.6 }, th * 0.7, '0', 'center');
    b.text('sbar:5', { x: x + len, y: y + th * 1.6 }, th * 0.7, '5 m', 'center');
  }
}
