// Shared export helpers: model px -> CAD/paper coordinates, bulge arcs, line weights.
import { Pt } from '../core/geom';
import { Drawing, Entity, LAYER_DEFS, LayerName, LayerSettings } from '../drawing/types';

/** CAD coordinates: x from the facade's left edge, y up from the ground line, in mm (or px if unscaled). */
export function cadTransform(d: Drawing) {
  const k = d.mmPerPx ?? 1;
  return { k, X: (x: number) => (x - d.origin.x) * k, Y: (y: number) => (d.origin.y - y) * k };
}

export function visibleEntities(d: Drawing, layers?: LayerSettings, includeHidden = false): Entity[] {
  if (!layers) return d.entities.filter((e) => includeHidden || LAYER_DEFS.find((l) => l.name === e.layer)!.plot);
  return d.entities.filter((e) => layers[e.layer]?.visible);
}

export function layerLw(name: LayerName, layers?: LayerSettings): number {
  return layers?.[name]?.lw ?? LAYER_DEFS.find((l) => l.name === name)!.lw;
}
export const entityLw = (e: Entity, layers?: LayerSettings) => e.lw ?? layerLw(e.layer, layers);

/** Points along a bulged segment from a to b (y-down model coordinates). */
export function bulgePoints(a: Pt, b: Pt, bulge: number, stepDeg = 6): Pt[] {
  if (Math.abs(bulge) < 1e-9) return [b];
  const theta = 4 * Math.atan(bulge); // signed included angle, CCW positive in y-up
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  // work in y-up space
  const A = { x: a.x, y: -a.y }, B = { x: b.x, y: -b.y };
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  const d = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const ux = (B.x - A.x) / chord, uy = (B.y - A.y) / chord;
  // centre lies to the left of A->B for CCW arcs smaller than 180°
  const s = Math.sign(theta) * (Math.abs(theta) < Math.PI ? 1 : -1);
  const c = { x: mx - uy * d * s, y: my + ux * d * s };
  const a0 = Math.atan2(A.y - c.y, A.x - c.x);
  const n = Math.max(2, Math.ceil(Math.abs((theta * 180) / Math.PI) / stepDeg));
  const pts: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const ang = a0 + (theta * i) / n;
    pts.push({ x: c.x + r * Math.cos(ang), y: -(c.y + r * Math.sin(ang)) });
  }
  return pts;
}

/** Arc entity (y-up angles) sampled into y-down points. */
export function arcPoints(c: Pt, r: number, a0: number, a1: number, stepDeg = 6): Pt[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += 360;
  const n = Math.max(2, Math.ceil(sweep / stepDeg));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = ((a0 + (sweep * i) / n) * Math.PI) / 180;
    return { x: c.x + r * Math.cos(t), y: c.y - r * Math.sin(t) };
  });
}

/** Flattened polyline points (bulges sampled) in model coordinates. */
export function flattenPoly(pts: Pt[], closed: boolean, bulges?: number[]): Pt[] {
  const out: Pt[] = [pts[0]];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    out.push(...bulgePoints(a, b, bulges?.[i] ?? 0));
  }
  return out;
}

/** Paper layout: model px -> paper mm at a drawing scale (1:N) or fitted to a width. */
export interface Paper { wMm: number; hMm: number; scaleDenom: number | null; px2mm: number; ox: number; oy: number; marginMm: number }
export function paperLayout(d: Drawing, opt: { scaleDenom?: number; fitWidthMm?: number } = {}): Paper {
  const margin = 15;
  const bw = d.bounds.x1 - d.bounds.x0, bh = d.bounds.y1 - d.bounds.y0;
  let px2mm: number, scaleDenom: number | null = null;
  if (d.mmPerPx && opt.scaleDenom) { px2mm = d.mmPerPx / opt.scaleDenom; scaleDenom = opt.scaleDenom; }
  else px2mm = (opt.fitWidthMm ?? 380) / bw;
  return { wMm: bw * px2mm + 2 * margin, hMm: bh * px2mm + 2 * margin, scaleDenom, px2mm, ox: d.bounds.x0, oy: d.bounds.y0, marginMm: margin };
}
/** Sensible drawing scale for a scaled drawing so the sheet is at most ~A1 width. */
export function autoScale(d: Drawing): number {
  if (!d.mmPerPx) return 100;
  const realW = (d.bounds.x1 - d.bounds.x0) * d.mmPerPx;
  for (const s of [20, 50, 100, 200, 250, 500, 1000]) if (realW / s <= 800) return s;
  return 1000;
}
