import { create } from 'zustand';
import type { Building } from '../domain/types';
import { EMPTY_FILTER, type FilterState, applyFilter } from '../domain/filter';
import { createRepository } from '../data/repository';

export type View = 'map' | 'stats' | 'data';
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
  baseSelection: { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; props: Record<string, unknown> } | null;
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
  flyTo: null,
  toast: null,

  async load() {
    set({ loading: true });
    const buildings = await repo.loadAll();
    // Ha valós (nem demo) adat is van, az alaptérképi kontúrok bekapcsolása hasznos
    set({ buildings, loading: false });
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
    await repo.upsert(updated);
    const list = get().buildings.filter((x) => x.id !== b.id);
    set({ buildings: [...list, updated], editing: null, selectedId: b.id, baseSelection: null });
    get().notify('Rekord mentve (helyi tároló).');
  },
  async saveMany(list) {
    await repo.upsertMany(list);
    const ids = new Set(list.map((b) => b.id));
    set({ buildings: [...get().buildings.filter((b) => !ids.has(b.id)), ...list] });
  },
  async remove(id) {
    await repo.remove(id);
    set({ buildings: get().buildings.filter((b) => b.id !== id), selectedId: null, detailOpen: false });
    get().notify('Rekord törölve.');
  },
  async resetLocal() {
    await repo.reset?.();
    await get().load();
    get().notify('Helyi módosítások törölve, az eredeti adatkészlet betöltve.');
  },
  notify(msg) {
    set({ toast: msg });
    setTimeout(() => { if (get().toast === msg) set({ toast: null }); }, 3500);
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
