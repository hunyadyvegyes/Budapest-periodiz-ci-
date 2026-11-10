import { useMemo, useRef, useState } from 'react';
import { canEdit, useStore } from '../state/store';
import { TEMPLATE_HEADERS, parseYear, rowsFromTable, type ImportRow } from '../domain/sheet';
import { matchAddress, type MatchResult } from '../data/geocode';
import { formatConstruction } from '../domain/periods';
import { centroidOf } from '../domain/geo';
import { newId } from '../domain/io';
import { normalize } from '../domain/filter';
import type { Building, FieldMeta } from '../domain/types';

type RowState = ImportRow & {
  match?: MatchResult;
  searching?: boolean;
  include: boolean;
  duplicateOf?: string; // meglévő épület azonosítója
};

async function readTable(file: File): Promise<unknown[][]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown[][];
}

async function downloadTemplate() {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ['Átrium-ház', 'Margit körút 55.', 'Budapest', 'II', '1935–1936', 'Kozma Lajos', 'modern', 'bérház és mozi', '(a forrás pontos megnevezése, pl. szerző: cím, oldalszám)', ''],
    ['(minta – töröld ki)', 'Példa utca 1.', 'Szeged', '', 'kb. 1910', '', '', 'lakóház', '', '', 'A „kb.” valószínű évet jelent'],
  ]);
  ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Épületek');
  XLSX.writeFile(wb, 'atlasz-feltoltesi-sablon.xlsx');
}

function csvCell(v: unknown) {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const addrKey = (a?: string, c?: string, d?: string) => normalize(`${a ?? ''} ${c || 'Budapest'} ${d ?? ''}`).replace(/[^a-z0-9]/g, '');

export default function ImportView() {
  const buildings = useStore((s) => s.buildings);
  const saveMany = useStore((s) => s.saveMany);
  const notify = useStore((s) => s.notify);
  const setView = useStore((s) => s.setView);
  const setLoginOpen = useStore((s) => s.setLoginOpen);
  const editable = useStore((s) => canEdit(s));
  const saveTarget = useStore((s) => s.saveTarget);

  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [unknownCols, setUnknownCols] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [defaultSource, setDefaultSource] = useState('');
  const [uncertainYears, setUncertainYears] = useState(false);
  const [running, setRunning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const stopRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // meglévő épületek: OSM-azonosító és cím szerint (duplikátumszűréshez)
  const existing = useMemo(() => {
    const byOsm = new Map<string, Building>();
    const byAddr = new Map<string, Building>();
    for (const b of buildings) {
      if (b.isDemo) continue;
      for (const s of b.sources) {
        const m = s.url?.match(/openstreetmap\.org\/(way|relation)\/(\d+)/);
        if (m) byOsm.set(`${m[1]}/${m[2]}`, b);
      }
      if (b.address) byAddr.set(addrKey(b.address, b.city, b.district), b);
    }
    return { byOsm, byAddr };
  }, [buildings]);

  const onFile = async (f: File) => {
    setError(null);
    try {
      const table = await readTable(f);
      const { rows: parsed, unknown, hasAddress } = rowsFromTable(table);
      if (!parsed.length) throw new Error('A táblázat első lapján nem találtam adatsort.');
      if (!hasAddress) setError('A táblázatban nincs „Cím” oszlop – cím nélkül az épületek nem helyezhetők el. Töltsd le a sablont, és egészítsd ki.');
      setFileName(f.name);
      setUnknownCols(unknown);
      setRows(parsed.map((r) => ({ ...r, include: true })));
    } catch (e) {
      setError('A fájlt nem sikerült beolvasni: ' + (e as Error).message);
    }
  };

  const update = (line: number, patch: Partial<RowState>) => setRows((rs) => rs.map((r) => (r.line === line ? { ...r, ...patch } : r)));

  const searchOne = async (r: RowState) => {
    update(r.line, { searching: true });
    try {
      const m = r.address || r.name
        ? await matchAddress({ address: r.address ?? '', city: r.city, district: r.district, postcode: r.postcode, country: r.country, name: r.name })
        : { status: 'notfound' as const, message: 'Nincs se cím, se név megadva.' };
      const dup = (m.osmRef && existing.byOsm.get(m.osmRef)) || existing.byAddr.get(addrKey(m.address ?? r.address, m.city ?? r.city, m.district ?? r.district));
      update(r.line, { match: m, searching: false, duplicateOf: dup ? dup.id : undefined, include: !dup });
    } catch (e) {
      update(r.line, { searching: false, match: { status: 'notfound', message: (e as Error).message } });
    }
  };

  const searchAll = async () => {
    setRunning(true);
    stopRef.current = false;
    for (const r of rows) {
      if (stopRef.current) break;
      if (r.match?.status === 'found') continue;
      await searchOne(r);
    }
    setRunning(false);
  };

  const sourceFor = (r: RowState) => r.source || defaultSource.trim() || undefined;
  const needsSource = (r: RowState) => Boolean(r.year || r.from || r.architects || r.style);
  const problem = (r: RowState): string | null => {
    if (needsSource(r) && !sourceFor(r)) return 'Forrás hiányzik (évhez, tervezőhöz, stílushoz kötelező).';
    if (!r.name && !r.address) return 'Nincs se név, se cím.';
    return null;
  };

  const ready = rows.filter((r) => r.include && r.match?.status === 'found' && !problem(r));
  const done = rows.filter((r) => r.match).length;

  const toBuilding = (r: RowState): Building => {
    const m = r.match!;
    let construction = parseYear(r.year, r.from, r.to);
    if (uncertainYears && construction.precision === 'exact') construction = { ...construction, precision: 'probable' };
    const src = sourceFor(r);
    const sources: Building['sources'] = [];
    if (src) sources.push({ id: 's1', title: src, url: r.sourceUrl || undefined });
    if (m.osmRef) sources.push({ id: 'osm', title: `OpenStreetMap – ${m.osmRef} (cím, kontúr)`, url: `https://www.openstreetmap.org/${m.osmRef}`, license: 'ODbL 1.0' });
    const userSrc = src ? ['s1'] : [];
    if (construction.precision !== 'unknown') construction.sourceIds = userSrc;
    const meta: FieldMeta = { sourceIds: userSrc, reliability: uncertainYears ? 'probable' : 'documented' };
    const architects = (r.architects ?? '').split(/\s*(?:,|;|\bés\b)\s*/).map((a) => a.trim()).filter(Boolean);
    const fieldMeta: Building['fieldMeta'] = { address: { sourceIds: m.osmRef ? ['osm'] : [], reliability: 'community' } };
    if (architects.length) fieldMeta.architects = meta;
    if (r.style) fieldMeta.style = meta;
    if (r.function) fieldMeta.originalFunction = meta;
    const prev = r.duplicateOf ? buildings.find((b) => b.id === r.duplicateOf) : undefined;
    return {
      id: prev?.id ?? newId('t'),
      isDemo: false,
      city: m.city ?? r.city ?? 'Budapest',
      name: r.name ?? prev?.name,
      address: m.address ?? r.address,
      district: m.district ?? r.district,
      centroid: centroidOf(m.geometry!),
      geometry: m.geometry!,
      construction,
      alterations: prev?.alterations ?? [],
      architects,
      style: r.style,
      originalFunction: r.function,
      protection: prev?.protection ?? 'ismeretlen',
      description: r.note ?? prev?.description,
      images: prev?.images ?? [],
      sources,
      fieldMeta,
      origin: 'import',
      updatedAt: new Date().toISOString(),
    };
  };

  const upload = async () => {
    setUploading(true);
    try {
      const list = ready.map(toBuilding);
      await saveMany(list);
      notify(`${list.length} épület feltöltve.`);
      setRows((rs) => rs.filter((r) => !ready.includes(r)));
    } catch (e) {
      notify('Hiba: ' + (e as Error).message);
    }
    setUploading(false);
  };

  const downloadMissing = () => {
    const rest = rows.filter((r) => !ready.includes(r));
    const lines = [['Sor', 'Név', 'Cím', 'Kerület', 'Építési év', 'Tervező', 'Forrás', 'Ok'].join(';')];
    for (const r of rest) lines.push([r.line, r.name, r.address, r.district, r.year ?? [r.from, r.to].filter(Boolean).join('–'), r.architects, sourceFor(r), problem(r) ?? r.match?.message ?? 'nincs keresve'].map(csvCell).join(';'));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'feltoltes-ellenorizendo.csv';
    a.click();
  };

  if (!editable) {
    return (
      <div className="data-view">
        <h2>Tömeges feltöltés</h2>
        <div className="card">
          <p>Épületek feltöltéséhez jelentkezz be szerkesztőként.</p>
          <button className="btn primary" onClick={() => setLoginOpen(true)}>Bejelentkezés</button>
        </div>
      </div>
    );
  }

  return (
    <div className="data-view import-view">
      <h2>Tömeges feltöltés</h2>
      <ol className="steps">
        <li>
          <strong>Töltsd ki a táblázatot.</strong> Egy sor = egy épület. A <em>Cím</em>, a <em>Település</em> (üresen: Budapest) és budapesti címnél a <em>Kerület</em> alapján az atlasz
          magától megkeresi az épület pontos körvonalát. A kvízapp táblázatának oszlopneveit is felismeri.
          <div className="btn-row"><button className="btn" onClick={downloadTemplate}>Excel-sablon letöltése</button></div>
        </li>
        <li>
          <strong>Forrás.</strong> Évhez, tervezőhöz, stílushoz forrás kell. Ha minden sor ugyanabból a forrásból van, itt egyszer is megadhatod:
          <input id="imp-src" className="wide" value={defaultSource} onChange={(e) => setDefaultSource(e.target.value)} placeholder="pl. Vukoszávlyev Zorán: Magyar építészettörténet II. (előadásanyag)" />
          <label className="check"><input id="imp-unc" type="checkbox" checked={uncertainYears} onChange={(e) => setUncertainYears(e.target.checked)} /> <span>Az évszámok bizonytalanok (pl. képaláírásból) – „valószínűsített” jelöléssel kerüljenek be</span></label>
        </li>
        <li>
          <strong>Válaszd ki a fájlt</strong> (Excel vagy CSV), majd indítsd a címkeresést. Kb. 1–2 másodperc soronként; közben dolgozhatsz mással, csak ezt a lapot hagyd nyitva.
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.ods" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <div className="btn-row">
            <button className="btn primary" onClick={() => fileRef.current?.click()}>Fájl kiválasztása…</button>
            {fileName && <span className="muted">{fileName} · {rows.length} sor</span>}
          </div>
        </li>
      </ol>

      {error && <p className="form-error block">{error}</p>}
      {unknownCols.length > 0 && <p className="hint">Nem használt oszlopok: {unknownCols.join(', ')}</p>}

      {rows.length > 0 && (
        <section className="card">
          <div className="table-head">
            <div>
              <h3>Ellenőrzés</h3>
              <span className="muted small">
                {done}/{rows.length} sor keresve · <span className="chip-s ok">{rows.filter((r) => r.match?.status === 'found').length} megtalálva</span>{' '}
                <span className="chip-s warn">{rows.filter((r) => r.match?.status === 'uncertain').length} körvonal nélkül</span>{' '}
                <span className="chip-s bad">{rows.filter((r) => r.match?.status === 'notfound').length} nem található</span>
              </span>
            </div>
            <div className="btn-row">
              {running ? (
                <button className="btn" onClick={() => (stopRef.current = true)}>Leállítás</button>
              ) : (
                <button className="btn primary" onClick={searchAll} disabled={done === rows.length && rows.every((r) => r.match?.status === 'found')}>
                  {done ? 'Hiányzók keresése' : 'Címek keresése'}
                </button>
              )}
            </div>
          </div>
          {running && <div className="progress"><span style={{ width: `${(done / rows.length) * 100}%` }} /></div>}
          <div className="table-scroll">
            <table className="records import-table">
              <thead>
                <tr><th /><th>Sor</th><th>Név</th><th>Cím</th><th>Település</th><th>Ker.</th><th>Építés</th><th>Tervező</th><th>Állapot</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = problem(r);
                  const st = r.searching ? 'run' : r.match?.status;
                  return (
                    <tr key={r.line} className={!r.include ? 'off' : ''}>
                      <td><input id={`inc-${r.line}`} type="checkbox" checked={r.include} onChange={(e) => update(r.line, { include: e.target.checked })} aria-label="Feltöltésre kijelölve" /></td>
                      <td className="num">{r.line}</td>
                      <td>{r.name ?? <span className="unknown">–</span>}</td>
                      <td><input id={`addr-${r.line}`} className="cell-input" value={r.address ?? ''} onChange={(e) => update(r.line, { address: e.target.value, match: undefined })} /></td>
                      <td><input id={`city-${r.line}`} className="cell-input mid" value={r.city ?? ''} placeholder="Budapest" onChange={(e) => update(r.line, { city: e.target.value, match: undefined })} /></td>
                      <td><input id={`ker-${r.line}`} className="cell-input short" value={r.district ?? ''} onChange={(e) => update(r.line, { district: e.target.value.toUpperCase(), match: undefined })} /></td>
                      <td>{formatConstruction(parseYear(r.year, r.from, r.to))}</td>
                      <td>{r.architects ?? <span className="unknown">–</span>}</td>
                      <td>
                        {st === 'run' && <span className="chip-s">keresés…</span>}
                        {st === 'found' && !r.match?.byName && <span className="chip-s ok">megtalálva</span>}
                        {st === 'found' && r.match?.byName && <span className="chip-s warn" title={r.match.message}>név alapján – ellenőrizd</span>}
                        {st === 'uncertain' && <span className="chip-s warn">körvonal nélkül</span>}
                        {st === 'notfound' && <span className="chip-s bad">nem található</span>}
                        {!st && <span className="chip-s">vár</span>}
                        {r.duplicateOf && <span className="chip-s warn" title="Bejelölve frissíti a meglévő rekordot">már szerepel</span>}
                        {p && <span className="chip-s bad">{p}</span>}
                        {r.match && (r.match.status !== 'found' || r.match.byName) && <div className="small muted">{r.match.message}</div>}
                      </td>
                      <td><button className="link" onClick={() => searchOne(r)} disabled={r.searching}>újra</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="import-foot">
            <button className="btn primary" onClick={upload} disabled={!ready.length || uploading}>
              {uploading ? 'Feltöltés…' : `${ready.length} épület feltöltése`}
            </button>
            <button className="btn" onClick={downloadMissing} disabled={ready.length === rows.length}>A többi letöltése ellenőrzéshez (CSV)</button>
            <button className="btn ghost" onClick={() => setView('map')}>Vissza a térképre</button>
            <span className="hint">
              Mentés helye: {saveTarget === 'online' ? 'online adatbázis' : saveTarget === 'file' ? 'projektmappa' : 'ez a böngésző'}. A „körvonal nélkül” és
              a „nem található” sorokat a térképen kattintással veheted fel.
            </span>
          </div>
        </section>
      )}
    </div>
  );
}
