import { describe, expect, it } from 'vitest';
import { districtFromPostcode, mapHeaders, parseYear, rowsFromTable, splitAddress } from '../src/domain/sheet';

describe('tömeges feltöltés – táblázat', () => {
  it('felismeri a sablon és a kvíztábla oszlopneveit', () => {
    const { map } = mapHeaders(['Név', 'Cím', 'Kerület', 'Építési év', 'Tervező(k)', 'Forrás link']);
    expect([...map.values()]).toEqual(['name', 'address', 'district', 'year', 'architects', 'sourceUrl']);
    const q = mapHeaders(['Épület', 'Tervező(k)', 'Dátum (képaláírás szerint)', 'Kezdés éve', 'Befejezés éve', 'Forrás']);
    expect([...q.map.values()]).toEqual(['name', 'architects', 'year', 'from', 'to', 'source']);
  });
  it('a település oszlopot (a kvíztábla „Helyszín” oszlopát is) felismeri', () => {
    const { map } = mapHeaders(['Épület', 'Helyszín', 'Cím']);
    expect([...map.values()]).toEqual(['name', 'city', 'address']);
    expect(mapHeaders(['Település']).map.get(0)).toBe('city');
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

describe('szabad formájú címek', () => {
  it('Város, utca házszám, irányítószám', () => {
    expect(splitAddress('Budapest, Városház u. 9-11, 1052')).toEqual({ street: 'Városház utca 9-11', city: 'Budapest', postcode: '1052', country: undefined });
    expect(splitAddress('Szombathely, Berzsenyi Dániel tér 3, 9700')).toMatchObject({ street: 'Berzsenyi Dániel tér 3', city: 'Szombathely', postcode: '9700' });
    expect(splitAddress('Ganna, Fő u. 37, 8597')).toMatchObject({ street: 'Fő utca 37', city: 'Ganna' });
  });
  it('zárójeles ország és német rövidítés', () => {
    expect(splitAddress('Eisenstadt, Esterhazypl. 1, 7000 (Ausztria)')).toMatchObject({ street: 'Esterhazyplatz 1', city: 'Eisenstadt', postcode: '7000', country: 'Ausztria' });
  });
  it('más sorrend és egyszerű cím', () => {
    expect(splitAddress('1052 Budapest, Városház utca 9')).toMatchObject({ street: 'Városház utca 9', city: 'Budapest', postcode: '1052' });
    expect(splitAddress('Margit körút 55.')).toMatchObject({ street: 'Margit körút 55.' });
    expect(splitAddress('Margit krt. 55')).toMatchObject({ street: 'Margit körút 55' });
  });
  it('kerület az irányítószámból, táblázatsor felbontása', () => {
    expect(districtFromPostcode('1052')).toBe('V');
    expect(districtFromPostcode('1117')).toBe('XI');
    expect(districtFromPostcode('9700')).toBeUndefined();
    const { rows } = rowsFromTable([['Név', 'Cím'], ['Invalidus-palota', 'Budapest, Városház u. 9-11, 1052'], ['Püspöki palota', 'Szombathely, Berzsenyi Dániel tér 3, 9700']]);
    expect(rows[0]).toMatchObject({ address: 'Városház utca 9-11', city: 'Budapest', district: 'V', postcode: '1052' });
    expect(rows[1]).toMatchObject({ address: 'Berzsenyi Dániel tér 3', city: 'Szombathely' });
    expect(rows[1].district).toBeUndefined();
  });
});

describe('házszám a kereséshez', () => {
  it('az első szám számít', async () => {
    const { wantedNumber } = await import('../src/data/geocode');
    expect(wantedNumber('Városház utca 9-11')).toBe('9');
    expect(wantedNumber('Margit körút 55.')).toBe('55');
    expect(wantedNumber('Lejtő út 2/b')).toBe('2');
    expect(wantedNumber('Esterhazyplatz 1')).toBe('1');
    expect(wantedNumber('Dóm tér')).toBeUndefined();
  });
});
