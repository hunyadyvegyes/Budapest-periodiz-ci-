// Application state (zustand): projects (one per photo), view/tool state, history, settings.
import { create } from 'zustand';
import { AnalyzeOptions, defaultOptions } from '../core/ctx';
import { Pt, Quad, apply } from '../core/geom';
import { FacadeModel } from '../core/model';
import { ScaleSpec } from '../core/scale';
import { DetailLevel, LayerName, LayerSettings, defaultLayerSettings } from '../drawing/types';
import { RectInfo } from '../worker/protocol';
import { worker } from '../worker/client';
import { mergeRefinement, MergeSummary } from '../ai/merge';
import { NormBox, toNorm, fromNorm } from '../ai/provider';
import { hostedRefiner } from '../platform';

export type View = 'photo' | 'rectified' | 'drawing' | 'overlay';
export type Tool = 'select' | 'pan' | 'addWindow' | 'addDoor' | 'addLine' | 'ignore' | 'scalePoints';
export type Status = 'loading' | 'ready' | 'processing' | 'done' | 'error';

export interface Project {
  id: string;
  name: string;
  fileUrl: string;
  srcW: number;
  srcH: number;
  status: Status;
  stage: string;
  progress: number;
  error?: string;
  quad: Quad | null;
  quadSource: 'auto' | 'manual' | null;
  /** automatic corners already narrowed to the facade */
  quadLocated: boolean;
  autoConfidence: number | null;
  aspectOverride: number | null;
  /** ignore regions & AI occluders, as quads in source-image pixels */
  ignore: Quad[];
  occluders: Quad[];
  rect: RectInfo | null;
  rectifiedUrl: string | null;
  model: FacadeModel | null;
  past: FacadeModel[];
  future: FacadeModel[];
  scale: ScaleSpec;
  knownWidthMm: number | null;
  knownHeightMm: number | null;
  ai: { status: 'idle' | 'running' | 'done' | 'error'; message?: string; summary?: MergeSummary };
  timings?: Record<string, number>;
}

interface State {
  projects: Project[];
  activeId: string | null;
  level: DetailLevel;
  view: View;
  tool: Tool;
  lineLayer: LayerName;
  selectedId: string | null;
  selectedEntity: string | null;
  layers: LayerSettings;
  overlayOpacity: number;
  showQC: boolean;
  focusRect: { x: number; y: number; w: number; h: number; t: number } | null;
  settings: AnalyzeOptions & { maxSide: number };
  apiKey: string;
  rememberKey: boolean;
  scalePts: Pt[];

  addFiles(files: File[] | { name: string; blob: Blob }[]): Promise<void>;
  removeProject(id: string): void;
  setActive(id: string): void;
  patch(p: Partial<State>): void;
  patchProject(id: string, p: Partial<Project>): void;
  setQuad(q: Quad): void;
  autoDetect(): Promise<void>;
  run(id?: string): Promise<void>;
  commit(model: FacadeModel): void;
  undo(): void;
  redo(): void;
  setLayer(name: LayerName, p: Partial<LayerSettings[LayerName]>): void;
  addIgnoreRect(r: { x: number; y: number; w: number; h: number }, space: 'source' | 'rectified'): void;
  clearIgnore(): void;
  aiReview(): Promise<void>;
}

const active = (s: State) => s.projects.find((p) => p.id === s.activeId) ?? null;
export const useActive = () => useStore((s) => active(s));

let pc = 0;
const readKey = () => { try { return sessionStorage.getItem('facade-cad:key') ?? ''; } catch { return ''; } };

export const useStore = create<State>((set, get) => ({
  projects: [],
  activeId: null,
  level: 2,
  view: 'photo',
  tool: 'select',
  lineLayer: '11_DECORATIVE_DETAILS',
  selectedId: null,
  selectedEntity: null,
  layers: defaultLayerSettings(),
  overlayOpacity: 0.55,
  showQC: true,
  focusRect: null,
  settings: { ...defaultOptions, maxSide: 1800 },
  apiKey: readKey(),
  rememberKey: !!readKey(),
  scalePts: [],

  async addFiles(files) {
    for (const f of files) {
      const blob = f instanceof File ? f : f.blob;
      const name = f instanceof File ? f.name : f.name;
      if (!/^image\/(jpeg|png|webp)$/.test(blob.type) && !/\.(jpe?g|png|webp)$/i.test(name)) continue;
      const id = `p${++pc}`;
      const proj: Project = {
        id, name, fileUrl: URL.createObjectURL(blob), srcW: 0, srcH: 0, status: 'loading', stage: 'Decoding image', progress: 0,
        quad: null, quadSource: null, quadLocated: false, autoConfidence: null, aspectOverride: null, ignore: [], occluders: [], rect: null, rectifiedUrl: null,
        model: null, past: [], future: [], scale: { mode: 'none' }, knownWidthMm: null, knownHeightMm: null, ai: { status: 'idle' },
      };
      set((s) => ({ projects: [...s.projects, proj], activeId: id, selectedId: null, selectedEntity: null }));
      try {
        const l = await worker.load(id, blob);
        get().patchProject(id, { srcW: l.w, srcH: l.h, status: 'ready', stage: l.scale < 1 ? `Working copy ${l.w}×${l.h}px` : '' });
        const a = await worker.auto(id);
        get().patchProject(id, { quad: a.quad, quadSource: 'auto', quadLocated: false, autoConfidence: a.confidence });
        await get().run(id);
      } catch (e) {
        get().patchProject(id, { status: 'error', error: (e as Error).message });
      }
    }
  },
  removeProject(id) {
    worker.drop(id);
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id);
      return { projects, activeId: s.activeId === id ? projects[0]?.id ?? null : s.activeId };
    });
  },
  setActive(id) { set({ activeId: id, selectedId: null, selectedEntity: null }); },
  patch(p) { set(p as Partial<State>); },
  patchProject(id, p) { set((s) => ({ projects: s.projects.map((x) => (x.id === id ? { ...x, ...p } : x)) })); },
  setQuad(q) { const p = active(get()); if (p) get().patchProject(p.id, { quad: q, quadSource: 'manual', quadLocated: false }); },
  async autoDetect() {
    const p = active(get());
    if (!p) return;
    const a = await worker.auto(p.id);
    get().patchProject(p.id, { quad: a.quad, quadSource: 'auto', quadLocated: false, autoConfidence: a.confidence });
  },
  async run(id) {
    const p = get().projects.find((x) => x.id === (id ?? get().activeId));
    if (!p || p.status === 'loading') return;
    const { settings } = get();
    get().patchProject(p.id, { status: 'processing', stage: 'Starting', progress: 0, error: undefined });
    try {
      const aspect = p.aspectOverride ?? (p.knownWidthMm && p.knownHeightMm ? p.knownWidthMm / p.knownHeightMm : undefined);
      const res = await worker.process(
        {
          id: p.id, quad: p.quad, quadIsAuto: p.quadSource === 'auto' && !p.quadLocated, aspect: aspect ?? undefined, ignore: p.ignore, occluders: p.occluders,
          maxSide: settings.maxSide, options: settings,
        },
        (stage, prog) => get().patchProject(p.id, { stage, progress: prog }),
      );
      const url = await rgbaToUrl(res.rectified.w, res.rectified.h, res.rectified.data);
      if (p.rectifiedUrl) URL.revokeObjectURL(p.rectifiedUrl);
      const prev = get().projects.find((x) => x.id === p.id)!;
      get().patchProject(p.id, {
        status: 'done', stage: '', progress: 1, quad: res.quad, quadSource: prev.quadSource === 'manual' ? 'manual' : 'auto', quadLocated: prev.quadLocated || res.located,
        autoConfidence: res.autoConfidence ?? prev.autoConfidence,
        rect: res.rect, rectifiedUrl: url, model: res.model, past: prev.model ? [...prev.past, prev.model].slice(-50) : prev.past, future: [], timings: res.timings,
      });
      if (get().view === 'photo' && get().activeId === p.id && prev.model === null) set({ view: 'overlay' });
    } catch (e) {
      get().patchProject(p.id, { status: 'error', error: (e as Error).message });
    }
  },
  commit(model) {
    const p = active(get());
    if (!p || !p.model) return;
    get().patchProject(p.id, { model, past: [...p.past, p.model].slice(-100), future: [] });
  },
  undo() {
    const p = active(get());
    if (!p || !p.past.length || !p.model) return;
    get().patchProject(p.id, { model: p.past[p.past.length - 1], past: p.past.slice(0, -1), future: [p.model, ...p.future] });
  },
  redo() {
    const p = active(get());
    if (!p || !p.future.length || !p.model) return;
    get().patchProject(p.id, { model: p.future[0], future: p.future.slice(1), past: [...p.past, p.model] });
  },
  setLayer(name, patch) { set((s) => ({ layers: { ...s.layers, [name]: { ...s.layers[name], ...patch } } })); },
  addIgnoreRect(r, space) {
    const p = active(get());
    if (!p) return;
    const corners: Pt[] = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
    const q = (space === 'rectified' && p.rect ? corners.map((c) => apply(p.rect!.Hinv, c)) : corners) as Quad;
    get().patchProject(p.id, { ignore: [...p.ignore, q] });
  },
  clearIgnore() { const p = active(get()); if (p) get().patchProject(p.id, { ignore: [], occluders: [] }); },
  async aiReview() {
    const p = active(get());
    if (!p || !p.model || !p.rect) return;
    const key = get().apiKey.trim();
    const hosted = await hostedRefiner();
    if (!hosted && !key) { get().patchProject(p.id, { ai: { status: 'error', message: 'Enter an Anthropic API key first.' } }); return; }
    get().patchProject(p.id, { ai: { status: 'running', message: 'Sending the corrected photo for review…' } });
    try {
      const m = p.model;
      const jpg = await worker.jpeg(p.id, 1568);
      const f = m.facade;
      const boxes = new Map<string, NormBox>();
      const candidates = m.openings.map((o) => { const b = toNorm(o.rect, m.width, m.height); boxes.set(o.id, b); return { id: o.id, kind: o.kind, box: b, confidence: o.confidence }; });
      const provider = hosted ?? (await import('../ai/claude')).claudeProvider(key); // SDK loaded only when used
      const res = await provider.refine({
        imageBase64: jpg.base64, width: jpg.w, height: jpg.h, candidates,
        facade: toNorm({ x: f.x0, y: f.top, w: f.x1 - f.x0, h: f.ground - f.top }, m.width, m.height),
      });
      // occluders go back into the local analysis so pattern inference can work around them
      if (res.occluders.length) {
        const occ = res.occluders.map((o) => {
          const r = fromNorm(o.box, m.width, m.height);
          return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }].map((c) => apply(p.rect!.Hinv, c)) as Quad;
        });
        get().patchProject(p.id, { occluders: occ });
        await get().run(p.id);
      }
      const cur = get().projects.find((x) => x.id === p.id)!;
      const merged = mergeRefinement(cur.model!, res, boxes);
      get().patchProject(p.id, {
        model: merged.model, past: [...cur.past, cur.model!].slice(-100), future: [],
        ai: { status: 'done', summary: merged.summary, message: `${res.model}: ${merged.summary.rejected} rejected, ${merged.summary.reclassified} re-classified, ${merged.summary.added} added, ${res.occluders.length} occluder(s) masked.` },
      });
    } catch (e) {
      get().patchProject(p.id, { ai: { status: 'error', message: (e as Error).message } });
    }
  },
}));

async function rgbaToUrl(w: number, h: number, buf: ArrayBuffer): Promise<string> {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buf), w, h), 0, 0);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
  return URL.createObjectURL(blob);
}

export function persistKey(key: string, remember: boolean) {
  try {
    if (remember && key) sessionStorage.setItem('facade-cad:key', key); else sessionStorage.removeItem('facade-cad:key');
  } catch { /* storage unavailable */ }
}
