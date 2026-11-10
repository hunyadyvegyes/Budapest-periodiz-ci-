#!/usr/bin/env node
/**
 * Valós budapesti épületkontúrok és kerülethatárok letöltése az OpenStreetMapből
 * (Overpass API), az atlasz adatformátumára alakítva.
 *
 *   npm run fetch:osm                       # alapértelmezett: belső kerületek bbox
 *   npm run fetch:osm -- --bbox 47.49,19.04,47.51,19.08
 *   npm run fetch:osm -- --only-dated       # csak start_date taggel rendelkező épületek
 *   OVERPASS_URL=https://overpass.kumi.systems/api/interpreter npm run fetch:osm
 *
 * Kimenet: public/data/osm-buildings.geojson, public/data/districts.geojson
 * Licenc: © OpenStreetMap közreműködők, ODbL 1.0 – a forrásmegjelölés kötelező.
 *
 * A teljes város (~250 ezer épület) egy fájlban túl nagy a böngészőnek;
 * nagyobb területhez a PostGIS-háttér + vektorcsempék javasoltak (lásd README).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { districtsToGeoJSON, elementToFeature } from './osm-convert.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OVERPASS = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
// dél, nyugat, észak, kelet – alapértelmezés: V–IX. kerület és a Várnegyed környéke
const bbox = (arg('--bbox') ?? '47.478,19.028,47.515,19.090').split(',').map(Number);
if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
  console.error('Hibás --bbox (formátum: dél,nyugat,észak,kelet)');
  process.exit(1);
}
const onlyDated = args.includes('--only-dated');

async function overpass(query) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'budapest-atlasz-prototype/0.1' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass hiba: ${res.status} ${await res.text().then((t) => t.slice(0, 300))}`);
  return res.json();
}

const fetchedAt = new Date().toISOString();
console.log(`Kerülethatárok letöltése (${OVERPASS})…`);
const dRes = await overpass(`[out:json][timeout:120];
area["name"="Budapest"]["boundary"="administrative"]->.bp;
relation["boundary"="administrative"]["admin_level"="9"](area.bp);
out geom;`);
const districts = districtsToGeoJSON(dRes.elements);
console.log(`  ${districts.features.length} kerület`);

console.log(`Épületek letöltése, bbox=${bbox.join(',')}${onlyDated ? ' (csak start_date)' : ''}…`);
const filter = onlyDated ? '["building"]["start_date"]' : '["building"]';
const bRes = await overpass(`[out:json][timeout:300][maxsize:1073741824];
(
  way${filter}(${bbox.join(',')});
  relation${filter}["type"="multipolygon"](${bbox.join(',')});
);
out tags geom;`);

const features = [];
let skipped = 0;
for (const el of bRes.elements) {
  const f = elementToFeature(el, districts.features, fetchedAt);
  if (f) features.push(f);
  else skipped++;
}
const dated = features.filter((f) => f.properties.construction.precision !== 'unknown').length;

mkdirSync(resolve(root, 'public/data'), { recursive: true });
writeFileSync(resolve(root, 'public/data/districts.geojson'), JSON.stringify(districts));
writeFileSync(
  resolve(root, 'public/data/osm-buildings.geojson'),
  JSON.stringify({
    type: 'FeatureCollection',
    metadata: { source: 'OpenStreetMap (Overpass API)', license: 'ODbL 1.0', attribution: '© OpenStreetMap közreműködők', bbox, fetchedAt, onlyDated },
    features,
  }),
);
console.log(`Kész: ${features.length} épület (${dated} OSM-ben rögzített építési évvel), ${skipped} kihagyva.`);
console.log('A rekordok „közösségi (nem ellenőrzött)” megbízhatósággal kerültek be. Indítsd újra a dev szervert / frissítsd az oldalt.');
