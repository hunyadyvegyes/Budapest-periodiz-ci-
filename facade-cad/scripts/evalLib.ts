// Shared helpers for evaluating the pipeline against the synthetic ground truth (Node only).
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { Quad, Rect, apply, homographyFrom4, iou } from '../src/core/geom';
import { RGBAImage } from '../src/core/image';
import { ProcessResult, processFacade } from '../src/core/pipeline';

export const SAMPLES = path.resolve(__dirname, '../public/samples');

export interface Truth {
  name: string;
  facade: { width_m: number; wall_height_m: number };
  quad_px: [number, number][];
  openings: { kind: string; u0: number; v0: number; u1: number; v1: number; floor: number; mullions?: number; transom?: boolean; arch?: string | null }[];
  balconies: { u0: number; u1: number; slab_v: number; rail_top: number }[];
  bands: { kind: string; v0: number; v1: number }[];
  downpipes: { u0: number; u1: number }[];
}

export function loadJpeg(file: string): RGBAImage {
  const raw = jpeg.decode(fs.readFileSync(file), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { w: raw.width, h: raw.height, data: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.length) };
}
export function loadTruth(name: string): Truth {
  return JSON.parse(fs.readFileSync(path.join(SAMPLES, `${name}.json`), 'utf8'));
}

/** Map a ground-truth rectangle in facade metres into rectified pixels of a result. */
export function truthToRectified(t: Truth, res: ProcessResult, u0: number, v0: number, u1: number, v1: number): Rect {
  const W = t.facade.width_m, Hm = t.facade.wall_height_m;
  const q = t.quad_px.map(([x, y]) => ({ x, y }));
  // metres (u, v-up) -> source px
  const M = homographyFrom4([{ x: 0, y: Hm }, { x: W, y: Hm }, { x: W, y: 0 }, { x: 0, y: 0 }], q);
  const pts = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => apply(res.rect.H, apply(M, { x: u, y: v })));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export interface Score { name: string; mode: string; gt: number; det: number; tp: number; precision: number; recall: number; meanIoU: number; doorsFound: string; aspectErr: number; ms: number; inferred: number }

export function score(t: Truth, res: ProcessResult, mode: string): Score {
  const gts = t.openings.map((o) => ({ ...o, r: truthToRectified(t, res, o.u0, o.v0, o.u1, o.v1) }));
  const dets = res.model.openings;
  const used = new Set<string>();
  let tp = 0, sumIoU = 0;
  for (const g of gts) {
    let best: { id: string; v: number } | null = null;
    for (const d of dets) {
      if (used.has(d.id)) continue;
      const v = iou(g.r, d.rect);
      if (!best || v > best.v) best = { id: d.id, v };
    }
    if (best && best.v >= 0.5) { tp++; sumIoU += best.v; used.add(best.id); }
  }
  const doors = gts.filter((g) => g.kind === 'door');
  const doorHits = doors.filter((g) => dets.some((d) => d.kind !== 'window' && iou(d.rect, g.r) > 0.4)).length;
  const f = res.rect.facade;
  const aspect = f.w / f.h, truthAspect = t.facade.width_m / t.facade.wall_height_m;
  return {
    name: t.name, mode, gt: gts.length, det: dets.length, tp, precision: dets.length ? tp / dets.length : 0, recall: tp / gts.length,
    meanIoU: tp ? sumIoU / tp : 0, doorsFound: `${doorHits}/${doors.length}`, aspectErr: mode === 'manual' ? aspect / truthAspect - 1 : NaN,
    ms: res.model.meta.analysisMs, inferred: dets.filter((d) => d.source === 'inferred').length,
  };
}

export function run(name: string, mode: 'manual' | 'auto'): { res: ProcessResult; truth: Truth } {
  const truth = loadTruth(name);
  const src = loadJpeg(path.join(SAMPLES, `${name}.jpg`));
  const quad = mode === 'manual' ? (truth.quad_px.map(([x, y]) => ({ x, y })) as Quad) : null;
  const res = processFacade({ source: src, quad, quadIsAuto: mode === 'auto' });
  return { res, truth };
}

/** Debug overlay: rectified image with detected elements (red: openings, blue: bands, green: balconies, magenta: verticals). */
export function writeOverlay(file: string, res: ProcessResult, truthRects: Rect[] = []) {
  const { rectified: img, model } = res;
  const png = new PNG({ width: img.w, height: img.h });
  png.data.set(img.data);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  const put = (x: number, y: number, c: number[]) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
    const i = (y * img.w + x) * 4;
    png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2];
  };
  const box = (r: Rect, c: number[]) => {
    for (let x = r.x; x <= r.x + r.w; x++) { put(x, r.y, c); put(x, r.y + r.h, c); }
    for (let y = r.y; y <= r.y + r.h; y++) { put(r.x, y, c); put(r.x + r.w, y, c); }
  };
  const hline = (y: number, x0: number, x1: number, c: number[]) => { for (let x = x0; x <= x1; x++) put(x, y, c); };
  for (const r of truthRects) box(r, [255, 255, 0]);
  for (const o of model.openings) {
    box(o.rect, o.source === 'inferred' ? [255, 150, 0] : o.kind === 'window' ? [230, 0, 0] : [180, 0, 255]);
    const ix = o.rect.x + o.frame, iy = o.rect.y + o.frame, iw = o.rect.w - 2 * o.frame, ih = o.rect.h - 2 * o.frame;
    for (const m of o.mullions) for (let y = iy; y < iy + ih; y++) put(ix + m * iw, y, [0, 200, 255]);
    for (const t of o.transoms) hline(iy + t * ih, ix, ix + iw, [0, 200, 255]);
    if (o.sill) box(o.sill, [0, 160, 0]);
    if (o.hood) box(o.hood, [0, 120, 255]);
  }
  for (const b of model.bands) for (const y of b.lines) hline(y, b.x0, b.x1, b.kind === 'cornice' ? [0, 0, 255] : [0, 120, 200]);
  for (const k of model.balconies) box({ x: k.x0, y: k.railTop, w: k.x1 - k.x0, h: k.slabBottom - k.railTop }, [0, 220, 0]);
  for (const v of model.verticals) box({ x: v.x0, y: v.y0, w: Math.max(1, v.x1 - v.x0), h: v.y1 - v.y0 }, [255, 0, 255]);
  for (let i = 1; i < model.roof.line.length; i++) {
    const a = model.roof.line[i - 1], b = model.roof.line[i];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
    for (let k = 0; k <= n; k++) put(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n, [255, 0, 0]);
  }
  for (const fl of model.floors) for (let x = model.facade.x0; x < model.facade.x1; x += 3) put(x, fl.y, [255, 128, 0]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(png));
}
