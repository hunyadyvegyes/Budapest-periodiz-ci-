import type { ConstructionDate } from './types';
import { normalize } from './filter';

/** Tömeges feltöltés: egy táblázatsor egységesített formában. */
export interface ImportRow {
  line: number; // sor száma a táblázatban (fejléc = 1)
  name?: string;
  address?: string;
  district?: string;
  year?: string; // nyers, pl. "1936", "kb. 1936", "1935–1938"
  from?: number;
  to?: number;
  architects?: string;
  style?: string;
  function?: string;
  source?: string;
  sourceUrl?: string;
  note?: string;
}

type Field = Exclude<keyof ImportRow, 'line'>;

/** Elfogadott oszlopnevek (ékezet- és kisbetű-függetlenül). A kvíztábla oszlopai is. */
const HEADERS: Record<Field, string[]> = {
  name: ['nev', 'epulet', 'epulet neve', 'megnevezes'],
  address: ['cim', 'pontos cim', 'utca hazszam', 'helyszin cim'],
  district: ['kerulet', 'ker'],
  year: ['epitesi ev', 'ev', 'evszam', 'datum', 'datum kepalairas szerint', 'epites eve'],
  from: ['tol', 'kezdes eve', 'epites kezdete', 'ev tol'],
  to: ['ig', 'befejezes eve', 'epites vege', 'ev ig'],
  architects: ['tervezo', 'tervezok', 'tervezo k', 'epitesz', 'epiteszek'],
  style: ['stilus', 'stilus iranyzat', 'iranyzat', 'stiluskorszak'],
  function: ['funkcio', 'eredeti funkcio', 'rendeltetes'],
  source: ['forras', 'forras megnevezese', 'hivatkozas'],
  sourceUrl: ['forras link', 'link', 'url', 'forras url'],
  note: ['megjegyzes', 'leiras', 'rovid leiras'],
};

export const TEMPLATE_HEADERS = ['Név', 'Cím', 'Kerület', 'Építési év', 'Tervező', 'Stílus', 'Funkció', 'Forrás', 'Forrás link', 'Megjegyzés'];

function key(h: string) {
  return normalize(h).replace(/[^a-z0-9]+/g, ' ').trim();
}

export function mapHeaders(headers: string[]): { map: Map<number, Field>; unknown: string[] } {
  const map = new Map<number, Field>();
  const unknown: string[] = [];
  headers.forEach((h, i) => {
    const k = key(String(h ?? ''));
    if (!k) return;
    const f = (Object.keys(HEADERS) as Field[]).find((field) => HEADERS[field].includes(k));
    if (f && ![...map.values()].includes(f)) map.set(i, f);
    else unknown.push(String(h));
  });
  return { map, unknown };
}

export function rowsFromTable(table: unknown[][]): { rows: ImportRow[]; unknown: string[]; hasAddress: boolean } {
  const [header = [], ...body] = table;
  const { map, unknown } = mapHeaders(header.map((h) => String(h ?? '')));
  const rows: ImportRow[] = [];
  body.forEach((cells, i) => {
    const r: ImportRow = { line: i + 2 };
    for (const [col, field] of map) {
      const v = cells[col];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      if (field === 'from' || field === 'to') {
        const n = Number(String(v).trim());
        if (Number.isFinite(n)) r[field] = n;
      } else (r as unknown as Record<string, string>)[field] = String(v).trim();
    }
    if (r.district) r.district = r.district.toUpperCase().replace(/\.?\s*KER(ÜLET)?\.?$/i, '').replace(/\.$/, '').trim();
    if (Object.keys(r).length > 1) rows.push(r);
  });
  return { rows, unknown, hasAddress: [...map.values()].includes('address') };
}

/**
 * Építési év értelmezése. Nem talál ki semmit: ami nem egyértelmű, az „ismeretlen”.
 *  "1936"                → pontos év
 *  "kb. 1936", "~1936", "1936?", "1936 k." → valószínű év
 *  "1935–1938", "1935-38" → évintervallum
 *  külön Tól/Ig oszlop    → évintervallum (vagy pontos év, ha egyenlők)
 */
export function parseYear(raw: string | undefined, from?: number, to?: number): ConstructionDate {
  const base = { sourceIds: [] as string[] };
  if (from != null && to != null) return from === to ? { ...base, precision: 'exact', year: from } : from < to ? { ...base, precision: 'range', from, to } : { ...base, precision: 'unknown' };
  if (from != null && raw == null) return { ...base, precision: 'exact', year: from };
  const s = (raw ?? '').trim();
  if (!s) return { ...base, precision: 'unknown' };
  let m = s.match(/^(\d{4})\s*[–\-—/]\s*(\d{2,4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = m[2].length === 2 ? Math.floor(a / 100) * 100 + Number(m[2]) : Number(m[2]);
    return a < b ? { ...base, precision: 'range', from: a, to: b } : a === b ? { ...base, precision: 'exact', year: a } : { ...base, precision: 'unknown' };
  }
  m = s.match(/^(?:kb\.?|kb|cca\.?|~|c\.)\s*(\d{4})$/i) ?? s.match(/^(\d{4})\s*(?:\?|k\.|körül)$/i);
  if (m) return { ...base, precision: 'probable', year: Number(m[1]) };
  m = s.match(/^(\d{4})\.?$/);
  if (m) return { ...base, precision: 'exact', year: Number(m[1]) };
  return { ...base, precision: 'unknown', note: `Nem értelmezhető évszám a táblázatban: „${s}”` };
}
