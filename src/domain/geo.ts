import type { MultiPolygon, Polygon, Position } from 'geojson';

/** Egyszerű területsúlyozott centroid (külső gyűrű alapján). */
export function centroidOf(geom: Polygon | MultiPolygon): [number, number] {
  const rings: Position[][] = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map((p) => p[0]);
  let ax = 0, ay = 0, aa = 0;
  for (const ring of rings) {
    let a = 0, cx = 0, cy = 0;
    // az első csúcshoz viszonyítva számolunk (kerekítési hiba elkerülése kis alaprajzoknál)
    const [ox, oy] = ring[0] ?? [0, 0];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const x0 = ring[j][0] - ox, y0 = ring[j][1] - oy;
      const x1 = ring[i][0] - ox, y1 = ring[i][1] - oy;
      const f = x0 * y1 - x1 * y0;
      a += f;
      cx += (x0 + x1) * f;
      cy += (y0 + y1) * f;
    }
    if (Math.abs(a) < 1e-18) {
      // degenerált: csúcsok átlaga
      const n = ring.length || 1;
      ax += ring.reduce((s, p) => s + p[0], 0) / n;
      ay += ring.reduce((s, p) => s + p[1], 0) / n;
      aa += 1;
      continue;
    }
    a /= 2;
    ax += (ox + cx / (6 * a)) * Math.abs(a);
    ay += (oy + cy / (6 * a)) * Math.abs(a);
    aa += Math.abs(a);
  }
  return aa ? [ax / aa, ay / aa] : [0, 0];
}

export function bboxOf(geoms: (Polygon | MultiPolygon)[]): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of geoms) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of polys)
      for (const [x, y] of p[0]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
  }
  return isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

/** Téglalap-poligon méterben megadott méretekkel egy pont körül (kézi felvitelhez). */
export function rectAround([lng, lat]: [number, number], wM = 20, hM = 14): Polygon {
  const dLat = hM / 2 / 111_320;
  const dLng = wM / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat],
    ]],
  };
}
