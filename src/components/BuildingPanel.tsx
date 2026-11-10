import { useSelected, useStore } from '../state/store';
import type { AttributableField, Building, FieldMeta } from '../domain/types';
import { IMAGE_KIND_LABELS, PRECISION_LABELS, PROTECTION_LABELS, RELIABILITY_LABELS } from '../domain/types';
import { colorOf, formatConstruction, periodOf } from '../domain/periods';
import { centroidOf } from '../domain/geo';
import { newId } from '../domain/io';

export function Unknown() {
  return <span className="unknown">ismeretlen</span>;
}

export function MetaBadge({ meta }: { meta?: FieldMeta }) {
  if (!meta) return null;
  return <span className={`rel rel-${meta.reliability}`} title={meta.sourceIds.length ? `Forrás: ${meta.sourceIds.join(', ')}` : 'Nincs forrás megadva'}>{RELIABILITY_LABELS[meta.reliability]}</span>;
}

export function Field({ label, value, b, field }: { label: string; value: React.ReactNode; b: Building; field?: AttributableField }) {
  const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>
        {empty ? <Unknown /> : value} {!empty && field ? <MetaBadge meta={b.fieldMeta[field]} /> : null}
      </dd>
    </div>
  );
}

export function DemoBanner() {
  return (
    <div className="demo-banner" role="note">
      <strong>DEMO tesztadat.</strong> Ez a rekord generált: a kontúr, a cím, az év, a tervező és a leírás nem valós épületre vonatkozik.
    </div>
  );
}

export function YearBlock({ b }: { b: Building }) {
  const p = periodOf(b);
  const c = b.construction;
  return (
    <div className="yearblock">
      <span className="swatch lg" style={{ background: colorOf(b) }} />
      <div>
        <div className="year">{formatConstruction(c)}</div>
        <div className="year-sub">
          {PRECISION_LABELS[c.precision]}
          {p ? ` · ${p.label}` : ''}
          {c.sourceIds.length ? ` · forrás: ${c.sourceIds.join(', ')}` : c.precision !== 'unknown' ? ' · forrás nincs megadva' : ''}
        </div>
      </div>
    </div>
  );
}

export default function BuildingPanel() {
  const b = useSelected();
  const baseSel = useStore((s) => s.baseSelection);
  const openDetail = useStore((s) => s.openDetail);
  const startEdit = useStore((s) => s.startEdit);
  const select = useStore((s) => s.select);

  if (!b && baseSel) {
    const p = baseSel.props;
    return (
      <div className="panel-inner">
        <div className="bp-kicker">OpenStreetMap-kontúr</div>
        <h2>{String(p.name ?? 'Adatbázison kívüli épület')}</h2>
        <p className="muted">
          Ez az épület az alaptérképen szerepel, de még nincs az atlasz adatbázisában. Építési éve, tervezője és stílusa ismeretlen.
        </p>
        {p.render_height != null && <p className="muted">Az OSM szerinti magasság: {String(p.render_height)} m</p>}
        <button
          className="btn primary"
          onClick={() =>
            startEdit({
              id: newId('m'),
              isDemo: false,
              city: 'Budapest',
              centroid: centroidOf(baseSel.geometry),
              geometry: baseSel.geometry,
              construction: { precision: 'unknown', sourceIds: [] },
              alterations: [],
              architects: [],
              protection: 'ismeretlen',
              images: [],
              sources: [{ id: 'osm', title: 'OpenStreetMap közreműködők – épületkontúr', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0' }],
              fieldMeta: {},
              origin: 'manual',
              updatedAt: new Date().toISOString(),
            })
          }
        >
          Felvétel az adatbázisba…
        </button>
        <p className="hint">A kontúr a vektorcsempéből származik; csempehatáron levágott lehet.</p>
      </div>
    );
  }

  if (!b) {
    return (
      <div className="panel-inner empty">
        <h2>Épület adatlap</h2>
        <p className="muted">Kattints egy épületre a térképen, vagy keress a bal oldali keresőben.</p>
      </div>
    );
  }

  const cover = b.images[0];
  return (
    <div className="panel-inner">
      {b.isDemo && <DemoBanner />}
      <div className="bp-kicker">{b.district ? `Budapest, ${b.district}. kerület` : 'Budapest'}</div>
      <h2>{b.name ?? b.address ?? 'Névtelen épület'}</h2>
      {b.name && b.address && <div className="bp-address">{b.address}</div>}

      <YearBlock b={b} />

      <dl className="fields">
        <Field label="Tervező" value={b.architects.join(', ')} b={b} field="architects" />
        <Field label="Stílus" value={b.style} b={b} field="style" />
        <Field label="Eredeti funkció" value={b.originalFunction} b={b} field="originalFunction" />
        <Field label="Jelenlegi funkció" value={b.currentFunction} b={b} field="currentFunction" />
        <Field label="Védettség" value={b.protection !== 'ismeretlen' ? PROTECTION_LABELS[b.protection] : undefined} b={b} field="protection" />
      </dl>

      {b.description && <p className="desc">{b.description}</p>}

      <div className="photos">
        {cover ? (
          <figure>
            <img src={cover.url} alt={cover.caption ?? ''} loading="lazy" />
            <figcaption>{IMAGE_KIND_LABELS[cover.kind]}{cover.year ? `, ${cover.year}` : ''}{cover.license ? ` · ${cover.license}` : ''}</figcaption>
          </figure>
        ) : (
          <div className="photo-empty">Nincs csatolt fénykép</div>
        )}
      </div>

      <div className="sources-short">
        <h4>Források</h4>
        {b.sources.length ? (
          <ul>{b.sources.map((s) => <li key={s.id}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</li>)}</ul>
        ) : (
          <p className="muted">Nincs forrás megadva – az adatok nem ellenőrzöttek.</p>
        )}
      </div>

      <div className="bp-actions">
        <button className="btn primary" onClick={() => openDetail(true)}>Részletes adatlap</button>
        <button className="btn" onClick={() => startEdit(structuredClone(b))}>Szerkesztés</button>
        <button className="btn ghost" onClick={() => select(null)}>Bezárás</button>
      </div>
    </div>
  );
}
