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

interface LocalState {
  upserts: Record<string, Building>;
  deleted: string[];
}

function readLocal(): LocalState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as LocalState;
  } catch { /* privát mód / letiltott tároló */ }
  return { upserts: {}, deleted: [] };
}
function writeLocal(s: LocalState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('A helyi mentés nem sikerült', e);
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

/**
 * Helyi tároló: statikus GeoJSON-állományok (demo + opcionális OSM-import)
 * + a böngésző localStorage-ában tárolt kézi módosítások.
 */
export class LocalRepository implements BuildingRepository {
  readonly kind = 'local';
  constructor(private datasets: string[]) {}

  async loadAll(): Promise<Building[]> {
    const lists = await Promise.all(this.datasets.map(fetchCollection));
    const byId = new Map<string, Building>();
    for (const list of lists) for (const b of list) byId.set(b.id, b);
    const local = readLocal();
    for (const id of local.deleted) byId.delete(id);
    for (const b of Object.values(local.upserts)) byId.set(b.id, b);
    return [...byId.values()];
  }
  async upsert(b: Building) {
    const s = readLocal();
    s.upserts[b.id] = b;
    s.deleted = s.deleted.filter((d) => d !== b.id);
    writeLocal(s);
  }
  async upsertMany(list: Building[]) {
    const s = readLocal();
    for (const b of list) {
      s.upserts[b.id] = b;
    }
    const ids = new Set(list.map((b) => b.id));
    s.deleted = s.deleted.filter((d) => !ids.has(d));
    writeLocal(s);
  }
  async remove(id: string) {
    const s = readLocal();
    delete s.upserts[id];
    if (!s.deleted.includes(id)) s.deleted.push(id);
    writeLocal(s);
  }
  async reset() {
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

export function createRepository(): BuildingRepository {
  return new LocalRepository([
    `${import.meta.env.BASE_URL}data/demo-buildings.geojson`,
    // A scripts/fetch-osm.mjs által előállított valós OSM-állomány, ha létezik:
    `${import.meta.env.BASE_URL}data/osm-buildings.geojson`,
  ]);
}
