// Line-segment detection (a compact LSD-style region-growing detector, without the a-contrario NFA test).
import { GrayImage, gaussianBlur, sobel } from './image';

export interface Segment { x1: number; y1: number; x2: number; y2: number; len: number; /** direction angle in rad, [0, PI) */ angle: number; strength: number }

export interface SegmentOptions { minLength?: number; angleTol?: number; gradThreshold?: number; sigma?: number }

export function detectSegments(img: GrayImage, opt: SegmentOptions = {}): Segment[] {
  const { w, h } = img;
  const sm = gaussianBlur(img, opt.sigma ?? 0.8);
  const { gx, gy, mag } = sobel(sm);
  const tau = opt.angleTol ?? (22.5 * Math.PI) / 180;
  const minLen = opt.minLength ?? Math.max(12, Math.round(Math.hypot(w, h) * 0.02));
  // Gradient threshold: LSD uses q / sin(tau) with q=2 on [0,255] images; keep a floor relative to the image.
  let mx = 0;
  for (let i = 0; i < mag.length; i++) if (mag[i] > mx) mx = mag[i];
  const thr = opt.gradThreshold ?? Math.max(2 / Math.sin(tau), mx * 0.04);

  // Bucket-sort pixels by gradient magnitude, strongest first.
  const nb = 1024, buckets: number[][] = Array.from({ length: nb }, () => []);
  for (let i = 0; i < mag.length; i++) if (mag[i] > thr) buckets[Math.min(nb - 1, Math.floor((mag[i] / mx) * (nb - 1)))].push(i);
  const used = new Uint8Array(w * h);
  // level-line angle = gradient angle rotated by 90deg
  const lla = (i: number) => Math.atan2(gx[i], -gy[i]);
  const segs: Segment[] = [];
  const region: number[] = [];

  for (let b = nb - 1; b >= 0; b--) {
    for (const seed of buckets[b]) {
      if (used[seed]) continue;
      region.length = 0;
      region.push(seed); used[seed] = 1;
      let ang = lla(seed), sx = Math.cos(ang), sy = Math.sin(ang);
      for (let k = 0; k < region.length; k++) {
        const p = region[k], px = p % w, py = (p - px) / w;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const qx = px + dx, qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
          const q = qy * w + qx;
          if (used[q] || mag[q] <= thr) continue;
          let d = Math.abs(lla(q) - ang);
          if (d > Math.PI) d = 2 * Math.PI - d;
          if (d > tau) continue;
          used[q] = 1; region.push(q);
          sx += Math.cos(lla(q)); sy += Math.sin(lla(q));
          ang = Math.atan2(sy, sx);
        }
      }
      if (region.length < minLen * 0.6) {
        // too small – release pixels so they can join another region's growth
        for (const p of region) used[p] = 2;
        continue;
      }
      // Weighted PCA for the line direction.
      let W = 0, mxx = 0, myy = 0;
      for (const p of region) { const x = p % w, y = (p - x) / w, m = mag[p]; W += m; mxx += m * x; myy += m * y; }
      const cx = mxx / W, cy = myy / W;
      let sxx = 0, syy = 0, sxy = 0;
      for (const p of region) {
        const x = p % w - cx, y = (p - (p % w)) / w - cy, m = mag[p];
        sxx += m * x * x; syy += m * y * y; sxy += m * x * y;
      }
      const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const ux = Math.cos(theta), uy = Math.sin(theta);
      let tmin = Infinity, tmax = -Infinity, wmax = 0;
      for (const p of region) {
        const x = p % w - cx, y = (p - (p % w)) / w - cy;
        const t = x * ux + y * uy, n = Math.abs(-x * uy + y * ux);
        if (t < tmin) tmin = t; if (t > tmax) tmax = t; if (n > wmax) wmax = n;
      }
      const len = tmax - tmin;
      if (len < minLen) continue;
      // density check: thin, well-filled support region
      const width = Math.max(1, 2 * wmax);
      if (region.length / (len * width) < 0.35 || width > Math.max(4, len * 0.25)) continue;
      let a = theta % Math.PI; if (a < 0) a += Math.PI;
      segs.push({ x1: cx + ux * tmin, y1: cy + uy * tmin, x2: cx + ux * tmax, y2: cy + uy * tmax, len, angle: a, strength: W / region.length });
    }
  }
  return segs;
}

/** Deviation (rad) of a segment from vertical, in [0, PI/2]. */
export const fromVertical = (s: Segment) => Math.abs(s.angle - Math.PI / 2);
/** Deviation (rad) of a segment from horizontal, in [0, PI/2]. */
export const fromHorizontal = (s: Segment) => Math.min(s.angle, Math.PI - s.angle);
