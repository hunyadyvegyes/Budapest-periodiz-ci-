import { describe, expect, it } from 'vitest';
// @ts-expect-error – JS modul típusdeklaráció nélkül
import { parseStartDate, elementToFeature, districtsToGeoJSON, assembleRings, districtRoman } from '../scripts/osm-convert.mjs';
import { featureToBuilding } from '../src/domain/io';

const sq = (x: number, y: number, d = 0.001) => [
  { lon: x, lat: y }, { lon: x + d, lat: y }, { lon: x + d, lat: y + d }, { lon: x, lat: y + d }, { lon: x, lat: y },
];

describe('OSM start_date értelmezése', () => {
  it.each([
    ['1898', { precision: 'probable', year: 1898 }],
    ['1898-05-01', { precision: 'probable', year: 1898 }],
    ['~1900', { precision: 'probable', year: 1900 }],
    ['1890..1895', { precision: 'range', from: 1890, to: 1895 }],
    ['189x', { precision: 'range', from: 1890, to: 1899 }],
    ['1930s', { precision: 'range', from: 1930, to: 1939 }],
    ['C19', { precision: 'range', from: 1800, to: 1899 }],
  ])('%s', (raw, exp) => expect(parseStartDate(raw)).toMatchObject(exp));
  it('értelmezhetetlen → null (nem találgat)', () => {
    expect(parseStartDate('early 20th century')).toBeNull();
    expect(parseStartDate('')).toBeNull();
    expect(parseStartDate('1900..1890')).toBeNull();
  });
});

describe('OSM elem → rekord', () => {
  const districts = districtsToGeoJSON([
    { type: 'relation', id: 1, tags: { name: 'VII. kerület' }, members: [
      { type: 'way', role: 'outer', geometry: [{ lon: 19.0, lat: 47.0 }, { lon: 19.2, lat: 47.0 }, { lon: 19.2, lat: 47.2 }] },
      { type: 'way', role: 'outer', geometry: [{ lon: 19.2, lat: 47.2 }, { lon: 19.0, lat: 47.2 }, { lon: 19.0, lat: 47.0 }] },
    ] },
  ]);
  it('kerület-reláció gyűrűje összefűzve', () => {
    expect(districts.features).toHaveLength(1);
    expect(districts.features[0].geometry.coordinates[0]).toHaveLength(5);
    expect(districtRoman('XIII. kerület')).toBe('XIII');
  });
  it('dátumozott épület', () => {
    const f = elementToFeature({ type: 'way', id: 42, tags: { building: 'apartments', start_date: '1911', architect: 'A; B', 'addr:street': 'Próba utca', 'addr:housenumber': '3', 'building:levels': '5', 'building:architecture': 'art_nouveau' }, geometry: sq(19.1, 47.1) }, districts.features, '2026-01-01T00:00:00Z');
    const p = f.properties;
    expect(p.district).toBe('VII');
    expect(p.construction).toMatchObject({ precision: 'probable', year: 1911, sourceIds: ['osm'] });
    expect(p.architects).toEqual(['A', 'B']);
    expect(p.style).toBe('szecesszió');
    expect(p.floors).toBe(4);
    expect(p.fieldMeta.architects.reliability).toBe('community');
    expect(p.sources[0].url).toBe('https://www.openstreetmap.org/way/42');
    const b = featureToBuilding(f)!;
    expect(b.isDemo).toBe(false);
    expect(b.origin).toBe('osm');
  });
  it('dátum nélküli épület ismeretlen marad', () => {
    const f = elementToFeature({ type: 'way', id: 7, tags: { building: 'yes' }, geometry: sq(19.5, 47.5) }, districts.features);
    expect(f.properties.construction.precision).toBe('unknown');
    expect(f.properties.district).toBeUndefined();
    expect(f.properties.architects).toEqual([]);
  });
  it('multipolygon reláció', () => {
    const g = sq(19.1, 47.1);
    const rings = assembleRings([{ type: 'way', role: 'outer', geometry: g.slice(0, 3) }, { type: 'way', role: 'outer', geometry: g.slice(2) }]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
  });
});
