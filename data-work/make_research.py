"""A kutatás eredménye: kvíz-sor → ellenőrzött cím(ek) és forrás(ok).
Minden cím mögött legalább egy online forrás áll; ami nem igazolható, 'todo'."""
import json

WD = lambda q, t: {'title': f'Wikidata {q} – {t}', 'url': f'https://www.wikidata.org/wiki/{q}', 'kind': 'adatbázis (Wikidata)'}
AI = lambda i, t: {'title': f'archINFORM {i} – {t}', 'url': f'https://www.archinform.net/projekte/{i}.htm', 'kind': 'adatbázis (archINFORM)'}
WP = lambda page, note='': {'title': f'Wikipédia: {page}' + (f' ({note})' if note else ''), 'url': 'https://hu.wikipedia.org/wiki/' + page.replace(' ', '_'), 'kind': 'Wikipédia'}
URL = lambda title, url, kind='web': {'title': title, 'url': url, 'kind': kind}

R = {}


def ok(row, items, function=None, **kw):
    R[row] = {'status': 'ok', 'items': items, 'function': function, **kw}


def todo(row, note):
    R[row] = {'status': 'todo', 'note': note}


# ---- Két világháború között ------------------------------------------------
todo(4, 'A Madách-házak/kapu pontos házszáma a talált forrásokban nem egyértelmű (Madách Imre tér / Károly körút); kézi ellenőrzés kell.')
ok(5, [{'osm': 'way/250716920', 'district': 'XII', 'address': 'Csaba utca 5.',
        'sources': [WD('Q1415660', 'Városmajori Jézus Szíve-templom, tervező Árkay Aladár és Árkay Bertalan'), WP('Városmajori Jézus Szíve-plébániatemplom')]}], 'templom', architect_confirmed_by=['s1'])
ok(6, [{'osm': 'way/250846071', 'district': 'II', 'address': 'Pasaréti út 137.',
        'sources': [URL('Welovebudapest: a pasaréti ferences templom évfordulója (2024)', 'https://welovebudapest.com/cikk/2024/10/14/latnivalok-es-kultura-pasaret-ferences-templom-evfordulo/')]}], 'templom')
todo(14, 'Rimanóczy Gyula postaigazgatósági épületének címét nem találtam megbízható forrásban (a Krisztina körúti Postapalota Sándy Gyula műve, nem ez).')
ok(15, [{'address': 'Mészáros utca 5-7', 'district': 'I',
         'sources': [WD('Q1298465', 'Szilágyi Erzsébet Gimnázium'), URL('Fortepan/Hungaricana – a Mészáros utcai gimnázium (1943)', 'https://gallery.hungaricana.hu/en/Fortepan/1524648')]}], 'iskola',
   description='Az épület címe forrásból igazolt; a tervezők és az évszám a kvíz adata.')
todo(16, 'A Levente Otthon címét nem találtam meg forrásban.')
ok(18, [{'address': 'Szabadság tér 5-6', 'district': 'V', 'sources': [WP('Lauber László', 'művek listája: 1938–40, Szabadság tér 5–6.')]}], 'pénzintézet',
   architect_confirmed_by=['s1'])
todo(19, 'A Palatinus strand területe ismert, de Janáky 1937-es épületének kontúrja az OSM-ben nem különíthető el a strand területétől.')
todo(20, 'A Kelenföldi Erőmű telepe ismert, de a Bierbauer-féle épület(ek) kontúrja nem azonosítható biztosan (a szócikk szerint több épületet tervezett 1925–34 között).')
todo(22, 'Az Anyag- és Árhivatal (később Könnyűipari Minisztérium) épületének címét nem találtam forrásban.')
todo(24, 'Ellentmondó címek: az Iparművészeti Múzeum fotója szerint Hankóczy u. 2., egy nyomtatott forrás szerint Ruszti utca 8/B. Kézi ellenőrzés kell.')
ok(25, [{'address': 'Berkenye utca 12', 'district': 'II', 'sources': [WD('Q127699438', 'Kozma Lajos, Berkenye utca 12.'), AI(3005, 'Haus in der Berkenye-Straße')]}], 'lakóház (villa)',
   architect_confirmed_by=['s1'])
ok(26, [{'address': 'Margit körút 55', 'district': 'II', 'sources': [
    URL('Modernism in Architecture: Átrium (1935)', 'https://modernism-in-architecture.org/buildings/atrium/'),
    URL('Pongrácz Erzsébet: The Cinemas of Budapest (Hungaricana)', 'https://library.hungaricana.hu/en/view/VaroshazaKiado_0086/?pg=24')]}], 'bérház és mozi',
   architect_confirmed_by=['s1', 's2'])
ok(27, [{'address': 'Vadász utca 29', 'district': 'V', 'sources': [WD('Q5567049', 'Üvegház, Vadász utca 29., tervező Kozma Lajos')]}],
   'üzlet- és raktárház', architect_confirmed_by=['s1'])

NAPRA = [  # Wikidata/archINFORM: az egyes házak saját tervezői
    ('2', 'Wälder Gyula', 80222), ('5', 'Kozma Lajos', 3181), ('6', 'Kozma Lajos', 3004), ('13', 'Masirevich György', 80210),
    ('15', 'Ligeti Pál, Molnár Farkas', 3611), ('18', 'Weichinger Károly', 80217), ('19', 'Gerlóczy Gedeon', 80223), ('20', 'Fischer József', 4980),
]
ok(28, [{'label': f'Napraforgó utca {n}.', 'address': f'Napraforgó utca {n}', 'district': 'II',
         'architects': [a.strip() for a in arch.split(',')],
         'architect_confirmed_by': ['s1'],
         'note': f'A ház tervezője az archINFORM szerint {arch}; a kvíz a teljes telepet a CIRPAC-csoporthoz köti.',
         'sources': [AI(ai, f'Wohnhaus Napraforgó utca {n}' + ('/8 (ikerház)' if n == '6' else ''))]} for n, arch, ai in NAPRA], 'lakóház (kísérleti lakótelep)',
   description='A 22 házas telepből az a nyolc szerepel, amelyhez online adatbázisban cím és tervező található.')
ok(29, [{'address': 'Lejtő út 2/b', 'district': 'XII', 'lat': 47.4902, 'lon': 19.0153,
         'sources': [AI(927, 'Villa in der Lejtő-Straße'), URL('Welovebudapest: Molnár Farkas – Dálnoki-Kováts-villa', 'https://welovebudapest.com/cikk/2026/06/11/molnar-farkas-dalnoki-kovats-villa-bauhaus-budapest/')]}], 'lakóház (villa)',
   architect_confirmed_by=['s1', 's2'])
ok(30, [{'address': 'Mihály utca 11', 'lat': 47.4872, 'lon': 19.0348, 'sources': [AI(23477, 'Wohnhaus in der Mihály-Straße (Ligeti Pál, Molnár Farkas)')]}], 'lakóház (villa)',
   architect_confirmed_by=['s1'])
ok(31, [{'address': 'Harangvirág utca 11', 'district': 'II', 'lat': 47.5226, 'lon': 18.9993, 'sources': [AI(19288, 'Villa in der Harangvirág-Straße (Molnár Farkas)')]}], 'lakóház (villa)',
   architect_confirmed_by=['s1'])
ok(32, [{'address': 'Kavics utca 8/f', 'district': 'II', 'lat': 47.5209, 'lon': 19.0338, 'sources': [AI(23559, 'Wohnhaus in der Kavics-Straße (Molnár Farkas)')]}], 'lakóház (villa)',
   architect_confirmed_by=['s1'])
ok(33, [{'address': 'Lotz Károly utca 4/B', 'district': 'II', 'lat': 47.518189, 'lon': 18.997873, 'sources': [AI(929, 'Wohnhaus Lotz Károly utca 4B (Molnár Farkas)')]}], 'lakóház (villa)',
   architect_confirmed_by=['s1'])
todo(34, 'A pestújhelyi kórház személyzeti épületének pontos címét nem találtam (Ferkai András disszertációja tárgyalja).')
ok(35, [{'address': 'Baba utca 14', 'district': 'II', 'sources': [WD('Q127785560', 'Járitz-villa, Baba utca 14.'), AI(10137, 'Járitz-Villa')]}], 'lakóház (villa)',
   architect_confirmed_by=['s1'])
ok(36, [{'address': 'Szépvölgyi út 88/b', 'district': 'II', 'lat': 47.5301, 'lon': 19.0268, 'sources': [AI(1821, 'Villa Hoffmann (Fischer József)')]}], 'lakóház (villa)',
   architect_confirmed_by=['s1'])
ok(37, [{'osm': 'relation/3331750', 'district': 'VIII', 'address': 'Fiumei út 19.',
         'sources': [WP('Komor Marcell', 'művek listája: Fiumei út 19.'), WP('Jakab Dezső', '1929–31 bővítés')]}], 'székház (társadalombiztosítás)',
   architect_confirmed_by=['s1', 's2'], description='A székház 1911–13-ban épült; a kvíz dátuma (1930) az 1929–31-es bővítésre utal.')
ok(38, [{'address': 'Visegrádi utca 47/c', 'district': 'XIII', 'sources': [URL('FSZEK Budapest-képarchívum: V. ker. rendelőintézet, Visegrádi utca 47/c–d (1942)', 'https://dspace.fszek.hu/items/2b820ffd-59b6-40af-9592-71912b01ee12/full')]}], 'rendelőintézet')
ok(39, [{'address': 'Fiumei út 17', 'district': 'VIII', 'queries': ['Fiumei út 13, VIII. kerület, Budapest', 'Fiumei út 15, VIII. kerület, Budapest'],
         'sources': [WP('Gerlóczy Gedeon', 'OTI Baleseti kórház, Fiumei út 13–17., 1937–39')]}], 'kórház', architect_confirmed_by=['s1'])
ok(40, [{'address': 'II. János Pál pápa tér 15', 'district': 'VIII', 'lat': 47.4954, 'lon': 19.0799,
         'queries': ['II. János Pál pápa tér 14, VIII. kerület, Budapest', 'II. János Pál pápa tér 16, VIII. kerület, Budapest'],
         'sources': [AI(27017, 'Mietshaus-Gruppe OTI, II. János Pál pápa tér 14–16 (volt Köztársaság tér)')]}], 'bérház',
   description='A tér korábbi neve Köztársaság tér.')
ok(41, [{'label': 'Pozsonyi út 36–38. (Szent István park 27–29.)', 'address': 'Pozsonyi út 38', 'district': 'XIII',
         'queries': ['Pozsonyi út 36, XIII. kerület, Budapest'],
         'note': 'Alföldi Cukorgyár Rt. bérháza a Dunapark kávéházzal, 1936–37.',
         'sources': [WP('Hofstätter Béla', 'művek listája, Domány Ferenccel')]},
        {'label': 'Pozsonyi út 40. (Szent István park 30.)', 'address': 'Pozsonyi út 40', 'district': 'XIII',
         'note': 'Magyar Rabbethege és Giesecke Rt. bérháza, 1935–37.',
         'sources': [WP('Hofstätter Béla', 'művek listája, Domány Ferenccel')]}], 'bérház',
   architect_confirmed_by=['s1'],
   description='A kvíz „apartmanházak” megjelölését a Hofstätter–Domány páros Szent István parki, 1935–37-es közös bérházaira vonatkoztattam.')
todo(42, 'A Wikipédia szerint a Hofstätter–Domány-féle Margit körút 15–17. a Weiss Manfréd Nyugdíjpénztár bérháza (1937–38); az „Elektromos Művek bérháza” megnevezés ezzel nem egyezik – ellenőrizendő.')
for row, addr, d, note in [(43, 'Kékgolyó utca 10', 'XII', '1933–34. Lakóház, Kékgolyó utca 10.'),
                           (44, 'Hollósy Simon utca 9', 'XII', '1934. Németvölgyi udvar, ma Hollósy Simon utca 9.'),
                           (45, 'Irányi utca 8', 'V', '1936. Lakóház (átépítve), Irányi utca 8.'),
                           (46, 'Vincellér utca 26/a', 'XI', '1942. Lakóház, Vincellér utca 26/a.')]:
    ok(row, [{'address': addr, 'district': d, 'sources': [WP('Lauber László', f'művek listája: {note}')]}], 'bérház', architect_confirmed_by=['s1'])
ok(47, [{'address': 'Városmajor utca 50/b', 'district': 'XII', 'sources': [URL('Wikipedia (en): Tschögl Building, Városmajor utca 50/b', 'https://en.wikipedia.org/wiki/Tsch%C3%B6gl_Building')]}], 'bérház',
   architect_confirmed_by=['s1'], description='Tschögl-ház; a források 1940-et vagy 1941-et adnak meg.')
ok(48, [{'address': 'Bartók Béla út 62', 'district': 'XI', 'queries': ['Bartók Béla út 64, XI. kerület, Budapest'],
         'sources': [URL('Welovebudapest: a Simplon mozi és bérház története (2025)', 'https://welovebudapest.com/cikk/2025/09/01/simplon-mozi-berhaz-tortenete-bartok-bela-ut-ujbuda/')]}], 'bérház és mozi',
   architect_confirmed_by=['s1'], description='A Weiss Manfréd Nyugdíjintézeti Pénztár megrendelésére épült (Simplon, később Bartók mozi).')

# ---- 1945–56 ---------------------------------------------------------------
ok(50, [{'address': 'József Attila utca 2', 'district': 'V', 'queries': ['József Attila utca 4, V. kerület, Budapest'],
         'sources': [URL('Trade magazin: a Belügyminisztérium egykori épületének árverése', 'https://trademagazin.hu/en/508-milliardos-kikialtasi-aron-aukciora-kerul-a-belugyminiszterium-egykori-epulete')]}], 'minisztérium',
   description='Egyes források 1947–1951-et adnak meg.')
ok(51, [{'address': 'Dózsa György út 84/a', 'district': 'VI', 'sources': [AI(1585, 'Haus der Gewerkschaften MÉMOSZ'), WD('Q122442029', 'MÉMOSZ-székház')]}], 'szakszervezeti székház', description='Az OSM szerint ma Liget Center irodaház.',
   architect_confirmed_by=['s1'])
todo(52, 'A Bányász szakszervezet Szrogh-féle székházának címét nem találtam forrásban.')
todo(53, 'A Ferihegy 1 terminál épületét az OSM-ben nem sikerült egyértelműen azonosítani.')
todo(54, 'A MÁVAUT-pályaudvar az Erzsébet téren állt (Fortepan, 1949); az épület OSM-kontúrja nem azonosítható biztosan.')
todo(55, 'A Csepeli posta tervezőit a Postamúzeum igazolja, de címet nem találtam (és a források 1949 vs. 1951 között ellentmondanak).')
ok(56, [{'address': 'Fehérvári út 130', 'district': 'XI', 'sources': [WP('Lauber László', 'művek listája: 1949–50, Vas és Fémipari Kutató Intézet, Fehérvári út 130.')]}], 'kutatóintézet',
   architect_confirmed_by=['s1'])
ok(57, [{'address': 'Fehérvári út 12', 'district': 'XI', 'sources': [URL('Wikimedia Commons: Szent Kristóf Szakrendelő (Fehérvári úti SZTK)', 'https://commons.wikimedia.org/wiki/Category:Szent_Krist%C3%B3f_Szakrendel%C5%91_(Budapest)')]}], 'rendelőintézet',
   architect_confirmed_by=['s1'], description='A források a házszámot 12. és 16–20. között adják meg.')
ok(58, [{'address': 'Fő utca 61', 'district': 'II', 'sources': [URL('Városháza Kiadó – Budapest építészeti kalauz (Hungaricana)', 'https://library.hungaricana.hu/hu/view/VaroshazaKiado_0058/?pg=22')]}], 'lakóház (pontház)',
   architect_confirmed_by=['s1'], description='A forrás kilencszintes, 48 lakásos pontházként írja le, 1948–49.')
ok(59, [{'address': 'Lehel utca 2/A', 'district': 'XIII', 'sources': [URL('Angyalföldi Helytörténeti Gyűjtemény (museum-digital): élmunkásházak, Lehel u. 2/A', 'https://bu.hu.museum-digital.org/pdf/object/420696.pdf?lang=en')]}], 'lakóház (élmunkásház)',
   architect_confirmed_by=['s1'], description='Négyépületes élmunkás-lakóházcsoport.')
ok(60, [{'osm': 'relation/107772', 'district': 'XI', 'address': 'Móricz Zsigmond körtér 10.', 'sources': [URL('OpenStreetMap: Gomba, Móricz Zsigmond körtér', 'https://www.openstreetmap.org/relation/107772')]}], 'villamosváró / üzlet')
todo(61, 'A Zsombolyai úti kollégiumot nem találtam forrásban.')
todo(62, 'A Népstadiont 2016-ban lebontották; helyén a Puskás Aréna áll, ezért nem a mai épületre rajzoljuk. Történeti kontúrként később felvehető.')
ok(63, [{'address': 'Mechwart liget 1', 'district': 'II', 'queries': ['Budapest Főváros II. Kerületi Önkormányzat', 'II. kerületi Polgármesteri Hivatal'],
         'sources': [URL('Welovebudapest: Helyóvó – a Mechwart ligeti bunker', 'https://welovebudapest.com/cikk/2026/02/20/helyovo-ovohely-mechwart-liget-bunker-masodik-kerulet-helytorteneti-gyujtemeny/')]}], 'pártház (ma kerületi önkormányzat)',
   architect_confirmed_by=['s1'])
todo(64, 'A Zugligeti úti Népművelési Intézet épületét nem találtam forrásban.')
todo(66, 'A Csepeli rendőrség Szrogh-féle épületét nem találtam forrásban.')
ok(75, [{'address': 'Hűvösvölgyi út 64', 'district': 'II', 'sources': [URL('Welovebudapest: felújították az egykori Pannónia Filmstúdiót', 'https://welovebudapest.com/cikk/2017/03/16/ujra-a-verkeringesben-felujitottak-az-egykori-pannonia-filmstudiot')]}], 'filmstúdió',
   architect_confirmed_by=['s1'])
ok(76, [{'osm': 'way/24727027', 'district': 'XI', 'address': 'Műegyetem rakpart 7-9.', 'sources': [URL('Wikimedia Commons: BUTE R building', 'https://commons.wikimedia.org/wiki/Category:BUTE_R_building')]}], 'egyetemi épület',
   architect_confirmed_by=['s1'])

# ---- 1956–68 ---------------------------------------------------------------
todo(78, 'A Chemolimpex-irodaház címét nem találtam forrásban.')
ok(79, [{'address': 'Pozsonyi út 56', 'district': 'XIII', 'sources': [URL('Architectuul: Headquarters of the Aluminium Industry Trust', 'https://architectuul.com/architecture/headquarters-of-the-aluminium-industry-trust')]}], 'irodaház (székház)',
   architect_confirmed_by=['s1'], description='A források 1964–67 közé teszik; ma átalakítva.')
todo(80, 'A BHG műhelyépületét nem találtam forrásban.')
todo(82, 'A Csarnok téri (1963) és Dob utcai (1965) transzformátorház tervezőjét a Telex igazolja, de pontos házszám nincs a forrásokban.')
ok(86, [{'address': 'Bem rakpart 33', 'district': 'II', 'queries': ['Novotel Budapest Danube'], 'sources': [URL('World-Architects: Hotel Novotel Danube (az egykori EGI-székház)', 'https://world-architects.com/en/t2-a-architects-budapest/project/hotel-novotel-danube')]}], 'irodaház (ma szálloda)',
   architect_confirmed_by=['s1'], description='2006-ban Novotel szállodává alakították át; a forrás 1967-et ad meg.')
for row in (87, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99):
    todo(row, 'Pontos házszámot nem találtam megbízható forrásban.')
ok(90, [{'address': 'József Attila utca 22', 'district': 'V', 'sources': [URL('Wikimedia Commons: József Attila utca 22 (Lipótváros)', 'https://commons.wikimedia.org/wiki/Category:J%C3%B3zsef_Attila_utca_22_(Lip%C3%B3tv%C3%A1ros)')]}], 'lakóház',
   architect_confirmed_by=['s1'], description='A forrás szerint 1956–58 között épült.')
ok(107, [{'address': 'Szent László tér 15', 'district': 'X', 'sources': [WD('Q116820535', 'Kőbánya mozi, Szent László tér 15.')]}], 'mozi')

# ---- 1968–95 ---------------------------------------------------------------
for row, addr in [(118, 'Úri utca 32'), (119, 'Dísz tér 8'), (120, 'Úri utca 23')]:
    ok(row, [{'address': addr, 'district': 'I', 'sources': []}], 'lakóház (műemléki rehabilitáció)',
       description='A címet maga a kvíztábla tartalmazza.')
ok(121, [{'address': 'Nándor utca 5', 'district': 'V', 'queries': ['Nándor utca 7, V. kerület, Budapest'],
          'sources': [URL('Fortepan/Hungaricana: Nándor (Petermann bíró) utca 5–7., az Országos Villamos Teherelosztó épülete', 'https://gallery.hungaricana.hu/en/Fortepan/1541470')]}], 'irodaház (teherelosztó)',
   description='A Peterman bíró utca ma Nándor utca.')
ok(124, [{'osm': 'way/319291836', 'district': 'XII', 'address': 'Hegyalja út 139.', 'sources': [WD('Q1177434', 'Mindenszentek-plébániatemplom, tervező Szabó István')]}], 'templom',
   architect_confirmed_by=['s1'])
ok(127, [{'address': 'Szőlő utca 66', 'district': 'III', 'queries': ['Faluház, Óbuda'], 'sources': [WD('Q95748698', 'Faluház, Szőlő utca 66–94.')]}], 'lakóház (panelház)')
todo(128, 'A forrás (Szablyár: Sky-high) az Alagút utca–Attila út–Pauler utca tömböt írja le, házszám nélkül.')
ok(130, [{'osm': 'way/415556517', 'district': 'II', 'address': 'Szilágyi Erzsébet fasor 47.', 'sources': [WD('Q110872954', 'Körszálló, tervező Szrogh György'), WP('Körszálló')]}], 'szálloda', architect_confirmed_by=['s1'],
   description='Az OSM szerint az épület átépítés alatt áll.')
todo(131, 'A „Duna-parti szállodák” megjelölés nem egyértelmű (a Hotel Intercontinental külön sorban szerepel; a Forum szálló 1981-es) – ellenőrizendő.')
ok(132, [{'address': 'Apáczai Csere János utca 4', 'district': 'V', 'sources': [WD('Q108811077', 'Budapest Marriott Hotel (volt Duna Intercontinental), tervező Finta József')]}], 'szálloda',
   architect_confirmed_by=['s1'], description='Ma Budapest Marriott Hotel.')
todo(139, 'A Farkasréti temető ismert, de a ravatalozó épületét az OSM-ben nem azonosítottam biztosan.')
ok(151, [{'osm': 'way/128982110', 'district': 'XIII', 'address': 'Róbert Károly körút 67.', 'sources': [WD('Q56390532', 'Domus Áruház, tervező Reimholz Péter és Lázár Antal'), WP('Domus Áruház')]}], 'áruház', architect_confirmed_by=['s1'])
ok(153, [{'address': 'Váci utca 20', 'district': 'V', 'sources': [URL('Juhász–Szántó: Hotels – Our Budapest (Hungaricana)', 'https://library.hungaricana.hu/en/view/VaroshazaKiado_0076/?pg=58')]}], 'szálloda', description='Az OSM szerint ma Mercure Budapest City Center.',
   architect_confirmed_by=['s1'])
todo(154, 'A Bajcsy-Zsilinszky úti Finta-irodaházat nem azonosítottam biztosan.')
ok(155, [{'address': 'Rákóczi út 1', 'district': 'VIII', 'queries': ['Rákóczi út 3, VIII. kerület, Budapest'],
          'sources': [URL('Eston: East-West Business Center, Rákóczi út 1–3.', 'https://eston.hu/property/east-west-business-center')]}], 'irodaház',
   description='A forrás 1991-es átadást ad meg; a tervezőt csak a kvíz adja.')
ok(156, [{'address': 'Naphegy tér 8', 'district': 'I', 'sources': [URL('Szablyár Péter: Sky-high – Our Budapest (Hungaricana)', 'https://library.hungaricana.hu/en/view/VaroshazaKiado_0004/?pg=55')]}], 'székház (hírügynökség)',
   architect_confirmed_by=['s1'])
todo(163, 'A Számadó utcai lakóparkot nem találtam forrásban.')
todo(164, 'A Graphisoft Park „G-A-B” épületeit egyenként nem azonosítottam.')
ok(165, [{'address': 'Fortuna utca 18', 'district': 'I', 'sources': [URL('Manchester History: Hapimag House, Fortuna utca', 'https://manchesterhistory.net/architecture/2000/hapimag.html')]}], 'apartmanház',
   architect_confirmed_by=['s1'])

json.dump({str(k): v for k, v in R.items()}, open('research.json', 'w'), ensure_ascii=False, indent=1)
print(len(R), 'sor;', sum(1 for v in R.values() if v['status'] == 'ok'), 'ok')
