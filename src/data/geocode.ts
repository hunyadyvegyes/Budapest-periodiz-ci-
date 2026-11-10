import type { MultiPolygon, Polygon } from 'geojson';
import { addressFrom, cityFrom, districtFrom } from './osmLookup';
import { buildingContainingPoint } from './osmBuildings';
import { isBudapest } from '../domain/types';
import { normalize } from '../domain/filter';
import { districtFromPostcode, expandAbbreviations } from '../domain/sheet';

/**
 * Cím → épületkörvonal (tömeges feltöltéshez).
 * Szigorú: csak akkor fogad el címtalálatot, ha a település és a házszám egyezik (Budapesten a kerület is).
 * Ha cím alapján nincs épület, az épület neve + település alapján is próbálkozik – ezt külön jelöli.
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
  /** névből (nem címből) találva – ellenőrizendő */
  byName?: boolean;
  message: string;
}

export interface MatchInput {
  address: string;
  city?: string;
  district?: string;
  postcode?: string;
  country?: string;
  name?: string;
}

interface NomResult {
  lat: string;
  lon: string;
  osm_type: string;
  osm_id: number;
  category: string;
  type: string;
  display_name: string;
  address?: Record<string, string>;
  geojson?: { type: string; coordinates: unknown };
}

let last = 0;
async function nominatim(params: Record<string, string>): Promise<NomResult[]> {
  const wait = Math.max(0, last + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const qs = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', polygon_geojson: '1', limit: '8', ...params });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`);
  if (!res.ok) throw new Error(`A címkereső nem válaszol (${res.status}).`);
  return (await res.json()) as NomResult[];
}

export function houseNumber(s: string | undefined): string | undefined {
  return s?.match(/(\d+)/)?.[1];
}

/** A házszám első száma: „Margit körút 55.” → 55, „Városház utca 9-11” → 9, „Lejtő út 2/b” → 2. */
export function wantedNumber(street: string): string | undefined {
  return street.match(/(\d+)(?:\s*[-–/]\s*\d+)?\s*(?:\/?\s*[a-zA-Z])?\.?\s*$/)?.[1];
}

const COUNTRY: Record<string, string> = {
  magyarorszag: 'hu', ausztria: 'at', osterreich: 'at', szlovakia: 'sk', romania: 'ro', szerbia: 'rs',
  horvatorszag: 'hr', szlovenia: 'si', ukrajna: 'ua', csehorszag: 'cz', lengyelorszag: 'pl', olaszorszag: 'it', nemetorszag: 'de',
};
/** a Kárpát-medence országai – ha nincs megadva ország és Magyarországon nincs találat */
const NEIGHBOURS = 'hu,at,sk,ro,rs,hr,si,ua';

const BAD = new Set(['highway', 'landuse', 'boundary', 'place', 'railway', 'natural', 'waterway', 'leisure']);
const isArea = (r: NomResult) => r.geojson?.type === 'Polygon' || r.geojson?.type === 'MultiPolygon';

export async function matchAddress(input: MatchInput): Promise<MatchResult> {
  const street = expandAbbreviations(input.address ?? '');
  const town = input.city?.trim() || 'Budapest';
  const bp = isBudapest(town);
  const d = bp ? (input.district?.trim().toUpperCase().replace(/\.$/, '') || districtFromPostcode(input.postcode)) : undefined;
  const cc = input.country ? COUNTRY[normalize(input.country).replace(/[^a-z]/g, '')] : 'hu';
  const want = wantedNumber(street);

  const inTown = (r: NomResult) => {
    const disp = normalize(r.display_name);
    return disp.includes(normalize(town)) || normalize(cityFrom(r.address) ?? '') === normalize(town);
  };
  const okDistrict = (r: NomResult) => !d || districtFrom(r.display_name) === d;
  const okNumber = (r: NomResult) => !want || houseNumber(r.address?.house_number) === want;
  const result = (r: NomResult, geometry: Polygon | MultiPolygon, osmRef: string, message: string, byName = false): MatchResult => ({
    status: 'found', geometry, osmRef, byName, message,
    address: byName ? street || undefined : addressFrom(r.address) ?? street,
    city: town,
    district: bp ? districtFrom(r.display_name) ?? d : undefined,
  });

  let res: NomResult[] = [];
  if (street) {
    const q = `${street}, ${input.postcode ? input.postcode + ' ' : ''}${town}${d && !input.postcode ? `, ${d}. kerület` : ''}`;
    res = await nominatim({ q, countrycodes: cc ?? NEIGHBOURS });
    if (!res.length && !input.country) res = await nominatim({ q, countrycodes: NEIGHBOURS });

    const candidates = res.filter((r) => inTown(r) && okDistrict(r) && okNumber(r));
    // 1) a találat maga az épület
    const area = candidates.find((r) => !BAD.has(r.category) && isArea(r));
    if (area) return result(area, area.geojson as Polygon | MultiPolygon, `${area.osm_type}/${area.osm_id}`, 'Megtalálva');
    // 2) címpont → az azt tartalmazó épület (több részből álló épületekkel is)
    for (const p of candidates.slice(0, 3)) {
      const b = await buildingContainingPoint(Number(p.lat), Number(p.lon));
      if (b) return result(p, b.geometry, b.id, 'Megtalálva (címpont alapján)');
    }
    if (candidates.length && !input.name) return { status: 'uncertain', message: 'A cím megvan, de épületkörvonal nincs hozzá az OSM-ben – a térképen kattintással vehető fel.' };
  }

  // 3) név + település alapján (pl. templomok, kastélyok, középületek)
  const name = input.name?.split(',').pop()?.replace(/\(.*?\)/g, '').trim();
  if (name && name.length > 3) {
    const byName = await nominatim({ q: `${name}, ${town}`, countrycodes: cc ?? NEIGHBOURS });
    const hit = byName.find((r) => inTown(r) && isArea(r) && !BAD.has(r.category));
    if (hit) return result(hit, hit.geojson as Polygon | MultiPolygon, `${hit.osm_type}/${hit.osm_id}`, `Név alapján találva („${hit.display_name.split(',')[0]}”) – ellenőrizd!`, true);
  }

  if (res.some((r) => inTown(r) && okDistrict(r) && okNumber(r)))
    return { status: 'uncertain', message: 'A cím megvan, de épületkörvonal nincs hozzá az OSM-ben – a térképen kattintással vehető fel.' };
  if (res.length) {
    const r0 = res[0];
    const why = !inTown(r0)
      ? `más településen találtam (${cityFrom(r0.address) ?? '?'})`
      : !okDistrict(r0)
        ? `más kerületben találtam (${districtFrom(r0.display_name) ?? '?'}.)`
        : `a házszám nem egyezik (kerestem: ${want ?? '–'}, találtam: ${r0.address?.house_number ?? 'nincs'})`;
    return { status: 'notfound', message: `Nincs biztos találat: ${why}.` };
  }
  return { status: 'notfound', message: street ? `A címet (${street}, ${town}) nem találtam. Ellenőrizd az írásmódot.` : 'Nincs cím megadva.' };
}
