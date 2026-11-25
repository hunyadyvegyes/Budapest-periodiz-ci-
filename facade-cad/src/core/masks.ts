// Scene masks: sky (to find the roofline) and foreground vegetation (to avoid tracing trees).
import { Rect } from './geom';
import { Gradients, Mask, RGBAImage, binClose, binDilate, binOpen, boxBlur, components, mask, rgbToHsv } from './image';

/** Region-grow the sky from the top border: bright, blue-ish or white, low gradient, smooth colour changes. */
export function skyMask(img: RGBAImage, g: Gradients, x0: number, x1: number): Uint8Array {
  const { w, h, data } = img;
  const sky = new Uint8Array(w * h);
  const ok = (i: number) => {
    const r = data[i * 4], gg = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    if (a === 0) return false;
    const v = Math.max(r, gg, b);
    return v > 110 && b >= r - 12 && g.mag[i] < 7;
  };
  const queue: number[] = [];
  const sx0 = Math.max(0, Math.floor(x0)), sx1 = Math.min(w - 1, Math.ceil(x1));
  for (let x = sx0; x <= sx1; x++) {
    for (let y = 0; y < Math.min(h, 4); y++) {
      const i = y * w + x;
      if (ok(i)) { sky[i] = 1; queue.push(i); }
    }
  }
  // also seed from any transparent (outside-photo) area adjacent rows: those are not sky, skip.
  const col = (i: number, k: number) => data[i * 4 + k];
  while (queue.length) {
    const p = queue.pop()!;
    const px = p % w, py = (p - px) / w;
    const nbs = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1];
    for (const q of nbs) {
      if (q < 0 || sky[q] || !ok(q)) continue;
      const d = Math.abs(col(p, 0) - col(q, 0)) + Math.abs(col(p, 1) - col(q, 1)) + Math.abs(col(p, 2) - col(q, 2));
      if (d > 18) continue;
      sky[q] = 1; queue.push(q);
    }
  }
  // remove tiny holes (birds, noise)
  const m: Mask = { w, h, data: sky };
  return binClose(m, 2, 2).data;
}

/** Vegetation (trees, shrubs): green hue with saturation; cleaned and dilated. */
export function vegetationMask(img: RGBAImage, region: Rect, g?: Gradients): { mask: Uint8Array; boxes: Rect[] } {
  const { w, h, data } = img;
  const m = mask(w, h);
  // foliage is strongly textured; painted green surfaces (doors, shutters) are not
  const tex = g ? boxBlur({ w, h, data: g.mag }, 4).data : null;
  for (let y = Math.max(0, Math.floor(region.y)); y < Math.min(h, region.y + region.h); y++) {
    for (let x = Math.max(0, Math.floor(region.x)); x < Math.min(w, region.x + region.w); x++) {
      const i = y * w + x;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      if (data[i * 4 + 3] === 0) continue;
      const [hue, s, v] = rgbToHsv(r, g, b);
      if (hue > 65 && hue < 165 && s > 0.22 && v > 0.12 && v < 0.92 && g > r + 6 && (!tex || tex[i] > 5)) m.data[i] = 1;
    }
  }
  let cleaned = binClose(binOpen(m, 1, 1), 4, 4);
  const { comps, labels } = components(cleaned);
  const minArea = w * h * 0.0015;
  const keep = new Set(comps.filter((c) => c.area >= minArea).map((c) => c.label));
  const out = mask(w, h);
  for (let i = 0; i < labels.length; i++) if (labels[i] && keep.has(labels[i])) out.data[i] = 1;
  cleaned = binDilate(out, 4, 4);
  const boxes = comps.filter((c) => keep.has(c.label)).map((c) => ({ x: c.x0 - 4, y: c.y0 - 4, w: c.x1 - c.x0 + 9, h: c.y1 - c.y0 + 9 }));
  return { mask: cleaned.data, boxes };
}

/** Rasterise rectangles into a mask (used for user "ignore" regions and AI-reported occluders). */
export function rectsMask(w: number, h: number, rects: Rect[], into?: Uint8Array): Uint8Array {
  const m = into ?? new Uint8Array(w * h);
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x)), x1 = Math.min(w, Math.ceil(r.x + r.w));
    const y0 = Math.max(0, Math.floor(r.y)), y1 = Math.min(h, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) m.fill(1, y * w + x0, y * w + x1);
  }
  return m;
}
