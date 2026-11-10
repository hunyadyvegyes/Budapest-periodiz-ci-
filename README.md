# Budapest Építészettörténeti Atlasz – prototípus (1. fázis)

Interaktív, böngészőben futó építészettörténeti térkép: Budapest épületei építési idő,
tervező, stílus, funkció és védettség szerint, forrásmegjelöléssel és megbízhatósági jelöléssel.

> **⚠ A beépített adatkészlet DEMO tesztadat.** Az 533 rekord generált: a kontúrok
> szintetikus, pesti zártsorú beépítést utánzó tömbök, a címek, évek, tervezők és leírások
> kitaláltak, és ezt a felület minden szinten jelzi. Valós épületekről a prototípus
> nem állít semmit. Valós adat az OSM-importtal (lent) vagy kézi felvitellel/CSV-importtal kerül be.

## Futtatás

Követelmény: Node.js ≥ 20.

```bash
npm install
```

```bash
npm run dev
```

Majd: <http://localhost:5173>. Éles build: `npm run build`, előnézet: `npm run preview`
(a `dist/` mappa bármilyen statikus tárhelyre feltehető).

Egyéb parancsok:

| Parancs | Mit csinál |
|---|---|
| `npm test` | Egységtesztek (szűrés, korszakok, CSV/GeoJSON, statisztika, OSM-konverzió) |
| `npm run typecheck` | TypeScript-ellenőrzés |
| `npm run gen:demo` | A DEMO adatkészlet újragenerálása (`public/data/demo-buildings.geojson`) |
| `npm run fetch:osm` | Valós OSM-épületkontúrok és kerülethatárok letöltése (lásd lent) |

### Valós OSM-adat betöltése

```bash
npm run fetch:osm
```

Alapértelmezés szerint a belső kerületek (kb. V–IX., I.) befoglaló téglalapját tölti le az
Overpass API-ról, és létrehozza a `public/data/osm-buildings.geojson` és
`public/data/districts.geojson` fájlokat. Az alkalmazás ezeket automatikusan betölti.
Opciók: `--bbox dél,nyugat,észak,kelet`, `--only-dated` (csak `start_date` taggel rendelkező
épületek). Az OSM-ből átvett év, tervező és stílus **„közösségi (nem ellenőrzött)”**
megbízhatósággal és OSM-hivatkozással kerül be; az évszám nélküli épületek ismeretlenek
(semleges szürkék) maradnak. Ilyenkor érdemes a bal panelen kikapcsolni a DEMO rekordokat.

## API-kulcsok és környezeti változók

Másold a `.env.example` fájlt `.env.local` néven. **Kulcs nélkül is minden működik**, kivéve a Google 3D nézetet.

| Változó | Kötelező? | Leírás |
|---|---|---|
| `VITE_BASEMAP_STYLE` | nem | MapLibre-stílus URL. Alapértelmezés: OpenFreeMap Positron (ingyenes, kulcs nélküli, OSM-alapú vektorcsempék). |
| `VITE_GOOGLE_MAPS_API_KEY` | csak Google 3D-hez | Google Cloud projekt, engedélyezett **Maps JavaScript API** (a `maps3d` könyvtárral, fotorealisztikus 3D; ha a konzol jelzi, a **Map Tiles API** is). Kulcs nélkül a „Google 3D” gomb inaktív. |
| `VITE_GOOGLE_MAP_ID` | nem | Későbbi stílusozáshoz. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | nem (2. fázis) | A PostGIS-háttérhez; a prototípus még nem használja. |

A `VITE_` előtagú változók a böngészőbe kerülnek, ezért a Google-kulcsot a Cloud Console-ban
**HTTP-referrer szerint és API szerint korlátozd**, és állíts be kvótát / költségriasztást.

## Költségek

| Komponens | Költség |
|---|---|
| MapLibre GL, React, Recharts | ingyenes, nyílt forrású |
| OpenFreeMap alaptérkép | ingyenes, kulcs nélkül; adományokból működik, SLA nélkül – éles üzemhez saját csempeszerver (pl. Planetiler + PMTiles) vagy fizetős szolgáltató javasolt |
| OpenStreetMap / Overpass | ingyenes (ODbL, forrásmegjelöléssel); az Overpass közös szerverét ne terheld – nagy letöltéshez Geofabrik-kivonat |
| Google Maps Platform – fotorealisztikus 3D | **díjköteles**, térképbetöltésenként számláz, SKU-nként havi ingyenes kerettel. Az aktuális árat a Google Maps Platform árlistáján ellenőrizd. A nézet csak kulccsal és csak kiválasztáskor töltődik be, így teljesen kikapcsolható. |
| Supabase (2. fázis) | ingyenes csomag fejlesztéshez; éles üzemhez fizetős csomag |

## Mit tud a prototípus

- **2D térkép** (MapLibre): épületkontúrok építési korszak szerinti, 16 fokozatú, Lab-térben
  interpolált gradiens színezéssel; ismeretlen év = semleges szürke; valószínűsített vagy
  intervallumos év = szaggatott körvonal; nagyítás, mozgatás, kattintható épületek, kiemelés.
- **Mindig látható jelmagyarázat**, korszakonként ki-/bekapcsolható, darabszámokkal.
- **3D (MapLibre)**: kihúzott épülettömegek (magasság = emeletszám alapján, csak vizualizáció).
- **Google 3D**: fotorealisztikus 3D-csempék, rajta az adatbázis épületei saját, kattintható
  poligonrétegként (`src/map/Google3DView.tsx`). Kulcs nélkül nem tesztelhető; hiba esetén üzenetet ad.
- **Oldalsó adatlap** + **részletes adatlap**: név, cím, kerület, építési év pontossággal és
  forrással, átépítések, tervező, stílus, funkciók, szerkezet, védettség, leírás, képek, források,
  mezőszintű megbízhatóság. A hiányzó adat „ismeretlen”.
- **Keresés** (ékezetfüggetlen; cím, név, tervező, év, stílus, funkció, kerület) és
  **összetett szűrés** (kerület, év, év pontossága, stílus, funkció, tervező, védettség).
- **Idővonal**: hisztogram, kétvégű csúszka, korszak-előbeállítások (1850 előtt, 1860–1900,
  dualizmus, két világháború között, szocializmus, 1990 után) és **beépülési animáció**.
- **Statisztika**: évtizedek, építési intenzitás, stílusok, kerületek, funkciók, tervezők,
  stílusok térbeli eloszlása (kerület × stílus hőtérkép). Egy elemre kattintva a térkép szűr.
- **Adatkezelés**: CSV- és GeoJSON-import/-export, üres CSV-sablon, új rekord kézi felvitele
  (koordinátával vagy OSM-kontúrra kattintva), szerkesztés, törlés. Forrás nélküli ismert év
  mentését a validáció nem engedi (DEMO kivételével).

## Architektúra

```
src/
  domain/      tiszta, UI-független logika: típusok, korszakok/színek, szűrés,
               statisztika, CSV/GeoJSON I/O, geometria  (→ tesztelhető, újrahasznosítható)
  data/        BuildingRepository interfész; LocalRepository (statikus GeoJSON + localStorage);
               Supabase-adattár helye
  state/       zustand store (szűrő, kijelölés, nézet)
  map/         MapView (MapLibre 2D/3D), Google3DView (cserélhető/kikapcsolható), features.ts
               (adatmodell → megjelenítési tulajdonságok)
  components/  szűrőpanel, jelmagyarázat, adatlapok, szerkesztő, idővonal
  views/       statisztika, adatkezelés
scripts/       DEMO-generátor, OSM-letöltő és -konverter
supabase/      PostGIS séma (2. fázis)
docs/          adatforrás-vizsgálat
```

- Az adatmodell és a térképi megjelenítés elválik: a térkép csak a `toMapFeatures()` által
  előállított lapos tulajdonságokat ismeri; az adattár az interfész mögött cserélhető.
- Többvárosos bővítés: a rekordokban `city` mező van, a sémában `city` tábla; a kerületlista és a
  kezdő nézet a városkonfigurációba emelhető ki.
- A Google-függőség egyetlen, lustán betöltött modulban él (`Google3DView`); törlése vagy
  CesiumJS-re cserélése a többi részt nem érinti.

## Ismert korlátok

- A DEMO tömbök a valós alaptérkép épületeire rálóghatnak (szándékosan nem valós kontúrokra
  kötöttük őket, hogy fiktív évek ne kerüljenek valós épületekre).
- A helyi módosítások csak az adott böngészőben (localStorage) élnek.
- A teljes városi épületállomány (kb. 250 ezer kontúr) egyetlen GeoJSON-ként túl nagy;
  ahhoz a PostGIS + vektorcsempe (pl. Martin / pg_tileserv vagy PMTiles) út kell.
- Az alaptérkép kerülethatár-rétege csak akkor jelenik meg, ha a csempeforrás tartalmazza
  (`admin_level=9`); a `fetch:osm` által letöltött `districts.geojson` ettől függetlenül rajzolódik.

## További fejlesztés

**2. fázis**
1. Supabase/PostGIS bekötése (`supabase/schema.sql`), `SupabaseRepository`, bbox-alapú lekérdezés,
   bejelentkezés szerkesztőknek.
2. Teljes városi kontúrállomány: OSM-kivonat → PostGIS → vektorcsempék; rekordok OSM-azonosítóhoz kötése.
3. Valós adatfeltöltés forrásokból (BFL tervtár és építési engedélyek, műemléki nyilvántartás,
   helyi védettségi rendeletek, szakirodalom) – rekordonként forrással.
4. Google 3D éles tesztelése kulccsal; költségkorlát; alternatívaként CesiumJS + saját 3D Tiles.
5. Képek: Fortepan-hivatkozások (CC BY-SA 3.0) és saját fotók Supabase Storage-ban, licenccel.

**3. fázis**
1. Adminisztrációs felület, változásnapló (`building_revision`), jóváhagyási folyamat.
2. Közösségi adatbővítés moderálással.
3. Történeti térképek (georeferált raszterek) átfedő rétegként, időbeli összevetés.
4. Épületek összehasonlítása, összetett várostörténeti statisztikák, URL-ben megosztható szűrők.

## Licenc és forrásmegjelölés

Térképadat © OpenStreetMap közreműködők (ODbL). Alaptérkép: OpenFreeMap / OpenMapTiles.
