import { create } from 'zustand';
import type { Building } from '../domain/types';
import { EMPTY_FILTER, type FilterState, applyFilter } from '../domain/filter';
import { createRepository, type SaveTarget } from '../data/repository';
import { currentSession, onAuthChange, signIn as sbSignIn, signOut as sbSignOut, type EditorSession } from '../data/supabase';

export type View = 'map' | 'stats' | 'data' | 'import';
export type MapMode = '2d' | '3d' | 'google3d';

const repo = createRepository();

interface AppState {
  buildings: Building[];
  loading: boolean;
  filter: FilterState;
  selectedId: string | null;
  detailOpen: boolean;
  editing: Building | null;
  view: View;
  mapMode: MapMode;
  leftOpen: boolean;
  rightOpen: boolean;
  showBaseBuildings: boolean;
  /** kijelölt OSM-alaptérképi épület (még nincs az adatbázisban) */
  baseSelection: { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; props: Record<string, unknown>; lngLat: [number, number]; ts: number } | null;
  /** hova menti a saját adatokat: projektmappa-fájlba vagy a böngészőbe */
  saveTarget: SaveTarget;
  /** bejelentkezett szerkesztő (csak online módban számít) */
  session: EditorSession | null;
  loginOpen: boolean;
  loadError: string | null;
  flyTo: { center: [number, number]; ts: number } | null;
  toast: string | null;

  load(): Promise<void>;
  setFilter(patch: Partial<FilterState>): void;
  resetFilter(): void;
  select(id: string | null, fly?: boolean): void;
  setBaseSelection(s: AppState['baseSelection']): void;
  openDetail(open: boolean): void;
  setView(v: View): void;
  setMapMode(m: MapMode): void;
  toggleLeft(): void;
  toggleRight(): void;
  setShowBaseBuildings(v: boolean): void;
  startEdit(b: Building | null): void;
  save(b: Building): Promise<void>;
  saveMany(list: Building[]): Promise<void>;
  remove(id: string): Promise<void>;
  resetLocal(): Promise<void>;
  notify(msg: string): void;
  setLoginOpen(v: boolean): void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

/** Szerkeszthet-e a felhasználó: helyi módban mindig, online módban bejelentkezve. */
export function canEdit(s: Pick<AppState, 'saveTarget' | 'session'>): boolean {
  return s.saveTarget !== 'online' || s.session != null;
}

export const useStore = create<AppState>((set, get) => ({
  buildings: [],
  loading: true,
  filter: EMPTY_FILTER,
  selectedId: null,
  detailOpen: false,
  editing: null,
  view: 'map',
  mapMode: '2d',
  leftOpen: true,
  rightOpen: true,
  showBaseBuildings: false,
  baseSelection: null,
  saveTarget: 'browser',
  session: null,
  loginOpen: false,
  loadError: null,
  flyTo: null,
  toast: null,

  async load() {
    set({ loading: true, loadError: null });
    let buildings: Building[] = [];
    try {
      buildings = await repo.loadAll();
    } catch (e) {
      set({ loadError: (e as Error).message });
    }
    const session = repo.target === 'online' ? await currentSession() : null;
    if (repo.target === 'online') onAuthChange((s) => set({ session: s }));
    // Ha van valós (nem DEMO) adat: a DEMO rekordok alapból rejtve, az OSM-alapkontúrok láthatók
    const hasReal = buildings.some((b) => !b.isDemo);
    set({
      buildings,
      loading: false,
      saveTarget: repo.target,
      session,
      ...(hasReal ? { filter: { ...get().filter, showDemo: false }, showBaseBuildings: true } : {}),
    });
  },
  setFilter(patch) {
    set({ filter: { ...get().filter, ...patch } });
  },
  resetFilter() {
    set({ filter: { ...EMPTY_FILTER, showDemo: get().filter.showDemo } });
  },
  select(id, fly = false) {
    const b = id ? get().buildings.find((x) => x.id === id) : undefined;
    set({
      selectedId: id,
      baseSelection: null,
      rightOpen: id ? true : get().rightOpen,
      flyTo: fly && b ? { center: b.centroid, ts: Date.now() } : get().flyTo,
    });
  },
  setBaseSelection(s) {
    set({ baseSelection: s, selectedId: null, rightOpen: s ? true : get().rightOpen });
  },
  openDetail(open) { set({ detailOpen: open }); },
  setView(v) { set({ view: v }); },
  setMapMode(m) { set({ mapMode: m }); },
  toggleLeft() { set({ leftOpen: !get().leftOpen }); },
  toggleRight() { set({ rightOpen: !get().rightOpen }); },
  setShowBaseBuildings(v) { set({ showBaseBuildings: v }); },
  startEdit(b) { set({ editing: b }); },
  async save(b) {
    const updated = { ...b, updatedAt: new Date().toISOString() };
    try {
      await repo.upsert(updated);
    } catch (e) {
      get().notify(`Hiba: ${(e as Error).message}`);
      throw e;
    }
    const list = get().buildings.filter((x) => x.id !== b.id);
    set({ buildings: [...list, updated], editing: null, selectedId: b.id, baseSelection: null });
    get().notify(
      repo.target === 'online' ? 'Mentve az online adatbázisba.' : repo.target === 'file' ? 'Mentve a projektmappába (public/data/sajat-modositasok.json).' : 'Mentve ebbe a böngészőbe.',
    );
  },
  async saveMany(list) {
    await repo.upsertMany(list);
    const ids = new Set(list.map((b) => b.id));
    set({ buildings: [...get().buildings.filter((b) => !ids.has(b.id)), ...list] });
  },
  async remove(id) {
    try {
      await repo.remove(id);
    } catch (e) {
      get().notify(`Hiba: ${(e as Error).message}`);
      return;
    }
    set({ buildings: get().buildings.filter((b) => b.id !== id), selectedId: null, detailOpen: false });
    get().notify('Rekord törölve.');
  },
  async resetLocal() {
    try {
      await repo.reset();
    } catch (e) {
      get().notify((e as Error).message);
      return;
    }
    await get().load();
    get().notify('Helyi módosítások törölve, az eredeti adatkészlet betöltve.');
  },
  setLoginOpen(v) { set({ loginOpen: v }); },
  async signIn(email, password) {
    const session = await sbSignIn(email, password);
    set({ session, loginOpen: false });
    get().notify(`Bejelentkezve: ${session.email}`);
  },
  async signOut() {
    await sbSignOut();
    set({ session: null });
    get().notify('Kijelentkeztél.');
  },
  notify(msg) {
    set({ toast: msg });
    setTimeout(() => { if (get().toast === msg) set({ toast: null }); }, 4500);
  },
}));

/** Szűrt lista – memoizálva a buildings/filter referenciákra. */
let memo: { b: Building[]; f: FilterState; r: Building[] } | null = null;
export function useFiltered(): Building[] {
  const buildings = useStore((s) => s.buildings);
  const filter = useStore((s) => s.filter);
  if (!memo || memo.b !== buildings || memo.f !== filter) memo = { b: buildings, f: filter, r: applyFilter(buildings, filter) };
  return memo.r;
}

export function useSelected(): Building | null {
  return useStore((s) => (s.selectedId ? s.buildings.find((b) => b.id === s.selectedId) ?? null : null));
}

export const hasGoogleKey = Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
