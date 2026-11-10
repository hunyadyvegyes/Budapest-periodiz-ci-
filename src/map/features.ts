import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { Building } from '../domain/types';
import { colorOf, formatConstruction, isUncertain } from '../domain/periods';

/** Térképi megjelenítéshez szükséges, lapos tulajdonságú feature-ök (adatmodelltől elválasztva). */
export function toMapFeatures(list: Building[]): FeatureCollection<Polygon | MultiPolygon> {
  return {
    type: 'FeatureCollection',
    features: list.map((b) => ({
      type: 'Feature',
      geometry: b.geometry,
      properties: {
        id: b.id,
        color: colorOf(b),
        uncertain: isUncertain(b.construction),
        approx: Boolean(b.geometryApprox),
        height: buildingHeight(b),
        isDemo: b.isDemo,
        label: b.name ?? b.address ?? 'Névtelen épület',
        yearLabel: `Építés: ${formatConstruction(b.construction)}`,
      },
    })),
  };
}

/** Becsült magasság CSAK vizualizációhoz (szintszám × 3,4 m; ismeretlennél semleges 10 m). */
export function buildingHeight(b: Building): number {
  return b.floors != null ? Math.max(4, b.floors * 3.4 + 1.5) : 10;
}
