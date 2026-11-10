import type { Building } from '../domain/types';
import { featureToBuilding } from '../domain/io';

/**
 * Adattár-absztrakció: a térkép és a felület csak ezen keresztül éri el az adatokat,
 * így a helyi (böngészős) tároló később Supabase/PostGIS háttérre cserélhető
 * (lásd supabase/schema.sql és SupabaseRepository vázlat lent).
 */
export interface BuildingRepository {
  readonly kind: string;
  loadAll(): Promise<Building[]>;
  upsert(b: Building): Promise<void>;
  upsertMany(list: Building[]): Promise<void>;
  remove(id: string): Promise<void>;
  /** Helyi módosítások törlése (csak a helyi tárolónál értelmes). */
  reset?(): Promise<void>;
}

const LS_KEY = 'bpatlasz.local.v1';
const API = '/api/sajat-adatok';

interface LocalState {
  upserts: Record<string, Building>;
  deleted: string[];
}

const emptyState = (): LocalState => ({ upserts: {}, deleted: [] });

function readLS(): LocalState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as LocalState;
  } catch { /* privát mód / letiltott tároló */ }
  return null;
}
function writeLS(s: LocalState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('A böngészős mentés nem sikerült', e);
  }
}

async function fetchCollection(url: string): Promise<Building[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const fc = await res.json();
    return (fc.features ?? []).map((f: GeoJSON.Feature) => featureToBuilding(f)).filter(Boolean) as Building[];
  } catch {
    return [];
  }
}

export type SaveTarget = 'file' | 'browser';

/**
 * Helyi tároló: statikus GeoJSON-állományok (demo, OSM, kvíz) + a saját módosítások.
 * A saját módosítások helye:
 *  - 'file':    public/data/sajat-modositasok.json a projekt mappájában (ha a helyi szerver fut)
 *  - 'browser': a böngésző localStorage-a (pl. statikus tárhelyre feltöltött változatnál)
 */
export class LocalRepository implements BuildingRepository {
  readonly kind = 'local';
  target: SaveTarget = 'browser';
  private state: LocalState = emptyState();

  constructor(private datasets: string[]) {}

  private async loadState(): Promise<void> {
    try {
      const res = await fetch(API);
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
        this.target = 'file';
        this.state = await res.json();
        // Korábban a böngészőbe mentett módosítások áthelyezése a fájlba
        const ls = readLS();
        if (ls && (Object.keys(ls.upserts).length || ls.deleted.length)) {
          this.state = {
            upserts: { ...ls.upserts, ...this.state.upserts },
            deleted: [...new Set([...this.state.deleted, ...ls.deleted])],
          };
          await this.persist();
          try { localStorage.removeItem(LS_KEY); } catch { /* */ }
        }
        return;
      }
    } catch { /* nincs helyi szerver */ }
    this.target = 'browser';
    // Statikus változat: a buildbe került fájl + a böngésző saját rétege
    let base = emptyState();
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/sajat-modositasok.json`);
      if (r.ok) base = await r.json();
    } catch { /* */ }
    const ls = readLS() ?? emptyState();
    this.state = { upserts: { ...base.upserts, ...ls.upserts }, deleted: [...new Set([...base.deleted, ...ls.deleted])] };
  }

  private async persist(): Promise<void> {
    if (this.target === 'file') {
      const res = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.state) });
      if (!res.ok) throw new Error('A mentés a projektmappába nem sikerült: ' + (await res.text()));
    } else {
      writeLS(this.state);
    }
  }

  async loadAll(): Promise<Building[]> {
    const [lists] = await Promise.all([Promise.all(this.datasets.map(fetchCollection)), this.loadState()]);
    const byId = new Map<string, Building>();
    for (const list of lists) for (const b of list) byId.set(b.id, b);
    for (const id of this.state.deleted) byId.delete(id);
    for (const b of Object.values(this.state.upserts)) byId.set(b.id, b);
    return [...byId.values()];
  }
  async upsert(b: Building) {
    this.state.upserts[b.id] = b;
    this.state.deleted = this.state.deleted.filter((d) => d !== b.id);
    await this.persist();
  }
  async upsertMany(list: Building[]) {
    for (const b of list) this.state.upserts[b.id] = b;
    const ids = new Set(list.map((b) => b.id));
    this.state.deleted = this.state.deleted.filter((d) => !ids.has(d));
    await this.persist();
  }
  async remove(id: string) {
    delete this.state.upserts[id];
    if (!this.state.deleted.includes(id)) this.state.deleted.push(id);
    await this.persist();
  }
  async reset() {
    this.state = emptyState();
    await this.persist();
    try { localStorage.removeItem(LS_KEY); } catch { /* */ }
  }
}

/**
 * Supabase/PostGIS adattár – VÁZLAT a második fázishoz.
 * A `buildings_geojson` nézet a sémában GeoJSON-t ad vissza, így a kliensoldali
 * modell változatlan maradhat. Aktiváláshoz: npm i @supabase/supabase-js,
 * VITE_SUPABASE_URL és VITE_SUPABASE_ANON_KEY beállítása.
 */
// export class SupabaseRepository implements BuildingRepository { ... }

export function createRepository(): LocalRepository {
  return new LocalRepository([
    `${import.meta.env.BASE_URL}data/demo-buildings.geojson`,
    // A scripts/fetch-osm.mjs által előállított valós OSM-állomány, ha létezik:
    `${import.meta.env.BASE_URL}data/osm-buildings.geojson`,
    // Kvízapplikáció budapesti épületei, ellenőrzött címmel (data-work/build.py)
    `${import.meta.env.BASE_URL}data/quiz-buildings.geojson`,
  ]);
}
