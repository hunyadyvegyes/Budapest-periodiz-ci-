// Recognition provider abstraction.
//
// The local computer-vision pipeline always runs (offline, deterministic). An optional
// "refiner" provider can then review its candidates on the rectified image: confirm or reject
// openings, re-classify them, report foreground occluders (cars, trees, people, signs) and point
// out openings the local pass missed. Providers are swappable; Claude is the first implementation.
import { Rect } from '../core/geom';
import { OpeningKind } from '../core/model';

/** Boxes are exchanged in a resolution-independent 0..1000 coordinate frame of the rectified image. */
export interface NormBox { x0: number; y0: number; x1: number; y1: number }

export interface RefineRequest {
  /** rectified image, JPEG base64 (no data: prefix) */
  imageBase64: string;
  width: number;
  height: number;
  facade: NormBox;
  candidates: { id: string; kind: OpeningKind; box: NormBox; confidence: number }[];
}

export type Verdict = OpeningKind | 'not_an_opening' | 'uncertain';
export interface RefineResult {
  verdicts: { id: string; verdict: Verdict; confidence: number }[];
  occluders: { kind: string; box: NormBox }[];
  missed: { kind: OpeningKind; box: NormBox }[];
  notes: string;
  model: string;
}

export interface RefinerProvider {
  id: string;
  label: string;
  refine(req: RefineRequest, signal?: AbortSignal): Promise<RefineResult>;
}

export const toNorm = (r: Rect, w: number, h: number): NormBox => ({
  x0: Math.round((r.x / w) * 1000), y0: Math.round((r.y / h) * 1000), x1: Math.round(((r.x + r.w) / w) * 1000), y1: Math.round(((r.y + r.h) / h) * 1000),
});
export const fromNorm = (b: NormBox, w: number, h: number): Rect => ({
  x: (b.x0 / 1000) * w, y: (b.y0 / 1000) * h, w: ((b.x1 - b.x0) / 1000) * w, h: ((b.y1 - b.y0) / 1000) * h,
});
