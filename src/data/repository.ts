import type { Building } from '../domain/types';
import { featureToBuilding } from '../domain/io';
import { loadConfig } from './config';
import { getSupabase } from './supabase';

/**
 * Adattár. A térkép és a felület csak ezen keresztül éri el az adatokat.
 *
 * Az épületek két rétegből állnak össze:
 *  1. beépített adatkészletek (statikus GeoJSON-fájlok: kvízépületek, opcionális OSM- és DEMO-adat),
 *  2. saját felvitelek és módosítások (új épületek, szerkesztések, törlések).
 *
 * A 2. réteg helye ("mentés célja"):
 *  - 'online':  Supabase-adatbázis – ha a weboldalhoz be van állítva (config.json); írni bejelentkezve lehet
 *  - 'file':    public/data/sajat-modositasok.json – ha az alkalmazás helyben, `npm run dev`-vel fut
 *  - 'browser': a böngésző saját tárhelye – tartalék, pl. online adatbázis nélküli közzétételnél
 */

export type SaveTarget = 'online' | 'file' | 'browser';

export interface Overlay {
  upserts: Record<string, Building>;
  deleted: string[];
}
const emptyOverlay = (): Overlay => ({ upserts: {}, deleted: [] });

interface Backend {
  target: SaveTarget;
  load(): Promise<Overlay>;
  put(list: Building[]): Promise<void>;
  del(ids: string[]): Promise<void>;
  reset?(): Promise<void>;
}

/* ---------------- böngésző ---------------- */
const LS_KEY = 'bpatlasz.local.v1';
function readLS(): Overlay | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Overlay;
  } catch { /* privát mód / letiltott tároló */ }
  return null;
}
function clearLS() {
  try { localStorage.removeItem(LS_KEY); } catch { /* */ }
}

/** Közös logika a „teljes állapotot egyben mentő” háttértárakhoz (fájl, böngésző). */
abstract class WholeStateBackend implements Backend {
  abstract target: SaveTarget;
  protected state = emptyOverlay();
  abstract load(): Promise<Overlay>;
  protected abstract persist(): Promise<void>;
  async put(list: Building[]) {
    for (const b of list) this.state.upserts[b.id] = b;
    const ids = new Set(list.map((b) => b.id));
    this.state.deleted = this.state.deleted.filter((d) => !ids.has(d));
    await this.persist();
  }
  async del(ids: string[]) {
    for (const id of ids) {
      delete this.state.upserts[id];
      if (!this.state.deleted.includes(id)) this.state.deleted.push(id);
    }
    await this.persist();
  }
  async reset() {
    this.state = emptyOverlay();
    await this.persist();
    clearLS();
  }
}

class BrowserBackend extends WholeStateBackend {
  target: SaveTarget = 'browser';
  async load() {
    // a közzétett változatba beépült fájl + a böngésző saját rétege
    let base = emptyOverlay();
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/sajat-modositasok.json`);
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) base = await r.json();
    } catch { /* */ }
    const ls = readLS() ?? emptyOverlay();
    this.state = { upserts: { ...base.upserts, ...ls.upserts }, deleted: [...new Set([...base.deleted, ...ls.deleted])] };
    return this.state;
  }
  protected async persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.state));
    } catch {
      throw new Error('A böngésző nem engedi a mentést (privát mód?).');
    }
  }
}

const API = '/api/sajat-adatok';
class FileBackend extends WholeStateBackend {
  target: SaveTarget = 'file';
  static async available(): Promise<boolean> {
    // csak a saját gépen futó fejlesztői szerver tud fájlba írni
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return false;
    try {
      const res = await fetch(API);
      return res.ok && (res.headers.get('content-type') ?? '').includes('json');
    } catch {
      return false;
    }
  }
  async load() {
    this.state = await (await fetch(API)).json();
    // korábban a böngészőbe mentett módosítások áthelyezése a fájlba
    const ls = readLS();
    if (ls && (Object.keys(ls.upserts).length || ls.deleted.length)) {
      this.state = { upserts: { ...ls.upserts, ...this.state.upserts }, deleted: [...new Set([...this.state.deleted, ...ls.deleted])] };
      await this.persist();
      clearLS();
    }
    return this.state;
  }
  protected async persist() {
    const res = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.state) });
    if (!res.ok) throw new Error('A mentés a projektmappába nem sikerült: ' + (await res.text()));
  }
}

/* ---------------- online (Supabase) ---------------- */
class OnlineBackend implements Backend {
  target: SaveTarget = 'online';
  async load(): Promise<Overlay> {
    const sb = await getSupabase();
    const out = emptyOverlay();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb!.from('buildings').select('id,data,deleted').order('id').range(from, from + PAGE - 1);
      if (error) throw new Error('Az online adatbázis nem érhető el: ' + error.message);
      for (const r of data ?? []) {
        if (r.deleted) out.deleted.push(r.id);
        else out.upserts[r.id] = r.data as Building;
      }
      if (!data || data.length < PAGE) break;
    }
    return out;
  }
  async put(list: Building[]) {
    const sb = await getSupabase();
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500).map((b) => ({ id: b.id, data: b, deleted: false }));
      const { error } = await sb!.from('buildings').upsert(chunk);
      if (error) throw new Error(friendly(error.message));
    }
  }
  async del(ids: string[]) {
    const sb = await getSupabase();
    // „puha” törlés: a beépített (fájlból jövő) rekordokat is így lehet elrejteni
    const { error } = await sb!.from('buildings').upsert(ids.map((id) => ({ id, data: {}, deleted: true })));
    if (error) throw new Error(friendly(error.message));
  }
}

function friendly(msg: string) {
  if (/row-level security|permission|JWT|not authorized/i.test(msg)) return 'A mentéshez be kell jelentkezned szerkesztőként.';
  return 'Az online mentés nem sikerült: ' + msg;
}

/* ---------------- adattár ---------------- */
async function fetchCollection(url: string): Promise<Building[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return []; // hiányzó fájl; a JSON-hiba (pl. HTML-válasz) lent kezelve
    const fc = await res.json();
    return (fc.features ?? []).map((f: GeoJSON.Feature) => featureToBuilding(f)).filter(Boolean) as Building[];
  } catch {
    return [];
  }
}

const DATASETS = [
  'data/demo-buildings.geojson',
  'data/osm-buildings.geojson', // scripts/fetch-osm.mjs, ha létezik
  'data/quiz-buildings.geojson', // a kvízapplikáció budapesti épületei (data-work/build.py)
];

export class AtlasRepository {
  private backend: Backend | null = null;
  get target(): SaveTarget {
    return this.backend?.target ?? 'browser';
  }

  private async pickBackend(): Promise<Backend> {
    if (this.backend) return this.backend;
    const cfg = await loadConfig();
    if (cfg.supabaseUrl && cfg.supabaseKey) this.backend = new OnlineBackend();
    else if (await FileBackend.available()) this.backend = new FileBackend();
    else this.backend = new BrowserBackend();
    return this.backend;
  }

  async loadAll(): Promise<Building[]> {
    const backend = await this.pickBackend();
    const [lists, overlay] = await Promise.all([
      Promise.all(DATASETS.map((p) => fetchCollection(import.meta.env.BASE_URL + p))),
      backend.load(),
    ]);
    const byId = new Map<string, Building>();
    for (const list of lists) for (const b of list) byId.set(b.id, b);
    for (const id of overlay.deleted) byId.delete(id);
    for (const b of Object.values(overlay.upserts)) byId.set(b.id, b);
    return [...byId.values()];
  }
  async upsert(b: Building) {
    await (await this.pickBackend()).put([b]);
  }
  async upsertMany(list: Building[]) {
    await (await this.pickBackend()).put(list);
  }
  async remove(id: string) {
    await (await this.pickBackend()).del([id]);
  }
  /** Csak helyi (fájl/böngésző) módnál: minden saját módosítás törlése. */
  async reset() {
    const b = await this.pickBackend();
    if (!b.reset) throw new Error('Az online adatbázist innen nem lehet kiüríteni.');
    await b.reset();
  }
}

export function createRepository(): AtlasRepository {
  return new AtlasRepository();
}
