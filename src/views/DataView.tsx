import { useRef, useState } from 'react';
import { useFiltered, useStore } from '../state/store';
import { parseCSV, parseGeoJSON, toCSV, toGeoJSON, newId } from '../domain/io';
import { formatConstruction } from '../domain/periods';
import { rectAround } from '../domain/geo';
import type { Building } from '../domain/types';

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const SOURCES: { name: string; what: string; license: string; status: string }[] = [
  { name: 'OpenStreetMap', what: 'Épületkontúrok (teljes városra), részben név, cím, szintszám; elszórtan start_date / architect tag', license: 'ODbL 1.0 – szabadon felhasználható forrásmegjelöléssel, share-alike', status: 'Bekötve: alaptérkép-kontúrok + scripts/fetch-osm.mjs' },
  { name: 'Budapest Főváros Levéltára (BFL)', what: 'Építési engedélyek, tervtár, telekkönyvi iratok – a legfontosabb elsődleges forrás az építési évhez és tervezőhöz', license: 'Kutatható; digitális másolatok újrafelhasználása engedélyhez kötött', status: 'Kézi feldolgozás, rekordonkénti hivatkozással' },
  { name: 'Hungaricana', what: 'Levéltári és könyvtári digitalizált anyagok (pl. BFL tervek, címtárak, térképek)', license: 'Böngészés szabad; tömeges letöltés / újraközlés a gyűjtemény feltételei szerint', status: 'Hivatkozási forrásként (URL a rekordban)' },
  { name: 'Fortepan', what: 'Archív fényképek (évszámmal, gyakran helymegjelöléssel)', license: 'CC BY-SA 3.0 – forrás: Fortepan / adományozó neve', status: 'Kép-URL + licenc a rekord képeinél' },
  { name: 'Lechner Tudásközpont / műemlékvédelmi nyilvántartás', what: 'Műemléki védettség, műemléki környezet, törzsszámok', license: 'Nyilvános lekérdezés; gépi újrafelhasználás feltételeit egyeztetni kell', status: 'Védettségi mező forrásaként; tömeges import vizsgálandó' },
  { name: 'Magyar Építészeti Múzeum és Műemlékvédelmi Dokumentációs Központ', what: 'Tervtári és fotódokumentáció, hagyatékok', license: 'Archívumi kutatás; reprodukció engedéllyel', status: 'Rekordonkénti hivatkozás' },
  { name: 'Fővárosi és kerületi önkormányzatok', what: 'Helyi védettségi rendeletek (mellékletben címlisták), településrendezési adatok', license: 'Jogszabályok szabadon idézhetők; térinformatikai adatok elérhetősége kerületenként eltér', status: 'Helyi védettség importja CSV-ből' },
];

export default function DataView() {
  const buildings = useStore((s) => s.buildings);
  const saveMany = useStore((s) => s.saveMany);
  const startEdit = useStore((s) => s.startEdit);
  const select = useStore((s) => s.select);
  const setView = useStore((s) => s.setView);
  const resetLocal = useStore((s) => s.resetLocal);
  const notify = useStore((s) => s.notify);
  const filtered = useFiltered();
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE = 25;

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      const isCsv = /\.csv$/i.test(file.name) || (!text.trim().startsWith('{') && !text.trim().startsWith('['));
      const { buildings: list, skipped } = isCsv ? parseCSV(text) : parseGeoJSON(text);
      await saveMany(list);
      const msg = `${list.length} rekord importálva (${file.name})${skipped ? `, ${skipped} kihagyva (hiányzó geometria/koordináta)` : ''}.`;
      setReport(msg);
      notify(msg);
    } catch (e) {
      setReport(`Hiba az importnál: ${(e as Error).message}`);
    }
  };

  const newRecord = () => {
    const raw = prompt('Az épület koordinátái (szélesség, hosszúság), pl. 47.4979, 19.0402\nA kontúr később pontosítható; addig jelölő négyzet jelenik meg.');
    if (!raw) return;
    const m = raw.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return notify('Érvénytelen koordináta.');
    const lat = Number(m[1]), lng = Number(m[2]);
    const b: Building = {
      id: newId('m'), isDemo: false, city: 'Budapest', centroid: [lng, lat], geometry: rectAround([lng, lat]), geometryApprox: true,
      construction: { precision: 'unknown', sourceIds: [] }, alterations: [], architects: [], protection: 'ismeretlen',
      images: [], sources: [], fieldMeta: {}, origin: 'manual', updatedAt: new Date().toISOString(),
    };
    startEdit(b);
  };

  const rows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));

  return (
    <div className="data-view">
      <h2>Adatkezelés</h2>
      <div className="data-grid">
        <section className="card">
          <h3>Import</h3>
          <p className="muted">CSV (vessző vagy pontosvessző) vagy GeoJSON. A CSV-oszlopokat lásd az exportált sablonban. Geometria nélküli sor koordinátával (lat, lng) is felvehető.</p>
          <input ref={fileRef} type="file" accept=".csv,.geojson,.json" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <button className="btn primary" onClick={() => fileRef.current?.click()}>Fájl kiválasztása…</button>
          {report && <p className="report">{report}</p>}
        </section>
        <section className="card">
          <h3>Export</h3>
          <p className="muted">Az aktuális szűrés szerinti {filtered.length.toLocaleString('hu')} rekord (a DEMO jelölés megmarad).</p>
          <div className="btn-row">
            <button className="btn" onClick={() => download('budapest-atlasz.geojson', JSON.stringify(toGeoJSON(filtered), null, 1), 'application/geo+json')}>GeoJSON</button>
            <button className="btn" onClick={() => download('budapest-atlasz.csv', '﻿' + toCSV(filtered), 'text/csv;charset=utf-8')}>CSV</button>
            <button className="btn ghost" onClick={() => download('sablon.csv', '﻿' + toCSV([]), 'text/csv;charset=utf-8')}>Üres CSV-sablon</button>
          </div>
        </section>
        <section className="card">
          <h3>Kézi felvitel</h3>
          <p className="muted">Új rekord koordináta alapján, vagy a térképen: kapcsold be az OSM-kontúrokat, kattints egy épületre, majd „Felvétel az adatbázisba”.</p>
          <div className="btn-row">
            <button className="btn primary" onClick={newRecord}>Új épület…</button>
            <button className="btn danger" onClick={() => confirm('A böngészőben tárolt összes módosítás és import törlődik. Folytatod?') && resetLocal()}>Helyi módosítások törlése</button>
          </div>
          <p className="hint">A prototípus a böngésző helyi tárolójában (localStorage) menti a módosításokat. A Supabase/PostGIS háttér sémája: <code>supabase/schema.sql</code>.</p>
        </section>
      </div>

      <section className="card">
        <div className="table-head">
          <h3>Rekordok ({filtered.length.toLocaleString('hu')} / {buildings.length.toLocaleString('hu')})</h3>
          <div className="pager">
            <button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
            <span>{Math.min(page + 1, pages)} / {pages}</span>
            <button className="btn small" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>›</button>
          </div>
        </div>
        <table className="records">
          <thead>
            <tr><th>Azonosító</th><th>Név / cím</th><th>Ker.</th><th>Építés</th><th>Tervező</th><th>Stílus</th><th>Funkció</th><th>Eredet</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td><code>{b.id}</code></td>
                <td>{b.name ?? b.address ?? '—'}</td>
                <td>{b.district ?? '—'}</td>
                <td>{formatConstruction(b.construction)}</td>
                <td>{b.architects.join(', ') || <span className="unknown">ismeretlen</span>}</td>
                <td>{b.style ?? <span className="unknown">ismeretlen</span>}</td>
                <td>{b.originalFunction ?? '—'}</td>
                <td>{b.isDemo ? <span className="demo-tag">DEMO</span> : b.origin}</td>
                <td className="actions">
                  <button className="link" onClick={() => { select(b.id, true); setView('map'); }}>térkép</button>
                  <button className="link" onClick={() => startEdit(structuredClone(b))}>szerk.</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Adatforrások – elérhetőség és felhasználhatóság (áttekintés)</h3>
        <p className="muted">Részletesen: <code>docs/ADATFORRASOK.md</code>. Egységes, letölthető budapesti építésiév-adatbázis jelenleg nem ismert; az évek és tervezők rekordonként, forrásmegjelöléssel vihetők fel.</p>
        <table className="records">
          <thead><tr><th>Forrás</th><th>Tartalom</th><th>Licenc / feltételek</th><th>Bekötés a prototípusban</th></tr></thead>
          <tbody>
            {SOURCES.map((s) => <tr key={s.name}><td><strong>{s.name}</strong></td><td>{s.what}</td><td>{s.license}</td><td>{s.status}</td></tr>)}
          </tbody>
        </table>
      </section>
    </div>
  );
}
