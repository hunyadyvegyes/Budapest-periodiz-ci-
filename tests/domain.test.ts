import { describe, expect, it } from 'vitest';
import type { Building } from '../src/domain/types';
import { EMPTY_FILTER, applyFilter, YEAR_MAX, YEAR_MIN } from '../src/domain/filter';
import { PERIODS, colorOf, periodForYear, UNKNOWN_COLOR, formatConstruction } from '../src/domain/periods';
import { parseCSV, toCSV, toGeoJSON, parseGeoJSON, constructionFromFlat } from '../src/domain/io';
import { byDecade, intensity, topArchitects } from '../src/domain/stats';

const geom = { type: 'Polygon' as const, coordinates: [[[19.05, 47.5], [19.051, 47.5], [19.051, 47.501], [19.05, 47.501], [19.05, 47.5]]] };
function mk(id: string, patch: Partial<Building> = {}): Building {
  return {
    id, isDemo: false, city: 'Budapest', centroid: [19.0505, 47.5005], geometry: geom,
    construction: { precision: 'unknown', sourceIds: [] }, alterations: [], architects: [], protection: 'ismeretlen',
    images: [], sources: [], fieldMeta: {}, origin: 'manual', updatedAt: '2026-01-01T00:00:00Z', ...patch,
  };
}

const list = [
  mk('a', { district: 'VII', style: 'szecesszió', originalFunction: 'bérház', architects: ['X Y'], construction: { precision: 'exact', year: 1905, sourceIds: ['s1'] }, address: 'Teszt utca 1.' }),
  mk('b', { district: 'VII', style: 'historizáló (eklektikus)', originalFunction: 'bérház', construction: { precision: 'range', from: 1885, to: 1895, sourceIds: ['s1'] } }),
  mk('c', { district: 'V', style: 'modern', originalFunction: 'iroda', construction: { precision: 'probable', year: 1936, sourceIds: ['s1'] } }),
  mk('d', { district: 'VII', name: 'Ismeretlen évű ház' }),
  mk('e', { district: 'I', construction: { precision: 'exact', year: 1760, sourceIds: ['s1'] }, isDemo: true }),
];

describe('korszakok', () => {
  it('16 egymást nem fedő korszak', () => {
    expect(PERIODS).toHaveLength(16);
    for (let y = 1700; y <= 2030; y++) expect(PERIODS.filter((p) => y >= p.from && y <= p.to)).toHaveLength(1);
  });
  it('ismeretlen év semleges szín', () => {
    expect(colorOf(list[3])).toBe(UNKNOWN_COLOR);
    expect(periodForYear(1905)?.label).toBe('1890–1909');
    expect(periodForYear(1760)?.label).toBe('1800 előtt');
  });
  it('formázás jelöli a bizonytalanságot', () => {
    expect(formatConstruction(list[1].construction)).toBe('1885–1895 között');
    expect(formatConstruction(list[2].construction)).toContain('valószínűsített');
    expect(formatConstruction(list[3].construction)).toBe('ismeretlen');
  });
});

describe('szűrés', () => {
  it('összetett szűrés: 1890–1910, historizáló, lakófunkció, VII. ker.', () => {
    const r = applyFilter(list, { ...EMPTY_FILTER, yearRange: [1890, 1910], styles: ['historizáló (eklektikus)'], functions: ['bérház'], districts: ['VII'] });
    expect(r.map((b) => b.id)).toEqual(['b']); // intervallum 1885–1895 átfed
  });
  it('időszűrés kizárja az ismeretlen évet, kérésre megtartja', () => {
    expect(applyFilter(list, { ...EMPTY_FILTER, yearRange: [1800, 1950] }).map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(applyFilter(list, { ...EMPTY_FILTER, yearRange: [1800, 1950], includeUnknownInRange: true }).map((b) => b.id)).toContain('d');
  });
  it('nyitott végű tartomány a 1700 előtti épületeket is tartalmazza', () => {
    const old = mk('o', { construction: { precision: 'exact', year: 1650, sourceIds: [] } });
    expect(applyFilter([old], { ...EMPTY_FILTER, yearRange: [YEAR_MIN, 1849] })).toHaveLength(1);
    expect(applyFilter([old], { ...EMPTY_FILTER, yearRange: [1990, YEAR_MAX] })).toHaveLength(0);
  });
  it('szabad szöveges keresés ékezet nélkül, évszámmal, kerülettel', () => {
    expect(applyFilter(list, { ...EMPTY_FILTER, query: 'szecesszio' }).map((b) => b.id)).toEqual(['a']);
    expect(applyFilter(list, { ...EMPTY_FILTER, query: '1890' }).map((b) => b.id)).toEqual(['b']);
    expect(applyFilter(list, { ...EMPTY_FILTER, query: 'x y vii' }).map((b) => b.id)).toEqual(['a']);
  });
  it('DEMO rekordok elrejthetők; korszak kikapcsolható', () => {
    expect(applyFilter(list, { ...EMPTY_FILTER, showDemo: false }).some((b) => b.isDemo)).toBe(false);
    expect(applyFilter(list, { ...EMPTY_FILTER, hiddenPeriods: ['unknown'] }).map((b) => b.id)).not.toContain('d');
  });
});

describe('import / export', () => {
  it('CSV oda-vissza megőrzi a lényeges mezőket', () => {
    const csv = toCSV(list);
    const { buildings, skipped } = parseCSV(csv);
    expect(skipped).toBe(0);
    expect(buildings).toHaveLength(list.length);
    const a = buildings.find((b) => b.id === 'a')!;
    expect(a.construction).toMatchObject({ precision: 'exact', year: 1905 });
    expect(a.architects).toEqual(['X Y']);
    expect(a.geometry).toEqual(geom);
    expect(buildings.find((b) => b.id === 'b')!.construction).toMatchObject({ precision: 'range', from: 1885, to: 1895 });
    expect(buildings.find((b) => b.id === 'e')!.isDemo).toBe(true);
  });
  it('pontosvesszős CSV, csak koordinátával', () => {
    const { buildings } = parseCSV('name;lat;lng;year_from;year_to\n"Próba; ház";47.5;19.05;1900;1910\n');
    expect(buildings[0].name).toBe('Próba; ház');
    expect(buildings[0].geometryApprox).toBe(true);
    expect(buildings[0].construction.precision).toBe('range');
  });
  it('hiányzó évből nem következtet', () => {
    expect(constructionFromFlat({ year_precision: 'exact' }).precision).toBe('unknown');
    expect(constructionFromFlat({}).precision).toBe('unknown');
  });
  it('GeoJSON oda-vissza', () => {
    const { buildings } = parseGeoJSON(JSON.stringify(toGeoJSON(list)));
    expect(buildings.map((b) => b.id)).toEqual(list.map((b) => b.id));
    expect(buildings[0].construction).toEqual(list[0].construction);
  });
});

describe('statisztika', () => {
  it('évtized, tervező, intenzitás', () => {
    expect(byDecade(list).map((r) => r.key)).toEqual(['1760', '1890', '1900', '1930']);
    expect(topArchitects(list)[0]).toEqual({ key: 'X Y', count: 1 });
    const total = intensity(list).reduce((s, r) => s + r.built, 0);
    expect(Math.round(total)).toBe(4);
  });
});

describe('keresés – egybetűs token', () => {
  it('egész szóként illeszkedik', () => {
    const l = [mk('k', { architects: ['DEMO Tervező K'], district: 'VII' }), mk('c', { architects: ['DEMO Tervező C'], district: 'VII' })];
    expect(applyFilter(l, { ...EMPTY_FILTER, query: 'Tervező K' }).map((b) => b.id)).toEqual(['k']);
  });
});
