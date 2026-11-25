// Facade structure: roofline, ground line, horizontal bands (cornices, string courses, plinth),
// vertical elements (pilasters, downpipes, wall breaks), balconies and floor levels.
import { Ctx } from './ctx';
import { Pt, clamp, cluster1D, median, simplify } from './geom';
import { components, integral, mask, rectSum } from './image';
import { Band, Balcony, Floor, MaterialZone, Opening, Roof, Vertical, uid } from './model';
import { colProfile, peaks } from './openings';

// ------------------------------------------------------------------ roof

export function detectRoof(ctx: Ctx): { roof: Roof; visible: boolean } {
  const { W, H, sky, img, facade: f, fw, fh } = ctx;
  const ys: number[] = [];
  let unknown = 0;
  const x0 = Math.max(0, Math.round(f.x0)), x1 = Math.min(W, Math.round(f.x1));
  for (let x = x0; x < x1; x++) {
    let y = 0;
    while (y < H && img.data[(y * W + x) * 4 + 3] === 0) y++;
    if (y >= H || !sky[y * W + x]) { ys.push(NaN); unknown++; continue; }
    while (y < f.ground && (sky[y * W + x] || img.data[(y * W + x) * 4 + 3] === 0)) y++;
    ys.push(y);
  }
  const n = ys.length;
  if (!n || unknown / n > 0.4) {
    return {
      visible: false,
      roof: { line: [{ x: f.x0, y: f.top }, { x: f.x1, y: f.top }], eaveY: f.top, pitched: false, confidence: 0.3 },
    };
  }
  // fill unknowns by nearest known, then median filter
  for (let i = 0; i < n; i++) if (isNaN(ys[i])) {
    let a = i, b = i;
    while (a >= 0 && isNaN(ys[a])) a--;
    while (b < n && isNaN(ys[b])) b++;
    ys[i] = a >= 0 && b < n ? (ys[a] + ys[b]) / 2 : a >= 0 ? ys[a] : ys[b];
  }
  const r = Math.max(2, Math.round(0.005 * fw));
  const sm = ys.map((_, i) => median(ys.slice(Math.max(0, i - r), Math.min(n, i + r + 1))));
  const pts: Pt[] = sm.map((y, i) => ({ x: x0 + i, y }));
  pts.push({ x: x1, y: sm[n - 1] });
  let line = simplify(pts, Math.max(1.5, 0.004 * fw));
  line = snapPolyline(line);
  const eaveY = f.top;
  const medY = median(sm);
  const pitched = medY < eaveY - 0.03 * fh;
  return { visible: true, roof: { line, eaveY, pitched, confidence: clamp(0.85 - unknown / n, 0.3, 0.9) } };
}

/** Snap nearly horizontal / vertical polyline segments to exact orthogonality. */
export function snapPolyline(pts: Pt[], degTol = 3): Pt[] {
  const out = pts.map((p) => ({ ...p }));
  const t = Math.tan((degTol * Math.PI) / 180);
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    if (dy <= t * dx) { const y = (a.y + b.y) / 2; a.y = y; b.y = y; }
    else if (dx <= t * dy) { const x = (a.x + b.x) / 2; a.x = x; b.x = x; }
  }
  // drop collinear duplicates
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1], c = out[i + 1];
    return Math.abs((p.x - a.x) * (c.y - a.y) - (p.y - a.y) * (c.x - a.x)) > 0.5;
  });
}

/** Find the ground line when the quad was not placed by the user (auto mode). */
export function detectGround(ctx: Ctx): number | null {
  const { W, Eh, Ev, facade: f, fh, edgeT } = ctx;
  const x0 = Math.round(f.x0), x1 = Math.round(f.x1);
  let best: { y: number; s: number } | null = null;
  const band = Math.round(0.06 * fh);
  const act = (ya: number, yb: number) => {
    let s = 0, c = 0;
    for (let y = Math.max(0, ya); y < Math.min(ctx.H, yb); y += 2) for (let x = x0; x < x1; x += 2) { s += Eh[y * W + x] + Ev[y * W + x]; c++; }
    return c ? s / c : 0;
  };
  for (let y = Math.round(f.top + 0.5 * fh); y < Math.min(ctx.H - 2, f.ground + 0.02 * fh); y++) {
    let hit = 0, n = 0;
    for (let x = x0; x < x1; x++) {
      if (!ctx.usable[y * W + x]) continue;
      n++;
      if (Math.max(Eh[(y - 1) * W + x], Eh[y * W + x], Eh[(y + 1) * W + x]) > edgeT) hit++;
    }
    const cov = n ? hit / n : 0;
    if (cov < 0.45) continue;
    const above = act(y - band, y - 2), below = act(y + 2, y + band);
    const s = cov * (above - below) / (above + below + 1);
    if (!best || s > best.s) best = { y, s };
  }
  return best && best.s > 0.08 ? best.y : null;
}

// ------------------------------------------------------------------ horizontal bands

function excludedColumns(openings: Opening[], y: number, pad: number): [number, number][] {
  const out: [number, number][] = [];
  for (const o of openings) {
    const parts = [o.rect, o.sill, o.hood].filter(Boolean) as { x: number; y: number; w: number; h: number }[];
    for (const r of parts) if (y >= r.y - pad && y <= r.y + r.h + pad) out.push([r.x - pad, r.x + r.w + pad]);
  }
  return out;
}

/** Maximal runs (index ranges) of >= 5 lines with near-constant spacing below `maxSpacing`. */
export function periodicRuns(lines: number[], maxSpacing: number): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < lines.length - 1) {
    const s0 = lines[i + 1] - lines[i];
    if (s0 > maxSpacing) { i++; continue; }
    const sp = [s0];
    let j = i + 1;
    while (j + 1 < lines.length) {
      const s = lines[j + 1] - lines[j], m = median(sp);
      if (Math.abs(s - m) <= 0.25 * m + 1) { sp.push(s); j++; } else break;
    }
    if (j - i + 1 >= 5) { out.push([i, j]); i = j + 1; } else i++;
  }
  return out;
}

export interface BandResult { bands: Band[]; textures: MaterialZone[]; lines: number[] }

export function detectBands(ctx: Ctx, openings: Opening[], roofTop: number, eaveY: number, auto: boolean): BandResult {
  const { W, Eh, facade: f, fh, fw, edgeT } = ctx;
  const x0 = Math.round(f.x0), x1 = Math.round(f.x1);
  const yStart = Math.max(2, Math.round(auto ? Math.min(roofTop, eaveY) + 2 : eaveY - 0.03 * fh)), yEnd = Math.round(f.ground - Math.max(3, 0.006 * fh));
  const cov: number[] = [];
  const pad = Math.max(2, Math.round(0.004 * fw));
  for (let y = yStart; y < yEnd; y++) {
    const ex = excludedColumns(openings, y, pad);
    let hit = 0, n = 0;
    for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      if (!ctx.usable[i] || ex.some(([a, b]) => x >= a && x <= b)) continue;
      n++;
      if (Math.max(Eh[i - W], Eh[i], Eh[i + W]) > edgeT) hit++;
    }
    cov.push(n > fw * 0.15 ? hit / n : 0);
  }
  const minCov = 0.62 - 0.2 * ctx.opt.sensitivity;
  const lineYs = peaks(cov, minCov).map((i) => i + yStart);
  // non-max suppression (2 px)
  const lines: number[] = [];
  for (const y of lineYs) if (!lines.length || y - lines[lines.length - 1] > 2) lines.push(y); else if (cov[y - yStart] > cov[lines[lines.length - 1] - yStart]) lines[lines.length - 1] = y;
  // evenly spaced runs of lines over a tall zone are masonry coursing (brick, ashlar, rustication), not mouldings
  const textures: MaterialZone[] = [];
  const inTexture = new Set<number>();
  // a mortar joint gives two close edges; merge them before looking for a period
  const merged: number[][] = [];
  for (const y of lines) { const m = merged[merged.length - 1]; if (m && y - m[m.length - 1] <= Math.max(4, 0.004 * fh)) m.push(y); else merged.push([y]); }
  const centres = merged.map((m) => (m[0] + m[m.length - 1]) / 2);
  for (const [i, j] of periodicRuns(centres, 0.06 * fh)) {
    const zl = centres.slice(i, j + 1);
    merged.slice(i, j + 1).flat().forEach((y) => inTexture.add(y));
    const y0 = zl[0], y1 = zl[zl.length - 1];
    if (y1 - y0 < 0.08 * fh) { merged.slice(i, j + 1).flat().forEach((y) => inTexture.delete(y)); continue; }
    const sp = median(zl.slice(1).map((y, k) => y - zl[k]));
    const lowStorey = y1 > f.ground - 0.1 * fh && y0 > f.ground - 0.45 * fh;
    const pattern: MaterialZone['pattern'] = sp < 0.012 * fh ? 'brick' : lowStorey ? 'rustication' : 'ashlar';
    textures.push({ id: uid('m'), rect: { x: f.x0, y: y0, w: fw, h: y1 - y0 }, pattern, courses: zl, confidence: clamp(0.4 + 0.03 * zl.length, 0.4, 0.75) });
  }
  // group the remaining lines into bands
  const gap = Math.max(4, 0.02 * fh);
  const groups: number[][] = [];
  for (const y of lines.filter((l) => !inTexture.has(l))) {
    const g = groups[groups.length - 1];
    if (g && y - g[g.length - 1] <= gap) g.push(y); else groups.push([y]);
  }
  const bands: Band[] = groups.map((g) => makeBand(ctx, g, eaveY));
  // auto mode: topmost band near the top is the main cornice / eave
  if (auto && bands.length) {
    const top = bands.reduce((a, b) => (b.y0 < a.y0 ? b : a));
    if (top.y0 < f.top + 0.35 * fh) top.kind = 'cornice';
  }
  return { bands, textures, lines };
}

function makeBand(ctx: Ctx, ys: number[], eaveY: number): Band {
  const { facade: f, fh, W, L } = ctx;
  const y0 = ys[0], y1 = ys[ys.length - 1];
  let kind: Band['kind'] = 'string_course';
  if (y0 < eaveY + 0.12 * fh) kind = 'cornice';
  else if (y1 > f.ground - 0.08 * fh) kind = 'plinth';
  // projection: darker strip (shadow) right below the band
  const h = Math.max(3, Math.round(0.012 * fh));
  const meanRow = (ya: number, yb: number) => {
    let s = 0, n = 0;
    for (let y = Math.max(0, ya); y < Math.min(ctx.H, yb); y++) for (let x = Math.round(f.x0); x < f.x1; x += 3) { if (ctx.usable[y * W + x]) { s += L.data[y * W + x]; n++; } }
    return n ? s / n : 0;
  };
  const above = meanRow(y0 - h - 2, y0 - 2), below = meanRow(y1 + 2, y1 + h + 2);
  const projecting = below < above * 0.88;
  return {
    id: uid('b'), kind, x0: f.x0, x1: f.x1, y0, y1, lines: ys, projecting,
    confidence: clamp(0.5 + 0.08 * ys.length + (projecting ? 0.1 : 0), 0, 0.92), source: 'detected',
  };
}

// ------------------------------------------------------------------ verticals

export function detectVerticals(ctx: Ctx, openings: Opening[], top: number): Vertical[] {
  const { W, H, Ev, g, facade: f, fw, fh, edgeT } = ctx;
  const x0 = Math.round(f.x0 + 0.006 * fw), x1 = Math.round(f.x1 - 0.006 * fw);
  const ya = Math.round(top), yb = Math.round(f.ground);
  const cov: number[] = [];
  for (let x = x0; x < x1; x++) {
    const ex = openings.filter((o) => x >= o.rect.x - 2 && x <= o.rect.x + o.rect.w + 2).map((o) => [o.rect.y - 3, o.rect.y + o.rect.h + 3]);
    let hit = 0, n = 0;
    for (let y = ya; y < yb; y++) {
      const i = y * W + x;
      if (!ctx.usable[i] || ex.some(([a, b]) => y >= a && y <= b)) continue;
      n++;
      if (Math.max(Ev[i - 1], Ev[i], Ev[i + 1]) > edgeT * 0.8) hit++;
    }
    cov.push(n > (yb - ya) * 0.3 ? hit / n : 0);
  }
  const P = peaks(cov, 0.5).map((i) => i + x0);
  const xs: number[] = [];
  for (const x of P) if (!xs.length || x - xs[xs.length - 1] > 2) xs.push(x);
  const used = new Set<number>();
  const out: Vertical[] = [];
  const signAt = (x: number) => {
    let s = 0;
    for (let y = ya; y < yb; y += 2) s += g.gx[y * W + x];
    return Math.sign(s);
  };
  const extent = (xa: number, xb: number) => {
    // vertical extent of the element: rows where at least one of its edges is present
    let first = -1, last = -1;
    for (let y = ya; y < yb; y++) {
      const on = [xa, xb].some((x) => Math.max(Ev[y * W + x - 1] || 0, Ev[y * W + x], Ev[y * W + x + 1] || 0) > edgeT * 0.6);
      if (on) { if (first < 0) first = y; last = y; }
    }
    return first < 0 ? [ya, yb] : [first, last];
  };
  for (let i = 0; i < xs.length; i++) {
    if (used.has(i)) continue;
    const a = xs[i], b = xs[i + 1];
    if (b !== undefined && !used.has(i + 1)) {
      const d = b - a;
      const opposite = signAt(a) !== signAt(b);
      if (d < 0.013 * fw && opposite) {
        const [y0, y1] = extent(a, b);
        if (y1 - y0 > 0.4 * fh) {
          out.push({ id: uid('v'), kind: 'downpipe', x0: a, x1: b, y0, y1: Math.max(y1, f.ground), lines: [], confidence: clamp((cov[a - x0] + cov[b - x0]) / 2 + 0.1, 0, 0.9), source: 'detected' });
          used.add(i); used.add(i + 1); continue;
        }
      }
      if (d >= 0.013 * fw && d <= 0.07 * fw && opposite) {
        out.push({ id: uid('v'), kind: 'pilaster', x0: a, x1: b, y0: ya, y1: yb, lines: [], confidence: clamp((cov[a - x0] + cov[b - x0]) / 2, 0, 0.85), source: 'detected' });
        used.add(i); used.add(i + 1); continue;
      }
    }
    if (cov[a - x0] > 0.7) {
      const [y0, y1] = extent(a, a);
      if (y1 - y0 > 0.5 * fh) out.push({ id: uid('v'), kind: 'edge', x0: a, x1: a, y0, y1, lines: [], confidence: clamp(cov[a - x0], 0, 0.8), source: 'detected' });
    }
  }
  void H;
  return out;
}

// ------------------------------------------------------------------ balconies

export function detectBalconies(ctx: Ctx, rows: Opening[][], bandLines: number[]): Balcony[] {
  const { W, H, Eh, Ev, L, facade: f, fh, edgeT } = ctx;
  const wins = rows.flat().filter((o) => o.kind === 'window');
  if (!wins.length) return [];
  const gW = median(wins.map((o) => o.rect.w)), gH = median(wins.map((o) => o.rect.h));
  const x0 = Math.max(0, Math.round(f.x0)), x1 = Math.min(W, Math.round(f.x1));
  const y0 = Math.max(0, Math.round(f.top)), y1 = Math.min(H, Math.round(f.ground - 0.1 * fh));
  if (y1 <= y0 || x1 <= x0) return [];
  // 1) balustrades: zones dense in short vertical edges (balusters / bars)
  const ind = new Float32Array(W * H);
  const blocked = new Uint8Array(W * H);
  for (const o of rows.flat()) {
    for (let y = Math.max(0, Math.round(o.rect.y - 2)); y < Math.min(H, o.rect.y + o.rect.h + 2); y++) blocked.fill(1, y * W + Math.max(0, Math.round(o.rect.x - 2)), y * W + Math.min(W, Math.round(o.rect.x + o.rect.w + 2)));
  }
  let tot = 0, cnt = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = !blocked[y * W + x] && Ev[y * W + x] > edgeT * 0.6 ? 1 : 0; ind[y * W + x] = v; tot += v; cnt++; }
  const rho0 = tot / Math.max(1, cnt);
  const I = integral(ind, W, H);
  const rx = Math.max(3, Math.round(0.25 * gW)), ry = Math.max(2, Math.round(0.07 * gH));
  const m = mask(W, H);
  const thr = Math.max(0.16, 3 * rho0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const d = rectSum(I, W, H, x - rx, y - ry, x + rx + 1, y + ry + 1) / ((2 * rx + 1) * (2 * ry + 1));
    if (d > thr) m.data[y * W + x] = 1;
  }
  const out: Balcony[] = [];
  const rowAt = (y: number) => {
    let best = 0, bd = Infinity;
    rows.forEach((r, i) => { const b = median(r.map((o) => o.rect.y + o.rect.h)); if (Math.abs(b - y) < bd) { bd = Math.abs(b - y); best = i; } });
    return best;
  };
  const meanEhRow = (y: number, a: number, b: number) => { let s = 0; for (let x = Math.round(a); x < b; x++) s += Eh[y * W + x]; return s / Math.max(1, b - a); };
  const bestRow = (ya: number, yb: number, a: number, b: number) => {
    let by = -1, bv = 0;
    for (let y = Math.max(1, Math.round(ya)); y <= Math.min(H - 2, Math.round(yb)); y++) { const v = meanEhRow(y, a, b); if (v > bv) { bv = v; by = y; } }
    return bv > 0.35 * edgeT ? by : -1;
  };
  for (const c of components(m).comps) {
    const w = c.x1 - c.x0, h = c.y1 - c.y0;
    if (w < 1.4 * gW || h < 0.1 * gH || h > 1.0 * gH) continue;
    // balusters: many vertical-edge peaks across the zone
    // lower half of the zone: windows behind the railing do not reach down there
    const prof = colProfile(ind, W, H, c.x0, c.x1 + 1, c.y0 + h * 0.5, c.y1 - h * 0.1);
    const pk = peaks(prof, 0.35);
    if (pk.length < 6) continue;
    const bx0 = c.x0 + pk[0] - 2, bx1 = c.x0 + pk[pk.length - 1] + 2;
    const railTop = Math.max(bestRow(c.y0 - 2 * ry, c.y0 + ry, bx0, bx1), c.y0 - 2 * ry);
    // the slab top is where the balusters end (nearest edge to the zone bottom, not the strongest shadow edge)
    let slabTop = c.y1;
    for (let d = 0; d <= ry; d++) {
      if (meanEhRow(Math.min(H - 2, c.y1 - d), bx0, bx1) > 0.5 * edgeT) { slabTop = c.y1 - d; break; }
      if (meanEhRow(Math.min(H - 2, c.y1 + d), bx0, bx1) > 0.5 * edgeT) { slabTop = c.y1 + d; break; }
    }
    let slabBottom = bestRow(slabTop + 2, slabTop + 0.25 * gH, bx0, bx1);
    if (slabBottom < 0) slabBottom = slabTop + Math.max(2, 0.06 * gH);
    if (slabTop - railTop < 0.15 * gH) continue;
    // posts: bright (or dark) runs along the rail region
    const ra = railTop + (slabTop - railTop) * 0.25, rb = slabTop - (slabTop - railTop) * 0.15;
    const lp = colProfile(L.data, W, H, bx0, bx1, ra, rb);
    const med = median(lp);
    const runs: [number, number][] = [];
    let s0 = -1;
    for (let i = 0; i <= lp.length; i++) {
      if (i < lp.length && lp[i] > med) { if (s0 < 0) s0 = i; }
      else if (s0 >= 0) { runs.push([s0, i - 1]); s0 = -1; }
    }
    const posts = runs.filter(([a, b]) => b - a < 2 * rx).map(([a, b]) => bx0 + (a + b) / 2);
    const widths = runs.map(([a, b]) => b - a + 1);
    out.push({
      id: uid('k'), x0: bx0, x1: bx1, railTop, slabTop, slabBottom, railing: median(widths) >= 3 ? 'balusters' : 'bars', posts,
      floor: rowAt(railTop), confidence: clamp(0.45 + 0.02 * pk.length, 0.45, 0.85), source: 'detected',
    });
  }
  // 2) solid parapets / plain slabs: long horizontal edges with a cast shadow below, near window sills
  const rho = (a: number, b: number, ya: number, yb: number) => {
    let s = 0, n = 0;
    for (let y = Math.round(ya); y < yb; y += 2) for (let x = Math.round(a); x < b; x += 2) { s += L.data[y * W + x]; n++; }
    return n ? s / n : 0;
  };
  rows.forEach((row, ri) => {
    const rw = row.filter((o) => o.kind === 'window');
    if (!rw.length) return;
    const wb = median(rw.map((o) => o.rect.y + o.rect.h)), wh = median(rw.map((o) => o.rect.h));
    if (wb > f.ground - 0.12 * fh) return;
    const runs: { a: number; b: number; y: number }[] = [];
    const maxGap = Math.max(3, Math.round(0.15 * gW));
    for (let y = Math.round(wb - 0.2 * wh); y <= Math.round(wb + 0.6 * wh); y++) {
      if (y < 1 || y >= H - 1 || bandLines.some((bl) => Math.abs(bl - y) <= 2)) continue;
      let start = -1, gap = 0;
      for (let x = x0; x <= x1; x++) {
        const on = x < x1 && Math.max(Eh[(y - 1) * W + x], Eh[y * W + x], Eh[(y + 1) * W + x]) > edgeT * 0.6;
        if (on) { if (start < 0) start = x; gap = 0; }
        else if (start >= 0 && ++gap > maxGap) {
          const end = x - gap;
          if (end - start >= 1.8 * gW && end - start < 0.8 * (x1 - x0)) runs.push({ a: start, b: end, y });
          start = -1; gap = 0;
        }
      }
    }
    const groups = cluster1D(runs, (r) => r.a, 0.3 * gW).filter((g) => g.length >= 2);
    for (const g of groups) {
      const a = median(g.map((r) => r.a)), b = median(g.map((r) => r.b));
      if (out.some((k) => Math.min(k.x1, b) - Math.max(k.x0, a) > 0.3 * (b - a) && Math.abs(k.slabTop - wb) < wh)) continue;
      const ys = [...new Set(g.map((r) => r.y))].sort((p, q) => p - q);
      const slabTop = ys[0], slabBottom = Math.max(ys[ys.length - 1], slabTop + 2);
      // a projecting slab casts a shadow
      const below = rho(a, b, slabBottom + 2, slabBottom + 2 + 0.08 * wh), above = rho(a, b, slabTop - 2 - 0.08 * wh, slabTop - 2);
      if (!(below < 0.85 * above)) continue;
      out.push({ id: uid('k'), x0: a, x1: b, railTop: slabTop - Math.max(2, 0.02 * wh), slabTop, slabBottom, railing: 'none', posts: [], floor: ri, confidence: 0.4, source: 'detected' });
    }
  });
  return out;
}

/** Windows whose lower part is hidden by a balcony railing take the height of their storey peers. */
export function extendBehindRailings(ctx: Ctx, openings: Opening[], balconies: Balcony[]) {
  for (const k of balconies) {
    for (const o of openings) {
      if (o.kind !== 'window') continue;
      const ov = Math.min(k.x1, o.rect.x + o.rect.w) - Math.max(k.x0, o.rect.x);
      const bottom = o.rect.y + o.rect.h;
      if (ov < 0.6 * o.rect.w || Math.abs(bottom - k.railTop) > 0.15 * o.rect.h) continue;
      const peers = openings.filter((p) => p !== o && p.kind === 'window' && Math.abs(p.rect.y - o.rect.y) < 0.03 * ctx.fh && Math.abs(p.rect.w - o.rect.w) < 0.15 * o.rect.w);
      const ph = median(peers.map((p) => p.rect.h));
      const target = peers.length ? Math.min(ph, k.slabTop - o.rect.y) : k.slabTop - o.rect.y;
      if (target > o.rect.h * 1.08) {
        o.rect = { ...o.rect, h: target };
        o.sill = undefined;
        o.flags.push('lower part hidden by the balcony railing – extended to its storey height');
        o.confidence *= 0.85;
      }
    }
  }
}

// ------------------------------------------------------------------ floors

export function deriveFloors(ctx: Ctx, rows: Opening[][], bands: Band[], balconies: Balcony[], eaveY: number): Floor[] {
  const { facade: f } = ctx;
  const winRows = rows
    .map((r) => r.filter((o) => o.kind === 'window'))
    .filter((r) => r.length)
    .map((r) => ({ top: median(r.map((o) => o.rect.y)), bottom: median(r.map((o) => o.rect.y + o.rect.h)) }))
    .sort((a, b) => b.top - a.top); // bottom-most first
  // merge rows that overlap (mezzanine noise)
  const levels: number[] = [f.ground];
  for (let i = 0; i + 1 < winRows.length; i++) {
    const lower = winRows[i], upper = winRows[i + 1];
    if (upper.bottom >= lower.top) continue;
    const gapTop = upper.bottom, gapBot = lower.top;
    let y = gapTop + 0.56 * (gapBot - gapTop);
    let estimated = true;
    const sc = bands.find((b) => b.kind === 'string_course' && b.y0 >= gapTop - 2 && b.y1 <= gapBot + 2);
    if (sc) { y = sc.y0; estimated = false; }
    const bal = balconies.find((b) => b.slabTop >= gapTop - 0.3 * (gapBot - gapTop) && b.slabTop <= gapBot);
    if (bal) { y = bal.slabTop; estimated = false; }
    levels.push(y);
    void estimated;
  }
  const out: Floor[] = [];
  for (let i = 0; i < levels.length; i++) {
    out.push({ index: i, y: levels[i], bottom: levels[i], top: i + 1 < levels.length ? levels[i + 1] : eaveY, estimated: i > 0 });
  }
  return out;
}
