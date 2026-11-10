import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';

/**
 * Valódi, teljes OSM-épületkörvonalak az aktuális nézethez – kijelöléshez.
 *
 * A háttértérkép vektorcsempéi megjelenítésre készültek: kis nagyításnál összevonják
 * a szomszédos épületeket, nagy nagyításnál a csempehatáron feldarabolják őket. Ezért a
 * kijelöléshez közvetlenül az OSM-adatbázisból töltjük be az épületeket, cellánként gyorsítótárazva.
 *
 * Elsődleges forrás: Overpass API (olvasásra készült). Tartalék: az OSM API kis befoglaló téglalapra.
 */

export const MIN_SELECT_ZOOM = 16;
const CELL = 0.004; // ~ 440 × 300 m Budapesten
const MAX_CELLS = 12;

export interface OsmBuilding {
  id: string; // "way/123" | "relation/456"
  geometry: Polygon | MultiPolygon;
  address?: string;
  name?: string;
  levels?: number;
}

const cache = new Map<string, OsmBuilding[]>();
const pending = new Map<string, Promise<OsmBuilding[]>>();
export const byId = new Map<string, OsmBuilding>();

function cellKey(ix: number, iy: number) {
  return `${ix}:${iy}`;
}

function addrOf(t: Record<string, string> = {}) {
  return t['addr:street'] ? `${t['addr:street']}${t['addr:housenumber'] ? ' ' + t['addr:housenumber'] + '.' : ''}` : undefined;
}

function closed(r: Position[]) {
  return r.length >= 4 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];
}

/** Multipolygon-reláció tagjaiból zárt gyűrűk összefűzése. */
export function joinRings(parts: Position[][]): Position[][] {
  const rest = parts.map((p) => [...p]);
  const rings: Position[][] = [];
  const eq = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
  while (rest.length) {
    let ring = rest.shift()!;
    let guard = 0;
    while (!eq(ring[0], ring[ring.length - 1]) && guard++ < 1000) {
      const end = ring[ring.length - 1];
      const i = rest.findIndex((p) => eq(p[0], end) || eq(p[p.length - 1], end));
      if (i < 0) break;
      const p = rest.splice(i, 1)[0];
      ring = ring.concat((eq(p[0], end) ? p : [...p].reverse()).slice(1));
    }
    if (closed(ring)) rings.push(ring);
  }
  return rings;
}

interface OverpassEl {
  type: 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}

export function parseOverpass(elements: OverpassEl[]): OsmBuilding[] {
  const out: OsmBuilding[] = [];
  for (const e of elements) {
    let geometry: Polygon | MultiPolygon | null = null;
    if (e.type === 'way' && e.geometry) {
      const ring = e.geometry.map((p) => [p.lon, p.lat]);
      if (closed(ring)) geometry = { type: 'Polygon', coordinates: [ring] };
    } else if (e.type === 'relation' && e.members) {
      const part = (role: string) =>
        e.members!.filter((m) => m.type === 'way' && (m.role || 'outer') === role && m.geometry).map((m) => m.geometry!.map((p) => [p.lon, p.lat]));
      const outers = joinRings(part('outer'));
      const inners = joinRings(part('inner'));
      if (outers.length === 1) geometry = { type: 'Polygon', coordinates: [outers[0], ...inners] };
      else if (outers.length > 1) geometry = { type: 'MultiPolygon', coordinates: outers.map((o) => [o]) };
    }
    if (!geometry) continue;
    const t = e.tags ?? {};
    out.push({
      id: `${e.type}/${e.id}`,
      geometry,
      address: addrOf(t),
      name: t.name,
      levels: t['building:levels'] ? Number(t['building:levels']) : undefined,
    });
  }
  return out;
}

async function fromOverpass(s: number, w: number, n: number, e: number): Promise<OsmBuilding[]> {
  const q = `[out:json][timeout:25];(way["building"](${s},${w},${n},${e});relation["building"]["type"="multipolygon"](${s},${w},${n},${e}););out geom;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!res.ok) throw new Error('Overpass ' + res.status);
  return parseOverpass((await res.json()).elements);
}

async function fromOsmApi(s: number, w: number, n: number, e: number): Promise<OsmBuilding[]> {
  const res = await fetch(`https://www.openstreetmap.org/api/0.6/map.json?bbox=${w},${s},${e},${n}`);
  if (!res.ok) throw new Error('OSM API ' + res.status);
  const data = await res.json();
  const nodes = new Map<number, { lat: number; lon: number }>();
  const ways = new Map<number, number[]>();
  for (const el of data.elements) {
    if (el.type === 'node') nodes.set(el.id, { lat: el.lat, lon: el.lon });
    if (el.type === 'way') ways.set(el.id, el.nodes);
  }
  const geom = (ids: number[]) => ids.map((i) => nodes.get(i)).filter(Boolean) as { lat: number; lon: number }[];
  const els: OverpassEl[] = [];
  for (const el of data.elements) {
    if (!el.tags?.building) continue;
    if (el.type === 'way') els.push({ type: 'way', id: el.id, tags: el.tags, geometry: geom(el.nodes) });
    if (el.type === 'relation' && el.tags.type === 'multipolygon')
      els.push({
        type: 'relation', id: el.id, tags: el.tags,
        members: el.members.filter((m: { type: string }) => m.type === 'way').map((m: { ref: number; role: string }) => ({ type: 'way', role: m.role, geometry: ways.has(m.ref) ? geom(ways.get(m.ref)!) : undefined })),
      });
  }
  return parseOverpass(els);
}

function loadCell(ix: number, iy: number): Promise<OsmBuilding[]> {
  const key = cellKey(ix, iy);
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  if (pending.has(key)) return pending.get(key)!;
  const w = ix * CELL, s = iy * CELL, e = w + CELL, n = s + CELL;
  const p = fromOverpass(s, w, n, e)
    .catch(() => fromOsmApi(s, w, n, e))
    .then((list) => {
      cache.set(key, list);
      for (const b of list) byId.set(b.id, b);
      return list;
    })
    .catch(() => [] as OsmBuilding[])
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

/** A nézet celláinak betöltése; visszaadja az összes eddig betöltött épületet GeoJSON-ként. */
export async function loadView(b: { west: number; south: number; east: number; north: number }): Promise<FeatureCollection<Polygon | MultiPolygon> | null> {
  const x0 = Math.floor(b.west / CELL), x1 = Math.floor(b.east / CELL);
  const y0 = Math.floor(b.south / CELL), y1 = Math.floor(b.north / CELL);
  const cells: [number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) cells.push([x, y]);
  if (cells.length > MAX_CELLS) return null;
  await Promise.all(cells.map(([x, y]) => loadCell(x, y)));
  return allLoaded();
}

export function allLoaded(): FeatureCollection<Polygon | MultiPolygon> {
  const seen = new Set<string>();
  const features: Feature<Polygon | MultiPolygon>[] = [];
  for (const list of cache.values())
    for (const b of list) {
      if (seen.has(b.id)) continue; // cellahatáron átnyúló épület csak egyszer
      seen.add(b.id);
      features.push({ type: 'Feature', geometry: b.geometry, properties: { id: b.id } });
    }
  return { type: 'FeatureCollection', features };
}
