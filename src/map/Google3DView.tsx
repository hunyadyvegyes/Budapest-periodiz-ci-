import { useEffect, useRef, useState } from 'react';
import { useFiltered, useStore } from '../state/store';
import { colorOf } from '../domain/periods';
import { buildingHeight } from './features';
import type { Building } from '../domain/types';

/**
 * Google Maps Platform – fotorealisztikus 3D térkép (Map3DElement, maps3d könyvtár).
 * Csak akkor töltődik be, ha a VITE_GOOGLE_MAPS_API_KEY be van állítva, így a
 * díjköteles szolgáltatás teljesen kikapcsolható; a MapLibre 2D/3D nézet ettől független.
 *
 * Az adatbázis épületei saját, kihúzott (extruded) poligonrétegként jelennek meg
 * a Google 3D csempék felett, és kattinthatók.
 */

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const MAX_POLYGONS = 1500; // a böngésző teljesítménye és a költségek miatt

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { google?: any; __bpAtlasGmapsInit?: () => void }
}

let loader: Promise<any> | null = null;
function loadMaps3d(): Promise<any> {
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    if (!KEY) return reject(new Error('Nincs beállítva VITE_GOOGLE_MAPS_API_KEY.'));
    window.__bpAtlasGmapsInit = async () => {
      try {
        resolve(await window.google.maps.importLibrary('maps3d'));
      } catch (e) {
        reject(e);
      }
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=beta&loading=async&language=hu&region=HU&callback=__bpAtlasGmapsInit`;
    s.async = true;
    s.onerror = () => reject(new Error('A Google Maps JavaScript API nem tölthető be.'));
    document.head.appendChild(s);
  });
  return loader;
}

function hexToRgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function outerRing(b: Building): { lat: number; lng: number; altitude: number }[] {
  const ring = b.geometry.type === 'Polygon' ? b.geometry.coordinates[0] : b.geometry.coordinates[0][0];
  const h = buildingHeight(b);
  return ring.map(([lng, lat]) => ({ lat, lng, altitude: h }));
}

export default function Google3DView() {
  const host = useRef<HTMLDivElement>(null);
  const mapEl = useRef<any>(null);
  const libRef = useRef<any>(null);
  const polys = useRef<Map<string, any>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const filtered = useFiltered();
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const flyTo = useStore((s) => s.flyTo);

  useEffect(() => {
    let cancelled = false;
    loadMaps3d()
      .then((lib) => {
        if (cancelled || !host.current) return;
        libRef.current = lib;
        const center = filtered[0]?.centroid ?? [19.058, 47.4995];
        const el = new lib.Map3DElement({
          center: { lat: center[1], lng: center[0], altitude: 0 },
          range: 1800,
          tilt: 62,
          heading: -20,
          mode: 'HYBRID',
        });
        host.current.appendChild(el);
        mapEl.current = el;
        setReady(true);
      })
      .catch((e) => setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
      mapEl.current?.remove();
      mapEl.current = null;
      polys.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // poligonréteg szinkronizálása
  useEffect(() => {
    const el = mapEl.current, lib = libRef.current;
    if (!ready || !el || !lib) return;
    for (const p of polys.current.values()) p.remove();
    polys.current.clear();
    const Ctor = lib.Polygon3DInteractiveElement ?? lib.Polygon3DElement;
    for (const b of filtered.slice(0, MAX_POLYGONS)) {
      const color = colorOf(b);
      const poly = new Ctor({
        altitudeMode: 'RELATIVE_TO_GROUND',
        extruded: true,
        fillColor: hexToRgba(color, 0.78),
        strokeColor: hexToRgba('#1a1410', 0.6),
        strokeWidth: 1,
        drawsOccludedSegments: false,
      });
      poly.outerCoordinates = outerRing(b);
      poly.addEventListener?.('gmp-click', () => select(b.id));
      el.append(poly);
      polys.current.set(b.id, poly);
    }
  }, [filtered, ready, select]);

  // kiemelés
  useEffect(() => {
    for (const [id, p] of polys.current) {
      const b = filtered.find((x) => x.id === id);
      if (!b) continue;
      const sel = id === selectedId;
      p.fillColor = sel ? 'rgba(255, 210, 63, 0.95)' : hexToRgba(colorOf(b), 0.78);
      p.strokeColor = sel ? 'rgba(0,0,0,1)' : hexToRgba('#1a1410', 0.6);
      p.strokeWidth = sel ? 3 : 1;
    }
  }, [selectedId, filtered, ready]);

  useEffect(() => {
    const el = mapEl.current;
    if (!el || !flyTo) return;
    el.flyCameraTo?.({
      endCamera: { center: { lat: flyTo.center[1], lng: flyTo.center[0], altitude: 0 }, range: 450, tilt: 62, heading: el.heading ?? 0 },
      durationMillis: 1500,
    });
  }, [flyTo]);

  return (
    <div className="map-wrap">
      <div ref={host} className="map google3d" />
      {error && (
        <div className="map-overlay-msg">
          <h3>A Google 3D nézet nem érhető el</h3>
          <p>{error}</p>
          <p>
            Állítsd be a <code>VITE_GOOGLE_MAPS_API_KEY</code> környezeti változót (Maps JavaScript API és Map Tiles API engedélyezésével),
            vagy használd a kulcs nélkül is működő <strong>3D (MapLibre)</strong> nézetet.
          </p>
        </div>
      )}
      {ready && filtered.length > MAX_POLYGONS && (
        <div className="map-notice">
          A Google 3D nézet az első {MAX_POLYGONS} szűrt rekordot jeleníti meg ({filtered.length} helyett). Szűkítsd a szűrést.
        </div>
      )}
    </div>
  );
}
