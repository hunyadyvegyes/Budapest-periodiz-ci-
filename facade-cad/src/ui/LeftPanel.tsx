import { useState } from 'react';
import { dist } from '../core/geom';
import { ScaleSpec } from '../core/scale';
import { LAYER_DEFS, LINEWEIGHTS, LAYER_COLORS, LayerName } from '../drawing/types';
import { Derived } from '../state/derived';
import { Project, persistKey, useStore } from '../state/store';
import { CLAUDE_MODEL } from '../ai/models';
import { inArtifact } from '../platform';

export default function LeftPanel({ project, derived }: { project: Project | null; derived: Derived | null }) {
  return (
    <aside className="panel left">
      <Section n={1} title="Photo & perspective"><Perspective project={project} /></Section>
      <Section n={2} title="Recognition"><Recognition project={project} /></Section>
      <Section n={3} title="Scale"><Scale project={project} derived={derived} /></Section>
      <Section n={4} title="Layers & line weights" collapsed><Layers /></Section>
    </aside>
  );
}

export function Section({ n, title, children, collapsed }: { n?: number; title: string; children: React.ReactNode; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <section className={`sec ${open ? 'open' : ''}`}>
      <button className="sec-h" onClick={() => setOpen(!open)}>
        {n !== undefined && <span className="sec-n">{n}</span>}<span>{title}</span><span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="sec-b">{children}</div>}
    </section>
  );
}

function Perspective({ project }: { project: Project | null }) {
  const { run, autoDetect, patch, clearIgnore } = useStore.getState();
  const tool = useStore((s) => s.tool);
  const view = useStore((s) => s.view);
  if (!project) return <p className="muted">Upload a facade photo (JPG or PNG) to start.</p>;
  const r = project.rect;
  return (
    <div className="stack">
      <div className="row">
        <button onClick={() => { patch({ view: 'photo' }); }} className={view === 'photo' ? 'on' : ''}>Edit corners</button>
        <button onClick={() => autoDetect()} title="Find vertical/horizontal vanishing points and propose corners">Auto-detect</button>
      </div>
      <button className="primary" disabled={project.status === 'processing' || !project.quad} onClick={() => run()}>Apply correction & analyse</button>
      <dl className="kv">
        <dt>Corners</dt><dd>{project.quadSource === 'manual' ? 'placed manually' : project.quadSource === 'auto' ? `automatic (${pct(project.autoConfidence ?? 0)} confidence)` : '–'}</dd>
        {r && <><dt>Proportions</dt><dd>W:H {r.aspect.toFixed(3)} {project.aspectOverride || (project.knownWidthMm && project.knownHeightMm) ? '(from known dimensions)' : r.focalEstimated ? '(focal length estimated)' : '(assumed focal length)'}</dd></>}
        {r && <><dt>Correction</dt><dd><Meter v={r.confidence} /></dd></>}
        {project.model && <><dt>Residual tilt</dt><dd>{project.model.meta.residualTiltDeg.toFixed(2)}°</dd></>}
      </dl>
      <div className="row">
        <button className={tool === 'ignore' ? 'on' : ''} onClick={() => patch({ tool: tool === 'ignore' ? 'select' : 'ignore' })} title="Exclude trees, cars, people, signs">Mask objects</button>
        <button disabled={!project.ignore.length && !project.occluders.length} onClick={() => clearIgnore()}>Clear masks ({project.ignore.length + project.occluders.length})</button>
      </div>
      {r?.notes.map((n, i) => <p key={i} className="note">{n}</p>)}
    </div>
  );
}

function Recognition({ project }: { project: Project | null }) {
  const settings = useStore((s) => s.settings);
  const apiKey = useStore((s) => s.apiKey);
  const remember = useStore((s) => s.rememberKey);
  const { patch, run, aiReview } = useStore.getState();
  const set = (p: Partial<typeof settings>) => patch({ settings: { ...settings, ...p } });
  return (
    <div className="stack">
      <label className="field">Sensitivity <input type="range" min={0} max={1} step={0.05} value={settings.sensitivity} onChange={(e) => set({ sensitivity: +e.target.value })} /><span className="val">{settings.sensitivity.toFixed(2)}</span></label>
      <label className="field">Analysis resolution
        <select value={settings.maxSide} onChange={(e) => set({ maxSide: +e.target.value })}>
          {[1200, 1800, 2400, 3200].map((v) => <option key={v} value={v}>{v} px{v === 1800 ? ' (default)' : v >= 2400 ? ' (detail, slower)' : ' (fast)'}</option>)}
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={settings.inferOccluded} onChange={(e) => set({ inferOccluded: e.target.checked })} /> Infer repeated openings hidden by occluders (flagged)</label>
      <label className="check"><input type="checkbox" checked={settings.symmetry} onChange={(e) => set({ symmetry: e.target.checked })} /> Snap to symmetry axis when clearly symmetric</label>
      <label className="check"><input type="checkbox" checked={settings.details} onChange={(e) => set({ details: e.target.checked })} /> Ornament & material detection (level 3)</label>
      <button disabled={!project || project.status === 'processing'} onClick={() => run()}>Re-analyse</button>
      <div className="ai-box">
        <div className="ai-h">AI review <span className="badge">optional</span></div>
        <p className="muted small">{inArtifact ? 'Sends the corrected photo and the detected candidates to Claude (built into claude.ai, you are asked once).' : `Sends the corrected photo and the detected candidates to ${CLAUDE_MODEL} with your own Anthropic API key.`} It confirms, rejects or re-classifies openings, masks cars, trees and people, and points out missed openings. Geometry stays photo-based.</p>
        {!inArtifact && <>
        <input type="password" placeholder="Anthropic API key (sk-ant-…)" value={apiKey} autoComplete="off"
          onChange={(e) => { patch({ apiKey: e.target.value }); persistKey(e.target.value, remember); }} />
        <label className="check small"><input type="checkbox" checked={remember} onChange={(e) => { patch({ rememberKey: e.target.checked }); persistKey(apiKey, e.target.checked); }} /> Remember for this browser tab only</label>
        </>}
        <button disabled={!project?.model || project.ai.status === 'running'} onClick={() => aiReview()}>{project?.ai.status === 'running' ? 'Reviewing…' : 'Review with Claude'}</button>
        {project?.ai.message && <p className={`note ${project.ai.status === 'error' ? 'err' : ''}`}>{project.ai.message}</p>}
      </div>
    </div>
  );
}

function Scale({ project, derived }: { project: Project | null; derived: Derived | null }) {
  const { patchProject, run, patch } = useStore.getState();
  const tool = useStore((s) => s.tool);
  const pts = useStore((s) => s.scalePts);
  const selectedId = useStore((s) => s.selectedId);
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const [target, setTarget] = useState<'facadeWidth' | 'facadeHeight' | 'elementWidth' | 'elementHeight'>('facadeWidth');
  const [mm, setMm] = useState('');
  const [ptMm, setPtMm] = useState('');
  if (!project?.model) return <p className="muted">Available after the analysis.</p>;
  const mode = project.scale.mode;
  const setScale = (s: ScaleSpec) => patchProject(project.id, { scale: s });
  const sc = derived?.scale;
  const m = (v: string) => { const n = parseFloat(v.replace(',', '.')); return isFinite(n) && n > 0 ? n : 0; };
  const isEl = target === 'elementWidth' || target === 'elementHeight';
  return (
    <div className="stack">
      <div className="seg small">
        {(['none', 'known', 'points'] as const).map((k) => (
          <button key={k} className={mode === k ? 'on' : ''} onClick={() => (k === 'none' ? setScale({ mode: 'none' }) : k === 'points' ? patch({ tool: 'scalePoints', scalePts: [], view: 'overlay' }) : setScale(mode === 'known' ? project.scale : { mode: 'none' }))}>
            {k === 'none' ? 'Unscaled' : k === 'known' ? 'Known dimension' : 'Two points'}
          </button>
        ))}
      </div>
      <div className="sub">
        <div className="sub-h">A · Known dimension</div>
        <label className="field">Reference
          <select value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
            <option value="facadeWidth">Facade width</option>
            <option value="facadeHeight">Facade height (ground → eave)</option>
            <option value="elementWidth">Selected opening – width</option>
            <option value="elementHeight">Selected opening – height</option>
          </select>
        </label>
        <div className="row">
          <input placeholder="mm" value={mm} onChange={(e) => setMm(e.target.value)} inputMode="decimal" />
          <button disabled={!m(mm) || (isEl && !selectedId)} onClick={() => setScale({ mode: 'known', target, mm: m(mm), elementId: isEl ? selectedId ?? undefined : undefined })}>Set</button>
        </div>
        {isEl && !selectedId && <p className="muted small">Select a window or door in the elevation first.</p>}
      </div>
      <div className="sub">
        <div className="sub-h">B · Two reference points</div>
        <button className={tool === 'scalePoints' ? 'on' : ''} onClick={() => patch({ tool: tool === 'scalePoints' ? 'select' : 'scalePoints', scalePts: [], view: 'overlay' })}>Pick points ({pts.length}/2)</button>
        {pts.length === 2 && (
          <div className="row">
            <input placeholder={`distance in mm (${dist(pts[0], pts[1]).toFixed(0)} px)`} value={ptMm} onChange={(e) => setPtMm(e.target.value)} />
            <button disabled={!m(ptMm)} onClick={() => { setScale({ mode: 'points', a: pts[0], b: pts[1], mm: m(ptMm) }); patch({ tool: 'select' }); }}>Set</button>
          </div>
        )}
      </div>
      <div className="sub">
        <div className="sub-h">Exact proportions (optional)</div>
        <p className="muted small">With both facade width and height the aspect ratio no longer depends on the estimated camera.</p>
        <div className="row">
          <input placeholder="width mm" value={w} onChange={(e) => setW(e.target.value)} />
          <input placeholder="height mm" value={h} onChange={(e) => setH(e.target.value)} />
        </div>
        <button disabled={!m(w) || !m(h)} onClick={async () => {
          patchProject(project.id, { knownWidthMm: m(w), knownHeightMm: m(h), scale: { mode: 'known', target: 'facadeWidth', mm: m(w) } });
          await run();
        }}>Apply & re-correct</button>
      </div>
      {sc && (
        <div className={`scale-status ${sc.mmPerPx ? 'ok' : 'none'}`}>
          <b>{sc.mmPerPx ? sc.label : 'UNSCALED – arbitrary units'}</b>
          {sc.mmPerPx && <div className="kvline">1 px = {sc.mmPerPx.toFixed(2)} mm · confidence <Meter v={sc.confidence} /></div>}
          {sc.notes.map((n, i) => <p key={i} className="note">{n}</p>)}
        </div>
      )}
    </div>
  );
}

function Layers() {
  const layers = useStore((s) => s.layers);
  const { setLayer } = useStore.getState();
  return (
    <table className="layers">
      <tbody>
        {LAYER_DEFS.map((L) => {
          const st = layers[L.name as LayerName];
          return (
            <tr key={L.name} title={L.desc}>
              <td><input type="checkbox" checked={st.visible} onChange={(e) => setLayer(L.name as LayerName, { visible: e.target.checked })} /></td>
              <td><span className="swatch" style={{ background: LAYER_COLORS[L.name as LayerName] }} /></td>
              <td className="lname">{L.name}</td>
              <td>
                <select value={st.lw} onChange={(e) => setLayer(L.name as LayerName, { lw: +e.target.value })}>
                  {LINEWEIGHTS.filter((v) => v <= 1).map((v) => <option key={v} value={v}>{v.toFixed(2)}</option>)}
                </select>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export function Meter({ v }: { v: number }) {
  const c = v >= 0.75 ? 'good' : v >= 0.5 ? 'mid' : 'low';
  return <span className={`meter ${c}`} title={pct(v)}><span style={{ width: pct(Math.max(0.04, v)) }} /><em>{pct(v)}</em></span>;
}
