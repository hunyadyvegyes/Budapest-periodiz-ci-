import { useState } from 'react';
import { Opening, OpeningKind } from '../core/model';
import { LAYER_DEFS, LayerName } from '../drawing/types';
import { exportDXF } from '../export/dxf';
import { exportPDF } from '../export/pdf';
import { exportSVG } from '../export/svg';
import { autoScale } from '../export/geometry';
import { Derived } from '../state/derived';
import { deleteElement, findElement, patchOpening, restoreSuppressed, setOpeningRect, setSubdivisions, suppressEntity } from '../state/edits';
import { Project, useStore } from '../state/store';
import { Meter, Section } from './LeftPanel';

export default function RightPanel({ project, derived }: { project: Project | null; derived: Derived | null }) {
  return (
    <aside className="panel right">
      <Section title="Inspector"><Inspector project={project} derived={derived} /></Section>
      <Section title="Quality check"><QC derived={derived} /></Section>
      <Section title="Export"><Export project={project} derived={derived} /></Section>
    </aside>
  );
}

function Inspector({ project, derived }: { project: Project | null; derived: Derived | null }) {
  const selectedId = useStore((s) => s.selectedId);
  const selectedEntity = useStore((s) => s.selectedEntity);
  const { commit, patch } = useStore.getState();
  const [group, setGroup] = useState(true);
  const m = project?.model;
  if (!m) return <p className="muted">Nothing analysed yet.</p>;
  const k = derived?.scale.mmPerPx ?? null;
  const ref = selectedId ? findElement(m, selectedId) : null;
  const unit = k ? 'mm' : 'px';
  const toU = (px: number) => (k ? Math.round(px * k) : Math.round(px * 10) / 10);
  const fromU = (v: number) => (k ? v / k : v);
  if (!ref) {
    return (
      <div className="stack">
        <p className="muted">Select an element in the elevation or overlay view. Drag to move, use the handles to resize.</p>
        <dl className="kv">
          <dt>Openings</dt><dd>{m.openings.length} ({m.openings.filter((o) => o.kind === 'window').length} windows, {m.openings.filter((o) => o.kind !== 'window').length} doors/other)</dd>
          <dt>Bands</dt><dd>{m.bands.length}</dd><dt>Balconies</dt><dd>{m.balconies.length}</dd>
          <dt>Verticals</dt><dd>{m.verticals.length}</dd><dt>Ornaments</dt><dd>{m.ornaments.length}</dd>
          <dt>Repeated groups</dt><dd>{new Set(m.openings.map((o) => o.templateId).filter(Boolean)).size}</dd>
          <dt>Symmetry</dt><dd>{m.symmetryAxis !== null ? 'yes (snapped)' : 'no'}</dd>
          <dt>Provider</dt><dd>{m.meta.provider}</dd>
        </dl>
        {m.suppressed.length > 0 && <button onClick={() => commit(restoreSuppressed(m))}>Restore {m.suppressed.length} deleted line(s)</button>}
      </div>
    );
  }
  const del = () => { commit(deleteElement(m, selectedId!)); patch({ selectedId: null, selectedEntity: null }); };
  const delLine = () => { if (selectedEntity) { commit(suppressEntity(m, selectedEntity)); patch({ selectedEntity: null }); } };
  if (ref.kind === 'opening') {
    const o = ref.o;
    const members = o.templateId ? m.openings.filter((x) => x.templateId === o.templateId).length : 1;
    const setR = (p: Partial<Opening['rect']>) => commit(setOpeningRect(m, o.id, { ...o.rect, ...p }, group && members > 1));
    const pOpen = (p: Partial<Opening>) => commit(patchOpening(m, o.id, p, group && members > 1));
    return (
      <div className="stack">
        <div className="insp-h"><b>{o.kind}</b> <span className={`src src-${o.source}`}>{o.source}</span> <Meter v={o.confidence} /></div>
        {members > 1 && <label className="check"><input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} /> Apply to all {members} openings of this repeated group</label>}
        <label className="field">Type
          <select value={o.kind} onChange={(e) => pOpen({ kind: e.target.value as OpeningKind })}>
            {['window', 'door', 'portal', 'shopfront'].map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <div className="grid2">
          <Num label={`x (${unit})`} v={toU(o.rect.x - m.facade.x0)} on={(v) => setR({ x: fromU(v) + m.facade.x0 })} />
          <Num label={`y (${unit})`} v={toU(m.facade.ground - o.rect.y - o.rect.h)} on={(v) => setR({ y: m.facade.ground - fromU(v) - o.rect.h })} />
          <Num label={`width (${unit})`} v={toU(o.rect.w)} on={(v) => setR({ w: fromU(v) })} />
          <Num label={`height (${unit})`} v={toU(o.rect.h)} on={(v) => setR({ h: fromU(v) })} />
          <Num label={`frame (${unit})`} v={toU(o.frame)} on={(v) => pOpen({ frame: fromU(v) })} />
          <label className="field">Head
            <select value={o.arch?.type ?? 'flat'} onChange={(e) => pOpen({ arch: e.target.value === 'flat' ? undefined : { type: e.target.value as 'round' | 'segmental', rise: e.target.value === 'round' ? o.rect.w / 2 : o.rect.w * 0.2 } })}>
              <option value="flat">flat</option><option value="round">round arch</option><option value="segmental">segmental arch</option>
            </select>
          </label>
          <Num label="mullions" v={o.mullions.length} step={1} on={(v) => commit(setSubdivisions(m, o.id, Math.max(0, Math.round(v)), o.transoms.length, group && members > 1))} />
          <Num label="transoms" v={o.transoms.length} step={1} on={(v) => commit(setSubdivisions(m, o.id, o.mullions.length, Math.max(0, Math.round(v)), group && members > 1))} />
        </div>
        <div className="row">
          <button onClick={() => pOpen({ sill: o.sill ? undefined : { x: o.rect.x - o.rect.w * 0.08, y: o.rect.y + o.rect.h, w: o.rect.w * 1.16, h: Math.max(2, o.rect.h * 0.04) } })}>{o.sill ? 'Remove sill' : 'Add sill'}</button>
          <button onClick={() => pOpen({ hood: o.hood ? undefined : { x: o.rect.x - o.rect.w * 0.1, y: o.rect.y - o.rect.h * 0.06, w: o.rect.w * 1.2, h: o.rect.h * 0.06 } })}>{o.hood ? 'Remove hood' : 'Add hood'}</button>
        </div>
        {o.flags.length > 0 && <ul className="flags">{o.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>}
        <div className="row"><button className="danger" onClick={del}>Delete opening</button>{selectedEntity && <button onClick={delLine}>Delete this line only</button>}</div>
      </div>
    );
  }
  const label: Record<string, string> = { band: 'Horizontal band', vertical: 'Vertical element', balcony: 'Balcony', ornament: 'Ornament', material: 'Material zone', userLine: 'User line', floor: 'Floor level', other: 'Drawing element' };
  const band = ref.kind === 'band' ? m.bands.find((b) => b.id === selectedId) : null;
  const bal = ref.kind === 'balcony' ? m.balconies.find((b) => b.id === selectedId) : null;
  const ul = ref.kind === 'userLine' ? m.userLines.find((u) => u.id === selectedId) : null;
  return (
    <div className="stack">
      <div className="insp-h"><b>{label[ref.kind]}</b>{band && <> · {band.kind.replace('_', ' ')} <Meter v={band.confidence} /></>}{bal && <Meter v={bal.confidence} />}</div>
      {band && (
        <label className="field">Kind
          <select value={band.kind} onChange={(e) => commit({ ...m, bands: m.bands.map((b) => (b.id === band.id ? { ...b, kind: e.target.value as typeof b.kind } : b)) })}>
            {['cornice', 'string_course', 'plinth', 'parapet', 'eave'].map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
      )}
      {bal && (
        <label className="field">Railing
          <select value={bal.railing} onChange={(e) => commit({ ...m, balconies: m.balconies.map((b) => (b.id === bal.id ? { ...b, railing: e.target.value as typeof b.railing } : b)) })}>
            {['balusters', 'bars', 'solid', 'none'].map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
      )}
      {ul && (
        <label className="field">Layer
          <select value={ul.layer} onChange={(e) => commit({ ...m, userLines: m.userLines.map((u) => (u.id === ul.id ? { ...u, layer: e.target.value } : u)) })}>
            {LAYER_DEFS.map((L) => <option key={L.name}>{L.name}</option>)}
          </select>
        </label>
      )}
      {(ref.kind === 'band' || ref.kind === 'balcony' || ref.kind === 'floor') && <p className="muted small">Drag vertically to move.</p>}
      {ref.kind === 'vertical' && <p className="muted small">Drag horizontally to move.</p>}
      <div className="row">
        {ref.kind !== 'other' && <button className="danger" onClick={del}>Delete element</button>}
        {selectedEntity && <button onClick={delLine}>Delete this line only</button>}
      </div>
    </div>
  );
}

function Num({ label, v, on, step }: { label: string; v: number; on: (v: number) => void; step?: number }) {
  const [txt, setTxt] = useState<string | null>(null);
  return (
    <label className="field num">{label}
      <input value={txt ?? String(v)} inputMode="decimal" step={step}
        onFocus={() => setTxt(String(v))} onChange={(e) => setTxt(e.target.value)}
        onBlur={() => { const n = parseFloat((txt ?? '').replace(',', '.')); if (isFinite(n) && n !== v) on(n); setTxt(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

function QC({ derived }: { derived: Derived | null }) {
  const { patch } = useStore.getState();
  const [filter, setFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  if (!derived) return <p className="muted">Runs automatically after analysis.</p>;
  const { qc } = derived;
  const list = qc.issues.filter((i) => filter === 'all' || i.severity === filter);
  return (
    <div className="stack">
      <div className="qc-sum">
        <span>Overall</span><Meter v={qc.score} />
        <span className="chip error" onClick={() => setFilter('error')}>{qc.counts.error} errors</span>
        <span className="chip warning" onClick={() => setFilter('warning')}>{qc.counts.warning} warnings</span>
        <span className="chip info" onClick={() => setFilter('info')}>{qc.counts.info} notes</span>
        {filter !== 'all' && <span className="chip" onClick={() => setFilter('all')}>all</span>}
      </div>
      <ul className="qc-list">
        {list.map((i) => (
          <li key={i.id} className={`sev-${i.severity}`} onClick={() => { if (i.rect) patch({ focusRect: { ...i.rect, t: Date.now() }, view: 'overlay' }); if (i.elementId) patch({ selectedId: i.elementId }); }}>
            <span className="cat">{i.category}</span> {i.message}
          </li>
        ))}
        {!list.length && <li className="muted">No issues in this category.</li>}
      </ul>
    </div>
  );
}

function download(name: string, data: string | Blob | Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Export({ project, derived }: { project: Project | null; derived: Derived | null }) {
  const layers = useStore((s) => s.layers);
  const level = useStore((s) => s.level);
  const [ver, setVer] = useState<'R2000' | 'R12'>('R2000');
  const [hidden, setHidden] = useState(true);
  const [scaleDen, setScaleDen] = useState<number | 0>(0);
  if (!project || !derived) return <p className="muted">Available after the analysis.</p>;
  const d = derived.drawing;
  const base = `${project.name.replace(/\.[a-z]+$/i, '')}-L${level}`;
  const den = scaleDen || autoScale(d);
  const errs = derived.qc.counts.error;
  const png = async () => {
    const { svg, paper } = exportSVG(d, layers, { scaleDenom: den });
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = url; });
    const px = Math.min(6000, Math.round(paper.wMm * 8)), s = px / paper.wMm;
    const c = document.createElement('canvas');
    c.width = px; c.height = Math.round(paper.hMm * s);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob((b) => b && download(`${base}.png`, b, 'image/png'), 'image/png');
  };
  return (
    <div className="stack">
      {errs > 0 && <p className="note err">Quality check reports {errs} error(s) – review before exporting.</p>}
      <p className="muted small">{d.entities.length} entities on {new Set(d.entities.map((e) => e.layer)).size} layers · {d.mmPerPx ? 'millimetres' : 'unscaled units'} · origin at the facade's bottom-left on the ground line.</p>
      <div className="row">
        <select value={ver} onChange={(e) => setVer(e.target.value as 'R2000' | 'R12')}>
          <option value="R2000">DXF R2000 (layers + lineweights)</option>
          <option value="R12">DXF R12 (maximum compatibility)</option>
        </select>
      </div>
      <label className="check small"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Include hidden layers in DXF (switched off)</label>
      <button className="primary" onClick={() => download(`${base}.dxf`, exportDXF(d, { version: ver, layers, includeHiddenLayers: hidden }), 'application/dxf')}>Download DXF</button>
      <label className="field">Sheet scale (SVG/PDF/PNG)
        <select value={scaleDen} onChange={(e) => setScaleDen(+e.target.value)} disabled={!d.mmPerPx}>
          <option value={0}>{d.mmPerPx ? `auto (1:${autoScale(d)})` : 'fit to sheet (unscaled)'}</option>
          {[20, 50, 100, 200, 500].map((v) => <option key={v} value={v}>1:{v}</option>)}
        </select>
      </label>
      <div className="row">
        <button onClick={() => download(`${base}.svg`, exportSVG(d, layers, { scaleDenom: den }).svg, 'image/svg+xml')}>SVG</button>
        <button onClick={() => download(`${base}.pdf`, exportPDF(d, layers, { scaleDenom: den }), 'application/pdf')}>PDF</button>
        <button onClick={png}>PNG</button>
        <button title="Semantic model (for re-import / debugging)" onClick={() => download(`${base}-model.json`, JSON.stringify({ model: project.model, quad: project.quad, scale: project.scale }, null, 1), 'application/json')}>JSON</button>
      </div>
      <details className="small">
        <summary>Layer standard</summary>
        <ul className="layer-list">{LAYER_DEFS.map((L) => <li key={L.name}><code>{L.name}</code> {L.desc} · {(layers[L.name as LayerName]?.lw ?? L.lw).toFixed(2)} mm</li>)}</ul>
      </details>
    </div>
  );
}
