import { Suspense, lazy, useEffect } from 'react';
import { hasGoogleKey, useStore } from './state/store';
import LoginDialog from './components/LoginDialog';
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
const ImportView = lazy(() => import('./views/ImportView'));
const Google3DView = lazy(() => import('./map/Google3DView'));

const VIEWS: { id: View; label: string }[] = [
  { id: 'map', label: 'Térkép' },
  { id: 'stats', label: 'Statisztika' },
  { id: 'import', label: 'Feltöltés' },
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
  const saveTarget = useStore((s) => s.saveTarget);
  const session = useStore((s) => s.session);
  const setLoginOpen = useStore((s) => s.setLoginOpen);
  const signOut = useStore((s) => s.signOut);
  const loadError = useStore((s) => s.loadError);
  const hasDemo = useStore((s) => s.filter.showDemo && s.buildings.some((b) => b.isDemo));

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
        <div className="account">
          {saveTarget === 'online' ? (
            session ? (
              <>
                <span className="who" title="Bejelentkezett szerkesztő">{session.email}</span>
                <button className="btn small ghost" onClick={signOut}>Kijelentkezés</button>
              </>
            ) : (
              <button className="btn small" onClick={() => setLoginOpen(true)}>Bejelentkezés</button>
            )
          ) : (
            <span className="who" title="A saját felvitelek mentési helye">{saveTarget === 'file' ? 'Mentés: projektmappa' : 'Mentés: ez a böngésző'}</span>
          )}
        </div>
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
        {view !== 'import' && (
          <aside className={`side left ${leftOpen ? 'open' : 'closed'}`} aria-label="Keresés és szűrés">
          {leftOpen && <FilterPanel />}
          <button className="collapse left" onClick={toggleLeft} title={leftOpen ? 'Panel elrejtése' : 'Keresés és szűrés'}>{leftOpen ? '‹' : '›'}</button>
        </aside>
        )}

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
          {view === 'import' && <Suspense fallback={<div className="loading">…</div>}><ImportView /></Suspense>}
          {(view === 'map' || view === 'stats') && <Timeline />}
        </section>

        {view === 'map' && (
          <aside className={`side right ${rightOpen ? 'open' : 'closed'}`} aria-label="Épület adatlap">
            <button className="collapse right" onClick={toggleRight} title={rightOpen ? 'Panel elrejtése' : 'Adatlap'}>{rightOpen ? '›' : '‹'}</button>
            {rightOpen && <BuildingPanel />}
          </aside>
        )}
      </main>

      {loadError && <div className="load-error" role="alert">{loadError}</div>}
      <DetailModal />
      <LoginDialog />
      <EditForm />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
