// SVG export (paper millimetres, one <g> per CAD layer, true arcs) and on-screen path helpers.
import { Pt } from '../core/geom';
import { Drawing, Entity, LAYER_DEFS, LayerSettings } from '../drawing/types';
import { Paper, autoScale, entityLw, paperLayout, visibleEntities } from './geometry';

const f = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** SVG path data for an entity in model px (y down). Arcs keep their true geometry. */
export function entityPath(e: Entity, T: (p: Pt) => Pt = (p) => p, s = 1): string {
  switch (e.type) {
    case 'line': { const a = T(e.a), b = T(e.b); return `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`; }
    case 'poly': {
      const pts = e.pts.map(T);
      let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
      const n = e.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const b = pts[(i + 1) % pts.length], a = pts[i];
        const bu = e.bulges?.[i] ?? 0;
        if (Math.abs(bu) > 1e-9) {
          const theta = 4 * Math.atan(Math.abs(bu));
          const r = Math.hypot(b.x - a.x, b.y - a.y) / (2 * Math.sin(theta / 2));
          // y-down screen: a CAD-counter-clockwise arc (bulge > 0) is drawn with sweep-flag 0
          d += `A${f(r)} ${f(r)} 0 ${theta > Math.PI ? 1 : 0} ${bu > 0 ? 0 : 1} ${f(b.x)} ${f(b.y)}`;
        } else if (i < pts.length - 1 || !e.closed) d += `L${f(b.x)} ${f(b.y)}`;
      }
      return e.closed ? d + 'Z' : d;
    }
    case 'arc': {
      const r = e.r * s;
      const p0 = T({ x: e.c.x + e.r * Math.cos((e.a0 * Math.PI) / 180), y: e.c.y - e.r * Math.sin((e.a0 * Math.PI) / 180) });
      const p1 = T({ x: e.c.x + e.r * Math.cos((e.a1 * Math.PI) / 180), y: e.c.y - e.r * Math.sin((e.a1 * Math.PI) / 180) });
      let sweep = e.a1 - e.a0; while (sweep <= 0) sweep += 360;
      return `M${f(p0.x)} ${f(p0.y)}A${f(r)} ${f(r)} 0 ${sweep > 180 ? 1 : 0} 0 ${f(p1.x)} ${f(p1.y)}`;
    }
    case 'circle': { const c = T(e.c), r = e.r * s; return `M${f(c.x - r)} ${f(c.y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`; }
    default: return '';
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function exportSVG(d: Drawing, layers?: LayerSettings, opt: { scaleDenom?: number } = {}): { svg: string; paper: Paper } {
  const paper = paperLayout(d, d.mmPerPx ? { scaleDenom: opt.scaleDenom ?? autoScale(d) } : { fitWidthMm: 380 });
  const T = (p: Pt): Pt => ({ x: (p.x - paper.ox) * paper.px2mm + paper.marginMm, y: (p.y - paper.oy) * paper.px2mm + paper.marginMm });
  const ents = visibleEntities(d, layers);
  const parts: string[] = [];
  for (const L of LAYER_DEFS) {
    const es = ents.filter((e) => e.layer === L.name);
    if (!es.length) continue;
    parts.push(`<g id="${L.name}" inkscape:groupmode="layer" inkscape:label="${L.name}">`);
    for (const e of es) {
      if (e.type === 'text') {
        const p = T(e.p), anchor = e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start';
        parts.push(`<text x="${f(p.x)}" y="${f(p.y)}" font-size="${f(e.h * paper.px2mm)}" text-anchor="${anchor}" font-family="Helvetica, Arial, sans-serif" fill="#000">${esc(e.text)}</text>`);
        continue;
      }
      const dash = e.ltype === 'DASHED' ? ' stroke-dasharray="3 1.5"' : '';
      parts.push(`<path d="${entityPath(e, T, paper.px2mm)}" stroke-width="${f(entityLw(e, layers))}"${dash}/>`);
    }
    parts.push('</g>');
  }
  const scaleNote = paper.scaleDenom ? `1:${paper.scaleDenom}` : 'unscaled';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${f(paper.wMm)}mm" height="${f(paper.hMm)}mm" viewBox="0 0 ${f(paper.wMm)} ${f(paper.hMm)}">
<title>Facade elevation (${scaleNote}, level ${d.level})</title>
<rect width="100%" height="100%" fill="#fff"/>
<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">
${parts.join('\n')}
</g>
</svg>
`;
  return { svg, paper };
}
