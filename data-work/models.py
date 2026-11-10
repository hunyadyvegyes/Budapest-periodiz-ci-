"""
Részletes 3D tömegmodellek nevezetes épületekhez – OpenStreetMap-épületrészekből (building:part).

A MapLibre csak függőleges hasábokat tud kihúzni, ezért a tetőformákat (kupola, gúla, kontytető)
egymásra rakott, felfelé szűkülő szeletekkel közelítjük. Az épületrészek alaprajza, magassága és
tetőformája az OSM-ből jön (© OpenStreetMap közreműködők, ODbL); ahol a tetőmagasság nincs megadva,
a tetőforma és az alapterület alapján becsüljük (ezt a modell metaadata jelzi).

Futtatás: python3 models.py  →  ../public/data/models.geojson
"""
import json, math, subprocess, urllib.parse

UA = 'bp-atlasz-research/0.1 (prototype; low-volume)'

# (OSM-hivatkozás a teljes épületre, név, befoglaló téglalap: nyugat, dél, kelet, észak)
MODELS = [
    ('relation/3199085', 'Országház', (19.0440, 47.5060, 19.0478, 47.5092)),
    (None, 'Szent István-bazilika', (19.0522, 47.4998, 19.0552, 47.5016)),
]


def osm_map(bbox):
    w, s, e, n = bbox
    url = f'https://www.openstreetmap.org/api/0.6/map.json?bbox={w},{s},{e},{n}'
    out = subprocess.run(['curl', '-sS', '-m', '120', '-A', UA, url], capture_output=True, text=True, check=True).stdout
    return json.loads(out)['elements']


def num(v):
    try:
        return float(str(v).split()[0].replace(',', '.'))
    except (TypeError, ValueError):
        return None


def ring_of(way, nodes):
    pts = [nodes[i] for i in way['nodes'] if i in nodes]
    return pts if len(pts) >= 4 and pts[0] == pts[-1] else None


def join_rings(parts):
    rest = [list(p) for p in parts]
    rings = []
    while rest:
        ring = rest.pop(0)
        for _ in range(1000):
            if ring[0] == ring[-1]:
                break
            end = ring[-1]
            i = next((k for k, p in enumerate(rest) if p[0] == end or p[-1] == end), None)
            if i is None:
                break
            p = rest.pop(i)
            ring += (p if p[0] == end else p[::-1])[1:]
        if len(ring) >= 4 and ring[0] == ring[-1]:
            rings.append(ring)
    return rings


def point_in(pt, ring):
    x, y = pt
    inside = False
    for i in range(len(ring)):
        (x1, y1), (x2, y2) = ring[i - 1], ring[i]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def centroid(ring):
    # az első csúcshoz viszonyított koordinátákkal – különben kis alaprajzoknál a nagy
    # földrajzi koordináták miatti kerekítési hiba elviszi a súlypontot
    ox, oy = ring[0]
    a = cx = cy = 0
    for i in range(len(ring)):
        (x0, y0), (x1, y1) = ring[i - 1], ring[i]
        x0, y0, x1, y1 = x0 - ox, y0 - oy, x1 - ox, y1 - oy
        f = x0 * y1 - x1 * y0
        a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f
    if abs(a) < 1e-18:
        return ring[0]
    return (ox + cx / (3 * a), oy + cy / (3 * a))


def area_m2(ring, lat):
    kx, ky = 111320 * math.cos(math.radians(lat)), 111320
    a = 0
    for i in range(len(ring)):
        (x0, y0), (x1, y1) = ring[i - 1], ring[i]
        a += (x0 * kx) * (y1 * ky) - (x1 * kx) * (y0 * ky)
    return abs(a) / 2


def scale_ring(ring, c, s):
    return [[round(c[0] + (x - c[0]) * s, 7), round(c[1] + (y - c[1]) * s, 7)] for x, y in ring]


# STILIZÁLT modell: csak a karakteres tetők (kupola, gúla, kúp) kapnak néhány szeletet,
# a nyereg-, konty- és manzárdtetős részek egyszerű, lapos tetejű tömbök (a tető felével megemelve).
PROFILES = {
    'dome': (4, lambda t: math.sqrt(max(0.0, 1 - t * t))),
    'onion': (4, lambda t: max(0.1, math.sin(math.pi * (0.35 + 0.65 * t)) * 1.1)),
    'pyramidal': (3, lambda t: 1 - t),
    'cone': (3, lambda t: 1 - t),
}
FLAT_ROOF_SHARE = 0.4   # a nem szeletelt tetőből ennyi adódik a tömb magasságához
MIN_PART_AREA = 60      # m² – ennél kisebb rész csak akkor marad, ha toronyszerű
TOWER_HEIGHT = 45       # m
# becsült tetőmagasság az alapterület négyzetgyökéhez képest, ha a tetőmagasság nincs megadva
ROOF_FACTOR = {'dome': 0.5, 'onion': 0.7, 'pyramidal': 0.9, 'cone': 1.2, 'hipped': 0.3, 'gabled': 0.3,
               'mansard': 0.2, 'gambrel': 0.2, 'half-hipped': 0.3}


def r05(v):
    return round(v * 2) / 2


def build_model(ref, name, bbox):
    els = osm_map(bbox)
    nodes = {e['id']: [e['lon'], e['lat']] for e in els if e['type'] == 'node'}
    ways = {e['id']: e for e in els if e['type'] == 'way'}
    # a teljes épület körvonala
    outline = None
    if ref and ref.startswith('relation/'):
        rid = int(ref.split('/')[1])
        rel = next(e for e in els if e['type'] == 'relation' and e['id'] == rid)
        parts = [ring_of_open(ways[m['ref']], nodes) for m in rel['members'] if m['type'] == 'way' and m.get('role', 'outer') == 'outer' and m['ref'] in ways]
        rings = join_rings([p for p in parts if p])
        outline = max(rings, key=lambda r: area_m2(r, bbox[1]))
    else:
        cand = [w for w in ways.values() if w.get('tags', {}).get('building') and w.get('tags', {}).get('name', '').lower().startswith(name.lower()[:12])]
        if not cand:
            cand = [e for e in els if e['type'] == 'relation' and e.get('tags', {}).get('building') and name.lower()[:12] in e.get('tags', {}).get('name', '').lower()]
        w = cand[0]
        ref = f"{w['type']}/{w['id']}"
        if w['type'] == 'way':
            outline = ring_of(w, nodes)
        else:
            parts = [ring_of_open(ways[m['ref']], nodes) for m in w['members'] if m['type'] == 'way' and m.get('role', 'outer') == 'outer' and m['ref'] in ways]
            outline = max(join_rings([p for p in parts if p]), key=lambda r: area_m2(r, bbox[1]))

    lat = bbox[1]
    parts = []
    for w in ways.values():
        t = w.get('tags', {})
        if not t.get('building:part'):
            continue
        ring = ring_of(w, nodes)
        if not ring or not point_in(centroid(ring), outline):
            continue
        h = num(t.get('height')) or (num(t.get('building:levels')) or 3) * 4
        mh = num(t.get('min_height')) or ((num(t.get('building:min_level')) or 0) * 4)
        area = area_m2(ring, lat)
        if area < MIN_PART_AREA and h < TOWER_HEIGHT:
            continue  # apró részlet – a stilizált modellből kimarad
        parts.append({'id': w['id'], 'ring': ring, 'h': h, 'mh': mh, 'area': area, 't': t})

    # azonos alaprajzú részek közül a magasabb marad; teljesen eltakart részek kimaradnak
    keep = []
    seen = {}
    for p in sorted(parts, key=lambda p: -p['h']):
        key = tuple(map(tuple, p['ring']))
        if key in seen:
            continue
        seen[key] = True
        keep.append(p)
    final = []
    for p in keep:
        c = centroid(p['ring'])
        hidden = any(q is not p and q['area'] > p['area'] and q['h'] >= p['h'] and q['mh'] <= p['mh'] and point_in(c, q['ring'])
                     and all(point_in(v, q['ring']) for v in p['ring'][:-1]) for q in keep)
        if not hidden:
            final.append(p)

    # lebegő részek kiszűrése: ami nem a talajon áll, annak egy megtartott rész tetején kell állnia
    changed = True
    while changed:
        changed = False
        for p in list(final):
            if p['mh'] <= 1:
                continue
            c = centroid(p['ring'])
            if not any(q is not p and q['h'] >= p['mh'] - 2 and q['mh'] < p['mh'] and point_in(c, q['ring']) for q in final):
                final.remove(p)
                changed = True

    feats, part_ids, estimated = [], [], 0
    for p in final:
        t, ring, h, mh = p['t'], p['ring'], p['h'], p['mh']
        shape = t.get('roof:shape', 'flat')
        side = math.sqrt(p['area'])
        rh = num(t.get('roof:height'))
        if rh is None and shape in ROOF_FACTOR:
            rh = min(ROOF_FACTOR[shape] * side, (h - mh) * 0.6)
            estimated += 1
        rh = max(0.0, min(rh or 0.0, h - mh))
        part_ids.append(p['id'])
        base = {'model': ref, 'part': f"way/{p['id']}"}
        if shape in PROFILES and rh > 0.3:
            wall_top = h - rh
            if wall_top > mh:
                feats.append({'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [ring]},
                              'properties': {**base, 'base': r05(mh), 'top': r05(wall_top), 'roof': False}})
            n, prof = PROFILES[shape]
            c = centroid(ring)
            for i in range(n):
                t0, t1 = i / n, (i + 1) / n
                sc = prof((t0 + t1) / 2)
                if sc <= 0.05:
                    continue
                feats.append({'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [scale_ring(ring, c, sc)]},
                              'properties': {**base, 'base': r05(wall_top + t0 * rh), 'top': r05(wall_top + t1 * rh), 'roof': True}})
        else:
            top = h - rh + FLAT_ROOF_SHARE * rh
            feats.append({'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [ring]},
                          'properties': {**base, 'base': r05(mh), 'top': r05(top), 'roof': False}})
    return ref, name, outline, feats, part_ids, estimated


def ring_of_open(way, nodes):
    pts = [nodes[i] for i in way['nodes'] if i in nodes]
    return pts if len(pts) >= 2 else None


def main():
    all_feats, meta = [], []
    for ref, name, bbox in MODELS:
        ref, name, outline, feats, part_ids, est = build_model(ref, name, bbox)
        all_feats += feats
        meta.append({'osmRef': ref, 'name': name, 'parts': len(part_ids), 'slices': len(feats), 'estimatedRoofs': est,
                     'osmWayIds': part_ids})
        print(f'{name}: {ref}, {len(part_ids)} épületrész, {len(feats)} szelet, {est} becsült tetőmagasság')
    json.dump({'type': 'FeatureCollection',
               'metadata': {'source': '© OpenStreetMap közreműködők (building:part), ODbL 1.0; a tetőformák szeletekkel közelítve',
                            'models': meta},
               'features': all_feats}, open('../public/data/models.geojson', 'w'), ensure_ascii=False)


if __name__ == '__main__':
    main()
