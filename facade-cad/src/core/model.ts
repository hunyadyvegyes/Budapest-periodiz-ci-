// The semantic facade model: what the analysis recognised, in rectified-image pixel coordinates
// (x to the right, y downward). Drawings for every detail level are generated from this model,
// and user edits are applied to it, so switching levels never loses work.
import { Pt, Rect } from './geom';

export type Source = 'detected' | 'inferred' | 'ai' | 'user';

export type OpeningKind = 'window' | 'door' | 'portal' | 'shopfront';

export interface Arch { type: 'round' | 'segmental'; /** vertical rise of the arch in px */ rise: number }

export interface Opening {
  id: string;
  kind: OpeningKind;
  /** outer edge of the wall opening (reveal) */
  rect: Rect;
  /** frame width in px (distance from opening edge to glazing/leaf) */
  frame: number;
  /** relative x positions (0..1 within the inner frame) of mullions */
  mullions: number[];
  /** relative y positions (0..1 within the inner frame) of transoms */
  transoms: number[];
  /** strength 0..1 of each mullion / transom – the strong ones are "major" (shown from level 2) */
  mullionStrength: number[];
  transomStrength: number[];
  arch?: Arch;
  /** window sill / ledge below the opening */
  sill?: Rect;
  /** hood moulding / cornice / pediment zone above the opening */
  hood?: Rect;
  /** handle positions (absolute px), only when visibly identifiable */
  handles: Pt[];
  floor: number;
  templateId?: string;
  confidence: number;
  source: Source;
  /** short reasons that lowered/raised confidence – shown in the inspector and QC */
  flags: string[];
}

export type BandKind = 'cornice' | 'string_course' | 'plinth' | 'parapet' | 'eave';
export interface Band {
  id: string;
  kind: BandKind;
  x0: number; x1: number;
  y0: number; y1: number;
  /** y positions of individual profile lines (mouldings) inside the band */
  lines: number[];
  /** does it cast a shadow below (i.e. projects from the wall)? */
  projecting: boolean;
  confidence: number;
  source: Source;
}

export type VerticalKind = 'pilaster' | 'column' | 'downpipe' | 'edge';
export interface Vertical {
  id: string;
  kind: VerticalKind;
  x0: number; x1: number;
  y0: number; y1: number;
  /** x positions of internal profile lines (e.g. fluting, pilaster edges) */
  lines: number[];
  confidence: number;
  source: Source;
}

export interface Balcony {
  id: string;
  /** overall extent: slab + railing */
  x0: number; x1: number;
  /** top of the railing (hand rail) */
  railTop: number;
  /** top / bottom of the slab */
  slabTop: number;
  slabBottom: number;
  railing: 'balusters' | 'bars' | 'solid' | 'none';
  /** x positions of balusters / bars as detected (px) */
  posts: number[];
  floor: number;
  confidence: number;
  source: Source;
}

export interface Ornament {
  id: string;
  bbox: Rect;
  /** simplified vector contours */
  paths: Pt[][];
  /** element this ornament belongs to (opening id, band id) if any */
  hostId?: string;
  confidence: number;
  source: Source;
}

export interface MaterialZone {
  id: string;
  rect: Rect;
  pattern: 'brick' | 'ashlar' | 'rustication' | 'tiles' | 'plain';
  /** joint/course y positions (absolute px) – real detected joints */
  courses: number[];
  /** for brick: vertical joint spacing (px) and phase */
  jointSpacing?: number;
  confidence: number;
}

export interface Roof {
  /** roofline polyline from left to right (absolute px) */
  line: Pt[];
  /** top of the wall / eave level (px) */
  eaveY: number;
  /** roof is visibly pitched above the eave */
  pitched: boolean;
  confidence: number;
}

export interface Floor { index: number; /** floor level line y (px) – estimated */ y: number; top: number; bottom: number; estimated: boolean }

export interface UserLine { id: string; layer: string; pts: Pt[]; closed: boolean }

export interface FacadeModel {
  version: 1;
  width: number;
  height: number;
  /** facade wall extent in rectified pixels */
  facade: { x0: number; x1: number; top: number; ground: number };
  outline: Pt[];
  roof: Roof;
  floors: Floor[];
  openings: Opening[];
  bands: Band[];
  verticals: Vertical[];
  balconies: Balcony[];
  ornaments: Ornament[];
  materials: MaterialZone[];
  /** occluded regions (vegetation, vehicles, user-masked areas) */
  occlusions: Rect[];
  symmetryAxis: number | null;
  userLines: UserLine[];
  /** ids of generated drawing entities the user deleted */
  suppressed: string[];
  meta: {
    analysisMs: number;
    provider: string;
    geometryConfidence: number;
    rectificationConfidence: number;
    residualTiltDeg: number;
    notes: string[];
  };
}

let counter = 0;
export const uid = (p: string) => `${p}${(++counter).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export const openingInner = (o: Opening): Rect => ({
  x: o.rect.x + o.frame, y: o.rect.y + o.frame, w: Math.max(1, o.rect.w - 2 * o.frame), h: Math.max(1, o.rect.h - 2 * o.frame),
});
