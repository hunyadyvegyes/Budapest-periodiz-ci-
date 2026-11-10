import json, urllib.request, urllib.parse, sys
q = """
SELECT ?item ?itemLabel ?deLabel ?archLabel ?coord ?addr ?street ?inception ?osmway ?huwiki ?ai ?commons WHERE {
  VALUES ?archName { %s }
  ?arch rdfs:label ?archName .
  ?item wdt:P84 ?arch .
  ?item wdt:P131* wd:Q1781 .
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P6375 ?addr }
  OPTIONAL { ?item wdt:P669 ?st . ?st rdfs:label ?street FILTER(lang(?street)='hu') }
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item rdfs:label ?deLabel FILTER(lang(?deLabel)='de') }
  OPTIONAL { ?item wdt:P5383 ?ai }
  OPTIONAL { ?item wdt:P373 ?commons }
  OPTIONAL { ?item wdt:P10689 ?osmway }
  OPTIONAL { ?huwiki schema:about ?item ; schema:isPartOf <https://hu.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "hu,en". }
}"""
names = json.load(open('archs.json'))
vals = ' '.join('"%s"@hu' % n for n in names)
url = 'https://query.wikidata.org/sparql?format=json&query=' + urllib.parse.quote(q % vals)
req = urllib.request.Request(url, headers={'User-Agent': 'bp-atlasz-research/0.1 (research prototype)'})
data = json.load(urllib.request.urlopen(req, timeout=120))
rows = [{k: v['value'] for k, v in b.items()} for b in data['results']['bindings']]
json.dump(rows, open('wikidata-hits.json', 'w'), ensure_ascii=False, indent=1)
for r in rows: print(r.get('ai',''), r.get('deLabel',''),'|',r.get('commons',''),'|',r.get('archLabel'), '|', r.get('itemLabel'), '|', r.get('addr',''), r.get('street',''), '|', r.get('coord',''), '|', r.get('inception','')[:4], '|', r.get('huwiki','')[-50:])
