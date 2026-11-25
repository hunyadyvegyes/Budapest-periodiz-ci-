// Small, dependency-free 2D/projective geometry toolkit.
// All functions are pure so they run identically in the browser, a Web Worker and Node tests.

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
/** Quadrilateral in image coordinates: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];
/** Row-major 3x3 matrix. */
export type Mat3 = number[];
export type Vec3 = [number, number, number];

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
export const rx1 = (r: Rect) => r.x + r.w;
export const ry1 = (r: Rect) => r.y + r.h;
export const rcx = (r: Rect) => r.x + r.w / 2;
export const rcy = (r: Rect) => r.y + r.h / 2;
export const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);

export function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x1 = Math.min(rx1(a), rx1(b)), y1 = Math.min(ry1(a), ry1(b));
  return { x, y, w: Math.max(0, x1 - x), h: Math.max(0, y1 - y) };
}
export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(rx1(a), rx1(b)) - x, h: Math.max(ry1(a), ry1(b)) - y };
}
export function iou(a: Rect, b: Rect): number {
  const i = area(intersect(a, b));
  const u = area(a) + area(b) - i;
  return u > 0 ? i / u : 0;
}
/** Fraction of `a` covered by `b`. */
export function coverage(a: Rect, b: Rect): number {
  const aa = area(a);
  return aa > 0 ? area(intersect(a, b)) / aa : 0;
}
export const inflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
export const clampRect = (r: Rect, w: number, h: number): Rect => {
  const x = Math.max(0, Math.min(w, r.x)), y = Math.max(0, Math.min(h, r.y));
  return { x, y, w: Math.max(0, Math.min(w, r.x + r.w) - x), h: Math.max(0, Math.min(h, r.y + r.h) - y) };
};
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------- 3x3 matrices

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
    r[i * 3 + j] = s;
  }
  return r;
}
export function inv3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) throw new Error('Singular matrix');
  const s = 1 / det;
  return [
    A * s, -(b * i - c * h) * s, (b * f - c * e) * s,
    B * s, (a * i - c * g) * s, -(a * f - c * d) * s,
    C * s, -(a * h - b * g) * s, (a * e - b * d) * s,
  ];
}
export function apply(H: Mat3, p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}
export function mulVec(H: Mat3, v: Vec3): Vec3 {
  return [
    H[0] * v[0] + H[1] * v[1] + H[2] * v[2],
    H[3] * v[0] + H[4] * v[1] + H[5] * v[2],
    H[6] * v[0] + H[7] * v[1] + H[8] * v[2],
  ];
}
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm3 = (a: Vec3): Vec3 => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
export const transpose3 = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** Solve A x = b (n x n) by Gaussian elimination with partial pivoting. */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('Degenerate system');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Homography mapping 4 source points onto 4 destination points (DLT, h33 = 1). */
export function homographyFrom4(src: Pt[], dst: Pt[]): Mat3 {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return [...h, 1];
}

/** Line through two points in homogeneous form. */
export const lineThrough = (a: Pt, b: Pt): Vec3 => cross([a.x, a.y, 1], [b.x, b.y, 1]);
export function meet(l1: Vec3, l2: Vec3): Pt | null {
  const p = cross(l1, l2);
  if (Math.abs(p[2]) < 1e-12) return null;
  return { x: p[0] / p[2], y: p[1] / p[2] };
}

/** Symmetric eigen-decomposition of a 3x3 matrix (Jacobi). Returns eigenvalues ascending with vectors. */
export function eigSym3(m: Mat3): { values: number[]; vectors: Vec3[] } {
  const a = [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-20) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return { values: idx.map((i) => a[i][i]), vectors: idx.map((i) => [v[0][i], v[1][i], v[2][i]] as Vec3) };
}

// ---------------------------------------------------------------- polylines

/** Douglas–Peucker simplification. */
export function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const a = pts[s], b = pts[e];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    let best = -1, bi = -1;
    for (let i = s + 1; i < e; i++) {
      // closed loops (a == b): fall back to the distance from the start point
      const d = L < 1e-9 ? Math.hypot(pts[i].x - a.x, pts[i].y - a.y) : Math.abs(dy * (pts[i].x - a.x) - dx * (pts[i].y - a.y)) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps && bi > 0) { keep[bi] = 1; stack.push([s, bi], [bi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function polylineLength(pts: Pt[], closed = false): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) L += dist(pts[pts.length - 1], pts[0]);
  return L;
}

export function median(vals: number[]): number {
  if (!vals.length) return NaN;
  const s = [...vals].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function mean(vals: number[]): number {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
}
export function percentile(vals: ArrayLike<number>, p: number): number {
  const s = Array.from(vals).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
}
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Cluster 1-D values; items closer than `tol` to the running cluster mean are grouped. */
export function cluster1D<T>(items: T[], key: (t: T) => number, tol: number): T[][] {
  const sorted = [...items].sort((a, b) => key(a) - key(b));
  const out: T[][] = [];
  let cur: T[] = [], sum = 0;
  for (const it of sorted) {
    const v = key(it);
    if (cur.length && Math.abs(v - sum / cur.length) > tol) { out.push(cur); cur = []; sum = 0; }
    cur.push(it); sum += v;
  }
  if (cur.length) out.push(cur);
  return out;
}
