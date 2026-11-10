import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { DISTRICTS, type Building, type FieldMeta, type Reliability, type YearPrecision } from '../domain/types';
import { centroidOf } from '../domain/geo';
import { newId } from '../domain/io';
import { lookupBuildingAt, osmBuildingContaining, pointInGeometry } from '../data/osmLookup';

type Sel = NonNullable<ReturnType<typeof useStore.getState>['baseSelection']>;

const opt = (s: string) => (s.trim() ? s.trim() : undefined);
const num = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : undefined);

function distinct(values: (string | undefined)[]) {
  return [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'hu'));
}

/**
 * Gyors felvétel: a térképen kattintott (még nem nyilvántartott) épület adatainak megadása.
 * A hely (cím, kerület, körvonal) az OpenStreetMapből töltődik ki; a történeti adatokat
 * a felhasználó adja meg, forrással.
 */
export default function QuickAddForm({ sel }: { sel: Sel }) {
  const buildings = useStore((s) => s.buildings);
  const save = useStore((s) => s.save);
  const startEdit = useStore((s) => s.startEdit);
  const setBaseSelection = useStore((s) => s.setBaseSelection);
  const saveTarget = useStore((s) => s.saveTarget);

  const [looking, setLooking] = useState(true);
  const [osmRef, setOsmRef] = useState<string | undefined>(sel.props.osmRef as string | undefined);
  const [geometry, setGeometry] = useState(sel.geometry);
  const [preciseGeom, setPreciseGeom] = useState(Boolean(sel.props.osmRef));

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [district, setDistrict] = useState('');
  const [precision, setPrecision] = useState<YearPrecision>('exact');
  const [year, setYear] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [architects, setArchitects] = useState('');
  const [style, setStyle] = useState('');
  const [fn, setFn] = useState('');
  const [srcTitle, setSrcTitle] = useState('');
  const [srcUrl, setSrcUrl] = useState('');
  const [reliability, setReliability] = useState<Reliability>('documented');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const options = useMemo(
    () => ({
      styles: distinct(buildings.map((b) => b.style)),
      functions: distinct(buildings.flatMap((b) => [b.originalFunction, b.currentFunction])),
      architects: distinct(buildings.flatMap((b) => b.architects)),
    }),
    [buildings],
  );

  // Cím, kerület és pontos (csempehatáron nem vágott) körvonal az OSM-ből
  useEffect(() => {
    let cancelled = false;
    setLooking(true);
    const [lng, lat] = sel.lngLat;
    const known = Boolean(sel.props.osmRef); // a térkép már a valódi OSM-körvonalat adta
    Promise.all([lookupBuildingAt(lat, lng), known ? Promise.resolve(null) : osmBuildingContaining(lat, lng)]).then(([p, w]) => {
      if (cancelled) return;
      setLooking(false);
      // Cím: a kattintott pont címe (Nominatim), ennek híján az épület OSM-címkéi
      const addr = p?.address ?? (sel.props.address as string | undefined) ?? w?.address;
      if (addr) setAddress(addr);
      if (p?.district) setDistrict(p.district);
      if (known) return;
      const exact = p?.geometry && pointInGeometry(sel.lngLat, p.geometry) ? p : w?.geometry ? w : null;
      if (exact?.geometry) {
        setGeometry(exact.geometry);
        setPreciseGeom(true);
        setOsmRef(exact.osmRef);
        setBaseSelection({ ...sel, geometry: exact.geometry });
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.ts]);

  const yearGiven = precision !== 'unknown';
  const archList = architects.split(/[;,]/).map((s) => s.trim()).filter(Boolean);

  const build = (): Building => {
    const sources: Building['sources'] = [];
    if (srcTitle.trim()) sources.push({ id: 's1', title: srcTitle.trim(), url: opt(srcUrl) });
    if (osmRef) sources.push({ id: 'osm', title: `OpenStreetMap – ${osmRef} (cím, kontúr)`, url: `https://www.openstreetmap.org/${osmRef}`, license: 'ODbL 1.0' });
    const userSrc = srcTitle.trim() ? ['s1'] : [];
    const meta = (): FieldMeta => ({ sourceIds: userSrc, reliability });
    const fieldMeta: Building['fieldMeta'] = {};
    if (archList.length) fieldMeta.architects = meta();
    if (opt(style)) fieldMeta.style = meta();
    if (opt(fn)) fieldMeta.originalFunction = meta();
    if (opt(address)) fieldMeta.address = { sourceIds: osmRef ? ['osm'] : [], reliability: osmRef ? 'community' : 'unknown' };
    const y = num(year), f = num(from), t = num(to);
    return {
      id: newId('m'),
      isDemo: false,
      city: 'Budapest',
      name: opt(name),
      address: opt(address),
      district: opt(district),
      centroid: centroidOf(geometry),
      geometry,
      construction: {
        precision,
        year: precision === 'exact' || precision === 'probable' ? y : undefined,
        from: precision === 'range' ? f : undefined,
        to: precision === 'range' ? t : undefined,
        sourceIds: yearGiven ? userSrc : [],
      },
      alterations: [],
      architects: archList,
      style: opt(style),
      originalFunction: opt(fn),
      protection: 'ismeretlen',
      description: opt(note),
      images: [],
      sources,
      fieldMeta,
      origin: 'manual',
      updatedAt: new Date().toISOString(),
    };
  };

  const validate = (): string | null => {
    if ((precision === 'exact' || precision === 'probable') && num(year) == null) return 'Add meg az évet, vagy válaszd az „Ismeretlen” lehetőséget.';
    if (precision === 'range') {
      if (num(from) == null || num(to) == null) return 'Add meg az intervallum kezdő és záró évét.';
      if (num(from)! > num(to)!) return 'A kezdő év nem lehet nagyobb a záró évnél.';
    }
    if ((yearGiven || archList.length || opt(style)) && !srcTitle.trim())
      return 'Építési évhez, tervezőhöz vagy stílushoz adj meg forrást (pl. könyv, cikk, levéltári jelzet, weboldal).';
    if (!opt(name) && !opt(address)) return 'Adj meg legalább nevet vagy címet.';
    return null;
  };

  const onSave = async () => {
    const err = validate();
    if (err) return setError(err);
    setSaving(true);
    try {
      await save(build());
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="panel-inner quick-add">
      <div className="bp-kicker">Új épület felvétele</div>
      <h2>{name || address || (looking ? 'Cím keresése…' : 'Névtelen épület')}</h2>
      <p className="muted small">
        {looking
          ? 'Cím és pontos körvonal lekérése az OpenStreetMapből…'
          : preciseGeom
            ? 'A cím és a körvonal az OpenStreetMapből töltődött ki – ellenőrizd.'
            : 'Az OSM-ből nem jött pontos körvonal; a térképcsempe kontúrja kerül mentésre (csempehatáron vágott lehet).'}
      </p>

      <div className="qa form">
        <label>Név<input value={name} onChange={(e) => setName(e.target.value)} placeholder="pl. Átrium-ház" /></label>
        <div className="row2">
          <label>Cím<input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
          <label>Kerület
            <select value={district} onChange={(e) => setDistrict(e.target.value)}>
              <option value="">–</option>
              {DISTRICTS.map((d) => <option key={d} value={d}>{d}.</option>)}
            </select>
          </label>
        </div>

        <label>Építési idő
          <select value={precision} onChange={(e) => setPrecision(e.target.value as YearPrecision)}>
            <option value="exact">Pontos év (dokumentált)</option>
            <option value="probable">Valószínű év</option>
            <option value="range">Évintervallum</option>
            <option value="unknown">Ismeretlen</option>
          </select>
        </label>
        {(precision === 'exact' || precision === 'probable') && (
          <label>Év<input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="pl. 1936" /></label>
        )}
        {precision === 'range' && (
          <div className="row2">
            <label>Tól<input type="number" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>Ig<input type="number" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
        )}

        <label>Tervező(k) – vesszővel elválasztva
          <input list="qa-arch" value={architects} onChange={(e) => setArchitects(e.target.value)} />
        </label>
        <div className="row2">
          <label>Stílus / irányzat<input list="qa-style" value={style} onChange={(e) => setStyle(e.target.value)} /></label>
          <label>Funkció<input list="qa-fn" value={fn} onChange={(e) => setFn(e.target.value)} /></label>
        </div>

        <fieldset className="qa-src">
          <legend>Forrás</legend>
          <label>Megnevezés<input value={srcTitle} onChange={(e) => setSrcTitle(e.target.value)} placeholder="pl. Ferkai A.: Buda építészete…, 123. o." /></label>
          <label>Link (ha van)<input value={srcUrl} onChange={(e) => setSrcUrl(e.target.value)} placeholder="https://…" /></label>
          <label>Megbízhatóság
            <select value={reliability} onChange={(e) => setReliability(e.target.value as Reliability)}>
              <option value="documented">Dokumentált (megbízható forrás)</option>
              <option value="probable">Valószínűsített</option>
            </select>
          </label>
        </fieldset>

        <label>Megjegyzés / rövid leírás<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>

        <datalist id="qa-arch">{options.architects.map((a) => <option key={a} value={a} />)}</datalist>
        <datalist id="qa-style">{options.styles.map((a) => <option key={a} value={a} />)}</datalist>
        <datalist id="qa-fn">{options.functions.map((a) => <option key={a} value={a} />)}</datalist>
      </div>

      {error && <p className="form-error block">{error}</p>}
      <div className="bp-actions">
        <button className="btn primary" onClick={onSave} disabled={saving || looking}>{saving ? 'Mentés…' : 'Mentés'}</button>
        <button className="btn" onClick={() => startEdit(build())} title="Minden mező: átépítések, képek, védettség, több forrás">Részletes űrlap…</button>
        <button className="btn ghost" onClick={() => setBaseSelection(null)}>Mégse</button>
      </div>
      <p className="hint">
        {saveTarget === 'file'
          ? 'Mentés helye: a projekt mappája (public/data/sajat-modositasok.json).'
          : 'Mentés helye: ez a böngésző. Tartós mentéshez indítsd az alkalmazást az npm run dev paranccsal.'}
      </p>
    </div>
  );
}
