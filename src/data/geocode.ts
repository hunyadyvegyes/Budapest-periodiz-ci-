import type { MultiPolygon, Polygon } from 'geojson';
import { addressFrom, cityFrom, districtFrom, osmBuildingContaining } from './osmLookup';
import { isBudapest } from '../domain/types';
import { normalize } from '../domain/filter';

/**
 * Cím → épületkörvonal (tömeges feltöltéshez).
 * Szigorú: csak akkor fogad el találatot, ha a házszám egyezik, és – ha megadták – a kerület is.
 * Nominatim használati feltétel: legfeljebb 1 kérés másodpercenként.
 */

export type MatchStatus = 'found' | 'uncertain' | 'notfound';

export interface MatchResult {
  status: MatchStatus;
  geometry?: Polygon | MultiPolygon;
  osmRef?: string;
  address?: string;
  city?: string;
  district?: string;
  message: string;
}

let last = 0;
async function nominatim(params: Record<string, string>) {
  const wait = Math.max(0, last + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const qs = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', polygon_geojson: '1', countrycodes: 'hu', 'accept-language': 'hu', ...params });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`);
  if (!res.ok) throw new Error(`A címkereső nem válaszol (${res.status}).`);
  return (await res.json()) as NomResult[];
}

interface NomResult {
  lat: string;
  lon: string;
  osm_type: string;
  osm_id: number;
  category: string;
  display_name: string;
  address?: Record<string, string>;
  geojson?: { type: string; coordinates: unknown };
}

export function houseNumber(s: string | undefined): string | undefined {
  return s?.match(/(\d+)/)?.[1];
}

/** A cím utolsó számcsoportja = házszám (pl. „Margit körút 55.” → 55, „Lejtő út 2/b” → 2). */
function wantedNumber(address: string): string | undefined {
  const m = address.match(/(\d+)\s*(?:[/\-–]?\s*[a-zA-Z])?\.?\s*$/);
  return m?.[1];
}

const BAD = new Set(['highway', 'landuse', 'boundary', 'place', 'railway', 'natural', 'waterway', 'leisure']);

export async function matchAddress(address: string, district?: string, city?: string): Promise<MatchResult> {
  const addr = address.trim().replace(/\s+/g, ' ');
  if (!addr) return { status: 'notfound', message: 'Nincs cím megadva.' };
  const want = wantedNumber(addr);
  const town = city?.trim() || 'Budapest';
  const bp = isBudapest(town);
  const d = bp ? district?.trim().toUpperCase().replace(/\.$/, '') || undefined : undefined;
  const q = `${addr.replace(/\.$/, '')}${d ? `, ${d}. kerület` : ''}, ${town}`;
  // Magyarország területén belül
  const res = await nominatim({ q, limit: '6', viewbox: '16.1,48.6,22.9,45.7', bounded: '1' });
  const okCity = (r: NomResult) => normalize(cityFrom(r.address) ?? '') === normalize(town);
  const okDistrict = (r: NomResult) => !d || districtFrom(r.display_name) === d;
  const okNumber = (r: NomResult) => !want || houseNumber(r.address?.house_number) === want;
  const candidates = res.filter((r) => okCity(r) && okDistrict(r) && okNumber(r));

  // 1) közvetlenül épület-poligon
  const area = candidates.find((r) => !BAD.has(r.category) && (r.geojson?.type === 'Polygon' || r.geojson?.type === 'MultiPolygon'));
  if (area) {
    return {
      status: 'found',
      geometry: area.geojson as Polygon | MultiPolygon,
      osmRef: `${area.osm_type}/${area.osm_id}`,
      address: addressFrom(area.address) ?? addr,
      city: cityFrom(area.address) ?? town,
      district: bp ? districtFrom(area.display_name) : undefined,
      message: 'Megtalálva',
    };
  }
  // 2) címpont → az azt tartalmazó épület
  for (const p of candidates) {
    const b = await osmBuildingContaining(Number(p.lat), Number(p.lon));
    if (b?.geometry) {
      return { status: 'found', geometry: b.geometry, osmRef: b.osmRef, address: addressFrom(p.address) ?? addr, city: cityFrom(p.address) ?? town, district: bp ? districtFrom(p.display_name) : undefined, message: 'Megtalálva (címpont alapján)' };
    }
  }
  if (candidates.length) return { status: 'uncertain', message: 'A cím megvan, de épületkörvonal nincs hozzá az OSM-ben – a térképen kattintással vehető fel.' };
  if (res.length) {
    const r0 = res[0];
    const why = !okCity(r0)
      ? `más településen találtam (${cityFrom(r0.address) ?? '?'})`
      : !okDistrict(r0)
        ? `más kerületben találtam (${districtFrom(r0.display_name) ?? '?'}.)`
        : 'a házszám nem egyezik';
    return { status: 'notfound', message: `Nincs biztos találat: ${why}. Ellenőrizd a címet.` };
  }
  return { status: 'notfound', message: 'A cím nem található. Ellenőrizd az írásmódot (pl. „Margit körút 55.”).' };
}
