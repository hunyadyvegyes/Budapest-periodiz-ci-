import type { MultiPolygon, Polygon } from 'geojson';
import type { Building } from './types';
import { isBudapest } from './types';
import { centroidOf } from './geo';

const OSM_URL = /openstreetmap\.org\/(way|relation|node)\/\d+/;

export interface ReassignInput {
  geometry: Polygon | MultiPolygon;
  osmRef?: string;
  /** az új hely címe (ha frissíteni kell) */
  place?: { address?: string; city?: string; district?: string } | null;
  updateAddress: boolean;
}

/**
 * Rekord áthelyezése egy másik épületre: minden történeti adat változatlan marad,
 * csak a körvonal, a súlypont, az OSM-hivatkozás és – kérésre – a cím változik.
 */
export function reassignBuilding(b: Building, t: ReassignInput): Building {
  const sources = b.sources.filter((s) => !(s.url && OSM_URL.test(s.url)) && s.id !== 'osm');
  if (t.osmRef)
    sources.push({ id: 'osm', title: `OpenStreetMap – ${t.osmRef} (kontúr)`, url: `https://www.openstreetmap.org/${t.osmRef}`, license: 'ODbL 1.0' });
  const newCity = t.place?.city ?? b.city;
  const changes = Boolean(t.place?.address && (t.place.address !== b.address || newCity !== b.city));
  const useAddr = t.updateAddress && changes;
  return {
    ...b,
    geometry: t.geometry,
    geometryApprox: false,
    centroid: centroidOf(t.geometry),
    sources,
    ...(useAddr
      ? {
          address: t.place!.address,
          city: newCity,
          district: isBudapest(newCity) ? t.place?.district ?? b.district : undefined,
          fieldMeta: { ...b.fieldMeta, address: { sourceIds: t.osmRef ? ['osm'] : [], reliability: 'community' as const, note: 'Kézzel áthelyezve a térképen' } },
        }
      : {}),
  };
}

export function addressWouldChange(b: Building, place?: { address?: string; city?: string } | null): boolean {
  const newCity = place?.city ?? b.city;
  return Boolean(place?.address && (place.address !== b.address || newCity !== b.city));
}
