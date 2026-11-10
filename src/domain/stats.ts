import type { Building } from './types';
import { DISTRICTS } from './types';
import { representativeYear, yearSpan } from './periods';

export interface CountRow {
  key: string;
  count: number;
}

function countBy(list: Building[], keyFn: (b: Building) => string[] | string | undefined): CountRow[] {
  const m = new Map<string, number>();
  for (const b of list) {
    const k = keyFn(b);
    const keys = Array.isArray(k) ? k : k ? [k] : [];
    for (const key of keys) m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m.entries()].map(([key, count]) => ({ key, count }));
}

export const UNKNOWN_LABEL = 'Ismeretlen';

export function byDecade(list: Building[]): CountRow[] {
  const rows = countBy(list, (b) => {
    const y = representativeYear(b.construction);
    return y == null ? undefined : `${Math.floor(y / 10) * 10}`;
  });
  return rows.sort((a, b) => Number(a.key) - Number(b.key));
}

export function byStyle(list: Building[]): CountRow[] {
  return countBy(list, (b) => b.style ?? UNKNOWN_LABEL).sort((a, b) => b.count - a.count);
}

export function byFunction(list: Building[]): CountRow[] {
  return countBy(list, (b) => b.originalFunction ?? UNKNOWN_LABEL).sort((a, b) => b.count - a.count);
}

export function byDistrict(list: Building[]): CountRow[] {
  const order = (k: string) => {
    const i = (DISTRICTS as readonly string[]).indexOf(k);
    return i < 0 ? 99 : i;
  };
  return countBy(list, (b) => b.district ?? UNKNOWN_LABEL).sort((a, b) => order(a.key) - order(b.key));
}

export function topArchitects(list: Building[], n = 12): CountRow[] {
  return countBy(list, (b) => b.architects)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'hu'))
    .slice(0, n);
}

export interface IntensityRow {
  year: number;
  /** adott ötéves időszakban épült (intervallumos adatnál arányosan elosztva) */
  built: number;
  cumulative: number;
}

/** Építési intenzitás 5 éves bontásban; az intervallumos évek egyenletesen elosztva. */
export function intensity(list: Building[], bucket = 5): IntensityRow[] {
  const m = new Map<number, number>();
  for (const b of list) {
    const s = yearSpan(b.construction);
    if (!s) continue;
    const len = s[1] - s[0] + 1;
    for (let y = s[0]; y <= s[1]; y++) {
      const k = Math.floor(y / bucket) * bucket;
      m.set(k, (m.get(k) ?? 0) + 1 / len);
    }
  }
  if (!m.size) return [];
  const keys = [...m.keys()].sort((a, b) => a - b);
  const rows: IntensityRow[] = [];
  let cum = 0;
  for (let y = keys[0]; y <= keys[keys.length - 1]; y += bucket) {
    const built = m.get(y) ?? 0;
    cum += built;
    rows.push({ year: y, built: Math.round(built * 10) / 10, cumulative: Math.round(cum) });
  }
  return rows;
}

/** Stílusok kerületenkénti eloszlása (halmozott oszlopdiagramhoz). */
export function styleByDistrict(list: Building[], maxStyles = 8) {
  const styles = byStyle(list)
    .filter((r) => r.key !== UNKNOWN_LABEL)
    .slice(0, maxStyles)
    .map((r) => r.key);
  const districts = byDistrict(list).map((r) => r.key);
  const rows = districts.map((d) => {
    const row: Record<string, number | string> = { district: d };
    for (const s of styles) row[s] = 0;
    row['Egyéb / ismeretlen'] = 0;
    for (const b of list) {
      if ((b.district ?? UNKNOWN_LABEL) !== d) continue;
      const k = b.style && styles.includes(b.style) ? b.style : 'Egyéb / ismeretlen';
      row[k] = (row[k] as number) + 1;
    }
    return row;
  });
  return { styles: [...styles, 'Egyéb / ismeretlen'], rows };
}

export function precisionShare(list: Building[]): CountRow[] {
  return countBy(list, (b) => b.construction.precision);
}
