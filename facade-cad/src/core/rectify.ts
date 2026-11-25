// Perspective analysis and correction.
//  * vanishing points from line segments (RANSAC + least squares)
//  * metric rectification of the facade plane (focal length estimated from two orthogonal
//    vanishing points when possible, otherwise a typical value is assumed)
//  * quad -> rectangle homographies with context margins, and the actual resampling.
import { Mat3, Pt, Quad, Vec3, apply, cross, dist, eigSym3, homographyFrom4, inv3, lineThrough, mul3, norm3 } from './geom';
import { GrayImage, RGBAImage } from './image';
import { Segment, detectSegments, fromHorizontal, fromVertical } from './lines';

export interface VanishingPoint { /** homogeneous, in pixel coordinates */ v: Vec3; inlierLength: number; support: number; finite: boolean }

export interface Rectification {
  /** maps original image pixels -> rectified pixels */
  H: Mat3;
  /** maps rectified pixels -> original image pixels */
  Hinv: Mat3;
  outW: number;
  outH: number;
  /** where the facade quad lands in the rectified image */
  facade: { x: number; y: number; w: number; h: number };
  quad: Quad;
  aspect: number;
  focalPx: number;
  focalEstimated: boolean;
  confidence: number;
  notes: string[];
}

// ------------------------------------------------------------------ vanishing points

function normalizer(w: number, h: number) {
  const s = Math.max(w, h) / 2, cx = w / 2, cy = h / 2;
  const N: Mat3 = [1 / s, 0, -cx / s, 0, 1 / s, -cy / s, 0, 0, 1];
  return { N, Ninv: inv3(N), s, cx, cy };
}

function vpConsistent(seg: Segment, v: Vec3, tol: number): boolean {
  const mx = (seg.x1 + seg.x2) / 2, my = (seg.y1 + seg.y2) / 2;
  let dx: number, dy: number;
  if (Math.abs(v[2]) < 1e-9) { dx = v[0]; dy = v[1]; } else { dx = v[0] / v[2] - mx; dy = v[1] / v[2] - my; }
  const sx = seg.x2 - seg.x1, sy = seg.y2 - seg.y1;
  const c = Math.abs(dx * sx + dy * sy) / ((Math.hypot(dx, dy) || 1e-9) * (Math.hypot(sx, sy) || 1e-9));
  return Math.acos(Math.min(1, c)) < tol;
}

/** Deterministic RANSAC (seeded LCG) so results are reproducible. */
export function estimateVP(segs: Segment[], w: number, h: number, tolDeg = 1.5, iters = 400): VanishingPoint | null {
  if (segs.length < 2) return null;
  const { N, Ninv } = normalizer(w, h);
  const tol = (tolDeg * Math.PI) / 180;
  const lines = segs.map((s) => {
    const a = apply(N, { x: s.x1, y: s.y1 }), b = apply(N, { x: s.x2, y: s.y2 });
    const l = lineThrough(a, b);
    const n = Math.hypot(l[0], l[1]) || 1;
    return [l[0] / n, l[1] / n, l[2] / n] as Vec3;
  });
  const total = segs.reduce((a, s) => a + s.len, 0);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  // length-weighted sampling
  const cum: number[] = []; let acc = 0;
  for (const s of segs) { acc += s.len; cum.push(acc); }
  const pick = () => { const r = rnd() * acc; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; } return lo; };
  let best: { v: Vec3; score: number } | null = null;
  for (let it = 0; it < iters; it++) {
    const i = pick(), j = pick();
    if (i === j) continue;
    const vn = cross(lines[i], lines[j]);
    if (Math.hypot(vn[0], vn[1], vn[2]) < 1e-12) continue;
    const v = norm3(vn);
    const vp = norm3(Ninv.length ? (mulH(Ninv, v)) : v);
    let score = 0;
    for (let k = 0; k < segs.length; k++) if (vpConsistent(segs[k], vp, tol)) score += segs[k].len;
    if (!best || score > best.score) best = { v: vp, score };
  }
  if (!best) return null;
  // least-squares refinement in normalised space
  const inl = segs.map((s, k) => ({ s, k })).filter(({ s }) => vpConsistent(s, best!.v, tol * 1.5));
  if (inl.length >= 2) {
    const M = new Array(9).fill(0);
    for (const { s, k } of inl) {
      const l = lines[k], wgt = s.len;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a * 3 + b] += wgt * l[a] * l[b];
    }
    const { vectors } = eigSym3(M);
    best.v = norm3(mulH(Ninv, vectors[0]));
  }
  const v = best.v;
  const finite = Math.abs(v[2]) > 1e-9 && Math.hypot(v[0] / v[2] - w / 2, v[1] / v[2] - h / 2) < 50 * Math.max(w, h);
  return { v, inlierLength: best.score, support: best.score / total, finite };
}

const mulH = (H: Mat3, v: Vec3): Vec3 => [
  H[0] * v[0] + H[1] * v[1] + H[2] * v[2],
  H[3] * v[0] + H[4] * v[1] + H[5] * v[2],
  H[6] * v[0] + H[7] * v[1] + H[8] * v[2],
];

// ------------------------------------------------------------------ metric rectification

/**
 * Homography (image px -> facade-plane coordinates, arbitrary scale) that makes the
 * vertical and horizontal facade directions axis aligned and restores the true aspect ratio,
 * given the two vanishing points and the focal length (principal point = image centre).
 */
export function metricHomography(vv: Vec3, vh: Vec3, w: number, h: number, focalPx: number): Mat3 {
  const cx = w / 2, cy = h / 2;
  const Kinv: Mat3 = [1 / focalPx, 0, -cx / focalPx, 0, 1 / focalPx, -cy / focalPx, 0, 0, 1];
  let dv = norm3(mulH(Kinv, vv));
  let dh = norm3(mulH(Kinv, vh));
  if (dv[1] < 0) dv = [-dv[0], -dv[1], -dv[2]];
  if (dh[0] < 0) dh = [-dh[0], -dh[1], -dh[2]];
  const d = dh[0] * dv[0] + dh[1] * dv[1] + dh[2] * dv[2];
  dh = norm3([dh[0] - d * dv[0], dh[1] - d * dv[1], dh[2] - d * dv[2]]);
  let n = cross(dh, dv);
  if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
  const R: Mat3 = [...dh, ...dv, ...n];
  return mul3(R, Kinv);
}

/** f^2 = -(v1-c).(v2-c) for orthogonal directions. Returns null if not estimable/plausible. */
export function focalFromVPs(vv: Vec3, vh: Vec3, w: number, h: number): number | null {
  if (Math.abs(vv[2]) < 1e-9 || Math.abs(vh[2]) < 1e-9) return null;
  const cx = w / 2, cy = h / 2;
  const a = { x: vv[0] / vv[2] - cx, y: vv[1] / vv[2] - cy }, b = { x: vh[0] / vh[2] - cx, y: vh[1] / vh[2] - cy };
  const f2 = -(a.x * b.x + a.y * b.y);
  if (!(f2 > 0)) return null;
  const f = Math.sqrt(f2), m = Math.max(w, h);
  return f > 0.4 * m && f < 4 * m ? f : null;
}
export const defaultFocal = (w: number, h: number) => 0.9 * Math.max(w, h);

/** Vanishing points implied by the sides of a quad (TL, TR, BR, BL). */
export function quadVPs(q: Quad): { vv: Vec3; vh: Vec3 } {
  const vv = cross(lineThrough(q[0], q[3]), lineThrough(q[1], q[2]));
  const vh = cross(lineThrough(q[0], q[1]), lineThrough(q[3], q[2]));
  const fix = (v: Vec3, a: Pt, b: Pt): Vec3 => (Math.hypot(v[0], v[1], v[2]) < 1e-12 ? [b.x - a.x, b.y - a.y, 0] : v);
  return { vv: fix(vv, q[0], q[3]), vh: fix(vh, q[0], q[1]) };
}

/** Estimated true width/height ratio of the rectangle seen as `q`. */
export function estimateQuadAspect(q: Quad, w: number, h: number): { aspect: number; focalPx: number; focalEstimated: boolean } {
  const { vv, vh } = quadVPs(q);
  const fEst = focalFromVPs(vv, vh, w, h);
  const focalPx = fEst ?? defaultFocal(w, h);
  try {
    const M = metricHomography(vv, vh, w, h, focalPx);
    const p = q.map((pt) => apply(M, pt));
    const width = (dist(p[0], p[1]) + dist(p[3], p[2])) / 2;
    const height = (dist(p[0], p[3]) + dist(p[1], p[2])) / 2;
    const aspect = width / height;
    if (isFinite(aspect) && aspect > 0.05 && aspect < 20) return { aspect, focalPx, focalEstimated: !!fEst };
  } catch { /* fall through */ }
  const width = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, height = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  return { aspect: width / height, focalPx, focalEstimated: false };
}

// ------------------------------------------------------------------ auto detection

export interface AutoResult { quad: Quad; confidence: number; vv: VanishingPoint | null; vh: VanishingPoint | null; segments: Segment[]; notes: string[] }

/** Find the dominant vertical/horizontal vanishing points and propose a facade quad. */
export function autoDetectQuad(gray: GrayImage): AutoResult {
  const { w, h } = gray;
  const segs = detectSegments(gray);
  const deg = Math.PI / 180;
  const vert = segs.filter((s) => fromVertical(s) < 25 * deg);
  const hor = segs.filter((s) => fromHorizontal(s) < 40 * deg);
  const notes: string[] = [];
  const vv = estimateVP(vert, w, h);
  const vh = estimateVP(hor, w, h);
  const vvH: Vec3 = vv && vv.support > 0.25 ? vv.v : [0, 1, 0];
  const vhH: Vec3 = vh && vh.support > 0.2 ? vh.v : [1, 0, 0];
  if (!vv || vv.support <= 0.25) notes.push('Few consistent vertical lines – vertical correction assumed none.');
  if (!vh || vh.support <= 0.2) notes.push('Few consistent horizontal lines – horizontal correction assumed none.');
  const f = focalFromVPs(vvH, vhH, w, h) ?? defaultFocal(w, h);
  let M: Mat3;
  try { M = metricHomography(vvH, vhH, w, h, f); } catch { M = [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
  // Largest axis-aligned rectangle (in facade space) inside the image footprint, shrunk slightly.
  const corners: Pt[] = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const c = corners.map((p) => apply(M, p));
  let x0 = Math.max(c[0].x, c[3].x), x1 = Math.min(c[1].x, c[2].x);
  let y0 = Math.max(c[0].y, c[1].y), y1 = Math.min(c[3].y, c[2].y);
  const okRect = x1 > x0 && y1 > y0;
  let quad: Quad;
  if (okRect) {
    const ix = (x1 - x0) * 0.02, iy = (y1 - y0) * 0.02;
    x0 += ix; x1 -= ix; y0 += iy; y1 -= iy;
    const Mi = inv3(M);
    quad = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }].map((p) => apply(Mi, p)) as Quad;
  } else {
    quad = [{ x: w * 0.02, y: h * 0.02 }, { x: w * 0.98, y: h * 0.02 }, { x: w * 0.98, y: h * 0.98 }, { x: w * 0.02, y: h * 0.98 }];
    notes.push('Perspective estimate was unstable; using the full image.');
  }
  const conf = Math.min(1, 0.35 + 0.35 * Math.min(1, (vv?.support ?? 0) / 0.6) + 0.3 * Math.min(1, (vh?.support ?? 0) / 0.5));
  return { quad, confidence: okRect ? conf : 0.3, vv, vh, segments: segs, notes };
}

// ------------------------------------------------------------------ quad -> rectangle

export interface RectifyOptions {
  /** width / height of the facade rectangle; estimated from perspective if omitted */
  aspect?: number;
  /** margins around the facade as fractions of facade width/height */
  margin?: { top: number; bottom: number; left: number; right: number };
  /** longest side of the rectified output in pixels */
  maxSide?: number;
}

export function computeRectification(quad: Quad, imgW: number, imgH: number, opt: RectifyOptions = {}): Rectification {
  const notes: string[] = [];
  const est = estimateQuadAspect(quad, imgW, imgH);
  const aspect = opt.aspect ?? est.aspect;
  const m = opt.margin ?? { top: 0.3, bottom: 0.04, left: 0.03, right: 0.03 };
  // Natural size: keep roughly the original pixel density along the facade width.
  const natW = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  let fw = natW, fh = natW / aspect;
  const totW = fw * (1 + m.left + m.right), totH = fh * (1 + m.top + m.bottom);
  const maxSide = opt.maxSide ?? 1800;
  const s = Math.min(maxSide / Math.max(totW, totH), 2.0);
  fw *= s; fh *= s;
  const fx = Math.round(fw * m.left), fy = Math.round(fh * m.top);
  const outW = Math.round(fw * (1 + m.left + m.right)), outH = Math.round(fh * (1 + m.top + m.bottom));
  const dst: Pt[] = [{ x: fx, y: fy }, { x: fx + fw, y: fy }, { x: fx + fw, y: fy + fh }, { x: fx, y: fy + fh }];
  const H = homographyFrom4(quad, dst);
  const Hinv = inv3(H);
  // Confidence: strongly oblique views lose resolution on the far side.
  const lens = [dist(quad[0], quad[1]), dist(quad[3], quad[2]), dist(quad[0], quad[3]), dist(quad[1], quad[2])];
  const ratioH = Math.min(lens[0], lens[1]) / Math.max(lens[0], lens[1]);
  const ratioV = Math.min(lens[2], lens[3]) / Math.max(lens[2], lens[3]);
  let confidence = 0.55 + 0.45 * Math.min(ratioH, ratioV);
  if (!est.focalEstimated && opt.aspect === undefined) {
    confidence -= 0.05;
    notes.push('Aspect ratio derived with an assumed focal length – enter a known width and height for exact proportions.');
  }
  if (Math.min(ratioH, ratioV) < 0.6) notes.push('Strongly oblique view: far side of the facade has low resolution.');
  return {
    H, Hinv, outW, outH, facade: { x: fx, y: fy, w: fw, h: fh }, quad, aspect,
    focalPx: est.focalPx, focalEstimated: est.focalEstimated, confidence: Math.max(0.2, Math.min(1, confidence)), notes,
  };
}

/** Inverse-mapped bilinear resampling. Pixels mapping outside the source get alpha 0. */
export function warpPerspective(src: RGBAImage, Hinv: Mat3, outW: number, outH: number): RGBAImage {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const d = src.data, sw = src.w, sh = src.h;
  const [a, b, c, e, f, g, p, q, r] = Hinv;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const X = x + 0.5, Y = y + 0.5;
      const wz = p * X + q * Y + r;
      const sx = (a * X + b * Y + c) / wz - 0.5, sy = (e * X + f * Y + g) / wz - 0.5;
      const o = (y * outW + x) * 4;
      if (sx < -0.5 || sy < -0.5 || sx > sw - 0.5 || sy > sh - 0.5) continue;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx))), y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0)), fy = Math.max(0, Math.min(1, sy - y0));
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let k = 0; k < 3; k++) {
        out[o + k] = (d[i00 + k] * (1 - fx) + d[i10 + k] * fx) * (1 - fy) + (d[i01 + k] * (1 - fx) + d[i11 + k] * fx) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { w: outW, h: outH, data: out };
}

/** Residual tilt (deg) of long near-vertical lines in a rectified image – a perspective-quality check. */
export function residualTilt(gray: GrayImage): { meanDeg: number; maxDeg: number; count: number } {
  const segs = detectSegments(gray, { minLength: Math.max(20, gray.h * 0.08) }).filter((s) => fromVertical(s) < (8 * Math.PI) / 180);
  if (!segs.length) return { meanDeg: 0, maxDeg: 0, count: 0 };
  let sw = 0, sa = 0, mx = 0;
  for (const s of segs) {
    const d = (fromVertical(s) * 180) / Math.PI;
    sw += s.len; sa += s.len * d; mx = Math.max(mx, d);
  }
  return { meanDeg: sa / sw, maxDeg: mx, count: segs.length };
}
