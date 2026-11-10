import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection, Polygon } from 'geojson';
import type { Building } from '../domain/types';
import { colorOf } from '../domain/periods';
import { pointInGeometry } from '../data/osmLookup';

/**
 * 3D nézet – csak a fontos (atlaszban szereplő) épületek emelkednek ki, a város 2D marad.
 *  - atlas-extrusion: minden atlasz-épület EGY hasáb; magassága az OSM-ben rögzített valódi
 *    magasság (a 2D háttérépületek render_height adatából), ennek híján a szintszámból becsült
 *  - models-3d: stilizált tömegmodell nevezetes épületekhez (data/models.geojson); ahol van
 *    modell, ott az épület egyszerű hasábja elrejtve
 */

export const SELECTED = '#ffd23f';

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

export function add3dLayers(map: MLMap) {
  if (map.getSource('models')) return;
  map.addSource('models', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
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
  });
  try {
    map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.4, position: [1.3, 215, 35] });
  } catch { /* régebbi motor: alapfény */ }
}

export function set3dVisible(map: MLMap, on: boolean) {
  if (map.getLayer('models-3d')) map.setLayoutProperty('models-3d', 'visibility', on ? 'visible' : 'none');
}

/** Az atlasz-épület, amelyhez egy OSM-hivatkozás tartozik (a forráslinkje alapján). */
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

function darken(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * f).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/**
 * Modellek: csak azok jelennek meg, amelyek épülete az atlaszban (a szűrés szerint) látható,
 * a korszak színében. Visszaadja a modellel rendelkező atlasz-épületek azonosítóit.
 */
export function updateModels(map: MLMap, m: Models, buildings: Building[], selectedId: string | null): Set<string> {
  const byOsm = atlasByOsm(buildings);
  const shown = new Set<string>();
  const features = [];
  for (const f of m.fc.features) {
    const p = f.properties as { model: string; roof: boolean };
    const b = byOsm.get(p.model);
    if (!b) continue;
    shown.add(b.id);
    const base = b.id === selectedId ? SELECTED : colorOf(b);
    features.push({ ...f, properties: { ...f.properties, atlasId: b.id, color: p.roof ? darken(base, 0.8) : base } });
  }
  (map.getSource('models') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  return shown;
}

function baseBuildingFillLayers(map: MLMap): string[] {
  return (map.getStyle()?.layers ?? [])
    .filter((l) => l.type === 'fill' && (l as { 'source-layer'?: string })['source-layer'] === 'building')
    .map((l) => l.id);
}

/**
 * Az atlasz-épületek magassága a 2D háttérépületek OSM-magasságából: az alaprajzon belül eső
 * háttérépület(rész)ek közül a legmagasabb. Egy épület = egy hasáb (feature-state „h”);
 * a modellel rendelkező épületeknél „modelled” → a hasáb elrejtve.
 */
export function updateAtlasHeights(map: MLMap, buildings: Building[], modelled: Set<string>) {
  const layers = baseBuildingFillLayers(map).filter((l) => map.getLayoutProperty(l, 'visibility') !== 'none');
  const bounds = map.getBounds();
  for (const b of buildings) {
    map.setFeatureState({ source: 'atlas', id: b.id }, { modelled: modelled.has(b.id) });
    if (modelled.has(b.id) || !layers.length || !bounds.contains(b.centroid)) continue;
    const ring = b.geometry.type === 'Polygon' ? b.geometry.coordinates[0] : b.geometry.coordinates[0][0];
    const pts = ring.map((c) => map.project(c as [number, number]));
    const box: [[number, number], [number, number]] = [
      [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y))],
      [Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y))],
    ];
    let h = 0;
    for (const f of map.queryRenderedFeatures(box, { layers })) {
      const rh = Number(f.properties?.render_height);
      if (!Number.isFinite(rh) || rh <= h) continue;
      const g = f.geometry;
      if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue;
      const r = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
      const c = r.slice(0, -1).reduce((s, q) => [s[0] + q[0] / (r.length - 1), s[1] + q[1] / (r.length - 1)], [0, 0]);
      if (pointInGeometry(c as [number, number], b.geometry)) h = rh;
    }
    if (h > 0) map.setFeatureState({ source: 'atlas', id: b.id }, { modelled: false, h });
  }
}

/** Kattintás 3D-ben egy modellre: melyik atlasz-épülethez tartozik. */
export function modelAtlasIdAt(map: MLMap, point: { x: number; y: number }): string | null {
  if (!map.getLayer('models-3d')) return null;
  const f = map.queryRenderedFeatures([point.x, point.y], { layers: ['models-3d'] })[0];
  return (f?.properties?.atlasId as string | undefined) ?? null;
}
