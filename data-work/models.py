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


# tetőforma → (szeletek száma, profil t∈[0,1] → méretarány)
PROFILES = {
    'dome': (7, lambda t: math.sqrt(max(0.0, 1 - t * t))),
    'onion': (7, lambda t: max(0.05, math.sin(math.pi * (0.35 + 0.65 * t)) * 1.1)),
    'pyramidal': (6, lambda t: 1 - t),
    'cone': (6, lambda t: 1 - t),
    'hipped': (3, lambda t: 1 - 0.75 * t),
    'gabled': (3, lambda t: 1 - 0.6 * t),
    'mansard': (2, lambda t: 1 - 0.35 * t),
    'gambrel': (2, lambda t: 1 - 0.35 * t),
    'half-hipped': (3, lambda t: 1 - 0.65 * t),
}
# becsült tetőmagasság az alapterület négyzetgyökéhez képest, ha a tetőmagasság nincs megadva
ROOF_FACTOR = {'dome': 0.5, 'onion': 0.7, 'pyramidal': 0.9, 'cone': 1.2, 'hipped': 0.3, 'gabled': 0.3,
               'mansard': 0.2, 'gambrel': 0.2, 'half-hipped': 0.3}


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
    feats, part_ids, estimated = [], [], 0
    for w in ways.values():
        t = w.get('tags', {})
        if not t.get('building:part'):
            continue
        ring = ring_of(w, nodes)
        if not ring or not point_in(centroid(ring), outline):
            continue
        h = num(t.get('height')) or (num(t.get('building:levels')) or 3) * 4
        mh = num(t.get('min_height')) or ((num(t.get('building:min_level')) or 0) * 4)
        shape = t.get('roof:shape', 'flat')
        side = math.sqrt(area_m2(ring, lat))
        rh = num(t.get('roof:height'))
        if rh is None and shape in ROOF_FACTOR:
            rh = min(ROOF_FACTOR[shape] * side, (h - mh) * 0.6)
            estimated += 1
        rh = max(0.0, min(rh or 0.0, h - mh))
        wall_top = h - rh
        color = t.get('building:colour') or t.get('colour')
        roof_color = t.get('roof:colour') or color
        part_ids.append(w['id'])
        base = {'model': ref, 'part': f"way/{w['id']}"}
        if wall_top > mh:
            feats.append({'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [ring]},
                          'properties': {**base, 'base': round(mh, 2), 'top': round(wall_top, 2), 'osmColor': color, 'roof': False}})
        if rh > 0.3 and shape in PROFILES:
            n, prof = PROFILES[shape]
            c = centroid(ring)
            for i in range(n):
                t0, t1 = i / n, (i + 1) / n
                s = prof((t0 + t1) / 2)
                if s <= 0.02:
                    continue
                feats.append({'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [scale_ring(ring, c, s)]},
                              'properties': {**base, 'base': round(wall_top + t0 * rh, 2), 'top': round(wall_top + t1 * rh, 2), 'osmColor': roof_color, 'roof': True}})
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
