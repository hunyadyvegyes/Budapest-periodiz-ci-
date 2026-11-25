import { useEffect, useRef, useState } from 'react';
import { LEVEL_NAMES, DetailLevel, LAYER_DEFS, LayerName } from '../drawing/types';
import { useDerived } from '../state/derived';
import { deleteElement, suppressEntity } from '../state/edits';
import { Tool, View, useActive, useStore } from '../state/store';
import Canvas from './Canvas';
import LeftPanel, { Meter } from './LeftPanel';
import RightPanel from './RightPanel';

const BASE = import.meta.env.BASE_URL;

export default function App() {
  const project = useActive();
  const derived = useDerived();
  useShortcuts();
  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <LeftPanel project={project} derived={derived} />
        <div className="center">
          <CenterBar />
          {project ? <Canvas project={project} derived={derived} /> : <Welcome />}
        </div>
        <RightPanel project={project} derived={derived} />
      </div>
      <StatusBar />
    </div>
  );
}

function TopBar() {
  const projects = useStore((s) => s.projects);
  const activeId = useStore((s) => s.activeId);
  const { addFiles, setActive, removeProject } = useStore.getState();
  const input = useRef<HTMLInputElement>(null);
  return (
    <header className="topbar">
      <div className="brand"><span className="mark">▥</span><div><h1>Facade → CAD</h1><span className="tagline">photo to architectural elevation</span></div></div>
      <nav className="projects">
        {projects.map((p) => (
          <div key={p.id} className={`ptab ${p.id === activeId ? 'on' : ''}`} onClick={() => setActive(p.id)} title={p.name}>
            <span className={`dot s-${p.status}`} />
            <span className="pname">{p.name}</span>
            <button className="x" title="Close" onClick={(e) => { e.stopPropagation(); removeProject(p.id); }}>×</button>
          </div>
        ))}
      </nav>
      <div className="top-actions">
        <SampleMenu />
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <button className="primary" onClick={() => input.current?.click()}>Upload photos</button>
      </div>
    </header>
  );
}

function SampleMenu() {
  const [list, setList] = useState<{ name: string; title: string; file: string }[]>([]);
  useEffect(() => { fetch(`${BASE}samples/index.json`).then((r) => r.json()).then(setList).catch(() => setList([])); }, []);
  const { addFiles } = useStore.getState();
  if (!list.length) return null;
  return (
    <select className="samples" value="" onChange={async (e) => {
      const s = list.find((x) => x.name === e.target.value);
      if (!s) return;
      const blob = await (await fetch(`${BASE}samples/${s.file}`)).blob();
      addFiles([{ name: s.file, blob: new Blob([blob], { type: 'image/jpeg' }) }]);
    }}>
      <option value="">Load a sample photo…</option>
      {list.map((s) => <option key={s.name} value={s.name}>{s.title} (synthetic)</option>)}
    </select>
  );
}

const VIEWS: [View, string][] = [['photo', 'Photo'], ['rectified', 'Corrected'], ['drawing', 'Elevation'], ['overlay', 'Overlay']];
const TOOLS: [Tool, string, string][] = [
  ['select', 'Select', 'Select / move / resize (V)'], ['pan', 'Pan', 'Pan (H) – or drag the background'], ['addWindow', '+ Window', 'Draw a window (W)'],
  ['addDoor', '+ Door', 'Draw a door (D)'], ['addLine', '+ Line', 'Draw a line on the chosen layer (L)'],
];

function CenterBar() {
  const view = useStore((s) => s.view);
  const level = useStore((s) => s.level);
  const tool = useStore((s) => s.tool);
  const showQC = useStore((s) => s.showQC);
  const opacity = useStore((s) => s.overlayOpacity);
  const lineLayer = useStore((s) => s.lineLayer);
  const project = useActive();
  const { patch, undo, redo } = useStore.getState();
  const ready = !!project?.model;
  return (
    <div className="centerbar">
      <div className="seg views">
        {VIEWS.map(([v, l]) => <button key={v} className={view === v ? 'on' : ''} disabled={v !== 'photo' && !ready} onClick={() => patch({ view: v })}>{l}</button>)}
      </div>
      <div className="seg levels" title="Detail level (1/2/3)">
        {([1, 2, 3] as DetailLevel[]).map((l) => (
          <button key={l} className={level === l ? 'on' : ''} onClick={() => patch({ level: l })}><b>{l}</b> {LEVEL_NAMES[l]}</button>
        ))}
      </div>
      <div className="seg tools">
        {TOOLS.map(([t, l, title]) => <button key={t} title={title} disabled={t !== 'select' && t !== 'pan' && !ready} className={tool === t ? 'on' : ''} onClick={() => patch({ tool: t, view: t.startsWith('add') && view === 'photo' ? 'overlay' : view })}>{l}</button>)}
      </div>
      {tool === 'addLine' && (
        <select value={lineLayer} onChange={(e) => patch({ lineLayer: e.target.value as LayerName })}>
          {LAYER_DEFS.map((L) => <option key={L.name}>{L.name}</option>)}
        </select>
      )}
      <div className="seg">
        <button title="Undo (Ctrl+Z)" disabled={!project?.past.length} onClick={undo}>↶</button>
        <button title="Redo (Ctrl+Y)" disabled={!project?.future.length} onClick={redo}>↷</button>
      </div>
      <label className="check small"><input type="checkbox" checked={showQC} onChange={(e) => patch({ showQC: e.target.checked })} /> QC marks</label>
      {view === 'overlay' && <label className="field inline small">Photo <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => patch({ overlayOpacity: +e.target.value })} /></label>}
    </div>
  );
}

function StatusBar() {
  const project = useActive();
  const derived = useDerived();
  if (!project) return <footer className="status"><span className="muted">No photo loaded.</span></footer>;
  const m = project.model;
  return (
    <footer className="status">
      <span className={`st st-${project.status}`}>{project.status === 'processing' ? `${project.stage}…` : project.status === 'error' ? `Error: ${project.error}` : project.status === 'done' ? 'Ready' : project.stage || project.status}</span>
      {project.status === 'processing' && <span className="prog"><span style={{ width: `${Math.round(project.progress * 100)}%` }} /></span>}
      {m && <><span>Geometry <Meter v={m.meta.geometryConfidence} /></span><span>Perspective <Meter v={m.meta.rectificationConfidence} /></span></>}
      {derived && <span>Scale {derived.scale.mmPerPx ? <Meter v={derived.scale.confidence} /> : <b className="warn">unscaled</b>}</span>}
      {project.timings && <span className="muted">{Object.entries(project.timings).map(([k, v]) => `${k} ${v} ms`).join(' · ')}</span>}
      {project.srcW > 0 && <span className="muted">{project.srcW}×{project.srcH}px</span>}
    </footer>
  );
}

function Welcome() {
  const { addFiles } = useStore.getState();
  const [over, setOver] = useState(false);
  return (
    <div className={`welcome ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); addFiles([...e.dataTransfer.files]); }}>
      <h2>Drop facade photographs here</h2>
      <p>JPG or PNG, one or several. Photos stay in your browser: the processing runs locally.</p>
      <ol>
        <li>The perspective is detected automatically – adjust the four corners if needed.</li>
        <li>Windows, doors, cornices, balconies, pilasters, downpipes and ornament are recognised and rebuilt as vector geometry.</li>
        <li>Pick a detail level, set a scale, review the quality check, correct anything by hand.</li>
        <li>Export layered DXF (AutoCAD, Archicad, Rhino, BricsCAD, LibreCAD), SVG, PDF or PNG.</li>
      </ol>
      <p className="muted">No photo at hand? Use “Load a sample photo…” at the top right.</p>
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const s = useStore.getState();
      const p = s.projects.find((x) => x.id === s.activeId);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && p?.model) {
        if (e.shiftKey && s.selectedEntity) s.commit(suppressEntity(p.model, s.selectedEntity));
        else if (s.selectedId) s.commit(deleteElement(p.model, s.selectedId));
        s.patch({ selectedId: null, selectedEntity: null });
        return;
      }
      const map: Record<string, () => void> = {
        Escape: () => s.patch({ tool: 'select', selectedId: null, selectedEntity: null, scalePts: [] }),
        '1': () => s.patch({ level: 1 }), '2': () => s.patch({ level: 2 }), '3': () => s.patch({ level: 3 }),
        v: () => s.patch({ tool: 'select' }), h: () => s.patch({ tool: 'pan' }), w: () => s.patch({ tool: 'addWindow' }),
        d: () => s.patch({ tool: 'addDoor' }), l: () => s.patch({ tool: 'addLine' }), f: () => window.dispatchEvent(new Event('facade:fit')),
      };
      map[e.key]?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
