// Opening detection: windows, doors, portals and shop fronts.
//
// Openings are found as dark, smooth, roughly rectangular regions with a morphological
// black top-hat (closing minus image): anything darker than its surroundings and smaller than
// the structuring element lights up – glazing and door leaves against the wall surface.
// Textured dark surfaces (brick, foliage) are suppressed with a local-roughness test.
// Each candidate is then refined against axis-aligned edge profiles to find the outer edge
// of the opening and the frame width, and tested for an arched head.
import { Ctx } from './ctx';
import { Rect, clamp, median, percentile } from './geom';
import { GrayImage, Mask, binClose, binOpen, boxBlur, components, grayClose, grayOpen, integral, rectSum } from './image';
import { Arch, Opening, OpeningKind, openingInner, uid } from './model';

export interface OpeningMaps {
  /** black top-hat response (crop coordinates) */
  T: GrayImage;
  ox: number;
  oy: number;
  threshold: number;
  IT: Float64Array;
  dark: Mask;
  /** local roughness (crop coordinates) and its "smooth" threshold */
  S: GrayImage;
  sT: number;
}

/** Mean of an edge raster along rows (for y in [y0,y1)) over x in [x0,x1). */
export function rowProfile(E: Float32Array, W: number, H: number, x0: number, x1: number, y0: number, y1: number): number[] {
  const out: number[] = [];
  const xa = Math.max(0, Math.round(x0)), xb = Math.min(W, Math.round(x1));
  for (let y = Math.round(y0); y < Math.round(y1); y++) {
    if (y < 0 || y >= H || xb <= xa) { out.push(0); continue; }
    let s = 0;
    for (let x = xa; x < xb; x++) s += E[y * W + x];
    out.push(s / (xb - xa));
  }
  return out;
}
export function colProfile(E: Float32Array, W: number, H: number, x0: number, x1: number, y0: number, y1: number): number[] {
  const out: number[] = [];
  const ya = Math.max(0, Math.round(y0)), yb = Math.min(H, Math.round(y1));
  for (let x = Math.round(x0); x < Math.round(x1); x++) {
    if (x < 0 || x >= W || yb <= ya) { out.push(0); continue; }
    let s = 0;
    for (let y = ya; y < yb; y++) s += E[y * W + x];
    out.push(s / (yb - ya));
  }
  return out;
}
/** Indices of local maxima above `min`, after light smoothing. */
export function peaks(p: number[], min: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = i > 0 ? p[i - 1] : -Infinity, b = i < p.length - 1 ? p[i + 1] : -Infinity;
    if (p[i] >= min && p[i] >= a && p[i] > b) out.push(i);
  }
  return out;
}

export function computeOpeningMaps(ctx: Ctx, topY: number): OpeningMaps {
  const { W, H, facade: f, fw, fh } = ctx;
  const ox = Math.max(0, Math.floor(f.x0) - 4), oy = Math.max(0, Math.floor(topY) - 4);
  const cw = Math.min(W, Math.ceil(f.x1) + 4) - ox, ch = Math.min(H, Math.ceil(f.ground) + 2) - oy;
  const crop = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = ctx.L.data[(y + oy) * W + x + ox];
  const Lc: GrayImage = { w: cw, h: ch, data: crop };
  // Wall background: first remove thin bright structures (frames, mullions, mortar joints, sills)
  // with a small opening, then fill dark structures smaller than a storey with a large closing.
  const ro = Math.max(2, Math.round(0.011 * fw)), roy = Math.max(2, Math.round(0.011 * fh));
  const rx = Math.max(6, Math.round(0.07 * fw)), ry = Math.max(8, Math.round(0.12 * fh));
  const C = grayClose(grayOpen(Lc, ro, roy), rx, ry);
  // Relative darkness in percent of the local wall brightness: comparable across light stucco and dark brick.
  const T: GrayImage = { w: cw, h: ch, data: new Float32Array(cw * ch) };
  for (let i = 0; i < crop.length; i++) T.data[i] = Math.max(0, (100 * (C.data[i] - crop[i])) / Math.max(25, C.data[i]));
  // local roughness – suppresses brick, stone joints, foliage
  const sm = boxBlur(Lc, 2);
  const dev: GrayImage = { w: cw, h: ch, data: new Float32Array(cw * ch) };
  for (let i = 0; i < crop.length; i++) dev.data[i] = Math.abs(crop[i] - sm.data[i]);
  const S = boxBlur(dev, 2);
  const valid = new Uint8Array(cw * ch);
  const sVals: number[] = [], tVals: number[] = [];
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const gx = x + ox, gy = y + oy;
    if (gx < f.x0 || gx >= f.x1 || gy < topY || gy >= f.ground) continue;
    if (!ctx.usable[gy * W + gx]) continue;
    valid[y * cw + x] = 1;
    if (((x * 7 + y * 13) & 3) === 0) { sVals.push(S.data[y * cw + x]); tVals.push(T.data[y * cw + x]); }
  }
  const sT = Math.max(6, percentile(sVals, 60) * 1.1);
  // Threshold: Otsu-like split of the top-hat histogram, bounded below by an absolute contrast.
  const tOtsu = otsuOf(tVals);
  const sens = ctx.opt.sensitivity;
  // bounded: low-contrast glazing in dark brick must still pass, wall noise must not
  const threshold = clamp(tOtsu * (1.2 - 0.4 * sens), 15 - 5 * sens, 30 - 8 * sens);
  const dark: Mask = { w: cw, h: ch, data: new Uint8Array(cw * ch) };
  for (let i = 0; i < crop.length; i++) dark.data[i] = valid[i] && T.data[i] > threshold && S.data[i] < sT ? 1 : 0;
  // remove storey-wide dark strips (plinths, cornice shadows, balcony shadows): no opening is that wide
  const maxRun = Math.round(0.42 * fw);
  for (let y = 0; y < ch; y++) {
    let x = 0;
    while (x < cw) {
      if (!dark.data[y * cw + x]) { x++; continue; }
      let e = x;
      while (e < cw && dark.data[y * cw + e]) e++;
      if (e - x > maxRun) dark.data.fill(0, y * cw + x, y * cw + e);
      x = e;
    }
  }
  const cx = Math.max(2, Math.round(0.006 * fw)), cy = Math.max(2, Math.round(0.006 * fh));
  const cleaned = binClose(binOpen(dark, 1, 1), cx, cy);
  for (let i = 0; i < crop.length; i++) cleaned.data[i] &= valid[i];
  return { T, ox, oy, threshold, IT: integral(T.data, cw, ch), dark: cleaned, S, sT };
}

function otsuOf(vals: number[]): number {
  if (!vals.length) return 20;
  const lo = Math.min(...vals.slice(0, 50000)), hi = percentile(vals, 99.5);
  const bins = 128, hist = new Float64Array(bins);
  for (const v of vals) hist[Math.max(0, Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo + 1e-9)) * (bins - 1))))]++;
  let sumAll = 0; for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = -1, bt = 0;
  const n = vals.length;
  for (let t = 0; t < bins; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += t * hist[t];
    const d = sumB / wB - (sumAll - sumB) / wF;
    const v = wB * wF * d * d;
    if (v > best) { best = v; bt = t; }
  }
  return lo + ((bt + 0.5) / (bins - 1)) * (hi - lo);
}

/** Average top-hat contrast inside a rectangle, relative to the detection threshold. */
export function evidence(maps: OpeningMaps, r: Rect): number {
  const m = rectSum(maps.IT, maps.T.w, maps.T.h, r.x - maps.ox, r.y - maps.oy, r.x + r.w - maps.ox, r.y + r.h - maps.oy);
  const n = Math.max(1, Math.round(r.w) * Math.round(r.h));
  return m / n / maps.threshold;
}

/**
 * Extend a candidate up/down while both jambs (vertical edges at its sides) continue and the
 * interior stays smooth – recovers glazing whose upper part reflects the sky and looks light.
 */
export function extendAlongJambs(ctx: Ctx, maps: OpeningMaps, g: Rect): Rect {
  const { W, H, Ev, edgeT } = ctx;
  const jl = Math.round(g.x), jr = Math.round(g.x + g.w - 1);
  const edgeAt = (x: number, y: number) => {
    for (let d = -2; d <= 2; d++) { const xx = x + d; if (xx >= 0 && xx < W && Ev[y * W + xx] > edgeT * 0.6) return true; }
    return false;
  };
  const smooth = (y: number) => {
    const ly = y - maps.oy;
    if (ly < 0 || ly >= maps.S.h) return false;
    const vals: number[] = [];
    for (let x = Math.round(g.x + g.w * 0.15); x < g.x + g.w * 0.85; x += 2) vals.push(maps.S.data[ly * maps.S.w + x - maps.ox]);
    return median(vals) < maps.sT * 1.2;
  };
  const maxMiss = Math.max(3, Math.round(0.05 * g.h));
  const walk = (start: number, dir: -1 | 1, limit: number) => {
    let best = start, miss = 0;
    for (let y = start + dir; dir < 0 ? y > limit : y < limit; y += dir) {
      if (y < 1 || y >= H - 1) break;
      if (edgeAt(jl, y) && edgeAt(jr, y) && smooth(y)) { best = y; miss = 0; }
      else if (++miss > maxMiss) break;
    }
    return best;
  };
  const top = walk(Math.round(g.y), -1, Math.max(ctx.facade.top - 2, g.y - 1.5 * g.h));
  const bot = walk(Math.round(g.y + g.h - 1), 1, Math.min(ctx.facade.ground, g.y + g.h + 0.8 * g.h));
  return { x: g.x, y: top, w: g.w, h: bot - top + 1 };
}

/**
 * Arched head from the frame edge above the springing line: for each column the topmost strong
 * edge is found and a circular segment is fitted. Returns null if no consistent arch is present.
 */
export function detectArchFromEdges(ctx: Ctx, o: Rect): Arch | undefined {
  const { W, g } = ctx;
  const c = o.w / 2, cx = o.x + c;
  if (o.w < 12) return undefined;
  const yBottom = Math.round(o.y + Math.min(o.h * 0.25, 4)), yTopLimit = Math.round(o.y - 0.75 * o.w);
  const samples: { t: number; y: number }[] = [];
  for (let x = Math.round(o.x + o.w * 0.05); x < o.x + o.w * 0.95; x++) {
    let mx = 0;
    for (let y = yTopLimit; y <= yBottom; y++) if (y > 0 && g.mag[y * W + x] > mx) mx = g.mag[y * W + x];
    if (mx < ctx.edgeT) continue;
    for (let y = Math.max(1, yTopLimit); y <= yBottom; y++) if (g.mag[y * W + x] > 0.5 * mx) { samples.push({ t: (x + 0.5 - cx) / c, y }); break; }
  }
  if (samples.length < o.w * 0.6) return undefined;
  const at = (lo: number, hi: number) => median(samples.filter((s) => Math.abs(s.t) >= lo && Math.abs(s.t) <= hi).map((s) => s.y));
  const apex = at(0, 0.15), side = at(0.85, 0.95);
  const drop = side - apex;
  if (!(drop > 0.15 * o.w)) return undefined;
  // a true arch springs from the jambs: its sides meet the top of the opening (a pediment or hood above does not)
  if (Math.abs(side - o.y) > 0.12 * o.w + 2) return undefined;
  let best = { f: c, err: Infinity };
  for (let k = 15; k <= 105; k += 2.5) {
    const f = (k / 100) * c, R = (c * c + f * f) / (2 * f);
    let err = 0;
    for (const s of samples) {
      const xx = Math.min(1, Math.abs(s.t)) * c;
      const model = f - (Math.sqrt(Math.max(0, R * R - xx * xx)) - (R - f));
      err += (model - (s.y - apex)) ** 2;
    }
    if (err < best.err) best = { f, err };
  }
  const rmse = Math.sqrt(best.err / samples.length);
  if (rmse > 0.08 * o.w) return undefined;
  const round = best.f > 0.85 * c;
  return { type: round ? 'round' : 'segmental', rise: round ? c : best.f };
}

interface SideFit { outer: number; inner: number | null; found: boolean }

function fitSide(prof: number[], start: number, glassEdge: number, outward: -1 | 1, minPeak: number): SideFit {
  const mx = Math.max(...prof);
  const P = peaks(prof, Math.max(minPeak, mx * 0.18)).map((i) => i + start);
  if (!P.length) return { outer: glassEdge, inner: null, found: false };
  const sorted = [...P].sort((a, b) => (a - b) * outward);
  const outer = sorted[sorted.length - 1]; // furthest in the outward direction
  const inner = sorted[0];
  return { outer, inner: Math.abs(outer - inner) >= 2 ? inner : null, found: true };
}

/** Refine a dark-region box to the opening's outer edge; estimate the frame width. */
export function refineOpening(ctx: Ctx, g: Rect): { rect: Rect; frame: number; frameEstimated: boolean; edgeSupport: number } {
  const { W, H, Eh, Ev, edgeT } = ctx;
  const m = Math.min(g.w, g.h);
  const dout = Math.max(2, Math.round(0.12 * m)), din = Math.max(2, Math.round(0.12 * m));
  const cxa = g.x + g.w * 0.15, cxb = g.x + g.w * 0.85, cya = g.y + g.h * 0.15, cyb = g.y + g.h * 0.85;
  const minPeak = edgeT * 0.5;
  const y0 = g.y, y1 = g.y + g.h, x0 = g.x, x1 = g.x + g.w;
  const top = fitSide(rowProfile(Eh, W, H, cxa, cxb, y0 - dout, y0 + din), Math.round(y0 - dout), y0, -1, minPeak);
  const bot = fitSide(rowProfile(Eh, W, H, cxa, cxb, y1 - din, y1 + dout), Math.round(y1 - din), y1, 1, minPeak);
  const lef = fitSide(colProfile(Ev, W, H, x0 - dout, x0 + din, cya, cyb), Math.round(x0 - dout), x0, -1, minPeak);
  const rig = fitSide(colProfile(Ev, W, H, x1 - din, x1 + dout, cya, cyb), Math.round(x1 - din), x1, 1, minPeak);
  const rx0 = Math.min(lef.outer, x0 + 1), rx1 = Math.max(rig.outer + 1, x1 - 1);
  const ry0 = Math.min(top.outer, y0 + 1), ry1 = Math.max(bot.outer + 1, y1 - 1);
  const frames: number[] = [];
  if (top.inner !== null) frames.push(top.inner - top.outer);
  if (lef.inner !== null) frames.push(lef.inner - lef.outer);
  if (rig.inner !== null) frames.push(rig.outer - rig.inner);
  if (!frames.length && bot.inner !== null) frames.push(bot.outer - bot.inner);
  const rect = { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 };
  const mm = Math.min(rect.w, rect.h);
  const frameEstimated = frames.length === 0;
  const frame = frameEstimated ? Math.max(1.5, 0.06 * mm) : clamp(median(frames), 1, 0.2 * mm);
  const edgeSupport = [top, bot, lef, rig].filter((s) => s.found).length / 4;
  return { rect, frame, frameEstimated, edgeSupport };
}

/** Test the dark region's upper outline for an arch; returns the arch of the opening if found. */
export function detectArch(maps: OpeningMaps, glass: Rect, opening: Rect): Arch | undefined {
  const { dark, ox, oy } = maps;
  const c = glass.w / 2;
  if (glass.w < 10 || glass.h < glass.w * 0.6) return undefined;
  const samples: { t: number; d: number }[] = [];
  const xs = Math.round(glass.x + glass.w * 0.04), xe = Math.round(glass.x + glass.w * 0.96);
  for (let x = xs; x < xe; x++) {
    let d = -1;
    for (let y = Math.round(glass.y); y < glass.y + glass.h * 0.6; y++) {
      const lx = x - ox, ly = y - oy;
      if (lx < 0 || ly < 0 || lx >= dark.w || ly >= dark.h) continue;
      if (dark.data[ly * dark.w + lx]) { d = y - glass.y; break; }
    }
    if (d >= 0) samples.push({ t: (x + 0.5 - (glass.x + c)) / c, d });
  }
  if (samples.length < glass.w * 0.6) return undefined;
  const at = (lo: number, hi: number) => median(samples.filter((s) => Math.abs(s.t) >= lo && Math.abs(s.t) <= hi).map((s) => s.d));
  const corner = at(0.8, 0.95), centre = at(0, 0.2);
  if (!(corner - centre > 0.12 * glass.w)) return undefined;
  // fit rise f of a circular segment over the half-chord c
  let best = { f: c, err: Infinity };
  for (let k = 10; k <= 105; k += 2.5) {
    const f = (k / 100) * c;
    const R = (c * c + f * f) / (2 * f);
    let err = 0;
    for (const s of samples) {
      const xx = Math.min(1, Math.abs(s.t)) * c;
      const model = f - (Math.sqrt(Math.max(0, R * R - xx * xx)) - (R - f));
      err += (model - (s.d - centre)) ** 2;
    }
    if (err < best.err) best = { f, err };
  }
  const round = best.f > 0.85 * c;
  const halfOuter = opening.w / 2;
  const rise = round ? halfOuter : Math.min(halfOuter, best.f + (opening.w - glass.w) / 2);
  return { type: round ? 'round' : 'segmental', rise };
}

/** Mullions/transoms: thin bars crossing the glazing (brighter or darker than the glass). */
export function detectSubdivisions(ctx: Ctx, o: Opening): Pick<Opening, 'mullions' | 'transoms' | 'mullionStrength' | 'transomStrength'> {
  const inner = openingInner(o);
  const springing = o.arch ? o.rect.y + o.arch.rise : inner.y;
  const L = ctx.L, W = ctx.W;
  const res = { mullions: [] as number[], transoms: [] as number[], mullionStrength: [] as number[], transomStrength: [] as number[] };
  if (inner.w < 8 || inner.h < 10) return res;
  const ya = Math.max(springing, inner.y) + inner.h * 0.06, yb = inner.y + inner.h * 0.94;
  const xa = inner.x + inner.w * 0.06, xb = inner.x + inner.w * 0.94;
  const lum = (x: number, y: number) => L.data[Math.round(y) * W + Math.round(x)];
  const scan = (n: number, at: (i: number, j: number) => number, m: number, maxBar: number) => {
    // profile along the scan axis (i), averaged over the other axis (j)
    const prof: number[] = [];
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < m; j++) s += at(i, j); prof.push(s / m); }
    const base = median(prof);
    const dev = prof.map((v) => v - base);
    const amp = Math.max(...dev.map(Math.abs));
    const thr = Math.max(9, amp * 0.4);
    const found: { pos: number; strength: number }[] = [];
    let i = 0;
    while (i < n) {
      if (Math.abs(dev[i]) <= thr) { i++; continue; }
      const sign = Math.sign(dev[i]);
      let j = i;
      while (j < n && Math.sign(dev[j]) === sign && Math.abs(dev[j]) > thr * 0.5) j++;
      const width = j - i;
      const left = i - width - 2, right = j + width + 1;
      const isBar = width <= maxBar && left >= 0 && right < n && Math.abs(dev[left]) < thr * 0.7 && Math.abs(dev[right]) < thr * 0.7;
      if (isBar) {
        const c = (i + j - 1) / 2;
        // coverage along the bar
        let hit = 0;
        for (let k = 0; k < m; k++) {
          const v = at(Math.round(c), k) - at(Math.max(0, Math.round(c) - width - 2), k) / 2 - at(Math.min(n - 1, Math.round(c) + width + 2), k) / 2;
          if (Math.sign(v) === sign && Math.abs(v) > thr * 0.35) hit++;
        }
        const cov = hit / m;
        if (cov > 0.6) {
          const meanDev = dev.slice(i, j).reduce((a, b) => a + Math.abs(b), 0) / width;
          found.push({ pos: c / n, strength: clamp((meanDev / 45) * cov, 0.05, 1) });
        }
      }
      i = j;
    }
    return found;
  };
  const nx = Math.round(xb - xa), ny = Math.round(yb - ya);
  if (nx > 6 && ny > 6) {
    const my = Math.min(ny, 40), mx = Math.min(nx, 40);
    const mul = scan(nx, (i, j) => lum(xa + i, ya + (j * (ny - 1)) / Math.max(1, my - 1)), my, Math.max(2, inner.w * 0.14));
    const tra = scan(ny, (i, j) => lum(xa + (j * (nx - 1)) / Math.max(1, mx - 1), ya + i), mx, Math.max(2, inner.h * 0.1));
    for (const m of mul) { res.mullions.push((xa + m.pos * nx - inner.x) / inner.w); res.mullionStrength.push(m.strength); }
    for (const t of tra) { res.transoms.push((ya + t.pos * ny - inner.y) / inner.h); res.transomStrength.push(t.strength); }
  }
  return res;
}

/** Horizontal ledges directly below (sill) and above (hood moulding) an opening. */
export function detectSillAndHood(ctx: Ctx, r: Rect): { sill?: Rect; hood?: Rect } {
  const { W, H, Eh, edgeT } = ctx;
  const runsAt = (y: number): [number, number] | null => {
    // longest run of edge pixels through the opening's centre region on row y
    if (y < 0 || y >= H) return null;
    const cx = Math.round(r.x + r.w / 2);
    const on = (x: number) => x >= 0 && x < W && (Eh[y * W + x] > edgeT * 0.6 || (y > 0 && Eh[(y - 1) * W + x] > edgeT * 0.6));
    if (!on(cx) && !on(cx - 2) && !on(cx + 2)) return null;
    let a = cx, b = cx, gap = 0;
    while (a > r.x - r.w * 0.5 && gap < 3) { a--; gap = on(a) ? 0 : gap + 1; }
    gap = 0;
    while (b < r.x + r.w * 1.5 && gap < 3) { b++; gap = on(b) ? 0 : gap + 1; }
    return [a + 3, b - 3];
  };
  const collect = (ya: number, yb: number) => {
    const lines: { y: number; a: number; b: number }[] = [];
    for (let y = Math.round(ya); y <= Math.round(yb); y++) {
      const run = runsAt(y);
      if (run && run[0] < r.x - 1 && run[1] > r.x + r.w + 1 && run[1] - run[0] < r.w * 1.9) lines.push({ y, a: run[0], b: run[1] });
    }
    return lines;
  };
  const out: { sill?: Rect; hood?: Rect } = {};
  const below = collect(r.y + r.h - 1, r.y + r.h + Math.max(3, r.h * 0.12));
  if (below.length) {
    const a = median(below.map((l) => l.a)), b = median(below.map((l) => l.b));
    const ys = below.map((l) => l.y);
    const y0 = Math.min(...ys), y1 = Math.max(Math.max(...ys), y0 + Math.max(2, r.h * 0.03));
    out.sill = { x: a, y: Math.max(r.y + r.h, y0), w: b - a, h: Math.max(2, y1 - Math.max(r.y + r.h, y0)) };
  }
  const above = collect(r.y - Math.max(3, r.h * 0.22), r.y - 1);
  if (above.length) {
    const a = median(above.map((l) => l.a)), b = median(above.map((l) => l.b));
    const y0 = Math.min(...above.map((l) => l.y));
    if (r.y - y0 >= 2) out.hood = { x: a, y: y0, w: b - a, h: r.y - y0 };
  }
  return out;
}

export function classifyOpening(ctx: Ctx, r: Rect, typicalW: number): OpeningKind {
  const nearGround = r.y + r.h > ctx.facade.ground - 0.045 * ctx.fh;
  if (!nearGround) return 'window';
  if (r.w > 1.7 * r.h) return 'shopfront';
  if (r.w > 1.45 * typicalW && r.h > 0.12 * ctx.fh) return 'portal';
  return 'door';
}

/** Two dark boxes side by side with the same head and sill, separated by a thin bar, are one opening. */
function mergeSplitPanes(ctx: Ctx, c: { glass: Rect; fill: number; contrast: number; occluded: number }[]) {
  const fw = ctx.fw;
  // the strip between the panes must be smooth (a frame member), not brick or stone
  // A mullion is one bar: exactly two vertical edges across the gap and no horizontal texture.
  // A pier between paired windows shows frame + wall + frame (>= 4 edges); brick shows many.
  const singleBar = (xa: number, xb: number, ya: number, yb: number) => {
    const prof = colProfile(ctx.Ev, ctx.W, ctx.H, xa - 2, xb + 3, ya + (yb - ya) * 0.1, yb - (yb - ya) * 0.1);
    const pk = peaks(prof, 0.5 * ctx.edgeT);
    const ehs = rowProfile(ctx.Eh, ctx.W, ctx.H, xa + 2, xb - 1, ya + (yb - ya) * 0.1, yb - (yb - ya) * 0.1);
    const eh = ehs.reduce((s, v) => s + v, 0) / Math.max(1, ehs.length);
    return pk.length <= 2 && eh < 0.35 * ctx.edgeT;
  };
  type C = { glass: Rect; fill: number; contrast: number; occluded: number };
  const n = c.length;
  const edges: { i: number; j: number; thin: boolean }[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const a = c[i].glass, b = c[j].glass;
    if (b.x < a.x) continue;
    const gap = b.x - (a.x + a.w);
    const ov = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    const sameHead = Math.abs(a.y - b.y) < 0.12 * Math.max(a.h, b.h) && Math.abs(a.y + a.h - b.y - b.h) < 0.12 * Math.max(a.h, b.h);
    if (!(ov > 0.8 * Math.min(a.h, b.h) && sameHead && gap >= -2)) continue;
    const thin = gap < Math.max(0.006 * fw, 0.2 * Math.min(a.w, b.w));
    const bridged = gap < Math.min(0.035 * fw, 0.45 * Math.min(a.w, b.w)) && singleBar(a.x + a.w, b.x, Math.max(a.y, b.y), Math.min(a.y + a.h, b.y + b.h));
    if (thin || bridged) edges.push({ i, j, thin });
  }
  const uf = (k: number) => Array.from({ length: k }, (_, i) => i);
  const find = (p: number[], x: number): number => (p[x] === x ? x : (p[x] = find(p, p[x])));
  // a window has a few lights; an evenly spaced row of windows (piers between them) must not chain together
  const p1 = uf(n);
  for (const e of edges) p1[find(p1, e.i)] = find(p1, e.j);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) (groups.get(find(p1, i)) ?? groups.set(find(p1, i), []).get(find(p1, i))!).push(i);
  const tooBig = new Set<number>();
  for (const [root, g] of groups) {
    const x0 = Math.min(...g.map((i) => c[i].glass.x)), x1 = Math.max(...g.map((i) => c[i].glass.x + c[i].glass.w));
    if (g.length > 4 || x1 - x0 > 0.25 * fw) tooBig.add(root);
  }
  const p2 = uf(n);
  for (const e of edges) if (e.thin || !tooBig.has(find(p1, e.i))) p2[find(p2, e.i)] = find(p2, e.j);
  const out = new Map<number, C>();
  for (let i = 0; i < n; i++) {
    const r = find(p2, i), cur = out.get(r), it = c[i];
    if (!cur) { out.set(r, { ...it, glass: { ...it.glass } }); continue; }
    const a = cur.glass, b = it.glass;
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
    const wa = a.w * a.h, wb = b.w * b.h;
    out.set(r, { glass: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, fill: (cur.fill * wa + it.fill * wb) / (wa + wb),
      contrast: (cur.contrast * wa + it.contrast * wb) / (wa + wb), occluded: Math.max(cur.occluded, it.occluded) });
  }
  c.splice(0, c.length, ...out.values());
}

/** Full detection pass: candidates -> refined openings (before pattern regularisation). */
export function detectOpenings(ctx: Ctx, maps: OpeningMaps): Opening[] {
  const { fw, fh } = ctx;
  const { comps, labels } = components(maps.dark);
  const cands: { glass: Rect; fill: number; contrast: number; occluded: number }[] = [];
  const occI = integral(ctx.occ, ctx.W, ctx.H);
  for (const c of comps) {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if (w < Math.max(5, 0.012 * fw) || h < Math.max(8, 0.02 * fh)) continue;
    if (w > 0.4 * fw || h > 0.5 * fh) continue;
    const fill = c.area / (w * h);
    if (fill < 0.4) continue;
    const asp = h / w;
    if (asp < 0.22 || asp > 5.5) continue;
    if (h < 0.035 * fh && w > 0.15 * fw) continue; // shadow strips under cornices
    const glass = { x: c.x0 + maps.ox, y: c.y0 + maps.oy, w, h };
    // occluder overlap measured on a slightly inflated box (occluders touch, not cover, the dark region)
    const occluded = rectSum(occI, ctx.W, ctx.H, glass.x - 3, glass.y - 3, glass.x + w + 3, glass.y + h + 3) / ((w + 6) * (h + 6));
    if (occluded > 0.5) continue;
    let s = 0;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (labels[y * maps.dark.w + x] === c.label) s += maps.T.data[y * maps.T.w + x];
    cands.push({ glass, fill, contrast: s / c.area / maps.threshold, occluded });
  }
  for (const c of cands) c.glass = extendAlongJambs(ctx, maps, c.glass);
  mergeSplitPanes(ctx, cands);
  const typicalW = median(cands.map((c) => c.glass.w)) || fw * 0.06;
  const out: Opening[] = [];
  for (const c of cands) {
    const ref = refineOpening(ctx, c.glass);
    const kind = classifyOpening(ctx, ref.rect, typicalW);
    if (kind !== 'window') { // doors reach the ground line
      const gap = ctx.facade.ground - (ref.rect.y + ref.rect.h);
      if (gap > 0 && gap < 0.06 * fh) ref.rect.h += gap;
    }
    const flags: string[] = [];
    if (ref.frameEstimated) flags.push('frame width estimated');
    if (c.occluded > 0.1) flags.push('partly occluded');
    const conf = clamp(0.2 + 0.3 * Math.min(1, c.contrast / 2.2) + 0.3 * ref.edgeSupport + 0.2 * c.fill, 0, 1) * (1 - 0.6 * c.occluded);
    const o: Opening = {
      id: uid('o'), kind, rect: ref.rect, frame: ref.frame, mullions: [], transoms: [], mullionStrength: [], transomStrength: [],
      handles: [], floor: 0, confidence: conf, source: 'detected', flags,
    };
    o.arch = detectArch(maps, c.glass, o.rect);
    if (!o.arch) {
      const a = detectArchFromEdges(ctx, o.rect);
      if (a) { o.arch = a; o.rect = { ...o.rect, y: o.rect.y - a.rise, h: o.rect.h + a.rise }; }
    }
    out.push(o);
  }
  return out;
}

export function enrichOpenings(ctx: Ctx, openings: Opening[]) {
  for (const o of openings) {
    Object.assign(o, detectSubdivisions(ctx, o));
    if (o.kind === 'window') {
      const sh = detectSillAndHood(ctx, o.rect);
      o.sill = sh.sill;
      o.hood = sh.hood;
    }
  }
}
