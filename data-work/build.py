"""
Kvízapp budapesti épületei → atlasz GeoJSON.

Bemenet:
  quiz-budapest.json  – a feltöltött táblázat budapesti sorai (név, tervező, dátum, forrás)
  research.json       – kézzel ellenőrzött hozzárendelés: sor → cím(ek) + forrás-URL-ek
Kimenet:
  ../public/data/quiz-buildings.geojson
  report.md           – mi került be, mi maradt ellenőrizendő

A geometriát a Nominatim (OpenStreetMap) adja: OSM-azonosító, cím vagy koordináta alapján.
Semmilyen történeti adatot nem talál ki: az év és a tervező a táblázatból jön,
a cím pedig csak a research.json-ban megadott forrásból.
"""
import json, re, time, urllib.parse, urllib.request, urllib.error, os, math

UA = {'User-Agent': 'bp-atlasz-research/0.1 (prototype; low-volume)'}
CACHE = 'nominatim-cache.json'
cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}

ERA_STYLE = {
    'Két világháború közötti magyar építészet (1920–45)': 'Két világháború közötti magyar építészet (1920–45)',
    'Újjáépítés – új építés (1945–49)': 'Újjáépítés – új építés (1945–49)',
    'Szocialista realizmus (1950–56)': 'Szocialista realizmus (1950–56)',
    'A konszolidáció modern építészete (1956–68)': 'A konszolidáció modern építészete (1956–68)',
    'Magyarország építészete 1968–95 – a hazai építészet útkeresése': '1968–95: a hazai építészet útkeresése',
}
ROMAN = re.compile(r'\b([IVXL]+)\. kerület')


def nominatim(path, params):
    key = path + '?' + urllib.parse.urlencode(sorted(params.items()))
    if key in cache:
        return cache[key]
    url = 'https://nominatim.openstreetmap.org/' + key
    for i in range(5):
        try:
            time.sleep(1.1)  # Nominatim használati feltétel: max. 1 kérés/s
            data = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))
            cache[key] = data
            json.dump(cache, open(CACHE, 'w'), ensure_ascii=False)
            return data
        except (urllib.error.URLError, TimeoutError):
            time.sleep(5 * (i + 1))
    raise RuntimeError('Nominatim nem válaszol: ' + url)


def is_area(r):
    return r and r.get('geojson', {}).get('type') in ('Polygon', 'MultiPolygon')


BAD_CATEGORIES = {'highway', 'landuse', 'boundary', 'place', 'railway', 'natural', 'waterway', 'leisure'}


def in_district(display, district):
    return re.search(r'(^|[\s,])' + district + r'\. kerület', display) is not None


def housenum(s):
    m = re.match(r'\s*(\d+)', str(s or ''))
    return m.group(1) if m else None


def dist_m(a_lat, a_lon, b_lat, b_lon):
    dy = (float(a_lat) - float(b_lat)) * 111320
    dx = (float(a_lon) - float(b_lon)) * 111320 * math.cos(math.radians(float(a_lat)))
    return math.hypot(dx, dy)


def good(r, district, item=None):
    if not is_area(r) or r.get('category') in BAD_CATEGORIES:
        return False
    if district and not in_district(r.get('display_name', ''), district):
        return False
    if item and item.get('lat') and dist_m(r['lat'], r['lon'], item['lat'], item['lon']) > 250:
        return False
    if item and item.get('address'):
        want = housenum(item['address'].rsplit(' ', 1)[-1])
        got = housenum((r.get('address') or {}).get('house_number'))
        if want and got and want != got:
            return False
    return True


def osm_building_at(lat, lon):
    """Az OSM API-ból a pontot tartalmazó épület (way) poligonja, vagy None."""
    lat, lon = float(lat), float(lon)
    key = f'osmapi:{lat:.7f},{lon:.7f}'
    if key not in cache:
        d = 0.0005
        url = f'https://www.openstreetmap.org/api/0.6/map?bbox={lon-d},{lat-d},{lon+d},{lat+d}'
        time.sleep(1.0)
        xml = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read().decode()
        cache[key] = xml
        json.dump(cache, open(CACHE, 'w'), ensure_ascii=False)
    import xml.etree.ElementTree as ET
    root = ET.fromstring(cache[key])
    nodes = {n.get('id'): (float(n.get('lon')), float(n.get('lat'))) for n in root.iter('node')}
    hits = []
    for w in root.iter('way'):
        tags = {t.get('k'): t.get('v') for t in w.iter('tag')}
        if 'building' not in tags:
            continue
        ring = [nodes[nd.get('ref')] for nd in w.iter('nd') if nd.get('ref') in nodes]
        if len(ring) < 4 or ring[0] != ring[-1]:
            continue
        inside = False
        for i in range(len(ring)):
            (x1, y1), (x2, y2) = ring[i - 1], ring[i]
            if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                inside = not inside
        if inside:
            hits.append((w.get('id'), tags, ring))
    if not hits:
        return None
    wid, tags, ring = hits[0]
    return {'osm_type': 'way', 'osm_id': int(wid), 'lat': str(lat), 'lon': str(lon),
            'display_name': tags.get('name', '') + ' (OSM-épület a címpont körül)',
            'geojson': {'type': 'Polygon', 'coordinates': [[list(p) for p in ring]]},
            'category': 'building', 'address': {}}


def resolve(item):
    """Visszaad: (nominatim_eredmény, módszer). Csak területi (poligon) találatot fogad el,
    és ha meg van adva a kerület, csak abban a kerületben."""
    base = {'format': 'jsonv2', 'polygon_geojson': '1', 'addressdetails': '1'}
    d = item.get('district')
    if item.get('osm'):
        t, i = item['osm'].split('/')
        res = nominatim('lookup', {**base, 'osm_ids': t[0].upper() + i})
        if res and is_area(res[0]):
            return res[0], 'OSM-azonosító'
    queries = []
    if item.get('address'):
        queries.append(item['address'] + (f", {d}. kerület" if d else '') + ', Budapest')
    queries += item.get('queries', [])
    for qs in queries:
        res = nominatim('search', {**base, 'q': qs, 'countrycodes': 'hu', 'limit': '6',
                                   'viewbox': '18.9,47.62,19.35,47.34', 'bounded': '1'})
        ok = [r for r in res if good(r, d, item)]
        if ok:
            return ok[0], f"keresés: {qs}"
        # címpont (azonos házszámmal) → az azt tartalmazó OSM-épület
        want = housenum(item['address'].rsplit(' ', 1)[-1]) if item.get('address') else None
        pts = [r for r in res if (not d or in_district(r.get('display_name', ''), d))
               and want and housenum((r.get('address') or {}).get('house_number')) == want]
        for p in pts:
            b = osm_building_at(p['lat'], p['lon'])
            if b:
                b['display_name'] = p['display_name'][:90] + ' → ' + b['display_name']
                return b, f"címpont + tartalmazó épület: {qs}"
        if pts:
            rev = nominatim('reverse', {**base, 'lat': pts[0]['lat'], 'lon': pts[0]['lon'], 'zoom': '18'})
            if good(rev, d, item) and housenum((rev.get('address') or {}).get('house_number')):
                return rev, f"keresés + épület a címponton: {qs}"
    if item.get('lat'):
        rev = nominatim('reverse', {**base, 'lat': str(item['lat']), 'lon': str(item['lon']), 'zoom': '18'})
        if good(rev, d, item):
            return rev, 'koordináta (forrásból)'
    return None, None


def rect(lon, lat, w=16, h=12):
    dlat = h / 2 / 111320
    dlon = w / 2 / (111320 * math.cos(math.radians(lat)))
    return {'type': 'Polygon', 'coordinates': [[[lon - dlon, lat - dlat], [lon + dlon, lat - dlat], [lon + dlon, lat + dlat], [lon - dlon, lat + dlat], [lon - dlon, lat - dlat]]]}


def centroid(g):
    ring = g['coordinates'][0] if g['type'] == 'Polygon' else g['coordinates'][0][0]
    a = cx = cy = 0
    for i in range(len(ring)):
        x0, y0 = ring[i - 1]
        x1, y1 = ring[i]
        f = x0 * y1 - x1 * y0
        a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f
    if abs(a) < 1e-14:
        return ring[0]
    return [round(cx / (3 * a), 7), round(cy / (3 * a), 7)]


def split_architects(s):
    s = re.sub(r'\s+és\s+', ', ', s or '')
    return [a.strip() for a in s.split(',') if a.strip()]


def main():
    quiz = {o['row']: o for o in json.load(open('quiz-budapest.json'))}
    research = json.load(open('research.json'))
    features, report_ok, report_todo = [], [], []
    for row, q in quiz.items():
        r = research.get(str(row))
        if not r or r.get('status') != 'ok':
            report_todo.append((q, (r or {}).get('note', 'nincs még ellenőrzött cím')))
            continue
        items = r['items']
        for n, item in enumerate(items):
            res, method = resolve(item)
            approx = False
            if res and is_area(res):
                geom = res['geojson']
            else:
                report_todo.append((q, f"a forrásban szereplő cím ({item.get('address') or item.get('label')}) épülete nem azonosítható biztosan az OSM-ben")); continue
            disp = (res or {}).get('display_name', '')
            m = ROMAN.search(disp)
            start, end = q['start'], q['end']
            if start and end and end != start:
                construction = {'precision': 'range', 'from': start, 'to': end}
            elif start:
                construction = {'precision': 'probable', 'year': start}
            else:
                construction = {'precision': 'unknown'}
            construction['sourceIds'] = ['kviz'] if start else []
            construction['note'] = (f"Táblázat: „{q['date']}”. A dátum az előadás képaláírása szerinti; "
                                    "nem különbözteti meg a tervezés, építés és átadás évét.")
            sources = [{'id': 'kviz', 'title': q['source'], 'kind': 'szakirodalom (egyetemi előadásanyag)',
                        'note': 'A kvízapplikáció adattáblája alapján.'}]
            for k, s in enumerate(item.get('sources', []) + r.get('sources', []), start=1):
                sources.append({'id': f's{k}', 'title': s['title'], 'url': s.get('url'), 'kind': s.get('kind', 'web')})
            if res and res.get('osm_type'):
                sources.append({'id': 'osm', 'title': f"OpenStreetMap – {res['osm_type']}/{res['osm_id']} (kontúr)",
                                'url': f"https://www.openstreetmap.org/{res['osm_type']}/{res['osm_id']}", 'license': 'ODbL 1.0'})
            addr_ids = [s['id'] for s in sources if s['id'].startswith('s')]
            confirm = [s['id'] for s in sources if s['id'] in item.get('architect_confirmed_by', r.get('architect_confirmed_by', []))]
            name = q['name'] if len(items) == 1 else f"{q['name']} – {item.get('label') or item.get('address')}"
            props = {
                'id': f"kviz-{row}" + (f"-{n + 1}" if len(items) > 1 else ''),
                'isDemo': False, 'city': 'Budapest', 'origin': 'import',
                'name': name,
                'address': item.get('address_display') or item.get('address'),
                'district': m.group(1) if m else None,
                'centroid': centroid(geom), 'geometryApprox': approx,
                'construction': construction, 'alterations': [],
                'architects': item.get('architects') or split_architects(q['architects']),
                'style': ERA_STYLE.get(q['era']),
                'originalFunction': item.get('function') or r.get('function'),
                'protection': 'ismeretlen',
                'description': (f"A kvízapplikáció „{q['chapter']}” kategóriájából ({q['era']}). "
                                + ' '.join(x for x in [r.get('description'), item.get('note')] if x)).strip(),
                'images': [], 'sources': sources,
                'fieldMeta': {
                    'architects': {'sourceIds': ['kviz'] + confirm, 'reliability': 'documented' if confirm else 'probable'},
                    'style': {'sourceIds': ['kviz'], 'reliability': 'probable', 'note': 'A kvíz stíluskorszak-besorolása.'},
                    'address': {'sourceIds': addr_ids, 'reliability': 'probable' if addr_ids else 'unknown',
                                'note': f"Helymeghatározás: {method}" + ('; pontos kontúr nem található, jelölő négyzet' if approx else '')},
                },
                'updatedAt': '2026-11-10T00:00:00Z',
            }
            props = {k: v for k, v in props.items() if v is not None}
            features.append({'type': 'Feature', 'id': props['id'], 'geometry': geom, 'properties': props})
            report_ok.append((q, item, method, disp, approx))
    os.makedirs('../public/data', exist_ok=True)
    json.dump({'type': 'FeatureCollection',
               'metadata': {'source': 'Kvízapplikáció adattáblája + ellenőrzött címek', 'osmLicense': 'ODbL 1.0'},
               'features': features}, open('../public/data/quiz-buildings.geojson', 'w'), ensure_ascii=False)
    with open('report.md', 'w') as f:
        f.write(f"# Kvízépületek – betöltési jelentés\n\nTérképre került: {len(features)} épület ({len({q['row'] for q, *_ in report_ok})} táblázatsorból).\n"
                f"Ellenőrzendő / nem betöltött: {len(report_todo)} sor.\n\n## Betöltve\n\n| Sor | Épület | Cím | Hely forrása | OSM-találat |\n|---|---|---|---|---|\n")
        for q, item, method, disp, approx in report_ok:
            f.write(f"| {q['row']} | {q['name']} | {item.get('address')} | {method}{' (jelölő négyzet)' if approx else ''} | {disp[:70]} |\n")
        f.write("\n## Ellenőrzendő\n\n| Sor | Épület | Tervező | Megjegyzés |\n|---|---|---|---|\n")
        for q, note in report_todo:
            f.write(f"| {q['row']} | {q['name']} | {q['architects']} | {note} |\n")
    print(len(features), 'feature;', len(report_todo), 'todo')


if __name__ == '__main__':
    main()
