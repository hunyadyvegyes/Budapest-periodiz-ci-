import type { Building, ConstructionDate } from './types';

export interface Period {
  id: string;
  label: string;
  /** zárt intervallum; -Infinity / Infinity a nyitott végekre */
  from: number;
  to: number;
  color: string;
}

/**
 * 16 korszak a specifikáció szerint. A paletta Lab-térben interpolált,
 * folytonos gradiens (borvörös → okker → zsályazöld → kékeszöld → indigó),
 * visszafogott telítettséggel.
 */
const PALETTE = [
  '#5c2a2e', '#7e382f', '#9d4d2f', '#b8692f', '#ca8a3d', '#d0a550', '#c9b866', '#a6b16f',
  '#83a779', '#5f9a83', '#4b8a8d', '#3f7994', '#3d6797', '#40588e', '#404981', '#3d3a6e',
];

const RANGES: [string, number, number][] = [
  ['1800 előtt', -Infinity, 1799],
  ['1800–1849', 1800, 1849],
  ['1850–1869', 1850, 1869],
  ['1870–1889', 1870, 1889],
  ['1890–1909', 1890, 1909],
  ['1910–1919', 1910, 1919],
  ['1920–1939', 1920, 1939],
  ['1940–1949', 1940, 1949],
  ['1950–1959', 1950, 1959],
  ['1960–1969', 1960, 1969],
  ['1970–1979', 1970, 1979],
  ['1980–1989', 1980, 1989],
  ['1990–1999', 1990, 1999],
  ['2000–2009', 2000, 2009],
  ['2010–2019', 2010, 2019],
  ['2020 után', 2020, Infinity],
];

export const PERIODS: Period[] = RANGES.map(([label, from, to], i) => ({
  id: `p${i}`,
  label,
  from,
  to,
  color: PALETTE[i],
}));

export const UNKNOWN_COLOR = '#c4c0b8';
export const UNKNOWN_PERIOD_ID = 'unknown';

/** Az időbeli műveletekhez használt [tól, ig] intervallum, vagy null ha ismeretlen. */
export function yearSpan(c: ConstructionDate): [number, number] | null {
  if ((c.precision === 'exact' || c.precision === 'probable') && c.year != null) return [c.year, c.year];
  if (c.precision === 'range' && c.from != null && c.to != null) return [c.from, c.to];
  return null;
}

/** Színezéshez használt reprezentatív év (intervallumnál a középpont). */
export function representativeYear(c: ConstructionDate): number | null {
  const s = yearSpan(c);
  if (!s) return null;
  return Math.round((s[0] + s[1]) / 2);
}

export function periodForYear(year: number | null): Period | null {
  if (year == null) return null;
  return PERIODS.find((p) => year >= p.from && year <= p.to) ?? null;
}

export function periodOf(b: Building): Period | null {
  return periodForYear(representativeYear(b.construction));
}

export function colorOf(b: Building): string {
  return periodOf(b)?.color ?? UNKNOWN_COLOR;
}

export function isUncertain(c: ConstructionDate): boolean {
  return c.precision === 'probable' || c.precision === 'range';
}

export function formatConstruction(c: ConstructionDate): string {
  switch (c.precision) {
    case 'exact':
      return c.year != null ? String(c.year) : 'ismeretlen';
    case 'probable':
      return c.year != null ? `kb. ${c.year} (valószínűsített)` : 'ismeretlen';
    case 'range':
      return c.from != null && c.to != null ? `${c.from}–${c.to} között` : 'ismeretlen';
    default:
      return 'ismeretlen';
  }
}
