import { describe, expect, it } from 'vitest';
import { joinRings, parseOverpass } from '../src/data/osmBuildings';

const g = (pts: number[][]) => pts.map(([lon, lat]) => ({ lon, lat }));

describe('OSM-épületek a kijelöléshez', () => {
  it('egyszerű épület (way) teljes körvonallal', () => {
    const [b] = parseOverpass([{ type: 'way', id: 1, tags: { building: 'yes', 'addr:street': 'Király utca', 'addr:housenumber': '13' }, geometry: g([[0, 0], [1, 0], [1, 1], [0, 0]]) }]);
    expect(b.id).toBe('way/1');
    expect(b.geometry.type).toBe('Polygon');
    expect(b.address).toBe('Király utca 13.');
  });
  it('nyitott vonal nem épület', () => {
    expect(parseOverpass([{ type: 'way', id: 2, geometry: g([[0, 0], [1, 0], [1, 1]]) }])).toHaveLength(0);
  });
  it('multipolygon: darabokból összefűzött külső gyűrű + udvar', () => {
    const [b] = parseOverpass([{
      type: 'relation', id: 3, tags: { building: 'yes', type: 'multipolygon' },
      members: [
        { type: 'way', role: 'outer', geometry: g([[0, 0], [4, 0], [4, 4]]) },
        { type: 'way', role: 'outer', geometry: g([[0, 0], [0, 4], [4, 4]]) }, // fordított irányú darab
        { type: 'way', role: 'inner', geometry: g([[1, 1], [2, 1], [2, 2], [1, 1]]) },
      ],
    }]);
    expect(b.geometry.type).toBe('Polygon');
    expect((b.geometry as GeoJSON.Polygon).coordinates).toHaveLength(2);
    expect((b.geometry as GeoJSON.Polygon).coordinates[0]).toHaveLength(5);
  });
  it('joinRings eldobja a nem záródó maradékot', () => {
    expect(joinRings([[[0, 0], [1, 0]]])).toHaveLength(0);
  });
});
