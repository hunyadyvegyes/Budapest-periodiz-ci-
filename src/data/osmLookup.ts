import type { MultiPolygon, Polygon } from 'geojson';

/**
 * A térképen kattintott pont épületének adatai az OpenStreetMapből (Nominatim).
 * Ingyenes, kulcs nélküli; a használati feltételek szerint kis forgalomra (max. 1 kérés/s).
 * Csak helyadatot ad (cím, kerület, körvonal) – történeti adatot nem.
 */
export interface OsmPlace {
  address?: string;
  district?: string;
  name?: string;
  osmRef?: string; // pl. "way/123"
  geometry?: Polygon | MultiPolygon;
  levels?: number;
}

const ROMAN = /(^|[\s,])([IVXL]+)\. kerület/;

export function districtFrom(display: string): string | undefined {
  return display.match(ROMAN)?.[2];
}

export function addressFrom(a: Record<string, string> | undefined): string | undefined {
  if (!a) return undefined;
  const street = a.road ?? a.pedestrian ?? a.footway ?? a.square ?? a.place;
  if (!street) return undefined;
  return a.house_number ? `${street} ${a.house_number}.` : street;
}

let last = 0;
async function politeFetch(url: string): Promise<Response> {
  const wait = Math.max(0, last + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  return fetch(url, { headers: { Accept: 'application/json' } });
}

export async function lookupBuildingAt(lat: number, lng: number): Promise<OsmPlace | null> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&extratags=1` +
    `&polygon_geojson=1&accept-language=hu&lat=${lat}&lon=${lng}`;
  try {
    const res = await politeFetch(url);
    if (!res.ok) return null;
    const r = await res.json();
    if (!r || r.error) return null;
    const g = r.geojson;
    const isArea = g && (g.type === 'Polygon' || g.type === 'MultiPolygon');
    const isBuildingLike = r.category === 'building' || r.addresstype === 'building' || r.extratags?.building;
    return {
      address: addressFrom(r.address),
      district: districtFrom(r.display_name ?? ''),
      name: r.name || undefined,
      osmRef: r.osm_type && r.osm_id ? `${r.osm_type}/${r.osm_id}` : undefined,
      geometry: isArea && isBuildingLike ? g : undefined,
      levels: r.extratags?.['building:levels'] ? Number(r.extratags['building:levels']) : undefined,
    };
  } catch {
    return null;
  }
}

/** Pont a poligonban (külső gyűrű) – annak ellenőrzésére, hogy a Nominatim a kattintott épületet adta-e. */
export function pointInGeometry([x, y]: [number, number], g: Polygon | MultiPolygon): boolean {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.some((p) => {
    const ring = p[0];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

/**
 * A pontot tartalmazó OSM-épület (way) teljes, csempehatáron nem vágott körvonala
 * az OpenStreetMap szerkesztő-API-jából (kis befoglaló téglalap, CORS-képes, kulcs nélkül).
 */
export async function osmBuildingContaining(lat: number, lng: number): Promise<OsmPlace | null> {
  const d = 0.0004;
  const url = `https://www.openstreetmap.org/api/0.6/map.json?bbox=${lng - d},${lat - d},${lng + d},${lat + d}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: { elements: OsmElement[] } = await res.json();
    const nodes = new Map<number, [number, number]>();
    for (const e of data.elements) if (e.type === 'node' && e.lat != null && e.lon != null) nodes.set(e.id, [e.lon, e.lat]);
    for (const e of data.elements) {
      if (e.type !== 'way' || !e.tags?.building || !e.nodes) continue;
      const ring = e.nodes.map((n) => nodes.get(n)).filter(Boolean) as [number, number][];
      if (ring.length < 4 || ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) continue;
      const geometry: Polygon = { type: 'Polygon', coordinates: [ring] };
      if (!pointInGeometry([lng, lat], geometry)) continue;
      const t = e.tags;
      return {
        geometry,
        osmRef: `way/${e.id}`,
        address: t['addr:street'] ? `${t['addr:street']}${t['addr:housenumber'] ? ' ' + t['addr:housenumber'] + '.' : ''}` : undefined,
        levels: t['building:levels'] ? Number(t['building:levels']) : undefined,
      };
    }
  } catch { /* hálózati hiba – marad a csempekontúr */ }
  return null;
}
