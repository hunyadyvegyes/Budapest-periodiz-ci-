import type { Building, ProtectionStatus, YearPrecision } from './types';
import { PERIODS, UNKNOWN_PERIOD_ID, formatConstruction, periodOf, yearSpan } from './periods';

export interface FilterState {
  query: string;
  /** települések (pl. Budapest, Szeged) */
  cities: string[];
  districts: string[];
  styles: string[];
  functions: string[];
  architects: string[];
  precisions: YearPrecision[];
  protections: ProtectionStatus[];
  /** Idővonal: [tól, ig]; null = nincs időszűrés */
  yearRange: [number, number] | null;
  /** Időszűrésnél az ismeretlen évű épületek is látszódjanak-e */
  includeUnknownInRange: boolean;
  /** Jelmagyarázatban kikapcsolt korszakok (periódus id-k, ill. 'unknown') */
  hiddenPeriods: string[];
  showDemo: boolean;
}

export const EMPTY_FILTER: FilterState = {
  query: '',
  cities: [],
  districts: [],
  styles: [],
  functions: [],
  architects: [],
  precisions: [],
  protections: [],
  yearRange: null,
  includeUnknownInRange: false,
  hiddenPeriods: [],
  showDemo: true,
};

export function normalize(s: string): string {
  return s
    .toLocaleLowerCase('hu')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Egy épület kereshető szövege (cím, név, tervező, év, stílus, funkció, kerület). */
export function searchText(b: Building): string {
  return normalize(
    [
      b.name,
      b.address,
      b.city,
      b.district ? `${b.district}. kerulet ${b.district} ker` : '',
      b.architects.join(' '),
      b.style,
      b.originalFunction,
      b.currentFunction,
      b.buildingType,
      formatConstruction(b.construction),
      b.construction.from,
      b.construction.to,
    ]
      .filter(Boolean)
      .join(' | '),
  );
}

function matchesQuery(b: Building, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const hay = searchText(b);
  // Minden szónak szerepelnie kell (ÉS kapcsolat)
  return normalize(q)
    .split(/\s+/)
    .every((tok) => {
      // Évszám-token: intervallumon belüli találat is számít
      if (/^\d{4}$/.test(tok)) {
        const y = Number(tok);
        const s = yearSpan(b.construction);
        if (s && y >= s[0] && y <= s[1]) return true;
      }
      // Egybetűs token (pl. „DEMO Tervező K”) csak egész szóként illeszkedik
      if (tok.length === 1) return new RegExp(`(^|[^a-z0-9])${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(hay);
      return hay.includes(tok);
    });
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

export function matchesFilter(b: Building, f: FilterState): boolean {
  if (!f.showDemo && b.isDemo) return false;
  if (f.cities.length && !f.cities.includes(b.city || 'Budapest')) return false;
  if (f.districts.length && (!b.district || !f.districts.includes(b.district))) return false;
  if (f.styles.length && (!b.style || !f.styles.includes(b.style))) return false;
  if (f.functions.length) {
    const fn = [b.originalFunction, b.currentFunction].filter(Boolean) as string[];
    if (!fn.some((x) => f.functions.includes(x))) return false;
  }
  if (f.architects.length && !b.architects.some((a) => f.architects.includes(a))) return false;
  if (f.precisions.length && !f.precisions.includes(b.construction.precision)) return false;
  if (f.protections.length && !f.protections.includes(b.protection)) return false;

  const span = yearSpan(b.construction);
  if (f.yearRange) {
    if (!span) {
      if (!f.includeUnknownInRange) return false;
    } else {
      const r: [number, number] = [
        f.yearRange[0] <= YEAR_MIN ? -Infinity : f.yearRange[0],
        f.yearRange[1] >= YEAR_MAX ? Infinity : f.yearRange[1],
      ];
      if (!overlaps(span, r)) return false;
    }
  }

  if (f.hiddenPeriods.length) {
    const pid = periodOf(b)?.id ?? UNKNOWN_PERIOD_ID;
    if (f.hiddenPeriods.includes(pid)) return false;
  }

  return matchesQuery(b, f.query);
}

export function applyFilter(list: Building[], f: FilterState): Building[] {
  return list.filter((b) => matchesFilter(b, f));
}

export function activeFilterCount(f: FilterState): number {
  return (
    (f.query.trim() ? 1 : 0) +
    f.cities.length +
    f.districts.length +
    f.styles.length +
    f.functions.length +
    f.architects.length +
    f.precisions.length +
    f.protections.length +
    (f.yearRange ? 1 : 0) +
    f.hiddenPeriods.length +
    (f.showDemo ? 0 : 1)
  );
}

export const ALL_PERIOD_IDS = [...PERIODS.map((p) => p.id), UNKNOWN_PERIOD_ID];

/** Az idővonal tartománya; a szélső értékek „nyitott” végként viselkednek. */
export const YEAR_MIN = 1700;
export const YEAR_MAX = 2030;

/** Korszakelőbeállítások az idővonalhoz. */
export const TIME_PRESETS: { label: string; range: [number, number] }[] = [
  { label: '1850 előtt', range: [YEAR_MIN, 1849] },
  { label: '1860–1900', range: [1860, 1900] },
  { label: 'Dualizmus (1867–1918)', range: [1867, 1918] },
  { label: 'Két világháború között', range: [1919, 1939] },
  { label: 'Szocializmus (1949–1989)', range: [1949, 1989] },
  { label: '1990 után', range: [1990, YEAR_MAX] },
];
