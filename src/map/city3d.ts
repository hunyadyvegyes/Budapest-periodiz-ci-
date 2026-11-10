import type { Map as MLMap, GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import type { FeatureCollection, Polygon } from 'geojson';
import type { Building } from '../domain/types';
import { colorOf } from '../domain/periods';
import { pointInGeometry } from '../data/osmLookup';

/**
 * Élethűbb 3D nézet.
 *  - base-3d:   a háttértérkép minden épülete és épületrésze valódi OSM-magassággal és -színnel
 *               (render_height / render_min_height / colour a vektorcsempékből)
 *  - models-3d: részletes tömegmodellek (data/models.geojson) – OSM-épületrészekből, tetőformákkal
 *  - az atlaszban szereplő épületek épületrészei a korszakuk színét kapják (feature-state)
 * A MapLibre csak hasábokat tud kihúzni; a tetőket a modellek szeletekkel közelítik.
 */

export const SELECTED = '#ffd23f';
const STONE = '#ddd6c9'; // semleges épületszín, ha az OSM nem ad meg színt
const BASE_SRC = { source: 'openmaptiles', sourceLayer: 'building' };

export interface ModelMeta {
  osmRef: string;
  name: string;
  osmWayIds: number[];
}

export interface Models {
  fc: FeatureCollection<Polygon>;
  meta: ModelMeta[];
}

let models: Models | null = null;

export async function loadModels(): Promise<Models | null> {
  if (models) return models;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/models.geojson`);
    if (!r.ok) return null;
    const fc = await r.json();
    models = { fc, meta: fc.metadata?.models ?? [] };
  } catch {
    models = null;
  }
  return models;
}

/** A csempe-azonosítóból az OSM-azonosító (OpenMapTiles: osm_id × 10 + jelző). */
const osmIdExpr = ['floor', ['/', ['id'], 10]];

export function add3dLayers(map: MLMap, before?: string) {
  if (!map.getSource('openmaptiles') || map.getLayer('base-3d')) return;
  map.addLayer(
    {
      id: 'base-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 13.5,
      layout: { visibility: 'none' },
      paint: {
        // szín csak az atlaszban szereplő épületeknek (korszak szerint); a többi semleges,
        // hogy az OSM-ben rögzített homlokzatszínek ne legyenek összetéveszthetők a korszakszínekkel
        'fill-extrusion-color': ['coalesce', ['feature-state', 'color'], STONE],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, ['coalesce', ['get', 'render_height'], 8]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.94,
        'fill-extrusion-vertical-gradient': true,
      },
    },
    before,
  );
  map.addSource('models', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer(
    {
      id: 'models-3d',
      type: 'fill-extrusion',
      source: 'models',
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'top'],
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': true,
      },
    },
    before,
  );
  try {
    // fény és égbolt: érezhetőbb térhatás
    map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.42, position: [1.3, 215, 35] });
    map.setSky({ 'sky-color': '#cddff0', 'horizon-color': '#f2efe9', 'fog-color': '#f2efe9', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.85 } as never);
  } catch { /* régebbi motor: fény/égbolt nélkül */ }
}

export function set3dVisible(map: MLMap, on: boolean) {
  for (const id of ['base-3d', 'models-3d']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

/** A modellel rendelkező épületek csempés tömbjeinek elrejtése (a modell kerül a helyükre). */
export function hideModelledFromBase(map: MLMap, m: Models) {
  const ids = m.meta.flatMap((x) => [...x.osmWayIds, Number(x.osmRef.split('/')[1])]);
  if (map.getLayer('base-3d')) map.setFilter('base-3d', ['!', ['in', osmIdExpr, ['literal', ids]]] as never);
}

/** Az atlasz-épület, amelyhez egy OSM-hivatkozás tartozik (a forráslinkje vagy az azonosítója alapján). */
function atlasByOsm(buildings: Building[]): Map<string, Building> {
  const m = new Map<string, Building>();
  for (const b of buildings) {
    for (const s of b.sources) {
      const r = s.url?.match(/openstreetmap\.org\/(way|relation)\/(\d+)/);
      if (r) m.set(`${r[1]}/${r[2]}`, b);
    }
  }
  return m;
}

function darken(hex: string, f = 0.78) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * f).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** A modellek színezése: atlaszban szereplő épületnél a korszak színe, egyébként semleges kőszín. */
export function updateModels(map: MLMap, m: Models, buildings: Building[], selectedId: string | null) {
  const byOsm = atlasByOsm(buildings);
  const fc: FeatureCollection<Polygon> = {
    type: 'FeatureCollection',
    features: m.fc.features.map((f) => {
      const p = f.properties as { model: string; roof: boolean };
      const b = byOsm.get(p.model);
      const base = b ? (b.id === selectedId ? SELECTED : colorOf(b)) : STONE;
      return { ...f, properties: { ...f.properties, atlasId: b?.id ?? null, color: p.roof ? darken(base, b ? 0.78 : 0.88) : base } };
    }),
  };
  (map.getSource('models') as GeoJSONSource | undefined)?.setData(fc);
}

let painted: (string | number)[] = [];

/**
 * Az atlasz épületeinek színe a valódi magasságú csempeépületekre: a látható atlasz-épületek
 * alaprajzán belül eső épületrészek a korszak színét kapják; ahol ilyen van, az atlasz saját
 * (becsült magasságú) tömbje elrejtve.
 */
export function paintAtlasParts(map: MLMap, buildings: Building[], selectedId: string | null, modelled: Set<string>) {
  if (!map.getLayer('base-3d') || map.getZoom() < 14) return;
  for (const id of painted) map.removeFeatureState({ ...BASE_SRC, id });
  painted = [];
  const bounds = map.getBounds();
  const byOsm = atlasByOsm(buildings);
  const modelAtlasIds = new Set([...modelled].map((r) => byOsm.get(r)?.id).filter(Boolean) as string[]);
  for (const b of buildings) {
    map.setFeatureState({ source: 'atlas', id: b.id }, { matched: modelAtlasIds.has(b.id) });
    if (modelAtlasIds.has(b.id)) continue;
    const [lng, lat] = b.centroid;
    if (!bounds.contains([lng, lat])) continue;
    const ring = b.geometry.type === 'Polygon' ? b.geometry.coordinates[0] : b.geometry.coordinates[0][0];
    const pts = ring.map((c) => map.project(c as [number, number]));
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    const hits = map.queryRenderedFeatures([[minX, minY], [maxX, maxY]], { layers: ['base-3d'] }) as MapGeoJSONFeature[];
    const color = b.id === selectedId ? SELECTED : colorOf(b);
    let any = false;
    for (const h of hits) {
      if (h.id == null) continue;
      const g = h.geometry;
      if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue;
      const r = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
      const c = r.slice(0, -1).reduce((s, q) => [s[0] + q[0] / (r.length - 1), s[1] + q[1] / (r.length - 1)], [0, 0]);
      if (!pointInGeometry(c as [number, number], b.geometry)) continue;
      map.setFeatureState({ ...BASE_SRC, id: h.id }, { color, atlasId: b.id });
      painted.push(h.id);
      any = true;
    }
    map.setFeatureState({ source: 'atlas', id: b.id }, { matched: any });
  }
}

/** Kattintás 3D-ben: melyik atlasz-épülethez tartozik a kattintott tömb. */
export function atlasIdAt(map: MLMap, point: { x: number; y: number }): string | null {
  const layers = ['models-3d', 'base-3d'].filter((l) => map.getLayer(l));
  for (const f of map.queryRenderedFeatures([point.x, point.y], { layers })) {
    const id = (f.properties?.atlasId as string | null) ?? (f.state?.atlasId as string | undefined);
    if (id) return id;
  }
  return null;
}
