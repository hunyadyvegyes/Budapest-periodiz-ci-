import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MLMap, StyleSpecification, GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// A MapLibre 6 külön ES-modul workert használ; a bundlernek explicit URL-t adunk.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(workerUrl);
import { useFiltered, useStore } from '../state/store';
import { toMapFeatures, toMapPoints } from './features';
import { bboxOf } from '../domain/geo';

const BASEMAP_URL = import.meta.env.VITE_BASEMAP_STYLE || 'https://tiles.openfreemap.org/styles/positron';

/** Tartalék stílus, ha az alaptérkép nem érhető el (offline / tiltott hálózat). */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ece8e0' } }],
};

const BUDAPEST: [number, number] = [19.058, 47.4995];
const ATLAS_LAYERS = ['atlas-fill', 'atlas-extrusion', 'atlas-points'];

function baseBuildingLayerIds(map: MLMap): string[] {
  return (map.getStyle()?.layers ?? [])
    .filter((l) => 'source-layer' in l && (l as { 'source-layer'?: string })['source-layer'] === 'building')
    .map((l) => l.id);
}

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [ready, setReady] = useState(0); // növekszik minden style.load után
  const [basemapFailed, setBasemapFailed] = useState(false);
  const fittedRef = useRef(false);

  const filtered = useFiltered();
  const total = useStore((s) => s.buildings.length);
  const selectedId = useStore((s) => s.selectedId);
  const baseSelection = useStore((s) => s.baseSelection);
  const mapMode = useStore((s) => s.mapMode);
  const showBase = useStore((s) => s.showBaseBuildings);
  const flyTo = useStore((s) => s.flyTo);

  // --- térkép létrehozása -------------------------------------------------
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: BASEMAP_URL,
      center: BUDAPEST,
      zoom: 14.2,
      maxBounds: [[18.75, 47.3], [19.4, 47.65]],
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true },
    } as maplibregl.MapOptions);
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map: MLMap }).__map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    let styleLoaded = false;
    const fallback = () => {
      if (styleLoaded) return;
      setBasemapFailed(true);
      map.setStyle(FALLBACK_STYLE);
    };
    const timer = setTimeout(fallback, 8000);
    map.on('error', (e) => {
      const msg = String((e as unknown as { error?: { message?: string } }).error?.message ?? '');
      if (!styleLoaded && /style|fetch|Failed/i.test(msg)) fallback();
    });
    map.on('style.load', () => {
      styleLoaded = true;
      clearTimeout(timer);
      addAtlasLayers(map);
      setReady((r) => r + 1);
    });

    // interakció
    map.on('mousemove', (e) => {
      const layers = ATLAS_LAYERS.filter((l) => map.getLayer(l));
      const feats = layers.length ? map.queryRenderedFeatures(e.point, { layers }) : [];
      const baseLayers = useStore.getState().showBaseBuildings ? baseBuildingLayerIds(map) : [];
      const baseHit = !feats.length && baseLayers.length && map.queryRenderedFeatures(e.point, { layers: baseLayers }).length;
      map.getCanvas().style.cursor = feats.length || baseHit ? 'pointer' : '';
      if (feats.length) {
        const p = feats[0].properties as Record<string, string>;
        const html = `<strong>${escapeHtml(p.label)}</strong><br/><span>${escapeHtml(p.yearLabel)}</span>${p.isDemo === 'true' || (p.isDemo as unknown) === true ? '<br/><em class="demo-tag">DEMO</em>' : ''}`;
        if (!popupRef.current) popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'hover-popup' });
        popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
      } else popupRef.current?.remove();
    });
    map.on('mouseout', () => popupRef.current?.remove());
    map.on('click', (e) => {
      const st = useStore.getState();
      const layers = ATLAS_LAYERS.filter((l) => map.getLayer(l));
      const feats = layers.length ? map.queryRenderedFeatures(e.point, { layers }) : [];
      if (feats.length) {
        st.select(String(feats[0].properties.id));
        return;
      }
      if (st.showBaseBuildings) {
        const base = map.queryRenderedFeatures(e.point, { layers: baseBuildingLayerIds(map) });
        const g = base[0]?.geometry;
        if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
          st.setBaseSelection({ geometry: g, props: { ...base[0].properties } });
          return;
        }
      }
      st.select(null);
    });

    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // --- adatok frissítése -------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource('atlas') as GeoJSONSource | undefined;
    src?.setData(toMapFeatures(filtered));
    (map.getSource('atlas-points') as GeoJSONSource | undefined)?.setData(toMapPoints(filtered));
    if (!fittedRef.current && filtered.length) {
      // Csak DEMO adatnál a belső-pesti tömbökre közelítünk; valós adatnál a teljes kiterjedésre.
      const real = filtered.filter((b) => !b.isDemo);
      if (!real.length) {
        map.jumpTo({ center: [19.0585, 47.5005], zoom: 14.75 });
        fittedRef.current = true;
        return;
      }
      const bb = bboxOf(real.map((b) => b.geometry));
      if (bb) map.fitBounds(bb, { padding: 60, duration: 0, maxZoom: 15.5 });
      fittedRef.current = true;
    }
  }, [filtered, ready]);

  // --- kijelölés ----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const id = selectedId ?? '__none__';
    for (const l of ['atlas-selected', 'atlas-selected-halo', 'atlas-selected-extrusion'])
      if (map.getLayer(l)) map.setFilter(l, ['==', ['get', 'id'], id]);
    const src = map.getSource('base-selection') as GeoJSONSource | undefined;
    src?.setData(
      baseSelection
        ? { type: 'Feature', geometry: baseSelection.geometry, properties: {} }
        : { type: 'FeatureCollection', features: [] },
    );
  }, [selectedId, baseSelection, ready]);

  // --- 2D / 3D -----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const is3d = mapMode === '3d';
    const vis = (l: string, on: boolean) => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none');
    vis('atlas-fill', !is3d);
    vis('atlas-outline', !is3d);
    vis('atlas-uncertain', !is3d);
    vis('atlas-selected-halo', !is3d);
    vis('atlas-extrusion', is3d);
    vis('atlas-selected-extrusion', is3d);
    map.easeTo({ pitch: is3d ? 58 : 0, bearing: is3d ? -20 : 0, duration: 900 });
    // alaptérképi 3D épületek (ha a stílus tartalmaz ilyet) csak 3D-ben
    for (const id of baseBuildingLayerIds(map)) {
      const layer = map.getLayer(id);
      if (layer?.type === 'fill-extrusion') map.setLayoutProperty(id, 'visibility', is3d && showBase ? 'visible' : 'none');
    }
  }, [mapMode, ready, showBase]);

  // --- alaptérképi (OSM) kontúrok --------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const id of baseBuildingLayerIds(map)) {
      const layer = map.getLayer(id);
      if (!layer || layer.type === 'fill-extrusion') continue;
      map.setLayoutProperty(id, 'visibility', showBase ? 'visible' : 'none');
      if (layer.type === 'fill') {
        map.setPaintProperty(id, 'fill-color', '#d6d2ca');
        map.setPaintProperty(id, 'fill-outline-color', '#a9a49a');
      }
    }
  }, [showBase, ready]);

  // --- odarepülés -----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo({ center: flyTo.center, zoom: Math.max(map.getZoom(), 16.5), duration: 900 });
  }, [flyTo]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" />
      {basemapFailed && (
        <div className="map-notice">
          Az alaptérkép ({new URL(BASEMAP_URL).host}) nem érhető el – egyszerűsített háttér látható. Az adatréteg működik.
        </div>
      )}
      <div className="map-count">
        <strong>{filtered.length.toLocaleString('hu')}</strong> / {total.toLocaleString('hu')} rekord látható
      </div>
    </div>
  );
}

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function addAtlasLayers(map: MLMap) {
  if (map.getSource('atlas')) return;
  // első szimbólumréteg alá szúrjuk be, hogy a feliratok felül maradjanak
  const firstSymbol = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;

  map.addSource('atlas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
  map.addSource('atlas-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('base-selection', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  map.addLayer(
    {
      id: 'atlas-fill',
      type: 'fill',
      source: 'atlas',
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': ['case', ['get', 'approx'], 0.45, 0.88],
      },
    },
    firstSymbol,
  );
  map.addLayer(
    {
      id: 'atlas-outline',
      type: 'line',
      source: 'atlas',
      filter: ['!', ['get', 'uncertain']],
      paint: { 'line-color': 'rgba(40,32,24,0.55)', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.2, 17, 1] },
    },
    firstSymbol,
  );
  // bizonytalan (valószínűsített / intervallumos) évek: szaggatott körvonal
  map.addLayer(
    {
      id: 'atlas-uncertain',
      type: 'line',
      source: 'atlas',
      filter: ['get', 'uncertain'],
      paint: {
        'line-color': 'rgba(40,32,24,0.8)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.4, 17, 1.4],
        'line-dasharray': [2, 1.5],
      },
    },
    firstSymbol,
  );
  map.addLayer({
    id: 'atlas-extrusion',
    type: 'fill-extrusion',
    source: 'atlas',
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': ['get', 'color'],
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-vertical-gradient': true,
    },
  });
  map.addLayer({
    id: 'atlas-selected-extrusion',
    type: 'fill-extrusion',
    source: 'atlas',
    filter: ['==', ['get', 'id'], '__none__'],
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': '#ffd23f',
      'fill-extrusion-height': ['+', ['get', 'height'], 0.6],
      'fill-extrusion-opacity': 1,
    },
  });
  // Kis nagyításnál pontok, hogy a városi áttekintésben is látszódjanak az épületek
  map.addLayer({
    id: 'atlas-points',
    type: 'circle',
    source: 'atlas-points',
    maxzoom: 15,
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 14, 5],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.2,
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 1, 15, 0],
      'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 1, 15, 0],
    },
  });
  map.addLayer({
    id: 'atlas-selected-halo',
    type: 'line',
    source: 'atlas',
    filter: ['==', ['get', 'id'], '__none__'],
    paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'atlas-selected',
    type: 'line',
    source: 'atlas',
    filter: ['==', ['get', 'id'], '__none__'],
    paint: { 'line-color': '#111', 'line-width': 3 },
  });
  map.addLayer({
    id: 'base-selection-line',
    type: 'line',
    source: 'base-selection',
    paint: { 'line-color': '#1f4fa3', 'line-width': 3, 'line-dasharray': [1.5, 1] },
  });

  // Kerülethatárok az OpenMapTiles sémájú alaptérképből (admin_level 9), ha elérhető
  const omt = map.getSource('openmaptiles');
  if (omt) {
    try {
      map.addLayer(
        {
          id: 'district-boundaries',
          type: 'line',
          source: 'openmaptiles',
          'source-layer': 'boundary',
          filter: ['in', ['get', 'admin_level'], ['literal', [9, 10]]],
          paint: { 'line-color': '#7a6a55', 'line-width': 1.2, 'line-dasharray': [3, 2], 'line-opacity': 0.7 },
        },
        firstSymbol,
      );
    } catch { /* a stílus nem tartalmaz határréteget */ }
  }
  // Opcionális kerülethatár-állomány (scripts/fetch-osm.mjs)
  fetch(`${import.meta.env.BASE_URL}data/districts.geojson`)
    .then((r) => (r.ok ? r.json() : null))
    .then((fc) => {
      if (!fc || map.getSource('districts')) return;
      map.addSource('districts', { type: 'geojson', data: fc });
      map.addLayer({ id: 'districts-line', type: 'line', source: 'districts', paint: { 'line-color': '#5b4a36', 'line-width': 1.6, 'line-opacity': 0.75 } }, 'atlas-fill');
    })
    .catch(() => {});
}

