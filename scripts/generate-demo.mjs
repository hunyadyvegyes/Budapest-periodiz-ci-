#!/usr/bin/env node
/**
 * DEMO tesztadatbázis generálása.
 *
 * FONTOS: minden itt létrehozott rekord FIKTÍV. A kontúrok szintetikus,
 * pesti zártsorú beépítést utánzó tömbök, NEM valós épületek; a nevek,
 * címek, tervezők és évek kitaláltak, és ezt minden rekord jelöli.
 * A kerület-középpontok csak hozzávetőleges elhelyezést szolgálnak.
 *
 * Futtatás: npm run gen:demo  → public/data/demo-buildings.geojson
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/demo-buildings.geojson');

// Determinisztikus álvéletlen (mulberry32)
let seed = 20261110;
function rnd() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function weighted(entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of entries) { if ((r -= w) <= 0) return v; }
  return entries[entries.length - 1][0];
}

// Hozzávetőleges elhelyezési pontok (nem kerülethatárok!) – a Dunától távol tartva.
const AREAS = [
  { district: 'I', center: [19.0338, 47.5005], blocks: [2, 2], bias: 'old' },
  { district: 'V', center: [19.0548, 47.5012], blocks: [3, 2], bias: 'dual' },
  { district: 'VI', center: [19.0650, 47.5068], blocks: [3, 3], bias: 'dual' },
  { district: 'VII', center: [19.0712, 47.4998], blocks: [3, 3], bias: 'dual' },
  { district: 'VIII', center: [19.0780, 47.4905], blocks: [3, 2], bias: 'mixed' },
  { district: 'IX', center: [19.0790, 47.4800], blocks: [3, 2], bias: 'mixed' },
  { district: 'XI', center: [19.0400, 47.4740], blocks: [3, 2], bias: 'inter' },
  { district: 'XIII', center: [19.0660, 47.5245], blocks: [3, 2], bias: 'modern' },
];

// Korszak-súlyok (a demo-eloszlás változatossága miatt, NEM történeti állítás)
const BIAS = {
  old: [[1750, 4], [1820, 4], [1860, 2], [1885, 2], [1900, 1], [1930, 1], [1965, 1], [2005, 1]],
  dual: [[1840, 1], [1860, 2], [1880, 4], [1900, 5], [1912, 2], [1930, 2], [1955, 1], [1975, 1], [1995, 1], [2015, 1]],
  mixed: [[1855, 1], [1880, 3], [1898, 4], [1914, 2], [1928, 2], [1945, 1], [1962, 2], [1985, 1], [2004, 2], [2022, 1]],
  inter: [[1890, 1], [1912, 2], [1925, 4], [1936, 4], [1946, 1], [1958, 2], [1972, 2], [1998, 1], [2016, 1]],
  modern: [[1905, 1], [1930, 3], [1938, 3], [1952, 2], [1964, 3], [1976, 3], [1992, 1], [2008, 2], [2018, 2], [2023, 1]],
};

function styleFor(y) {
  if (y < 1800) return pick(['barokk', 'copf']);
  if (y < 1850) return pick(['klasszicista', 'klasszicista', 'romantikus']);
  if (y < 1870) return pick(['romantikus', 'historizáló (eklektikus)']);
  if (y < 1896) return pick(['historizáló (eklektikus)', 'neoreneszánsz', 'neobarokk']);
  if (y < 1915) return pick(['szecesszió', 'szecesszió', 'historizáló (eklektikus)', 'késő szecesszió']);
  if (y < 1928) return pick(['késő szecesszió', 'neobarokk', 'art deco']);
  if (y < 1945) return pick(['art deco', 'modern', 'modern', 'mérsékelt modern']);
  if (y < 1956) return pick(['szocialista realizmus', 'modern']);
  if (y < 1990) return pick(['késő modern', 'késő modern', 'iparosított (panel)', 'organikus']);
  if (y < 2005) return pick(['posztmodern', 'kortárs']);
  return 'kortárs';
}
function functionFor(y) {
  if (y < 1850) return weighted([['lakóház', 5], ['középület', 2], ['templom', 1], ['kereskedelmi', 1]]);
  if (y < 1945) return weighted([['bérház', 8], ['lakóház', 2], ['iroda', 1], ['középület', 1], ['iskola', 1], ['ipari', 1], ['szálloda', 0.5]]);
  if (y < 1990) return weighted([['lakóház', 6], ['iroda', 2], ['középület', 1], ['iskola', 1], ['ipari', 1]]);
  return weighted([['lakóház', 5], ['iroda', 3], ['kereskedelmi', 1], ['szálloda', 1]]);
}

const ARCHITECTS = Array.from({ length: 18 }, (_, i) => `DEMO Tervező ${String.fromCharCode(65 + i)}`);
const STREETS = ['Teszt utca', 'Minta utca', 'Próba köz', 'Demo tér', 'Példa sor', 'Kísérleti út', 'Vázlat utca', 'Modell köz'];
const STRUCTURES = ['tégla falazat, fa födém', 'tégla falazat, poroszsüveg födém', 'vasbeton váz', 'előregyártott panel', 'acélváz'];

const DEMO_SOURCE = {
  id: 'demo',
  title: 'DEMO – generált tesztadat (nem valós forrás)',
  kind: 'demo',
  note: 'A rekord kizárólag a felület bemutatására szolgál. Semmilyen valós épületre vonatkozó történeti állítást nem tartalmaz.',
};

const M_LAT = 111_320;
const toLngLat = (center, dx, dy) => [
  +(center[0] + dx / (M_LAT * Math.cos((center[1] * Math.PI) / 180))).toFixed(7),
  +(center[1] + dy / M_LAT).toFixed(7),
];

function ringFromLocal(center, pts) {
  const r = pts.map(([x, y]) => toLngLat(center, x, y));
  r.push(r[0]);
  return r;
}

/** Egy tömb kerülete mentén parcellák (zártsorú, udvaros beépítés). */
function perimeterParcels(x0, y0, w, h, depth) {
  const parcels = [];
  const split = (len) => {
    const out = [];
    let pos = 0;
    while (len - pos > 14) {
      const step = Math.min(len - pos, 14 + rnd() * 14);
      out.push([pos, pos + step]);
      pos += step;
    }
    if (out.length) out[out.length - 1][1] = len; else out.push([0, len]);
    return out;
  };
  // déli és északi oldal: teljes szélesség
  for (const [a, b] of split(w)) {
    parcels.push([[x0 + a, y0], [x0 + b, y0], [x0 + b, y0 + depth], [x0 + a, y0 + depth]]);
    parcels.push([[x0 + a, y0 + h - depth], [x0 + b, y0 + h - depth], [x0 + b, y0 + h], [x0 + a, y0 + h]]);
  }
  // nyugati és keleti oldal: sarkok közötti rész
  for (const [a, b] of split(h - 2 * depth)) {
    const ya = y0 + depth + a, yb = y0 + depth + b;
    parcels.push([[x0, ya], [x0 + depth, ya], [x0 + depth, yb], [x0, yb]]);
    parcels.push([[x0 + w - depth, ya], [x0 + w, ya], [x0 + w, yb], [x0 + w - depth, yb]]);
  }
  return parcels;
}

const features = [];
let n = 0;
for (const area of AREAS) {
  const [cols, rows] = area.blocks;
  const bw = 78, bh = 66, street = 16;
  const totalW = cols * bw + (cols - 1) * street;
  const totalH = rows * bh + (rows - 1) * street;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x0 = -totalW / 2 + c * (bw + street);
      const y0 = -totalH / 2 + r * (bh + street);
      const depth = 11 + rnd() * 5;
      const street1 = pick(STREETS);
      for (const local of perimeterParcels(x0, y0, bw, bh, depth)) {
        if (rnd() < 0.06) continue; // foghíjtelkek
        n++;
        const id = `demo-${String(n).padStart(4, '0')}`;
        const base = weighted(BIAS[area.bias].map(([y, w]) => [y, w]));
        const y = Math.round(base + (rnd() - 0.5) * 16);
        const precision = weighted([['exact', 5], ['probable', 2], ['range', 2], ['unknown', 2]]);
        const construction = { precision, sourceIds: precision === 'unknown' ? [] : ['demo'] };
        if (precision === 'exact' || precision === 'probable') construction.year = y;
        if (precision === 'range') { construction.from = y - 3 - Math.floor(rnd() * 6); construction.to = y + 3 + Math.floor(rnd() * 6); }
        const knownArchitect = precision !== 'unknown' && rnd() < 0.65;
        const fn = functionFor(y);
        const floors = y < 1850 ? 1 + Math.floor(rnd() * 2) : y < 1960 ? 3 + Math.floor(rnd() * 3) : 4 + Math.floor(rnd() * 8);
        const ring = ringFromLocal(area.center, local);
        const cx = local.reduce((s, p) => s + p[0], 0) / 4, cy = local.reduce((s, p) => s + p[1], 0) / 4;
        const alterations = rnd() < 0.2 && y < 1990
          ? [{ year: Math.min(2024, y + 20 + Math.floor(rnd() * 60)), description: 'DEMO átépítés (fiktív)', sourceIds: ['demo'] }]
          : [];
        const props = {
          id,
          isDemo: true,
          city: 'Budapest',
          name: rnd() < 0.18 ? `DEMO tesztépület ${String(n).padStart(4, '0')}` : undefined,
          address: `${street1} ${1 + Math.floor(rnd() * 60)}. (fiktív cím)`,
          district: area.district,
          centroid: toLngLat(area.center, cx, cy),
          construction,
          alterations,
          architects: knownArchitect ? [pick(ARCHITECTS)] : [],
          style: precision === 'unknown' && rnd() < 0.5 ? undefined : styleFor(y),
          originalFunction: fn,
          buildingType: fn === 'bérház' ? 'zártsorú bérház' : fn === 'lakóház' ? (y < 1850 ? 'földszintes lakóház' : 'többlakásos lakóépület') : undefined,
          floors: rnd() < 0.85 ? floors : undefined,
          structure: rnd() < 0.5 ? (y < 1920 ? STRUCTURES[Math.floor(rnd() * 2)] : y > 1965 && y < 1990 && rnd() < 0.5 ? STRUCTURES[3] : STRUCTURES[2]) : undefined,
          currentFunction: rnd() < 0.7 ? fn : pick(['lakóház', 'iroda', 'kereskedelmi', 'szálloda']),
          protection: weighted([['nincs', 6], ['helyi', 2], ['muemlek', 1], ['ismeretlen', 2]]),
          description:
            'DEMO tesztrekord. Ez a leírás generált helyőrző szöveg: nem valós épületről szól, és nem tartalmaz építészettörténeti állítást. ' +
            'Valós adatok betöltése után ide kerül a forrással alátámasztott rövid építészettörténeti leírás.',
          images: [],
          sources: [DEMO_SOURCE],
          fieldMeta: {
            architects: { sourceIds: ['demo'], reliability: 'demo' },
            style: { sourceIds: ['demo'], reliability: 'demo' },
            originalFunction: { sourceIds: ['demo'], reliability: 'demo' },
            protection: { sourceIds: ['demo'], reliability: 'demo' },
          },
          origin: 'demo',
          updatedAt: '2026-11-10T00:00:00.000Z',
        };
        // undefined mezők elhagyása
        for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
        features.push({ type: 'Feature', id, geometry: { type: 'Polygon', coordinates: [ring] }, properties: props });
      }
    }
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({
    type: 'FeatureCollection',
    metadata: {
      demo: true,
      generatedBy: 'scripts/generate-demo.mjs',
      warning: 'FIKTÍV TESZTADAT – a kontúrok, címek, évek, tervezők nem valósak.',
    },
    features,
  }),
);
console.log(`${features.length} DEMO rekord → ${out}`);
