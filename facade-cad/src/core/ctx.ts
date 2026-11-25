// Shared analysis context: the rectified image plus derived rasters every detector needs.
import { Rect } from './geom';
import { Gradients, GrayImage, RGBAImage, gaussianBlur, integral, sobel, toGray } from './image';

export interface AnalyzeOptions {
  /** 0 (conservative) .. 1 (finds more, risks false positives) */
  sensitivity: number;
  /** add pattern-inferred openings hidden behind detected occluders (flagged as inferred) */
  inferOccluded: boolean;
  /** snap to a mirror axis when the facade is clearly symmetric */
  symmetry: boolean;
  /** run ornament / material detection (level 3 data) */
  details: boolean;
}
export const defaultOptions: AnalyzeOptions = { sensitivity: 0.5, inferOccluded: true, symmetry: true, details: true };

export interface Ctx {
  img: RGBAImage;
  W: number;
  H: number;
  L: GrayImage; // luminance, lightly smoothed
  g: Gradients;
  /** axis-aligned edge strength: horizontal edges (|gy| dominant) and vertical edges (|gx| dominant) */
  Eh: Float32Array;
  Ev: Float32Array;
  /** 1 = usable pixel (inside source image, not sky, not occluded) */
  usable: Uint8Array;
  sky: Uint8Array;
  occ: Uint8Array;
  /** integral image of luminance */
  IL: Float64Array;
  /** robust edge threshold for "this is a real edge" */
  edgeT: number;
  facade: { x0: number; x1: number; top: number; ground: number };
  fw: number;
  fh: number;
  opt: AnalyzeOptions;
  occlusions: Rect[];
  notes: string[];
}

export function buildBaseRasters(img: RGBAImage) {
  const L = gaussianBlur(toGray(img), 1.0);
  const g = sobel(L);
  const n = img.w * img.h;
  const Eh = new Float32Array(n), Ev = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ax = Math.abs(g.gx[i]), ay = Math.abs(g.gy[i]);
    if (ay > 1.5 * ax) Eh[i] = ay;
    if (ax > 1.5 * ay) Ev[i] = ax;
  }
  return { L, g, Eh, Ev, IL: integral(L.data, img.w, img.h) };
}
