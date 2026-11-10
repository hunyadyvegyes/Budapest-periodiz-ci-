# Adatforrások – elérhetőség, licenc, lefedettség, adatminőség

Kiinduló áttekintés a fejlesztői specifikáció 9. pontjához. **Nem jogi tanácsadás**: a
licenc- és felhasználási feltételeket minden forrásnál a hivatalos oldalon, felhasználás
előtt újra ellenőrizni kell, és nem egyértelmű esetben az intézménytől írásos engedélyt kérni.

Fő megállapítás: **egységes, letölthető, forrással alátámasztott budapesti építésiév-adatbázis
nem ismert.** A kontúrok OSM-ből jól lefedhetők; az építési év, a tervező és a stílus
rekordonkénti, forrásalapú feldolgozást igényel.

| Forrás | Mit ad | Elérhetőség | Licenc / feltétel | Lefedettség | Adatminőség | Javasolt használat |
|---|---|---|---|---|---|---|
| **OpenStreetMap** | Épületkontúr; részben cím, név, szintszám; elszórtan `start_date`, `architect`, `building:architecture`, `heritage`, `wikidata` | Overpass API, Geofabrik-kivonat (napi), vektorcsempék | ODbL 1.0 – forrásmegjelölés, a származtatott adatbázis share-alike | Kontúr: lényegében teljes; évszám: töredékes | Kontúr jó; az évszám ellenőrizetlen, forrása ritkán megadott | Geometriai alap; évszám csak „közösségi” jelöléssel, ellenőrzendő (`npm run fetch:osm`) |
| **Budapest Főváros Levéltára (BFL)** | Építési engedélyek, tervtár, telekkönyvek, címtárak | Kutatótermi és részben online (Hungaricanán keresztül) | Kutatható; digitális másolatok közlése engedélyhez kötött | Egész város, jelentős hiányokkal (háborús pusztulás) | Elsődleges forrás, a legmegbízhatóbb évhez és tervezőhöz | „Dokumentált” év/tervező; rekordonként levéltári jelzettel |
| **Hungaricana** | Digitalizált levéltári, könyvtári, múzeumi anyag, tervek, térképek | Nyilvános web, keresés | Böngészés szabad; tömeges letöltés és újraközlés a gyűjtemény feltételei szerint | Széles, nem egységes | Forrástípustól függ | Hivatkozott forrás URL-lel; a képek beágyazása csak engedéllyel |
| **Fortepan** | Archív fotók évszámmal, gyakran helymegjelöléssel | Nyilvános web | CC BY-SA 3.0 (megjelölendő: Fortepan / adományozó) | Sok budapesti utcakép, nem épületszintű index | Az évszám a felvétel ideje, nem az építésé | Archív képek a rekordokhoz; az évből **nem** szabad építési évet következtetni |
| **Lechner Tudásközpont – műemléki nyilvántartás** | Műemlékek, műemléki környezet, törzsszám | Nyilvános lekérdező felületek | Gépi újrafelhasználás feltételei tisztázandók | Országos, a védett állományra | Hivatalos nyilvántartás | Védettségi mező „dokumentált” forrása; tömeges import egyeztetés után |
| **Magyar Építészeti Múzeum és Műemlékvédelmi Dokumentációs Központ** | Tervtár, hagyatékok, fotótár | Kutatás bejelentkezéssel | Reprodukció és közlés engedéllyel | Kiemelkedő épületek, építészhagyatékok | Elsődleges / szakértői | Tervező és tervdokumentáció forrása, hivatkozással |
| **Fővárosi és kerületi önkormányzatok** | Helyi védettségi rendeletek (címlisták), településrendezési tervek | Nemzeti Jogszabálytár, önkormányzati honlapok | Jogszabályszöveg szabadon felhasználható | Kerületenként eltérő | Hivatalos | Helyi védettség CSV-be gyűjtve, importtal |
| **Budapesti nyilvános térinformatikai adatok** | Kerülethatár, címek, egyes tematikus rétegek | Portálonként eltérő | Adatkészletenként eltérő | Változó | Változó | Egyenként vizsgálandó; addig az OSM-kerülethatár |
| **Wikidata / Wikimedia Commons** | Nevezetes épületek (építés éve, építész, kép) | API, SPARQL | Wikidata: CC0; Commons: fájlonként (CC BY-SA stb.) | Ismertebb épületek | Vegyes; hivatkozás gyakran megadott | Kiinduló jelölt adatok, elsődleges forrással ellenőrizve |
| **Szakirodalom** (építészeti kézikönyvek, monográfiák, topográfiák) | Év, tervező, stílus | Könyvtár | Tények szabadon rögzíthetők, szöveg nem másolható | Jelentős épületekre jó | Szakértői | Rekordonkénti hivatkozás (szerző, cím, oldal) |

## Adatminőségi szabályok az atlaszban

1. Évszám csak forrással rögzíthető (a szerkesztő validációja kikényszeríti).
2. Pontosság mindig explicit: dokumentált pontos év / valószínűsített / intervallum / ismeretlen.
3. Mezőszintű megbízhatóság: dokumentált, valószínűsített, közösségi (OSM), DEMO, ismeretlen.
4. Ellentmondó források esetén a rekord megjegyzésben rögzíti mindkettőt; a színezés a
   kiválasztott (legmegbízhatóbb) értéket használja.
5. Fotó felvételi éve ≠ építési év; a „legkorábbi fotón már látszik” típusú következtetés
   legfeljebb felső korlátként, intervallumként és megjegyzéssel rögzíthető.
