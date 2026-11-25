// Facade analysis orchestrator: rectified photo -> semantic FacadeModel.
import { AnalyzeOptions, Ctx, buildBaseRasters, defaultOptions } from './ctx';
import { Pt, Rect, clamp, mean, median, percentile } from './geom';
import { RGBAImage, downscaleGray } from './image';
import { skyMask, vegetationMask, rectsMask } from './masks';
import { FacadeModel, Opening } from './model';
import { computeOpeningMaps, detectOpenings, enrichOpenings } from './openings';
import { residualTilt } from './rectify';
import { regularize } from './regularize';
import { deriveFloors, detectBalconies, detectBands, detectGround, detectRoof, detectVerticals, extendBehindRailings } from './structure';
import { detectOrnaments, detectRoofCourses, refineBrick } from './details';

export interface AnalyzeInput {
  image: RGBAImage;
  /** facade wall rectangle in the rectified image (ground at the bottom edge, eave at the top) */
  facadeRect: Rect;
  /** quad came from automatic perspective detection (ground/eave are then searched for) */
  auto: boolean;
  /** regions to ignore (rectified px) */
  ignore?: Rect[];
  /** occluders reported by an external provider */
  occluders?: Rect[];
  options?: Partial<AnalyzeOptions>;
  rectificationConfidence?: number;
  provider?: string;
  onProgress?: (stage: string, p: number) => void;
}

export function analyze(input: AnalyzeInput): FacadeModel {
  const t0 = Date.now();
  const opt = { ...defaultOptions, ...(input.options ?? {}) };
  const img = input.image;
  const W = img.w, H = img.h;
  const progress = input.onProgress ?? (() => {});
  progress('Edges and gradients', 0.05);
  const base = buildBaseRasters(img);
  const fr = input.facadeRect;
  const facade = { x0: fr.x, x1: fr.x + fr.w, top: fr.y, ground: Math.min(H - 1, fr.y + fr.h) };
  const notes: string[] = [];

  progress('Sky, vegetation and occluders', 0.15);
  const sky = skyMask(img, base.g, facade.x0, facade.x1);
  const veg = vegetationMask(img, { x: facade.x0 - 10, y: 0, w: fr.w + 20, h: H }, base.g);
  const occ = new Uint8Array(W * H);
  for (let i = 0; i < occ.length; i++) occ[i] = veg.mask[i];
  const occlusions: Rect[] = [...veg.boxes, ...(input.ignore ?? []), ...(input.occluders ?? [])];
  rectsMask(W, H, [...(input.ignore ?? []), ...(input.occluders ?? [])], occ);
  if (veg.boxes.length) notes.push(`${veg.boxes.length} vegetation region(s) masked out.`);
  const usable = new Uint8Array(W * H);
  for (let i = 0; i < usable.length; i++) usable[i] = img.data[i * 4 + 3] > 0 && !sky[i] && !occ[i] ? 1 : 0;
  // edge threshold from the facade's own gradient statistics
  const mags: number[] = [];
  for (let y = Math.round(facade.top); y < facade.ground; y += 3) for (let x = Math.round(facade.x0); x < facade.x1; x += 3) if (usable[y * W + x]) mags.push(base.g.mag[y * W + x]);
  const edgeT = Math.max(4, 0.3 * percentile(mags, 97));
  const ctx: Ctx = {
    img, W, H, L: base.L, g: base.g, Eh: base.Eh, Ev: base.Ev, usable, sky, occ, IL: base.IL, edgeT,
    facade, fw: fr.w, fh: facade.ground - facade.top, opt, occlusions, notes,
  };
  for (let i = 0; i < usable.length; i++) if (!usable[i]) { ctx.Eh[i] = 0; ctx.Ev[i] = 0; }

  progress('Roofline', 0.25);
  const { roof, visible } = detectRoof(ctx);
  if (!visible) notes.push('Roofline not visible against the sky – using the top of the facade.');
  if (input.auto) {
    const g = detectGround(ctx);
    if (g !== null) { facade.ground = g; ctx.fh = g - facade.top; }
    else notes.push('Ground line not found – using the bottom of the corrected area. Adjust the corners for accuracy.');
  }
  const roofTop = Math.min(...roof.line.map((p) => p.y));
  const topY = input.auto ? Math.max(roofTop, facade.top) : Math.max(0, facade.top - 0.01 * ctx.fh);

  progress('Openings', 0.35);
  const maps = computeOpeningMaps(ctx, topY);
  const raw = detectOpenings(ctx, maps);
  enrichOpenings(ctx, raw);
  progress('Repetition, alignment and symmetry', 0.5);
  const reg = regularize(ctx, raw, maps);
  let openings = reg.openings;

  progress('Cornices, string courses, plinth', 0.6);
  let eaveY = roof.eaveY;
  const bandRes = detectBands(ctx, openings, roofTop, eaveY, input.auto);
  if (input.auto) {
    const cornice = bandRes.bands.filter((b) => b.kind === 'cornice').sort((a, b) => a.y0 - b.y0)[0];
    eaveY = cornice ? cornice.y0 : Math.max(roofTop, median(roof.line.map((p) => p.y)));
    roof.eaveY = eaveY;
    roof.pitched = median(roof.line.map((p) => p.y)) < eaveY - 0.03 * ctx.fh;
    // openings above the eave in auto mode are roof/sky artefacts
    openings = openings.filter((o) => o.rect.y > eaveY - 2);
  }
  progress('Pilasters, downpipes, balconies', 0.7);
  const verticals = detectVerticals(ctx, openings, eaveY);
  const balconies = detectBalconies(ctx, reg.rows, bandRes.lines);
  extendBehindRailings(ctx, openings, balconies);
  const floors = deriveFloors(ctx, reg.rows, bandRes.bands, balconies, eaveY);
  for (const o of openings) {
    const cy = o.rect.y + o.rect.h / 2;
    const fl = floors.findIndex((f) => cy <= f.bottom && cy >= f.top);
    o.floor = fl < 0 ? 0 : fl;
  }
  for (const b of balconies) {
    const fl = floors.findIndex((f) => b.railTop <= f.bottom && b.railTop >= f.top);
    b.floor = fl < 0 ? b.floor : fl;
  }

  progress('Details and materials', 0.8);
  const ornaments = opt.details ? detectOrnaments(ctx, openings, bandRes.bands) : [];
  const materials = bandRes.textures.map((z) => refineBrick(ctx, z, openings));
  const tiles = opt.details ? detectRoofCourses(ctx, roof) : null;
  if (tiles) materials.push(tiles);

  progress('Outline and confidence', 0.9);
  const outline = buildOutline(roof.line, facade);
  const geometryConfidence = overallConfidence(openings, bandRes.bands.map((b) => b.confidence), roof.confidence, input.rectificationConfidence ?? 0.7);
  let tilt = 0;
  try {
    const small = downscaleGray(base.L, Math.min(1, 900 / Math.max(W, H)));
    tilt = residualTilt(small).meanDeg;
  } catch { /* ignore */ }
  if (tilt > 1) notes.push(`Residual tilt of ${tilt.toFixed(1)}° in long vertical lines – check the perspective corners.`);
  if (openings.length === 0) notes.push('No openings recognised – check the perspective corners, the masks or raise the sensitivity.');

  return {
    version: 1, width: W, height: H, facade, outline, roof, floors, openings, bands: bandRes.bands, verticals, balconies, ornaments, materials,
    occlusions, symmetryAxis: reg.symmetryAxis, userLines: [], suppressed: [],
    meta: {
      analysisMs: Date.now() - t0, provider: input.provider ?? 'local-cv', geometryConfidence,
      rectificationConfidence: input.rectificationConfidence ?? 0.7, residualTiltDeg: tilt, notes,
    },
  };
}

export function buildOutline(roofLine: Pt[], f: { x0: number; x1: number; ground: number }): Pt[] {
  const inside = roofLine.filter((p) => p.x > f.x0 + 0.5 && p.x < f.x1 - 0.5);
  const yAt = (x: number) => {
    let best = roofLine[0];
    for (const p of roofLine) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    return best.y;
  };
  return [{ x: f.x0, y: f.ground }, { x: f.x0, y: yAt(f.x0) }, ...inside, { x: f.x1, y: yAt(f.x1) }, { x: f.x1, y: f.ground }];
}

function overallConfidence(openings: Opening[], bandConf: number[], roofConf: number, rectConf: number): number {
  const oc = openings.length ? mean(openings.map((o) => o.confidence)) : 0.3;
  const bc = bandConf.length ? mean(bandConf) : 0.5;
  return clamp(0.45 * oc + 0.15 * bc + 0.15 * roofConf + 0.25 * rectConf, 0, 1);
}
