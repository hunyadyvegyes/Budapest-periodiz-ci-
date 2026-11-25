// Raster primitives on typed arrays. No DOM APIs, so this works in Workers and Node.

export interface RGBAImage { w: number; h: number; data: Uint8ClampedArray }
export interface GrayImage { w: number; h: number; data: Float32Array }
export interface Mask { w: number; h: number; data: Uint8Array }

export const gray = (w: number, h: number, data?: Float32Array): GrayImage => ({ w, h, data: data ?? new Float32Array(w * h) });
export const mask = (w: number, h: number): Mask => ({ w, h, data: new Uint8Array(w * h) });

export function toGray(img: RGBAImage): GrayImage {
  const out = gray(img.w, img.h);
  const d = img.data, o = out.data;
  for (let i = 0, j = 0; j < o.length; i += 4, j++) o[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return out;
}

/** Area-averaging downscale by an arbitrary factor (<= 1). Keeps fine detail better than nearest/bilinear. */
export function downscaleRGBA(img: RGBAImage, scale: number): RGBAImage {
  if (scale >= 0.999) return img;
  const w = Math.max(1, Math.round(img.w * scale)), h = Math.max(1, Math.round(img.h * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  const fx = img.w / w, fy = img.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.min(img.h, Math.max(y0 + 1, Math.floor((y + 1) * fy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.min(img.w, Math.max(x0 + 1, Math.floor((x + 1) * fx)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * img.w + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) { r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; a += img.data[i + 3]; n++; }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { w, h, data: out };
}

export function downscaleGray(img: GrayImage, scale: number): GrayImage {
  if (scale >= 0.999) return img;
  const w = Math.max(1, Math.round(img.w * scale)), h = Math.max(1, Math.round(img.h * scale));
  const out = gray(w, h);
  const fx = img.w / w, fy = img.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.min(img.h, Math.max(y0 + 1, Math.floor((y + 1) * fy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.min(img.w, Math.max(x0 + 1, Math.floor((x + 1) * fx)));
      let s = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += img.data[yy * img.w + xx]; n++; }
      out.data[y * w + x] = s / n;
    }
  }
  return out;
}

function kernel1D(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}

export function gaussianBlur(img: GrayImage, sigma: number): GrayImage {
  if (sigma <= 0) return img;
  // Large sigmas: approximate by three box passes (fast, O(1) per pixel).
  if (sigma > 6) {
    const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
    return boxBlur(boxBlur(boxBlur(img, r), r), r);
  }
  const k = kernel1D(sigma), r = (k.length - 1) >> 1;
  const { w, h } = img;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        s += img.data[row + xx] * k[i + r];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        s += tmp[yy * w + x] * k[i + r];
      }
      out[y * w + x] = s;
    }
  }
  return { w, h, data: out };
}

/** Separable box blur with radius r (window 2r+1), edge-clamped. */
export function boxBlur(img: GrayImage, r: number): GrayImage {
  const { w, h } = img;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let i = -r; i <= r; i++) s += img.data[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / n;
      s += img.data[row + Math.min(w - 1, x + r + 1)] - img.data[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return { w, h, data: out };
}

export interface Gradients { gx: Float32Array; gy: Float32Array; mag: Float32Array; w: number; h: number }

/** Sobel gradients. gx > 0 means brightness increases to the right; gy > 0 means it increases downward. */
export function sobel(img: GrayImage): Gradients {
  const { w, h, data: d } = img;
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = d[i - w - 1], b = d[i - w], c = d[i - w + 1];
      const e = d[i - 1], f = d[i + 1];
      const g = d[i + w - 1], hh = d[i + w], k = d[i + w + 1];
      const sx = (c + 2 * f + k - a - 2 * e - g) / 8;
      const sy = (g + 2 * hh + k - a - 2 * b - c) / 8;
      gx[i] = sx; gy[i] = sy; mag[i] = Math.hypot(sx, sy);
    }
  }
  return { gx, gy, mag, w, h };
}

/** 1-D running max/min (van Herk / Gil–Werman), window 2r+1, applied along rows or columns. */
function runningExtreme(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean, isMax: boolean) {
  const len = horizontal ? w : h, lines = horizontal ? h : w;
  const n = 2 * r + 1;
  const padLen = len + 2 * r;
  const buf = new Float32Array(padLen), g = new Float32Array(padLen), hb = new Float32Array(padLen);
  const pick = isMax ? Math.max : Math.min;
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < padLen; i++) {
      const k = Math.min(len - 1, Math.max(0, i - r));
      buf[i] = horizontal ? src[l * w + k] : src[k * w + l];
    }
    for (let i = 0; i < padLen; i++) g[i] = i % n === 0 ? buf[i] : pick(g[i - 1], buf[i]);
    for (let i = padLen - 1; i >= 0; i--) hb[i] = (i + 1) % n === 0 || i === padLen - 1 ? buf[i] : pick(hb[i + 1], buf[i]);
    for (let i = 0; i < len; i++) {
      const v = pick(hb[i], g[i + 2 * r]);
      if (horizontal) dst[l * w + i] = v; else dst[i * w + l] = v;
    }
  }
}

/** Grayscale dilation (max) with a (2rx+1) x (2ry+1) rectangle. */
export function grayDilate(img: GrayImage, rx: number, ry: number): GrayImage {
  const tmp = new Float32Array(img.data.length), out = new Float32Array(img.data.length);
  runningExtreme(img.data, tmp, img.w, img.h, rx, true, true);
  runningExtreme(tmp, out, img.w, img.h, ry, false, true);
  return { w: img.w, h: img.h, data: out };
}
export function grayErode(img: GrayImage, rx: number, ry: number): GrayImage {
  const tmp = new Float32Array(img.data.length), out = new Float32Array(img.data.length);
  runningExtreme(img.data, tmp, img.w, img.h, rx, true, false);
  runningExtreme(tmp, out, img.w, img.h, ry, false, false);
  return { w: img.w, h: img.h, data: out };
}
/** Morphological closing: removes dark structures smaller than the kernel. */
export const grayClose = (img: GrayImage, rx: number, ry: number) => grayErode(grayDilate(img, rx, ry), rx, ry);
export const grayOpen = (img: GrayImage, rx: number, ry: number) => grayDilate(grayErode(img, rx, ry), rx, ry);

/** Integral image of a binary/float field, size (w+1)*(h+1). */
export function integral(data: ArrayLike<number>, w: number, h: number): Float64Array {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) {
      s += data[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s;
    }
  }
  return I;
}
/** Sum over [x0,x1) x [y0,y1) of an integral image (coordinates clamped). */
export function rectSum(I: Float64Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): number {
  x0 = Math.max(0, Math.min(w, Math.round(x0))); x1 = Math.max(0, Math.min(w, Math.round(x1)));
  y0 = Math.max(0, Math.min(h, Math.round(y0))); y1 = Math.max(0, Math.min(h, Math.round(y1)));
  if (x1 <= x0 || y1 <= y0) return 0;
  const W = w + 1;
  return I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
}

/** Binary dilation/erosion with a rectangular kernel via integral images. */
export function binDilate(m: Mask, rx: number, ry: number): Mask {
  const I = integral(m.data, m.w, m.h), out = mask(m.w, m.h);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++)
    out.data[y * m.w + x] = rectSum(I, m.w, m.h, x - rx, y - ry, x + rx + 1, y + ry + 1) > 0 ? 1 : 0;
  return out;
}
export function binErode(m: Mask, rx: number, ry: number): Mask {
  const I = integral(m.data, m.w, m.h), out = mask(m.w, m.h);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const x0 = Math.max(0, x - rx), x1 = Math.min(m.w, x + rx + 1), y0 = Math.max(0, y - ry), y1 = Math.min(m.h, y + ry + 1);
    out.data[y * m.w + x] = rectSum(I, m.w, m.h, x0, y0, x1, y1) >= (x1 - x0) * (y1 - y0) ? 1 : 0;
  }
  return out;
}
export const binClose = (m: Mask, rx: number, ry: number) => binErode(binDilate(m, rx, ry), rx, ry);
export const binOpen = (m: Mask, rx: number, ry: number) => binDilate(binErode(m, rx, ry), rx, ry);

/** Otsu threshold over values where `valid` (optional) is set. */
export function otsu(values: Float32Array, valid?: Uint8Array): number {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (valid && !valid[i]) continue;
    const v = values[i];
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  if (!(hi > lo)) return lo;
  const bins = 256, hist = new Float64Array(bins), sc = (bins - 1) / (hi - lo);
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (valid && !valid[i]) continue;
    hist[Math.round((values[i] - lo) * sc)]++; n++;
  }
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = -1, bestT = 0;
  for (let t = 0; t < bins; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  return lo + (bestT + 0.5) / sc;
}

export interface Component { label: number; area: number; x0: number; y0: number; x1: number; y1: number; sumX: number; sumY: number }

/** 8-connected component labelling (two-pass with union-find). Returns labels (0 = background) and stats. */
export function components(m: Mask): { labels: Int32Array; comps: Component[] } {
  const { w, h, data } = m;
  const labels = new Int32Array(w * h);
  const parent: number[] = [0];
  const find = (a: number) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const unite = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  let next = 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!data[i]) continue;
    const nb: number[] = [];
    if (x > 0 && labels[i - 1]) nb.push(labels[i - 1]);
    if (y > 0) {
      if (labels[i - w]) nb.push(labels[i - w]);
      if (x > 0 && labels[i - w - 1]) nb.push(labels[i - w - 1]);
      if (x < w - 1 && labels[i - w + 1]) nb.push(labels[i - w + 1]);
    }
    if (!nb.length) { parent.push(next); labels[i] = next++; }
    else {
      let m0 = nb[0];
      for (const l of nb) if (l < m0) m0 = l;
      labels[i] = m0;
      for (const l of nb) unite(m0, l);
    }
  }
  const map = new Map<number, Component>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!labels[i]) continue;
    const r = find(labels[i]);
    labels[i] = r;
    let c = map.get(r);
    if (!c) { c = { label: r, area: 0, x0: x, y0: y, x1: x, y1: y, sumX: 0, sumY: 0 }; map.set(r, c); }
    c.area++; c.sumX += x; c.sumY += y;
    if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
  }
  return { labels, comps: [...map.values()] };
}

/** RGB -> HSV (h in [0,360), s,v in [0,1]). */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, mx > 0 ? d / mx : 0, mx];
}

/** Bilinear sample of a gray image. */
export function sampleGray(img: GrayImage, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= img.w - 1 || y0 >= img.h - 1) {
    const xi = Math.max(0, Math.min(img.w - 1, Math.round(x))), yi = Math.max(0, Math.min(img.h - 1, Math.round(y)));
    return img.data[yi * img.w + xi];
  }
  const fx = x - x0, fy = y - y0, i = y0 * img.w + x0, d = img.data;
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + img.w] * (1 - fx) + d[i + img.w + 1] * fx) * fy;
}

/** Mean of a gray image inside a rectangle (fast path via integral image). */
export function meanIn(I: Float64Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): number {
  const ax0 = Math.max(0, Math.round(x0)), ax1 = Math.min(w, Math.round(x1)), ay0 = Math.max(0, Math.round(y0)), ay1 = Math.min(h, Math.round(y1));
  const n = Math.max(0, ax1 - ax0) * Math.max(0, ay1 - ay0);
  return n > 0 ? rectSum(I, w, h, ax0, ay0, ax1, ay1) / n : 0;
}
