import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { Building, ConstructionDate, ProtectionStatus, YearPrecision } from './types';
import { centroidOf, rectAround } from './geo';

/* ------------------------------------------------------------------ */
/* GeoJSON                                                             */
/* ------------------------------------------------------------------ */

export function toGeoJSON(list: Building[]): FeatureCollection<Polygon | MultiPolygon> {
  return {
    type: 'FeatureCollection',
    features: list.map((b) => {
      const { geometry, ...props } = b;
      return { type: 'Feature', id: b.id, geometry, properties: props as Record<string, unknown> };
    }),
  };
}

const PRECISIONS: YearPrecision[] = ['exact', 'probable', 'range', 'unknown'];
const PROTECTIONS: ProtectionStatus[] = ['muemlek', 'muemleki_kornyezet', 'helyi', 'nincs', 'ismeretlen'];

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

let seq = 0;
export function newId(prefix = 'b'): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Építési dátum felépítése lapos mezőkből. Hiányzó adatból NEM következtet. */
export function constructionFromFlat(p: Record<string, unknown>): ConstructionDate {
  const precisionRaw = str(p.year_precision ?? p.precision);
  const year = num(p.year ?? p.construction_year ?? p.start_date);
  const from = num(p.year_from);
  const to = num(p.year_to);
  const sourceIds = (str(p.year_source_ids) ?? '').split(/[;,]\s*/).filter(Boolean);
  let precision: YearPrecision =
    precisionRaw && PRECISIONS.includes(precisionRaw as YearPrecision) ? (precisionRaw as YearPrecision) : 'unknown';
  if (!precisionRaw) {
    if (year != null) precision = 'exact';
    else if (from != null && to != null) precision = 'range';
  }
  if ((precision === 'exact' || precision === 'probable') && year == null) precision = 'unknown';
  if (precision === 'range' && (from == null || to == null)) precision = 'unknown';
  return {
    precision,
    year: precision === 'exact' || precision === 'probable' ? year : undefined,
    from: precision === 'range' ? from : undefined,
    to: precision === 'range' ? to : undefined,
    sourceIds,
    note: str(p.year_note),
  };
}

/** Egy tetszőleges GeoJSON feature épületrekorddá alakítása. */
export function featureToBuilding(f: Feature, origin: Building['origin'] = 'import'): Building | null {
  const g = f.geometry;
  const p = (f.properties ?? {}) as Record<string, unknown>;
  let geometry: Polygon | MultiPolygon;
  let geometryApprox = false;
  if (g?.type === 'Polygon' || g?.type === 'MultiPolygon') geometry = g;
  else if (g?.type === 'Point') {
    geometry = rectAround(g.coordinates as [number, number]);
    geometryApprox = true;
  } else return null;

  // Saját formátum: teljes rekord a properties-ben
  if (p.construction && typeof p.construction === 'object') {
    const b = p as unknown as Building;
    return {
      ...b,
      id: str(b.id) ?? str(f.id) ?? newId(),
      geometry,
      geometryApprox: b.geometryApprox ?? geometryApprox,
      centroid: b.centroid ?? centroidOf(geometry),
      architects: b.architects ?? [],
      alterations: b.alterations ?? [],
      images: b.images ?? [],
      sources: b.sources ?? [],
      fieldMeta: b.fieldMeta ?? {},
      protection: b.protection ?? 'ismeretlen',
      isDemo: Boolean(b.isDemo),
      city: b.city ?? 'Budapest',
      origin: b.origin ?? origin,
      updatedAt: b.updatedAt ?? new Date().toISOString(),
    };
  }
  return flatToBuilding(p, geometry, geometryApprox, origin, str(f.id));
}

function flatToBuilding(
  p: Record<string, unknown>,
  geometry: Polygon | MultiPolygon,
  geometryApprox: boolean,
  origin: Building['origin'],
  fallbackId?: string,
): Building {
  const protectionRaw = str(p.protection);
  const sources = [] as Building['sources'];
  const srcTitle = str(p.source_title ?? p.source);
  if (srcTitle) sources.push({ id: 'src1', title: srcTitle, url: str(p.source_url), license: str(p.source_license) });
  const construction = constructionFromFlat(p);
  if (srcTitle && !construction.sourceIds.length && construction.precision !== 'unknown') construction.sourceIds = ['src1'];
  return {
    id: str(p.id) ?? fallbackId ?? newId(),
    isDemo: String(p.is_demo ?? p.isDemo ?? '').toLowerCase() === 'true',
    city: str(p.city) ?? 'Budapest',
    name: str(p.name),
    address: str(p.address),
    district: str(p.district),
    centroid: centroidOf(geometry),
    geometry,
    geometryApprox,
    construction,
    alterations: str(p.alterations)
      ? String(p.alterations).split(';').map((s) => {
          const [y, ...rest] = s.split(':');
          return { year: num(y), description: rest.join(':').trim() || s.trim(), sourceIds: [] };
        })
      : [],
    architects: (str(p.architects ?? p.architect) ?? '').split(/;\s*/).filter(Boolean),
    style: str(p.style),
    originalFunction: str(p.original_function ?? p.function),
    buildingType: str(p.building_type),
    floors: num(p.floors),
    structure: str(p.structure),
    currentFunction: str(p.current_function),
    protection: protectionRaw && PROTECTIONS.includes(protectionRaw as ProtectionStatus) ? (protectionRaw as ProtectionStatus) : 'ismeretlen',
    description: str(p.description),
    images: [],
    sources,
    fieldMeta: {},
    origin,
    updatedAt: new Date().toISOString(),
  };
}

export function parseGeoJSON(text: string): { buildings: Building[]; skipped: number } {
  const data = JSON.parse(text);
  const features: Feature[] = data.type === 'FeatureCollection' ? data.features : data.type === 'Feature' ? [data] : [];
  const buildings: Building[] = [];
  let skipped = 0;
  for (const f of features) {
    const b = featureToBuilding(f);
    if (b) buildings.push(b);
    else skipped++;
  }
  return { buildings, skipped };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

export const CSV_COLUMNS = [
  'id', 'is_demo', 'city', 'name', 'address', 'district', 'lng', 'lat',
  'year_precision', 'year', 'year_from', 'year_to', 'year_source_ids', 'year_note',
  'alterations', 'architects', 'style', 'original_function', 'building_type', 'floors',
  'structure', 'current_function', 'protection', 'description',
  'source_title', 'source_url', 'source_license', 'geometry',
] as const;

function csvEscape(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(list: Building[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const b of list) {
    const c = b.construction;
    const src = b.sources[0];
    const rec: Record<(typeof CSV_COLUMNS)[number], unknown> = {
      id: b.id,
      is_demo: b.isDemo,
      city: b.city,
      name: b.name,
      address: b.address,
      district: b.district,
      lng: b.centroid[0].toFixed(6),
      lat: b.centroid[1].toFixed(6),
      year_precision: c.precision,
      year: c.year,
      year_from: c.from,
      year_to: c.to,
      year_source_ids: c.sourceIds.join(';'),
      year_note: c.note,
      alterations: b.alterations.map((a) => `${a.year ?? ''}:${a.description}`).join(';'),
      architects: b.architects.join(';'),
      style: b.style,
      original_function: b.originalFunction,
      building_type: b.buildingType,
      floors: b.floors,
      structure: b.structure,
      current_function: b.currentFunction,
      protection: b.protection,
      description: b.description,
      source_title: src?.title,
      source_url: src?.url,
      source_license: src?.license,
      geometry: b.geometryApprox ? '' : JSON.stringify(b.geometry),
    };
    rows.push(CSV_COLUMNS.map((k) => csvEscape(rec[k])).join(','));
  }
  return rows.join('\n') + '\n';
}

/** RFC 4180-kompatibilis CSV-olvasó (vessző vagy pontosvessző elválasztó). */
export function parseCSVRows(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

export function parseCSV(text: string): { buildings: Building[]; skipped: number } {
  const rows = parseCSVRows(text.replace(/^﻿/, ''));
  if (!rows.length) return { buildings: [], skipped: 0 };
  const header = rows[0].map((h) => h.trim());
  const buildings: Building[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const p: Record<string, unknown> = {};
    header.forEach((h, i) => (p[h] = r[i]));
    let geometry: Polygon | MultiPolygon | null = null;
    let approx = false;
    const gs = str(p.geometry);
    if (gs) {
      try {
        const g = JSON.parse(gs);
        if (g.type === 'Polygon' || g.type === 'MultiPolygon') geometry = g;
      } catch { /* hibás geometria – lent pontból próbáljuk */ }
    }
    if (!geometry) {
      const lng = num(p.lng ?? p.lon), lat = num(p.lat);
      if (lng != null && lat != null) {
        geometry = rectAround([lng, lat]);
        approx = true;
      }
    }
    if (!geometry) { skipped++; continue; }
    buildings.push(flatToBuilding(p, geometry, approx, 'import'));
  }
  return { buildings, skipped };
}
