/**
 * OpenStreetMap (Overpass `out geom`) → atlasz-rekordok átalakítása.
 * Tiszta függvények, hálózat nélkül tesztelhetők (tests/osm-convert.test.ts).
 *
 * Elv: az OSM közösségi adat. Amit átveszünk (start_date, architect, stílus,
 * műemléki tag), azt „community” megbízhatósággal és forráshivatkozással
 * jelöljük; semmit nem egészítünk ki vagy következtetünk ki.
 */

const STYLE_MAP = {
  art_nouveau: 'szecesszió',
  secession: 'szecesszió',
  hungarian_secession: 'szecesszió',
  eclectic: 'historizáló (eklektikus)',
  historicism: 'historizáló (eklektikus)',
  neo_renaissance: 'neoreneszánsz',
  neo_baroque: 'neobarokk',
  neo_gothic: 'neogótika',
  neo_romanesque: 'neoromán',
  neoclassicism: 'klasszicista',
  classicism: 'klasszicista',
  baroque: 'barokk',
  gothic: 'gótika',
  romanesque: 'román',
  renaissance: 'reneszánsz',
  romanticism: 'romantikus',
  art_deco: 'art deco',
  bauhaus: 'modern (Bauhaus)',
  modern: 'modern',
  modernism: 'modern',
  functionalism: 'modern',
  socialist_realism: 'szocialista realizmus',
  stalinist_neoclassicism: 'szocialista realizmus',
  brutalism: 'brutalista',
  postmodern: 'posztmodern',
  contemporary: 'kortárs',
  organic: 'organikus',
};

const TYPE_MAP = {
  apartments: 'lakóépület (többlakásos)',
  residential: 'lakóépület',
  house: 'családi ház',
  detached: 'családi ház',
  terrace: 'sorház',
  commercial: 'kereskedelmi',
  retail: 'kereskedelmi',
  office: 'irodaépület',
  industrial: 'ipari',
  warehouse: 'raktár',
  church: 'templom',
  cathedral: 'templom',
  chapel: 'kápolna',
  synagogue: 'zsinagóga',
  school: 'iskola',
  university: 'egyetem',
  hospital: 'kórház',
  hotel: 'szálloda',
  public: 'középület',
  civic: 'középület',
  government: 'középület',
  train_station: 'pályaudvar',
  garage: 'garázs',
  garages: 'garázs',
};

/** OSM start_date → ConstructionDate (csak egyértelműen értelmezhető formák). */
export function parseStartDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m;
  if ((m = s.match(/^(\d{4})(-\d{2}(-\d{2})?)?$/))) return { precision: 'probable', year: +m[1] };
  if ((m = s.match(/^(?:~|c\.?\s?|ca\.?\s?|circa\s)(\d{4})$/i))) return { precision: 'probable', year: +m[1], note: 'OSM: hozzávetőleges' };
  if ((m = s.match(/^(\d{4})\s*(?:\.\.|–|-|\/)\s*(\d{4})$/))) {
    const a = +m[1], b = +m[2];
    return a <= b ? { precision: 'range', from: a, to: b } : null;
  }
  if ((m = s.match(/^(\d{3})x$/i))) return { precision: 'range', from: +m[1] * 10, to: +m[1] * 10 + 9 };
  if ((m = s.match(/^(\d{4})s$/))) return { precision: 'range', from: +m[1], to: +m[1] + 9 };
  if ((m = s.match(/^C(\d{2})$/i))) return { precision: 'range', from: (+m[1] - 1) * 100, to: (+m[1] - 1) * 100 + 99 };
  return null;
}

function closeRing(r) {
  if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0]);
  return r;
}

const geomToRing = (geom) => geom.map((p) => [+p.lon.toFixed(7), +p.lat.toFixed(7)]);

/** Multipolygon reláció tagjaiból gyűrűk összefűzése (külső gyűrűk; a lyukak a belsők). */
export function assembleRings(members, role = 'outer') {
  const parts = members.filter((m) => m.type === 'way' && (m.role || 'outer') === role && m.geometry?.length).map((m) => geomToRing(m.geometry));
  const rings = [];
  const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (parts.length) {
    let ring = parts.shift();
    let guard = 0;
    while (!eq(ring[0], ring[ring.length - 1]) && guard++ < 10000) {
      const i = parts.findIndex((p) => eq(p[0], ring[ring.length - 1]) || eq(p[p.length - 1], ring[ring.length - 1]));
      if (i < 0) break;
      const p = parts.splice(i, 1)[0];
      ring = ring.concat(eq(p[0], ring[ring.length - 1]) ? p.slice(1) : p.reverse().slice(1));
    }
    if (ring.length >= 4 && eq(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

export function elementGeometry(el) {
  if (el.type === 'way' && el.geometry?.length >= 4) {
    return { type: 'Polygon', coordinates: [closeRing(geomToRing(el.geometry))] };
  }
  if (el.type === 'relation' && el.members) {
    const outers = assembleRings(el.members, 'outer');
    const inners = assembleRings(el.members, 'inner');
    if (!outers.length) return null;
    if (outers.length === 1) return { type: 'Polygon', coordinates: [outers[0], ...inners] };
    return { type: 'MultiPolygon', coordinates: outers.map((o) => [o]) };
  }
  return null;
}

export function centroid(geom) {
  const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
  const [ox, oy] = ring[0]; // relatív koordináták: kerekítési hiba elkerülése
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x0 = ring[j][0] - ox, y0 = ring[j][1] - oy, x1 = ring[i][0] - ox, y1 = ring[i][1] - oy;
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-18) return ring[0];
  return [+(ox + cx / (3 * a)).toFixed(7), +(oy + cy / (3 * a)).toFixed(7)];
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function pointInGeom(pt, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.some((p) => pointInRing(pt, p[0]) && !p.slice(1).some((h) => pointInRing(pt, h)));
}

export function districtRoman(name) {
  const m = String(name ?? '').match(/^([IVXL]+)\.\s*kerület/i);
  return m ? m[1].toUpperCase() : undefined;
}

/** Kerület-relációk → GeoJSON FeatureCollection. */
export function districtsToGeoJSON(elements) {
  const features = [];
  for (const el of elements) {
    if (el.type !== 'relation') continue;
    const roman = districtRoman(el.tags?.name);
    if (!roman) continue;
    const outers = assembleRings(el.members ?? [], 'outer');
    if (!outers.length) continue;
    features.push({
      type: 'Feature',
      properties: { district: roman, name: el.tags.name, osm_id: `relation/${el.id}` },
      geometry: outers.length === 1 ? { type: 'Polygon', coordinates: [outers[0]] } : { type: 'MultiPolygon', coordinates: outers.map((o) => [o]) },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Egy OSM épület → atlasz-rekord (properties) + geometria. */
export function elementToFeature(el, districts = [], fetchedAt = new Date().toISOString()) {
  const geometry = elementGeometry(el);
  if (!geometry) return null;
  const t = el.tags ?? {};
  const osmRef = `${el.type}/${el.id}`;
  const src = {
    id: 'osm',
    title: `OpenStreetMap közreműködők – ${osmRef}`,
    url: `https://www.openstreetmap.org/${osmRef}`,
    kind: 'adatbázis (közösségi)',
    license: 'ODbL 1.0',
    accessed: fetchedAt.slice(0, 10),
  };
  const fieldMeta = {};
  const community = (field, note) => (fieldMeta[field] = { sourceIds: ['osm'], reliability: 'community', ...(note ? { note } : {}) });

  const sd = parseStartDate(t.start_date ?? t['building:start_date']);
  const construction = sd ? { ...sd, sourceIds: ['osm'], note: [sd.note, `OSM start_date=${t.start_date ?? t['building:start_date']} (nem ellenőrzött)`].filter(Boolean).join('; ') } : { precision: 'unknown', sourceIds: [] };

  const c = centroid(geometry);
  const district = districts.find((d) => pointInGeom(c, d.geometry))?.properties.district;
  const address = t['addr:street'] && t['addr:housenumber'] ? `${t['addr:street']} ${t['addr:housenumber']}.` : t['addr:street'];
  const architects = t.architect ? String(t.architect).split(/\s*;\s*/).filter(Boolean) : [];
  const styleRaw = t['building:architecture'];
  const style = styleRaw ? STYLE_MAP[styleRaw] ?? styleRaw : undefined;
  const levels = t['building:levels'] != null && /^\d+$/.test(t['building:levels']) ? +t['building:levels'] : undefined;
  const heritage = t.heritage || t['heritage:operator'] || t['ref:HU:hrsz:muemlek'];

  if (t.name) community('name');
  if (address) community('address');
  if (architects.length) community('architects');
  if (style) community('style', `OSM building:architecture=${styleRaw}`);
  if (levels != null) community('floors', `OSM building:levels=${levels} (földszinttel együtt) → emeletszám = szintszám − 1`);
  if (heritage) community('protection', `OSM heritage=${t.heritage ?? ''} ${t['heritage:operator'] ?? ''}`.trim());

  const props = {
    id: `osm-${el.type[0]}${el.id}`,
    isDemo: false,
    city: 'Budapest',
    name: t.name,
    address,
    district,
    centroid: c,
    construction,
    alterations: [],
    architects,
    style,
    buildingType: TYPE_MAP[t.building] ?? (t.building && t.building !== 'yes' ? t.building : undefined),
    floors: levels != null ? Math.max(0, levels - 1) : undefined,
    protection: heritage ? 'muemlek' : 'ismeretlen',
    images: [],
    sources: [src],
    fieldMeta,
    origin: 'osm',
    updatedAt: fetchedAt,
  };
  if (t.wikidata) props.sources.push({ id: 'wikidata', title: `Wikidata ${t.wikidata}`, url: `https://www.wikidata.org/wiki/${t.wikidata}`, kind: 'adatbázis', license: 'CC0' });
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: 'Feature', id: props.id, geometry, properties: props };
}
