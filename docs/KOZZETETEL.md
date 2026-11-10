# Közzététel és online adatbázis

## 1. Weboldal (GitHub Pages)
A kód a GitHub-repóban él. Minden feltöltés (push a `main` ágra) után a
`.github/workflows/deploy.yml` lefuttatja a teszteket, megépíti az oldalt, és közzéteszi:
`https://<felhasználó>.github.io/<repó>/`

Egyszeri beállítás a GitHubon: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## 2. Online adatbázis (Supabase, ingyenes csomag)
1. https://supabase.com → regisztráció → **New project** (régió: Central EU / Frankfurt).
2. **SQL Editor → New query**: másold be a `supabase/setup.sql` teljes tartalmát → **Run**.
3. **Authentication → Sign In / Providers → Email**: a „Allow new users to sign up” legyen **kikapcsolva**
   (így csak az tud szerkeszteni, akit te felveszel).
4. **Authentication → Users → Add user → Create new user**: e-mail + jelszó a szerkesztőknek
   (pl. magadnak). „Auto Confirm User” legyen bekapcsolva.
5. **Project Settings → API Keys** (vagy **Data API**): a *Project URL* és a **publishable** (régi
   nevén *anon public*) kulcs kell. A *secret* / *service_role* kulcsot soha ne add ki és ne írd be sehova.
6. Írd be a kettőt a `public/config.json` fájlba (a GitHubon a fájl megnyitása → ceruza ikon →
   **Commit changes**):
   ```json
   { "supabaseUrl": "https://xxxx.supabase.co", "supabaseKey": "sb_publishable_..." }
   ```
   Pár perc múlva a weboldal az online adatbázist használja: böngészni bárki tud, szerkeszteni
   a jobb felső **Bejelentkezés** után lehet.

## 3. Tömeges feltöltés
**Feltöltés** fül → Excel-sablon letöltése → kitöltés (egy sor = egy épület; *Cím* és *Kerület*
alapján keresi meg az épületet) → fájl kiválasztása → **Címek keresése** → ellenőrzés →
**N épület feltöltése**. Ami nem található, letölthető CSV-ben, és a térképen kattintással felvehető.
A címkereső (OpenStreetMap Nominatim) használati feltétele miatt kb. 1 sor/másodperc;
nagyon nagy (több ezres) tételnél érdemes több részletben feltölteni.
