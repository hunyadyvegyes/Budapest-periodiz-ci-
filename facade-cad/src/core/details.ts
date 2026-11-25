// Level-3 data: ornament contours (only where the photo shows clear relief) and material courses.
import { Ctx } from './ctx';
import { Pt, Rect, clamp, coverage, median, simplify } from './geom';
import { GrayImage, gaussianBlur } from './image';
import { Band, MaterialZone, Opening, Ornament, Roof, uid } from './model';

/** Marching squares over a binary grid -> chained polylines (closed where possible). */
export function traceContours(bin: Uint8Array, w: number, h: number): Pt[][] {
  const segs: [Pt, Pt][] = [];
  const v = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : bin[y * w + x]);
  for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
    const c = (v(x, y) << 3) | (v(x + 1, y) << 2) | (v(x + 1, y + 1) << 1) | v(x, y + 1);
    if (c === 0 || c === 15) continue;
    const T = { x: x + 1, y: y + 0.5 }, R = { x: x + 1.5, y: y + 1 }, B = { x: x + 1, y: y + 1.5 }, Lf = { x: x + 0.5, y: y + 1 };
    const add = (a: Pt, b: Pt) => segs.push([a, b]);
    switch (c) {
      case 1: case 14: add(Lf, B); break;
      case 2: case 13: add(B, R); break;
      case 3: case 12: add(Lf, R); break;
      case 4: case 11: add(T, R); break;
      case 5: add(Lf, T); add(B, R); break;
      case 6: case 9: add(T, B); break;
      case 7: case 8: add(Lf, T); break;
      case 10: add(T, R); add(Lf, B); break;
    }
  }
  const key = (p: Pt) => `${p.x},${p.y}`;
  const adj = new Map<string, number[]>();
  segs.forEach(([a, b], i) => { for (const p of [a, b]) { const k = key(p); (adj.get(k) ?? adj.set(k, []).get(k)!).push(i); } });
  const used = new Uint8Array(segs.length);
  const out: Pt[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const path = [segs[i][0], segs[i][1]];
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const end = dir === 0 ? path[path.length - 1] : path[0];
        const next = (adj.get(key(end)) ?? []).find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = 1;
        const [a, b] = segs[next];
        const p = key(a) === key(end) ? b : a;
        if (dir === 0) path.push(p); else path.unshift(p);
      }
    }
    out.push(path);
  }
  return out;
}

/** Band-pass (difference of Gaussians) of the luminance, plus its robust noise level on plain wall. */
export function bandPass(ctx: Ctx, openings: Opening[]): { BP: GrayImage; sigma: number } {
  const a = gaussianBlur(ctx.L, 0.8), b = gaussianBlur(ctx.L, 3);
  const BP: GrayImage = { w: ctx.W, h: ctx.H, data: new Float32Array(ctx.W * ctx.H) };
  for (let i = 0; i < BP.data.length; i++) BP.data[i] = a.data[i] - b.data[i];
  const vals: number[] = [];
  const f = ctx.facade;
  for (let y = Math.round(f.top + 0.05 * ctx.fh); y < f.ground - 0.05 * ctx.fh; y += 4) for (let x = Math.round(f.x0); x < f.x1; x += 4) {
    if (!ctx.usable[y * ctx.W + x]) continue;
    if (openings.some((o) => x >= o.rect.x - 4 && x <= o.rect.x + o.rect.w + 4 && y >= o.rect.y - 4 && y <= o.rect.y + o.rect.h + 4)) continue;
    vals.push(Math.abs(BP.data[y * ctx.W + x]));
  }
  return { BP, sigma: Math.max(0.8, median(vals) * 1.4826) };
}

function zoneContours(ctx: Ctx, BP: GrayImage, sigma: number, z: Rect, exclude: Rect[]): { paths: Pt[][]; density: number } {
  const x0 = Math.max(0, Math.round(z.x)), y0 = Math.max(0, Math.round(z.y));
  const w = Math.min(ctx.W, Math.round(z.x + z.w)) - x0, h = Math.min(ctx.H, Math.round(z.y + z.h)) - y0;
  if (w < 6 || h < 6) return { paths: [], density: 0 };
  const thr = Math.max(4, 3.2 * sigma);
  const bin = new Uint8Array(w * h);
  let on = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = x + x0, gy = y + y0;
    if (!ctx.usable[gy * ctx.W + gx]) continue;
    if (exclude.some((r) => gx >= r.x && gx < r.x + r.w && gy >= r.y && gy < r.y + r.h)) continue;
    if (BP.data[gy * ctx.W + gx] > thr) { bin[y * w + x] = 1; on++; }
  }
  const density = on / (w * h);
  if (density < 0.025 || on < 25) return { paths: [], density };
  const raw = traceContours(bin, w, h);
  const paths = raw
    .filter((p) => p.length >= 8)
    .map((p) => simplify(p, 0.9).map((q) => ({ x: q.x + x0 - 0.5, y: q.y + y0 - 0.5 })))
    .filter((p) => {
      // straight edges (sill lines, shadow lines, joints) are not ornament: require 2-D extent
      const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
      const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
      return bw + bh > 8 && Math.min(bw, bh) >= 4 && Math.max(bw, bh) / Math.max(1, Math.min(bw, bh)) < 6;
    })
    .sort((a, b) => b.length - a.length)
    .slice(0, 40);
  return { paths, density };
}

export function detectOrnaments(ctx: Ctx, openings: Opening[], bands: Band[]): Ornament[] {
  const { BP, sigma } = bandPass(ctx, openings);
  const out: Ornament[] = [];
  const openRects = openings.flatMap((o) => [o.rect, o.sill].filter(Boolean).map((r) => ({ x: r!.x - 3, y: r!.y - 3, w: r!.w + 6, h: r!.h + 6 })));
  const bandRects = bands.map((b) => ({ x: b.x0, y: b.y0 - 2, w: b.x1 - b.x0, h: b.y1 - b.y0 + 4 }));
  const byTemplate = new Map<string, { o: Opening; zone: Rect; res: ReturnType<typeof zoneContours> }[]>();
  for (const o of openings) {
    const r = o.rect;
    // zone above the opening (hood, pediment, keystone, relief panel)
    let top = r.y - 0.5 * r.h;
    for (const b of bands) if (b.y1 < r.y && b.y1 > top) top = b.y1 + Math.max(4, 0.025 * ctx.fh); // skip the band's own shadow
    for (const p of openings) if (p !== o && p.rect.y + p.rect.h < r.y && p.rect.y + p.rect.h > top && Math.abs(p.rect.x + p.rect.w / 2 - (r.x + r.w / 2)) < r.w) top = p.rect.y + p.rect.h + (p.sill?.h ?? 0) + 2;
    const zone = { x: r.x - 0.3 * r.w, y: top, w: r.w * 1.6, h: r.y - top - 1 };
    if (zone.h < 6) continue;
    const res = zoneContours(ctx, BP, sigma, zone, [...openRects, ...bandRects.filter((b) => coverage(b, zone) < 0.9)]);
    // a relief needs some substance: at least two shapes or one shape spanning a third of the zone
    const span = res.paths.reduce((a, p) => a + (Math.max(...p.map((q) => q.x)) - Math.min(...p.map((q) => q.x))), 0);
    if (res.paths.length < 2 && span < zone.w / 3) res.paths = [];
    const key = o.templateId ?? o.id;
    (byTemplate.get(key) ?? byTemplate.set(key, []).get(key)!).push({ o, zone, res });
  }
  // template members share the clearest exemplar's geometry (consistency, less noise)
  for (const members of byTemplate.values()) {
    const ex = members.reduce((a, b) => (b.res.paths.length && b.res.density > a.res.density ? b : a));
    if (!ex.res.paths.length) continue;
    for (const m of members) {
      if (m.res.density < 0.5 * ex.res.density) continue;
      const dx = m.o.rect.x - ex.o.rect.x, dy = m.o.rect.y - ex.o.rect.y;
      const paths = ex.res.paths.map((p) => p.map((q) => ({ x: q.x + dx, y: q.y + dy })));
      const xs = paths.flat().map((p) => p.x), ys = paths.flat().map((p) => p.y);
      out.push({
        id: uid('n'), bbox: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
        paths, hostId: m.o.id, confidence: clamp(0.3 + m.res.density * 3, 0.3, 0.7), source: 'detected',
      });
    }
  }
  return out;
}

/** Roof tile courses between the roofline and the eave. */
export function detectRoofCourses(ctx: Ctx, roof: Roof): MaterialZone | null {
  if (!roof.pitched) return null;
  const { W, Eh, edgeT, facade: f } = ctx;
  const yTop = Math.min(...roof.line.map((p) => p.y)), yBot = roof.eaveY - 2;
  const rf = (x: number) => {
    const L = roof.line;
    for (let i = 1; i < L.length; i++) if (x <= L[i].x) { const t = (x - L[i - 1].x) / (L[i].x - L[i - 1].x || 1); return L[i - 1].y + t * (L[i].y - L[i - 1].y); }
    return L[L.length - 1].y;
  };
  const lines: number[] = [];
  let prev = -10;
  for (let y = Math.round(yTop + 3); y < yBot; y++) {
    let hit = 0, n = 0;
    for (let x = Math.round(f.x0); x < f.x1; x++) {
      if (rf(x) > y - 2) continue;
      n++;
      if (Math.max(Eh[(y - 1) * W + x], Eh[y * W + x], Eh[(y + 1) * W + x]) > edgeT * 0.7) hit++;
    }
    if (n > 20 && hit / n > 0.45 && y - prev > 2) { lines.push(y); prev = y; }
  }
  if (lines.length < 3) return null;
  return { id: uid('m'), rect: { x: f.x0, y: yTop, w: f.x1 - f.x0, h: yBot - yTop }, pattern: 'tiles', courses: lines, confidence: 0.5 };
}

/** Brick: estimate the head-joint spacing from vertical edges in the zone (autocorrelation). */
export function refineBrick(ctx: Ctx, z: MaterialZone, openings: Opening[]): MaterialZone {
  if (z.pattern !== 'brick') return z;
  const { W, Ev } = ctx;
  const prof: number[] = [];
  for (let x = Math.round(z.rect.x); x < z.rect.x + z.rect.w; x++) {
    let s = 0;
    for (let y = Math.round(z.rect.y); y < z.rect.y + z.rect.h; y += 1) {
      if (openings.some((o) => x >= o.rect.x - 3 && x <= o.rect.x + o.rect.w + 3 && y >= o.rect.y - 3 && y <= o.rect.y + o.rect.h + 3)) continue;
      s += Ev[y * W + x];
    }
    prof.push(s);
  }
  const m = prof.reduce((a, b) => a + b, 0) / Math.max(1, prof.length);
  const d = prof.map((v) => v - m);
  const course = median(z.courses.slice(1).map((y, i) => y - z.courses[i]));
  let best = { lag: course * 3.3, r: 0 };
  for (let lag = Math.max(3, Math.round(course * 1.5)); lag < course * 6; lag++) {
    let s = 0, s0 = 0;
    for (let i = 0; i + lag < d.length; i++) { s += d[i] * d[i + lag]; s0 += d[i] * d[i]; }
    const r = s / (s0 || 1);
    if (r > best.r) best = { lag, r };
  }
  // the half-bond pattern repeats at 2x the head-joint spacing on alternating courses
  return { ...z, jointSpacing: best.r > 0.1 ? best.lag : course * 3.3, confidence: clamp(0.4 + best.r, 0.4, 0.8) };
}
