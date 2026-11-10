import { useEffect } from 'react';
import { useSelected, useStore } from '../state/store';
import { DemoBanner, Field, YearBlock } from './BuildingPanel';
import { IMAGE_KIND_LABELS, PROTECTION_LABELS, RELIABILITY_LABELS, type AttributableField } from '../domain/types';

const FIELD_LABELS: Record<AttributableField, string> = {
  name: 'Név', address: 'Cím', architects: 'Tervező', style: 'Stílus', originalFunction: 'Eredeti funkció',
  buildingType: 'Épülettípus', floors: 'Emeletszám', structure: 'Szerkezet', currentFunction: 'Jelenlegi funkció',
  protection: 'Védettség', description: 'Leírás',
};

export default function DetailModal() {
  const b = useSelected();
  const open = useStore((s) => s.detailOpen);
  const openDetail = useStore((s) => s.openDetail);
  const startEdit = useStore((s) => s.startEdit);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openDetail(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDetail]);

  if (!open || !b) return null;
  const metaEntries = Object.entries(b.fieldMeta) as [AttributableField, NonNullable<(typeof b.fieldMeta)[AttributableField]>][];

  return (
    <div className="modal-backdrop" onClick={() => openDetail(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Részletes adatlap" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <div className="bp-kicker">Részletes adatlap · {b.id}</div>
            <h2>{b.name ?? b.address ?? 'Névtelen épület'}</h2>
          </div>
          <button className="icon-btn" onClick={() => openDetail(false)} aria-label="Bezárás">✕</button>
        </header>
        <div className="modal-body">
          {b.isDemo && <DemoBanner />}
          <div className="detail-grid">
            <section>
              <h3>Alapadatok</h3>
              <dl className="fields">
                <Field label="Név" value={b.name} b={b} field="name" />
                <Field label="Cím" value={b.address} b={b} field="address" />
                <Field label="Kerület" value={b.district ? `${b.district}. kerület` : undefined} b={b} />
                <Field label="Koordináták" value={`${b.centroid[1].toFixed(6)}, ${b.centroid[0].toFixed(6)}`} b={b} />
                <Field label="Kontúr" value={b.geometryApprox ? 'nincs valódi kontúr (jelölő négyzet)' : `${b.geometry.type}`} b={b} />
              </dl>
              <h3>Építési idő</h3>
              <YearBlock b={b} />
              {b.construction.note && <p className="muted">{b.construction.note}</p>}
              <h4>Átépítések, bővítések</h4>
              {b.alterations.length ? (
                <ul className="plain">
                  {b.alterations.map((a, i) => (
                    <li key={i}>
                      <strong>{a.year ?? (a.from && a.to ? `${a.from}–${a.to}` : 'ismeretlen év')}</strong>: {a.description}
                      {a.sourceIds.length ? <span className="muted"> ({a.sourceIds.join(', ')})</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Nincs rögzített átépítés.</p>
              )}
            </section>
            <section>
              <h3>Építészeti adatok</h3>
              <dl className="fields">
                <Field label="Tervező" value={b.architects.join(', ')} b={b} field="architects" />
                <Field label="Stílus / irányzat" value={b.style} b={b} field="style" />
                <Field label="Eredeti funkció" value={b.originalFunction} b={b} field="originalFunction" />
                <Field label="Épülettípus" value={b.buildingType} b={b} field="buildingType" />
                <Field label="Emeletszám" value={b.floors} b={b} field="floors" />
                <Field label="Szerkezet" value={b.structure} b={b} field="structure" />
                <Field label="Jelenlegi funkció" value={b.currentFunction} b={b} field="currentFunction" />
                <Field label="Védettség" value={b.protection !== 'ismeretlen' ? PROTECTION_LABELS[b.protection] : undefined} b={b} field="protection" />
              </dl>
            </section>
          </div>

          <section>
            <h3>Történeti leírás</h3>
            {b.description ? <p className="desc">{b.description}</p> : <p className="muted">Nincs leírás.</p>}
          </section>

          <section>
            <h3>Képek és tervdokumentáció</h3>
            {b.images.length ? (
              <div className="gallery">
                {b.images.map((im, i) => (
                  <figure key={i}>
                    <img src={im.url} alt={im.caption ?? ''} loading="lazy" />
                    <figcaption>
                      <strong>{IMAGE_KIND_LABELS[im.kind]}</strong>{im.year ? `, ${im.year}` : ''} {im.caption}
                      {im.author ? ` · ${im.author}` : ''}{im.license ? ` · ${im.license}` : ''}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="muted">Nincs csatolt archív vagy mai fénykép, illetve tervdokumentáció.</p>
            )}
          </section>

          <section>
            <h3>Források és megbízhatóság</h3>
            {b.sources.length ? (
              <ol className="sources">
                {b.sources.map((s) => (
                  <li key={s.id}>
                    <code>[{s.id}]</code> {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}
                    {s.kind ? <span className="muted"> · {s.kind}</span> : null}
                    {s.license ? <span className="muted"> · {s.license}</span> : null}
                    {s.note ? <div className="muted small">{s.note}</div> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Nincs forrás megadva.</p>
            )}
            {metaEntries.length > 0 && (
              <table className="meta-table">
                <thead><tr><th>Mező</th><th>Megbízhatóság</th><th>Forrás</th></tr></thead>
                <tbody>
                  {metaEntries.map(([k, m]) => (
                    <tr key={k}><td>{FIELD_LABELS[k]}</td><td><span className={`rel rel-${m.reliability}`}>{RELIABILITY_LABELS[m.reliability]}</span></td><td>{m.sourceIds.join(', ') || '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted small">Utolsó módosítás: {new Date(b.updatedAt).toLocaleString('hu')} · eredet: {b.origin}</p>
          </section>
        </div>
        <footer className="modal-foot">
          <button className="btn" onClick={() => { openDetail(false); startEdit(structuredClone(b)); }}>Szerkesztés</button>
          <button className="btn primary" onClick={() => openDetail(false)}>Bezárás</button>
        </footer>
      </div>
    </div>
  );
}
