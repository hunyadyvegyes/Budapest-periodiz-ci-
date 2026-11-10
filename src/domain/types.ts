import type { MultiPolygon, Polygon } from 'geojson';

/**
 * Az adatmodell szándékosan független a térképi megjelenítéstől.
 * Ugyanez a struktúra tükröződik a PostGIS sémában (supabase/schema.sql).
 */

/** Egy adat megbízhatósága. */
export type Reliability =
  | 'documented' // Elsődleges / hiteles forrással dokumentált
  | 'probable' // Forrás alapján valószínűsített
  | 'community' // Közösségi adat (pl. OpenStreetMap), nem ellenőrzött
  | 'demo' // Generált tesztadat – NEM valós
  | 'unknown';

/** Építési év pontossága (a specifikáció 3. pontja szerint). */
export type YearPrecision = 'exact' | 'probable' | 'range' | 'unknown';

export interface SourceRef {
  id: string;
  title: string;
  url?: string;
  /** pl. "levéltári", "szakirodalom", "adatbázis", "terepbejárás", "demo" */
  kind?: string;
  license?: string;
  accessed?: string;
  note?: string;
}

export interface FieldMeta {
  sourceIds: string[];
  reliability: Reliability;
  note?: string;
}

export interface ConstructionDate {
  precision: YearPrecision;
  /** exact / probable esetén */
  year?: number;
  /** range esetén */
  from?: number;
  to?: number;
  sourceIds: string[];
  note?: string;
}

export interface Alteration {
  year?: number;
  from?: number;
  to?: number;
  description: string;
  sourceIds: string[];
}

export type ImageKind = 'archive' | 'current' | 'plan' | 'facade' | 'other';

export interface BuildingImage {
  url: string;
  caption?: string;
  kind: ImageKind;
  year?: number;
  author?: string;
  license?: string;
  sourceId?: string;
}

export type ProtectionStatus = 'muemlek' | 'muemleki_kornyezet' | 'helyi' | 'nincs' | 'ismeretlen';

/** Mezők, amelyekhez külön forrás- és megbízhatósági metaadat rendelhető. */
export type AttributableField =
  | 'name'
  | 'address'
  | 'architects'
  | 'style'
  | 'originalFunction'
  | 'buildingType'
  | 'floors'
  | 'structure'
  | 'currentFunction'
  | 'protection'
  | 'description';

export interface Building {
  id: string;
  /** Tesztadat jelölése – a felületen mindig látható. */
  isDemo: boolean;
  /** Későbbi többvárosos bővítéshez. */
  city: string;
  name?: string;
  address?: string;
  /** Kerület római számmal, pl. "VII" */
  district?: string;
  /** [lng, lat] */
  centroid: [number, number];
  geometry: Polygon | MultiPolygon;
  /** true, ha nincs valódi kontúr (pl. csak koordinátával importált rekord) – jelölő négyzet */
  geometryApprox?: boolean;

  construction: ConstructionDate;
  alterations: Alteration[];

  architects: string[];
  style?: string;
  originalFunction?: string;
  buildingType?: string;
  floors?: number;
  structure?: string;
  currentFunction?: string;
  protection: ProtectionStatus;

  description?: string;
  images: BuildingImage[];
  sources: SourceRef[];
  fieldMeta: Partial<Record<AttributableField, FieldMeta>>;

  /** Honnan került az adatbázisba (demo, osm, kézi, import) */
  origin: 'demo' | 'osm' | 'manual' | 'import';
  updatedAt: string;
}

/** Budapest-e a település (a kerület csak ott értelmezett). */
export function isBudapest(city: string | undefined): boolean {
  return !city || city.trim().toLocaleLowerCase('hu') === 'budapest';
}

export const DISTRICTS = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
  'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII',
] as const;

export const PROTECTION_LABELS: Record<ProtectionStatus, string> = {
  muemlek: 'Műemlék',
  muemleki_kornyezet: 'Műemléki környezet',
  helyi: 'Helyi védelem',
  nincs: 'Nem védett',
  ismeretlen: 'Ismeretlen',
};

export const PRECISION_LABELS: Record<YearPrecision, string> = {
  exact: 'Dokumentált, pontos év',
  probable: 'Forrás alapján valószínűsített',
  range: 'Tól–ig (kezdés és befejezés éve)',
  unknown: 'Ismeretlen',
};

export const RELIABILITY_LABELS: Record<Reliability, string> = {
  documented: 'Dokumentált',
  probable: 'Valószínűsített',
  community: 'Közösségi (nem ellenőrzött)',
  demo: 'DEMO tesztadat',
  unknown: 'Ismeretlen',
};

export const IMAGE_KIND_LABELS: Record<ImageKind, string> = {
  archive: 'Archív fotó',
  current: 'Mai fotó',
  plan: 'Alaprajz / terv',
  facade: 'Homlokzatrajz',
  other: 'Egyéb',
};
