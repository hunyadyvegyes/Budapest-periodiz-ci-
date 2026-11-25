// End-to-end processing used by the Web Worker and by the tests:
// source photo (+ optional user quad) -> rectified image -> FacadeModel.
import { AnalyzeOptions } from './ctx';
import { Quad, Rect, apply, cluster1D, median, rcx } from './geom';
import { RGBAImage, downscaleRGBA, sobel, toGray } from './image';
import { FacadeModel } from './model';
import { analyze } from './analyze';
import { Rectification, autoDetectQuad, computeRectification, warpPerspective } from './rectify';

export interface ProcessInput {
  source: RGBAImage;
  /** facade corners in source pixels (TL, TR, BR, BL); null = detect automatically */
  quad: Quad | null;
  /** the quad is an automatic proposal (not placed by the user): refine the facade extent */
  quadIsAuto?: boolean;
  /** explicit width/height ratio, e.g. from known dimensions */
  aspect?: number;
  /** ignore regions as quads in source pixels */
  ignore?: Quad[];
  occluders?: Quad[];
  maxSide?: number;
  options?: Partial<AnalyzeOptions>;
  provider?: string;
  onProgress?: (stage: string, p: number) => void;
}

export interface ProcessResult {
  rectified: RGBAImage;
  rect: Rectification;
  quad: Quad;
  quadSource: 'manual' | 'auto';
  /** automatic mode isolated the facade (the returned quad is its wall rectangle) */
  located: boolean;
  autoConfidence: number | null;
  model: FacadeModel;
  timings: Record<string, number>;
}

/** Quad (source px) -> axis-aligned bounding rect in rectified px. */
export function quadToRectified(q: Quad, H: number[]): Rect {
  const p = q.map((pt) => apply(H, pt));
  const xs = p.map((a) => a.x), ys = p.map((a) => a.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export function autoQuad(source: RGBAImage): { quad: Quad; confidence: number; notes: string[] } {
  const s = Math.min(1, 1000 / Math.max(source.w, source.h));
  const small = downscaleRGBA(source, s);
  const res = autoDetectQuad(toGray(small));
  return { quad: res.quad.map((p) => ({ x: p.x / s, y: p.y / s })) as Quad, confidence: res.confidence, notes: res.notes };
}

/**
 * From a whole-image analysis, find the main building's wall rectangle (rectified px):
 * window columns sharing the storey rows of the column nearest the image centre, widened to
 * the nearest long vertical building edges, from the ground line up to the eave.
 */
export function proposeFacadeRect(m: FacadeModel, img: RGBAImage): Rect | null {
  // pattern-inferred openings count (they follow the grid); anything at roof level does not
  const all = m.openings.filter((o) => o.kind === 'window' && o.source !== 'ai');
  if (all.length < 4) return null;
  // ignore small fragments (split panes, reflections) when looking for the storey/column structure
  const wh = median(all.map((o) => o.rect.h));
  const wins = all.filter((o) => o.rect.h >= 0.6 * wh && o.rect.y > m.roof.eaveY + 0.3 * wh);
  if (wins.length < 4) return null;
  const ww = median(wins.map((o) => o.rect.w));
  const cols = cluster1D(wins, (o) => rcx(o.rect), 0.5 * ww).filter((c) => c.length >= 2);
  if (!cols.length) return null;
  const cx = img.w / 2;
  const seed = cols.reduce((a, b) => (Math.abs(median(b.map((o) => rcx(o.rect))) - cx) < Math.abs(median(a.map((o) => rcx(o.rect))) - cx) ? b : a));
  const rows = seed.map((o) => o.rect.y);
  const tol = Math.max(4, 0.35 * wh);
  const matchFrac = (c: typeof wins) => c.filter((o) => rows.some((y) => Math.abs(o.rect.y - y) < tol)).length / c.length;
  const sorted = [...cols].sort((a, b) => median(a.map((o) => rcx(o.rect))) - median(b.map((o) => rcx(o.rect))));
  const cxOf = (c: typeof wins) => median(c.map((o) => rcx(o.rect)));
  const inMain = sorted.map((c) => matchFrac(c) >= 0.5);
  // grow outward from the main block while column spacing stays regular and rows still partly agree
  const idx = sorted.map((_, i) => i).filter((i) => inMain[i]);
  if (idx.length >= 2) {
    const sp = median(idx.slice(1).map((v, k) => cxOf(sorted[v]) - cxOf(sorted[idx[k]])));
    for (const dir of [-1, 1]) {
      let edge = dir < 0 ? Math.min(...idx) : Math.max(...idx);
      for (let j = edge + dir; j >= 0 && j < sorted.length; j += dir) {
        const gap = Math.abs(cxOf(sorted[j]) - cxOf(sorted[edge]));
        if (gap > 1.35 * sp) break;
        if (matchFrac(sorted[j]) >= 0.34) { inMain[j] = true; edge = j; }
      }
    }
  }
  const main = sorted.filter((_, i) => inMain[i]);
  const members = main.flat();
  let x0 = Math.min(...members.map((o) => o.rect.x)), x1 = Math.max(...members.map((o) => o.rect.x + o.rect.w));
  const spacing = main.length > 1 ? (x1 - x0 - ww) / (main.length - 1) : 2 * ww;
  // snap to long vertical edges just outside the outermost windows
  const g = sobel(toGray(img));
  const top = Math.max(0, Math.round(Math.min(m.roof.eaveY, ...members.map((o) => o.rect.y)))), bot = Math.round(m.facade.ground);
  const coverage = (x: number) => {
    let hit = 0, n = 0;
    for (let y = top; y < bot; y += 2) {
      n++;
      for (let d = -1; d <= 1; d++) { const i = y * img.w + x + d; if (Math.abs(g.gx[i]) > 6 && Math.abs(g.gx[i]) > 1.5 * Math.abs(g.gy[i])) { hit++; break; } }
    }
    return n ? hit / n : 0;
  };
  const search = (from: number, to: number) => {
    let best = -1, bv = 0.45;
    const step = from < to ? 1 : -1;
    for (let x = Math.round(from); step > 0 ? x <= to : x >= to; x += step) {
      if (x < 2 || x >= img.w - 2) break;
      const c = coverage(x);
      if (c > bv) { bv = c; best = x; }
    }
    return best;
  };
  const reach = Math.max(ww, 0.75 * spacing);
  const l = search(x0 - 2, x0 - reach), r = search(x1 + 2, x1 + reach);
  x0 = l > 0 ? l : Math.max(0, x0 - 0.5 * (spacing - ww));
  x1 = r > 0 ? r : Math.min(img.w, x1 + 0.5 * (spacing - ww));
  // the eave lies above the top window row, but not more than about one storey above it
  const topRow = Math.min(...members.map((o) => o.rect.y));
  const rowYs = [...new Set(members.map((o) => Math.round(o.rect.y / (0.5 * wh))))].map((k) => k * 0.5 * wh).sort((a, b) => a - b);
  const storey = rowYs.length > 1 ? median(rowYs.slice(1).map((y, k) => y - rowYs[k])) : 2 * wh;
  const bands = m.bands.filter((b) => b.y1 < topRow - 0.1 * wh && b.y0 > topRow - 1.3 * storey);
  const eave = bands.length ? Math.min(...bands.map((b) => b.y0))
    : m.roof.eaveY < topRow - 0.15 * wh && m.roof.eaveY > topRow - 1.3 * storey ? m.roof.eaveY : topRow - 0.6 * storey;
  const rect = { x: x0, y: Math.max(0, eave), w: x1 - x0, h: bot - Math.max(0, eave) };
  return rect.w > 4 * ww && rect.h > 2 * wh ? rect : null;
}

export function processFacade(inp: ProcessInput): ProcessResult {
  const timings: Record<string, number> = {};
  const prog = inp.onProgress ?? (() => {});
  let t = Date.now();
  let quad = inp.quad, quadSource: 'manual' | 'auto' = inp.quadIsAuto ? 'auto' : 'manual', autoConfidence: number | null = null;
  const notes: string[] = [];
  let located = false;
  if (!quad) {
    prog('Detecting perspective', 0.02);
    const a = autoQuad(inp.source);
    quad = a.quad; quadSource = 'auto'; autoConfidence = a.confidence; notes.push(...a.notes);
  }
  if (quadSource === 'auto') {
    // pass 1: fast whole-image analysis to locate the main facade, then continue as if its corners were placed
    prog('Locating the facade', 0.03);
    const r1 = computeRectification(quad, inp.source.w, inp.source.h, { aspect: inp.aspect, margin: { top: 0, bottom: 0, left: 0, right: 0 }, maxSide: 1200 });
    const img1 = warpPerspective(inp.source, r1.Hinv, r1.outW, r1.outH);
    const m1 = analyze({ image: img1, facadeRect: r1.facade, auto: true, options: { ...inp.options, details: false, inferOccluded: false } });
    const fr = proposeFacadeRect(m1, img1);
    if (fr) {
      quad = [{ x: fr.x, y: fr.y }, { x: fr.x + fr.w, y: fr.y }, { x: fr.x + fr.w, y: fr.y + fr.h }, { x: fr.x, y: fr.y + fr.h }].map((p) => apply(r1.Hinv, p)) as Quad;
      notes.push('Facade extent found automatically – check the corners in the Photo view.');
    } else notes.push('Could not isolate the facade automatically – place the four corners in the Photo view.');
    autoConfidence = (autoConfidence ?? 0.6) * (fr ? 1 : 0.7);
    located = !!fr;
  }
  timings.perspective = Date.now() - t; t = Date.now();
  prog('Correcting perspective', 0.04);
  const wholeImage = quadSource === 'auto' && !located;
  const margin = wholeImage ? { top: 0, bottom: 0, left: 0, right: 0 } : { top: 0.3, bottom: 0.04, left: 0.03, right: 0.03 };
  const rect = computeRectification(quad, inp.source.w, inp.source.h, { aspect: inp.aspect, margin, maxSide: inp.maxSide ?? 1800 });
  const rectified = warpPerspective(inp.source, rect.Hinv, rect.outW, rect.outH);
  timings.rectify = Date.now() - t; t = Date.now();
  const toRect = (qs?: Quad[]) => (qs ?? []).map((q) => quadToRectified(q, rect.H));
  const conf = quadSource === 'auto' ? Math.min(rect.confidence, autoConfidence ?? 0.5) : rect.confidence;
  const model = analyze({
    image: rectified, facadeRect: rect.facade, auto: wholeImage, ignore: toRect(inp.ignore), occluders: toRect(inp.occluders),
    options: inp.options, rectificationConfidence: conf, provider: inp.provider,
    onProgress: (s, p) => prog(s, 0.05 + 0.95 * p),
  });
  model.meta.notes.unshift(...notes, ...rect.notes);
  timings.analyze = Date.now() - t;
  return { rectified, rect, quad, quadSource, located, autoConfidence, model, timings };
}
