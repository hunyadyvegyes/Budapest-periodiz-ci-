// Vector drawing primitives and the CAD layer standard.
// Coordinates are rectified-image pixels (y down); exporters convert to CAD units (y up).
import { Pt } from '../core/geom';

export type DetailLevel = 1 | 2 | 3;
export const LEVEL_NAMES: Record<DetailLevel, string> = { 1: 'Simplified', 2: 'Architectural', 3: 'Detailed' };

interface Base {
  /** stable id: `${elementId}:${part}` – used for selection and user deletions */
  id: string;
  layer: LayerName;
  /** source model element */
  src?: string;
  /** lineweight override in mm (otherwise BYLAYER) */
  lw?: number;
  ltype?: LineType;
}
export interface LineE extends Base { type: 'line'; a: Pt; b: Pt }
export interface PolyE extends Base { type: 'poly'; pts: Pt[]; closed: boolean; /** per-segment bulge (tan(angle/4), CAD y-up convention: > 0 = counter-clockwise) */ bulges?: number[] }
/** Arc in y-UP angle convention (degrees, counter-clockwise from a0 to a1), centre/radius in px. */
export interface ArcE extends Base { type: 'arc'; c: Pt; r: number; a0: number; a1: number }
export interface CircleE extends Base { type: 'circle'; c: Pt; r: number }
export interface TextE extends Base { type: 'text'; p: Pt; h: number; text: string; align?: 'left' | 'center' | 'right' }
export type Entity = LineE | PolyE | ArcE | CircleE | TextE;

export interface Drawing {
  entities: Entity[];
  level: DetailLevel;
  /** model-space extent (px) */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** px -> real units: mm per px; null = unscaled */
  mmPerPx: number | null;
  /** origin for CAD coordinates: x = facade left, y = ground line */
  origin: Pt;
  stats: { duplicatesRemoved: number; merged: number };
}

export type LineType = 'CONTINUOUS' | 'DASHED' | 'CENTER' | 'HIDDEN';

export const LAYER_DEFS = [
  { name: '00_REFERENCE', color: 8, lw: 0.09, plot: false, desc: 'Photo extents and reference frame' },
  { name: '01_BUILDING_OUTLINE', color: 7, lw: 0.5, plot: true, desc: 'Building silhouette' },
  { name: '02_WALLS', color: 7, lw: 0.25, plot: true, desc: 'Wall edges, recesses, material transitions' },
  { name: '03_OPENINGS', color: 4, lw: 0.35, plot: true, desc: 'Wall openings (reveal outline)' },
  { name: '04_WINDOWS', color: 5, lw: 0.18, plot: true, desc: 'Glazing, sashes, window subdivisions' },
  { name: '05_DOORS', color: 6, lw: 0.25, plot: true, desc: 'Door leaves and panels' },
  { name: '06_FRAMES', color: 3, lw: 0.18, plot: true, desc: 'Window and door frames, mullions, transoms' },
  { name: '07_BALCONIES', color: 30, lw: 0.35, plot: true, desc: 'Balcony slabs' },
  { name: '08_RAILINGS', color: 40, lw: 0.13, plot: true, desc: 'Railings, balusters' },
  { name: '09_ROOF', color: 1, lw: 0.35, plot: true, desc: 'Roof edges, eaves, chimneys' },
  { name: '10_CORNICES', color: 2, lw: 0.25, plot: true, desc: 'Cornices, string courses, sills, hoods' },
  { name: '11_DECORATIVE_DETAILS', color: 9, lw: 0.13, plot: true, desc: 'Ornament, mouldings, reliefs' },
  { name: '12_GROUND', color: 7, lw: 0.7, plot: true, desc: 'Ground line' },
  { name: '13_HATCHING', color: 8, lw: 0.05, plot: true, desc: 'Brick, stone and tile coursing' },
  { name: '14_COLUMNS_PILASTERS', color: 3, lw: 0.25, plot: true, desc: 'Columns and pilasters' },
  { name: '15_FLOOR_LEVELS', color: 8, lw: 0.13, plot: true, desc: 'Floor levels (estimated)' },
  { name: '16_DRAINAGE', color: 140, lw: 0.18, plot: true, desc: 'Downpipes and gutters' },
  { name: '17_ANNOTATION', color: 7, lw: 0.18, plot: true, desc: 'Level marks, scale, notes' },
  { name: '18_QC_REVIEW', color: 1, lw: 0.09, plot: false, desc: 'Low-confidence areas for review' },
] as const;
export type LayerName = (typeof LAYER_DEFS)[number]['name'];
export const LAYER_NAMES = LAYER_DEFS.map((l) => l.name) as LayerName[];

/** Standard DXF lineweights in mm. */
export const LINEWEIGHTS = [0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1.0, 1.06, 1.2, 1.4, 1.58, 2.0, 2.11];
export const snapLineweight = (mm: number) => LINEWEIGHTS.reduce((a, b) => (Math.abs(b - mm) < Math.abs(a - mm) ? b : a));

export interface LayerState { visible: boolean; lw: number }
export type LayerSettings = Record<LayerName, LayerState>;
export const defaultLayerSettings = (): LayerSettings =>
  Object.fromEntries(LAYER_DEFS.map((l) => [l.name, { visible: l.name !== '18_QC_REVIEW', lw: l.lw }])) as LayerSettings;

/** ACI colour index -> RGB (subset used by the layer standard). */
export const ACI: Record<number, string> = {
  1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#000000', 8: '#808080', 9: '#c0c0c0',
  30: '#ff7f00', 40: '#ffbf00', 140: '#007fff',
};
/** Screen colours for the overlay view (readable on a photo). */
export const LAYER_COLORS: Record<LayerName, string> = {
  '00_REFERENCE': '#8a8a8a', '01_BUILDING_OUTLINE': '#d7263d', '02_WALLS': '#f46036', '03_OPENINGS': '#00a6ed', '04_WINDOWS': '#2e86ab',
  '05_DOORS': '#c200fb', '06_FRAMES': '#1b998b', '07_BALCONIES': '#ff8c00', '08_RAILINGS': '#e9b200', '09_ROOF': '#b80c09',
  '10_CORNICES': '#7768ae', '11_DECORATIVE_DETAILS': '#9c6644', '12_GROUND': '#222222', '13_HATCHING': '#9a9a9a',
  '14_COLUMNS_PILASTERS': '#3c6e71', '15_FLOOR_LEVELS': '#ef476f', '16_DRAINAGE': '#118ab2', '17_ANNOTATION': '#333333', '18_QC_REVIEW': '#ff0054',
};
