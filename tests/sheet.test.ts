import { describe, expect, it } from 'vitest';
import { mapHeaders, parseYear, rowsFromTable } from '../src/domain/sheet';

describe('tömeges feltöltés – táblázat', () => {
  it('felismeri a sablon és a kvíztábla oszlopneveit', () => {
    const { map } = mapHeaders(['Név', 'Cím', 'Kerület', 'Építési év', 'Tervező(k)', 'Forrás link']);
    expect([...map.values()]).toEqual(['name', 'address', 'district', 'year', 'architects', 'sourceUrl']);
    const q = mapHeaders(['Épület', 'Tervező(k)', 'Dátum (képaláírás szerint)', 'Kezdés éve', 'Befejezés éve', 'Forrás']);
    expect([...q.map.values()]).toEqual(['name', 'architects', 'year', 'from', 'to', 'source']);
  });
  it('sorok és kerület egységesítése', () => {
    const { rows, hasAddress } = rowsFromTable([
      ['Név', 'Cím', 'Kerület'],
      ['Átrium', 'Margit körút 55.', 'II. kerület'],
      ['', '', ''],
      ['X', 'Fő utca 1', 'v'],
    ]);
    expect(hasAddress).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ line: 2, district: 'II' });
    expect(rows[1]).toMatchObject({ line: 4, district: 'V' });
  });
  it('évszám-értelmezés nem talál ki semmit', () => {
    expect(parseYear('1936')).toMatchObject({ precision: 'exact', year: 1936 });
    expect(parseYear('kb. 1936')).toMatchObject({ precision: 'probable', year: 1936 });
    expect(parseYear('1936?')).toMatchObject({ precision: 'probable', year: 1936 });
    expect(parseYear('1935–1938')).toMatchObject({ precision: 'range', from: 1935, to: 1938 });
    expect(parseYear('1935-38')).toMatchObject({ precision: 'range', from: 1935, to: 1938 });
    expect(parseYear(undefined, 1932, 1934)).toMatchObject({ precision: 'range', from: 1932, to: 1934 });
    expect(parseYear('a 30-as évek')).toMatchObject({ precision: 'unknown' });
    expect(parseYear('')).toMatchObject({ precision: 'unknown' });
  });
});
