import type { ConstructionDate } from './types';
import { isBudapest } from './types';
import { normalize } from './filter';

/** Tömeges feltöltés: egy táblázatsor egységesített formában. */
export interface ImportRow {
  line: number; // sor száma a táblázatban (fejléc = 1)
  name?: string;
  address?: string;
  city?: string;
  district?: string;
  postcode?: string;
  country?: string;
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
  city: ['telepules', 'varos', 'helyseg', 'helyszin', 'telepules neve', 'kozseg'],
  district: ['kerulet', 'ker'],
  postcode: ['iranyitoszam', 'irsz', 'ir szam'],
  country: ['orszag'],
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

export const TEMPLATE_HEADERS = ['Név', 'Cím', 'Település', 'Kerület', 'Építési év', 'Tervező', 'Stílus', 'Funkció', 'Forrás', 'Forrás link', 'Megjegyzés'];

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
    if (r.address) {
      // „Város, utca 1, 1234 (Ország)” → külön mezők; a táblázat Település oszlopa elsőbbséget élvez
      const sp = splitAddress(r.address);
      r.address = sp.street;
      if (!r.city && sp.city) r.city = sp.city;
      if (sp.postcode) r.postcode = sp.postcode;
      if (sp.country) r.country = sp.country;
      if (!r.district && (!r.city || isBudapest(r.city))) r.district = districtFromPostcode(sp.postcode);
    }
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

/* ------------------------------------------------------------------ */
/* Címfelbontás                                                         */
/* ------------------------------------------------------------------ */

export interface SplitAddress {
  street: string; // utca + házszám, rövidítések kibontva
  city?: string;
  postcode?: string;
  country?: string;
}

/** Közterület-típusok – ezekről ismerjük fel, melyik címrész az utca. */
const STREET_WORDS = /\b(utca|u\.|út|útja|tér|tere|körút|krt\.?|köz|sor|sétány|fasor|rakpart|rkp\.?|park|lépcső|liget|dűlő|udvar|kert|telep|határsor|árok|part|pl\.?|platz|gasse|straße|strasse|str\.?|ulica|ul\.|námestie|nám\.|strada|str|trg|ulice)\b|\b\w+(pl\.|platz|gasse|straße|strasse)\b/i;

/** Gyakori rövidítések kibontása, hogy a címkereső jobban értse. */
export function expandAbbreviations(s: string): string {
  return s
    .replace(/\bu\.\s*/gi, 'utca ')
    .replace(/\bkrt\.?(?=\s|$)/gi, 'körút')
    .replace(/\brkp\.?(?=\s|$)/gi, 'rakpart')
    .replace(/(\p{L})pl\.(?=\s|$)/gu, '$1platz')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Szabad formájú cím felbontása. Kezeli a „Város, utca 1, 1234”, a „1234 Város, utca 1”
 * és az „utca 1, Város” sorrendet, valamint a zárójeles országot: „… (Ausztria)”.
 */
export function splitAddress(raw: string): SplitAddress {
  let s = raw.trim();
  let country: string | undefined;
  const paren = s.match(/\(([^)]+)\)\s*$/);
  if (paren) {
    country = paren[1].trim();
    s = s.slice(0, paren.index).trim();
  }
  let postcode: string | undefined;
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  const rest: string[] = [];
  for (let p of parts) {
    const pc = p.match(/^(\d{4})(?:\s+(.*))?$/) ?? p.match(/^(.*?)\s+(\d{4})$/);
    if (/^\d{4}$/.test(p)) { postcode = p; continue; }
    if (pc && /^\d{4}\s+\D/.test(p)) { postcode = pc[1]; p = pc[2] ?? ''; } // „1052 Budapest”
    if (p) rest.push(p);
  }
  if (rest.length <= 1) return { street: expandAbbreviations(rest[0] ?? s), postcode, country };
  // az utcarész: amelyikben közterület-típus vagy házszám van
  const streetIdx = rest.findIndex((p) => STREET_WORDS.test(p) || /\d/.test(p));
  const street = streetIdx >= 0 ? rest[streetIdx] : rest[rest.length - 1];
  const others = rest.filter((_, i) => i !== (streetIdx >= 0 ? streetIdx : rest.length - 1));
  const city = others.find((p) => !/\d/.test(p));
  return { street: expandAbbreviations(street), city, postcode, country };
}

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII'];

/** Budapesti irányítószámból a kerület (1052 → V). */
export function districtFromPostcode(pc: string | undefined): string | undefined {
  const m = pc?.match(/^1(\d\d)\d$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 23 ? ROMANS[n - 1] : undefined;
}
