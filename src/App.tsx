import { Suspense, lazy, useEffect } from 'react';
import { hasGoogleKey, useStore } from './state/store';
import MapView from './map/MapView';
import FilterPanel from './components/FilterPanel';
import BuildingPanel from './components/BuildingPanel';
import Legend from './components/Legend';
import Timeline from './components/Timeline';
import DetailModal from './components/DetailModal';
import EditForm from './components/EditForm';
import type { MapMode, View } from './state/store';

const StatsView = lazy(() => import('./views/StatsView'));
const DataView = lazy(() => import('./views/DataView'));
const Google3DView = lazy(() => import('./map/Google3DView'));

const VIEWS: { id: View; label: string }[] = [
  { id: 'map', label: 'Térkép' },
  { id: 'stats', label: 'Statisztika' },
  { id: 'data', label: 'Adatkezelés' },
];

export default function App() {
  const load = useStore((s) => s.load);
  const loading = useStore((s) => s.loading);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const mapMode = useStore((s) => s.mapMode);
  const setMapMode = useStore((s) => s.setMapMode);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const toggleLeft = useStore((s) => s.toggleLeft);
  const toggleRight = useStore((s) => s.toggleRight);
  const toast = useStore((s) => s.toast);
  const hasDemo = useStore((s) => s.buildings.some((b) => b.isDemo));

  useEffect(() => { load(); }, [load]);

  const modes: { id: MapMode; label: string; disabled?: boolean; title?: string }[] = [
    { id: '2d', label: '2D' },
    { id: '3d', label: '3D' },
    { id: 'google3d', label: 'Google 3D', disabled: !hasGoogleKey, title: hasGoogleKey ? 'Fotorealisztikus 3D (Google Maps Platform)' : 'Ehhez VITE_GOOGLE_MAPS_API_KEY szükséges' },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>▦</span>
          <div>
            <h1>Budapest Építészettörténeti Atlasz</h1>
            <span className="brand-sub">prototípus · 1. fázis</span>
          </div>
          {hasDemo && <span className="demo-badge" title="Az adatbázis generált tesztrekordokat tartalmaz">DEMO ADATOK</span>}
        </div>
        <nav className="tabs" aria-label="Nézetek">
          {VIEWS.map((v) => (
            <button key={v.id} className={`tab ${view === v.id ? 'on' : ''}`} onClick={() => setView(v.id)}>{v.label}</button>
          ))}
        </nav>
        <div className="modes" role="group" aria-label="Térképnézet">
          {modes.map((m) => (
            <button
              key={m.id}
              className={`seg ${mapMode === m.id ? 'on' : ''}`}
              disabled={m.disabled}
              title={m.title}
              onClick={() => { setMapMode(m.id); setView('map'); }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      <main className={`main view-${view}`}>
        <aside className={`side left ${leftOpen ? 'open' : 'closed'}`} aria-label="Keresés és szűrés">
          {leftOpen && <FilterPanel />}
          <button className="collapse left" onClick={toggleLeft} title={leftOpen ? 'Panel elrejtése' : 'Keresés és szűrés'}>{leftOpen ? '‹' : '›'}</button>
        </aside>

        <section className="center">
          {view === 'map' && (
            <div className="map-stage">
              {mapMode === 'google3d' ? (
                <Suspense fallback={<div className="loading">Google 3D betöltése…</div>}><Google3DView /></Suspense>
              ) : (
                <MapView />
              )}
              <Legend />
              {loading && <div className="loading">Adatok betöltése…</div>}
            </div>
          )}
          {view === 'stats' && <Suspense fallback={<div className="loading">…</div>}><StatsView /></Suspense>}
          {view === 'data' && <Suspense fallback={<div className="loading">…</div>}><DataView /></Suspense>}
          {view !== 'data' && <Timeline />}
        </section>

        {view === 'map' && (
          <aside className={`side right ${rightOpen ? 'open' : 'closed'}`} aria-label="Épület adatlap">
            <button className="collapse right" onClick={toggleRight} title={rightOpen ? 'Panel elrejtése' : 'Adatlap'}>{rightOpen ? '›' : '‹'}</button>
            {rightOpen && <BuildingPanel />}
          </aside>
        )}
      </main>

      <DetailModal />
      <EditForm />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
