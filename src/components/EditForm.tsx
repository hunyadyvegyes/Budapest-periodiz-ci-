import { useState } from 'react';
import { useStore } from '../state/store';
import {
  DISTRICTS, IMAGE_KIND_LABELS, PRECISION_LABELS, PROTECTION_LABELS, RELIABILITY_LABELS,
  type AttributableField, type Building, type ImageKind, type ProtectionStatus, type Reliability, type YearPrecision,
} from '../domain/types';

const META_FIELDS: AttributableField[] = ['architects', 'style', 'originalFunction', 'floors', 'protection', 'description'];
const META_LABELS: Partial<Record<AttributableField, string>> = {
  architects: 'Tervező', style: 'Stílus', originalFunction: 'Eredeti funkció', floors: 'Emeletszám', protection: 'Védettség', description: 'Leírás',
};

const opt = (s: string) => (s.trim() ? s.trim() : undefined);
const optNum = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : undefined);

export default function EditForm() {
  const editing = useStore((s) => s.editing);
  if (!editing) return null;
  return <EditFormInner key={editing.id} initial={editing} />;
}

function EditFormInner({ initial }: { initial: Building }) {
  const [b, setB] = useState<Building>(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useStore((s) => s.save);
  const remove = useStore((s) => s.remove);
  const startEdit = useStore((s) => s.startEdit);
  const exists = useStore((s) => s.buildings.some((x) => x.id === initial.id));

  const up = (patch: Partial<Building>) => setB((prev) => ({ ...prev, ...patch }));
  const c = b.construction;
  const upC = (patch: Partial<Building['construction']>) => up({ construction: { ...c, ...patch } });
  const sourceIds = b.sources.map((s) => s.id);

  const validate = (): string | null => {
    if (c.precision === 'exact' || c.precision === 'probable') {
      if (c.year == null) return 'Pontos vagy valószínűsített évnél add meg az évet – vagy válaszd az „Ismeretlen” lehetőséget.';
    }
    if (c.precision === 'range') {
      if (c.from == null || c.to == null || c.from > c.to) return 'Évintervallumnál add meg a kezdő és záró évet (kezdő ≤ záró).';
    }
    if (c.precision !== 'unknown' && !c.sourceIds.length && !b.isDemo)
      return 'Ismert építési évhez legalább egy forrást rendelj (lásd Források). Forrás nélküli évet ne rögzíts.';
    if (b.sources.some((s) => !s.id.trim() || !s.title.trim())) return 'Minden forrásnak legyen azonosítója és címe.';
    return null;
  };

  const onSave = () => {
    const err = validate();
    if (err) return setError(err);
    const cleaned: Building = {
      ...b,
      construction: {
        ...c,
        year: c.precision === 'exact' || c.precision === 'probable' ? c.year : undefined,
        from: c.precision === 'range' ? c.from : undefined,
        to: c.precision === 'range' ? c.to : undefined,
        sourceIds: c.precision === 'unknown' ? [] : c.sourceIds,
      },
    };
    save(cleaned);
  };

  return (
    <div className="modal-backdrop" onClick={() => startEdit(null)}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Épületrekord szerkesztése" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <div className="bp-kicker">{exists ? 'Rekord szerkesztése' : 'Új rekord'} · {b.id}</div>
            <h2>{b.name || b.address || 'Névtelen épület'}</h2>
          </div>
          <button className="icon-btn" onClick={() => startEdit(null)} aria-label="Bezárás">✕</button>
        </header>
        <div className="modal-body form">
          <p className="hint">
            Csak ellenőrizhető, forrással alátámasztott adatot rögzíts. Ami nem ismert, maradjon üresen – a felület „ismeretlen”-ként jeleníti meg.
          </p>
          <div className="form-grid">
            <fieldset>
              <legend>Alapadatok</legend>
              <label>Név<input value={b.name ?? ''} onChange={(e) => up({ name: opt(e.target.value) })} /></label>
              <label>Cím<input value={b.address ?? ''} onChange={(e) => up({ address: opt(e.target.value) })} /></label>
              <label>Kerület
                <select value={b.district ?? ''} onChange={(e) => up({ district: opt(e.target.value) })}>
                  <option value="">ismeretlen</option>
                  {DISTRICTS.map((d) => <option key={d} value={d}>{d}. kerület</option>)}
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={b.isDemo} onChange={(e) => up({ isDemo: e.target.checked })} /> <span>DEMO / tesztrekord</span></label>
            </fieldset>

            <fieldset>
              <legend>Építési idő</legend>
              <label>Pontosság
                <select value={c.precision} onChange={(e) => upC({ precision: e.target.value as YearPrecision })}>
                  {(Object.keys(PRECISION_LABELS) as YearPrecision[]).map((p) => <option key={p} value={p}>{PRECISION_LABELS[p]}</option>)}
                </select>
              </label>
              {(c.precision === 'exact' || c.precision === 'probable') && (
                <label>Év<input type="number" value={c.year ?? ''} onChange={(e) => upC({ year: optNum(e.target.value) })} /></label>
              )}
              {c.precision === 'range' && (
                <div className="row2">
                  <label>Tól<input type="number" value={c.from ?? ''} onChange={(e) => upC({ from: optNum(e.target.value) })} /></label>
                  <label>Ig<input type="number" value={c.to ?? ''} onChange={(e) => upC({ to: optNum(e.target.value) })} /></label>
                </div>
              )}
              {c.precision !== 'unknown' && (
                <div className="srcpick">
                  <span className="sublabel">Az évet alátámasztó forrás(ok)</span>
                  {sourceIds.length ? sourceIds.map((id) => (
                    <label key={id} className="check">
                      <input type="checkbox" checked={c.sourceIds.includes(id)} onChange={(e) => upC({ sourceIds: e.target.checked ? [...c.sourceIds, id] : c.sourceIds.filter((x) => x !== id) })} />
                      <span>[{id}] {b.sources.find((s) => s.id === id)?.title}</span>
                    </label>
                  )) : <span className="muted small">Előbb vegyél fel forrást lent.</span>}
                </div>
              )}
              <label>Megjegyzés<input value={c.note ?? ''} onChange={(e) => upC({ note: opt(e.target.value) })} /></label>
            </fieldset>

            <fieldset>
              <legend>Építészeti adatok</legend>
              <label>Tervező(k) – pontosvesszővel elválasztva
                <input value={b.architects.join('; ')} onChange={(e) => up({ architects: e.target.value.split(';').map((s) => s.trim()).filter(Boolean) })} />
              </label>
              <label>Stílus / irányzat<input value={b.style ?? ''} onChange={(e) => up({ style: opt(e.target.value) })} /></label>
              <div className="row2">
                <label>Eredeti funkció<input value={b.originalFunction ?? ''} onChange={(e) => up({ originalFunction: opt(e.target.value) })} /></label>
                <label>Jelenlegi funkció<input value={b.currentFunction ?? ''} onChange={(e) => up({ currentFunction: opt(e.target.value) })} /></label>
              </div>
              <div className="row2">
                <label>Épülettípus<input value={b.buildingType ?? ''} onChange={(e) => up({ buildingType: opt(e.target.value) })} /></label>
                <label>Emeletszám<input type="number" value={b.floors ?? ''} onChange={(e) => up({ floors: optNum(e.target.value) })} /></label>
              </div>
              <label>Szerkezet / építési mód<input value={b.structure ?? ''} onChange={(e) => up({ structure: opt(e.target.value) })} /></label>
              <label>Védettség
                <select value={b.protection} onChange={(e) => up({ protection: e.target.value as ProtectionStatus })}>
                  {(Object.keys(PROTECTION_LABELS) as ProtectionStatus[]).map((p) => <option key={p} value={p}>{PROTECTION_LABELS[p]}</option>)}
                </select>
              </label>
            </fieldset>

            <fieldset>
              <legend>Mezőszintű megbízhatóság</legend>
              {META_FIELDS.map((f) => {
                const m = b.fieldMeta[f];
                return (
                  <div key={f} className="meta-row">
                    <span>{META_LABELS[f]}</span>
                    <select
                      value={m?.reliability ?? ''}
                      onChange={(e) => {
                        const fm = { ...b.fieldMeta };
                        if (!e.target.value) delete fm[f];
                        else fm[f] = { sourceIds: m?.sourceIds ?? [], reliability: e.target.value as Reliability };
                        up({ fieldMeta: fm });
                      }}
                    >
                      <option value="">—</option>
                      {(Object.keys(RELIABILITY_LABELS) as Reliability[]).map((r) => <option key={r} value={r}>{RELIABILITY_LABELS[r]}</option>)}
                    </select>
                    <input
                      placeholder="forrás-id-k (;)"
                      value={m?.sourceIds.join(';') ?? ''}
                      disabled={!m}
                      onChange={(e) => up({ fieldMeta: { ...b.fieldMeta, [f]: { ...m!, sourceIds: e.target.value.split(';').map((s) => s.trim()).filter(Boolean) } } })}
                    />
                  </div>
                );
              })}
            </fieldset>
          </div>

          <fieldset>
            <legend>Rövid építészettörténeti leírás</legend>
            <textarea rows={4} value={b.description ?? ''} onChange={(e) => up({ description: opt(e.target.value) })} />
          </fieldset>

          <fieldset>
            <legend>Források</legend>
            {b.sources.map((s, i) => (
              <div key={i} className="list-row">
                <input className="w-id" placeholder="id" value={s.id} onChange={(e) => up({ sources: b.sources.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })} />
                <input placeholder="cím / hivatkozás" value={s.title} onChange={(e) => up({ sources: b.sources.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                <input placeholder="URL" value={s.url ?? ''} onChange={(e) => up({ sources: b.sources.map((x, j) => (j === i ? { ...x, url: opt(e.target.value) } : x)) })} />
                <input className="w-sm" placeholder="licenc" value={s.license ?? ''} onChange={(e) => up({ sources: b.sources.map((x, j) => (j === i ? { ...x, license: opt(e.target.value) } : x)) })} />
                <button className="icon-btn" onClick={() => up({ sources: b.sources.filter((_, j) => j !== i) })} aria-label="Forrás törlése">✕</button>
              </div>
            ))}
            <button className="btn small" onClick={() => up({ sources: [...b.sources, { id: `s${b.sources.length + 1}`, title: '' }] })}>+ Forrás</button>
          </fieldset>

          <fieldset>
            <legend>Átépítések, bővítések</legend>
            {b.alterations.map((a, i) => (
              <div key={i} className="list-row">
                <input className="w-sm" type="number" placeholder="év" value={a.year ?? ''} onChange={(e) => up({ alterations: b.alterations.map((x, j) => (j === i ? { ...x, year: optNum(e.target.value) } : x)) })} />
                <input placeholder="leírás" value={a.description} onChange={(e) => up({ alterations: b.alterations.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
                <input className="w-sm" placeholder="forrás-id" value={a.sourceIds.join(';')} onChange={(e) => up({ alterations: b.alterations.map((x, j) => (j === i ? { ...x, sourceIds: e.target.value.split(';').filter(Boolean) } : x)) })} />
                <button className="icon-btn" onClick={() => up({ alterations: b.alterations.filter((_, j) => j !== i) })} aria-label="Törlés">✕</button>
              </div>
            ))}
            <button className="btn small" onClick={() => up({ alterations: [...b.alterations, { description: '', sourceIds: [] }] })}>+ Átépítés</button>
          </fieldset>

          <fieldset>
            <legend>Képek, tervek (URL)</legend>
            {b.images.map((im, i) => (
              <div key={i} className="list-row">
                <input placeholder="kép URL" value={im.url} onChange={(e) => up({ images: b.images.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                <select value={im.kind} onChange={(e) => up({ images: b.images.map((x, j) => (j === i ? { ...x, kind: e.target.value as ImageKind } : x)) })}>
                  {(Object.keys(IMAGE_KIND_LABELS) as ImageKind[]).map((k) => <option key={k} value={k}>{IMAGE_KIND_LABELS[k]}</option>)}
                </select>
                <input className="w-sm" type="number" placeholder="év" value={im.year ?? ''} onChange={(e) => up({ images: b.images.map((x, j) => (j === i ? { ...x, year: optNum(e.target.value) } : x)) })} />
                <input placeholder="felirat" value={im.caption ?? ''} onChange={(e) => up({ images: b.images.map((x, j) => (j === i ? { ...x, caption: opt(e.target.value) } : x)) })} />
                <input className="w-sm" placeholder="licenc" value={im.license ?? ''} onChange={(e) => up({ images: b.images.map((x, j) => (j === i ? { ...x, license: opt(e.target.value) } : x)) })} />
                <button className="icon-btn" onClick={() => up({ images: b.images.filter((_, j) => j !== i) })} aria-label="Törlés">✕</button>
              </div>
            ))}
            <button className="btn small" onClick={() => up({ images: [...b.images, { url: '', kind: 'current' }] })}>+ Kép</button>
            <p className="hint">Pl. Fortepan-képnél add meg a képazonosítót és a licencet (CC BY-SA 3.0) a felirat / licenc mezőben.</p>
          </fieldset>
        </div>
        <footer className="modal-foot">
          {error && <span className="form-error">{error}</span>}
          {exists && (
            <button className="btn danger" onClick={() => { if (confirm('Biztosan törlöd ezt a rekordot?')) { remove(b.id); startEdit(null); } }}>Törlés</button>
          )}
          <button className="btn" onClick={() => startEdit(null)}>Mégse</button>
          <button className="btn primary" onClick={onSave}>Mentés</button>
        </footer>
      </div>
    </div>
  );
}
