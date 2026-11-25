// Central viewer/editor: photo (perspective corners, ignore regions), rectified photo,
// CAD elevation and overlay views with pan/zoom and direct editing of the model.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pt, Quad, Rect } from '../core/geom';
import { FacadeModel } from '../core/model';
import { generateDrawing } from '../drawing/generate';
import { Drawing, Entity, LAYER_COLORS, LayerSettings } from '../drawing/types';
import { entityPath } from '../export/svg';
import { Derived } from '../state/derived';
import { addOpening, addUserLine, findElement, moveHorizontal, moveOpening, moveUserLinePoint, moveVertical, setOpeningRect } from '../state/edits';
import { Project, useStore } from '../state/store';

type VB = { x: number; y: number; w: number; h: number };
type Drag =
  | { kind: 'pan'; start: Pt; vb: VB; moved: boolean }
  | { kind: 'quad'; index: number }
  | { kind: 'rect'; start: Pt; cur: Pt; purpose: 'addWindow' | 'addDoor' | 'ignore' }
  | { kind: 'move'; id: string; start: Pt; cur: Pt; axis: 'xy' | 'y' | 'x' }
  | { kind: 'resize'; id: string; handle: string; start: Pt; cur: Pt; orig: Rect }
  | { kind: 'uline'; id: string; index: number; cur: Pt };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

export default function Canvas({ project, derived }: { project: Project; derived: Derived | null }) {
  const view = useStore((s) => s.view);
  const tool = useStore((s) => s.tool);
  const layers = useStore((s) => s.layers);
  const selectedId = useStore((s) => s.selectedId);
  const opacity = useStore((s) => s.overlayOpacity);
  const showQC = useStore((s) => s.showQC);
  const focusRect = useStore((s) => s.focusRect);
  const lineLayer = useStore((s) => s.lineLayer);
  const scalePts = useStore((s) => s.scalePts);
  const level = useStore((s) => s.level);
  const { patch, setQuad, commit, addIgnoreRect } = useStore.getState();
  const svgRef = useRef<SVGSVGElement>(null);
  const [vbs, setVbs] = useState<Record<string, VB>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const [lineStart, setLineStart] = useState<Pt | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const model = project.model;
  const photo = view === 'photo';
  const contentW = photo ? project.srcW : model?.width ?? project.srcW;
  const contentH = photo ? project.srcH : model?.height ?? project.srcH;
  const key = `${project.id}:${photo ? 'photo' : 'model'}`;

  const fit = useCallback((): VB => {
    if (!photo && derived && view === 'drawing') {
      const b = derived.drawing.bounds;
      return pad({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }, 0.03);
    }
    return pad({ x: 0, y: 0, w: contentW || 1000, h: contentH || 800 }, 0.02);
  }, [photo, derived, view, contentW, contentH]);
  const vb = vbs[key] ?? fit();
  const setVb = (v: VB) => setVbs((s) => ({ ...s, [key]: v }));
  useEffect(() => { if (contentW && !vbs[key]) setVbs((s) => ({ ...s, [key]: fit() })); }, [key, contentW]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focusRect || photo) return;
    const r = focusRect;
    setVb(pad({ x: r.x, y: r.y, w: Math.max(r.w, contentW * 0.15), h: Math.max(r.h, contentH * 0.15) }, 0.6));
  }, [focusRect]); // eslint-disable-line react-hooks/exhaustive-deps

  // fit on explicit request
  useEffect(() => {
    const onFit = () => setVb(fit());
    window.addEventListener('facade:fit', onFit);
    return () => window.removeEventListener('facade:fit', onFit);
  });

  const toSvg = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM()!.inverse();
    const r = pt.matrixTransform(m);
    return { x: r.x, y: r.y };
  };
  const pxPerUnit = svgRef.current ? 1 / Math.max(vb.w / svgRef.current.clientWidth, vb.h / svgRef.current.clientHeight) : 1;
  const hs = 6 / pxPerUnit; // handle size in model units

  const onWheel = (e: React.WheelEvent) => {
    const p = toSvg(e);
    const f = Math.exp(e.deltaY * 0.0015);
    setVb({ x: p.x - (p.x - vb.x) * f, y: p.y - (p.y - vb.y) * f, w: vb.w * f, h: vb.h * f });
  };

  // ---------------------------------------------------------------- preview model while dragging
  const preview: FacadeModel | null = useMemo(() => {
    if (!model || !drag) return null;
    if (drag.kind === 'move') {
      const dx = drag.cur.x - drag.start.x, dy = drag.cur.y - drag.start.y;
      return applyMove(model, drag.id, drag.axis, dx, dy);
    }
    if (drag.kind === 'resize') return setOpeningRect(model, drag.id, resizeRect(drag.orig, drag.handle, drag.cur.x - drag.start.x, drag.cur.y - drag.start.y));
    if (drag.kind === 'uline') return moveUserLinePoint(model, drag.id, drag.index, drag.cur);
    return null;
  }, [model, drag]);
  const drawing: Drawing | null = useMemo(() => {
    if (!derived) return null;
    if (!preview) return derived.drawing;
    return generateDrawing(preview, level, { mmPerPx: derived.drawing.mmPerPx, title: '' });
  }, [derived, preview, level]);
  const shownModel = preview ?? model;

  // ---------------------------------------------------------------- pointer handling
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toSvg(e);
    if (e.button === 1 || tool === 'pan' || e.altKey) { setDrag({ kind: 'pan', start: { x: e.clientX, y: e.clientY }, vb, moved: false }); return; }
    if (tool === 'ignore' || (!photo && (tool === 'addWindow' || tool === 'addDoor'))) {
      setDrag({ kind: 'rect', start: p, cur: p, purpose: tool === 'ignore' ? 'ignore' : tool });
      return;
    }
    if (!photo && tool === 'addLine') {
      if (!lineStart) { setLineStart(snapPt(p)); return; }
      const end = ortho(lineStart, snapPt(p), e.shiftKey);
      const r = addUserLine(model!, lineLayer, [lineStart, end]);
      commit(r.model);
      setLineStart(e.ctrlKey || e.metaKey ? end : null);
      return;
    }
    if (!photo && tool === 'scalePoints') {
      const pts = scalePts.length >= 2 ? [p] : [...scalePts, p];
      patch({ scalePts: pts });
      return;
    }
    setDrag({ kind: 'pan', start: { x: e.clientX, y: e.clientY }, vb, moved: false });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = toSvg(e);
    setHover(p);
    if (!drag) return;
    if (drag.kind === 'pan') {
      const el = svgRef.current!;
      const upp = Math.max(drag.vb.w / el.clientWidth, drag.vb.h / el.clientHeight); // units per screen px ("meet")
      const dx = (e.clientX - drag.start.x) * upp, dy = (e.clientY - drag.start.y) * upp;
      if (Math.abs(e.clientX - drag.start.x) + Math.abs(e.clientY - drag.start.y) > 3) {
        setVb({ ...drag.vb, x: drag.vb.x - dx, y: drag.vb.y - dy });
        if (!drag.moved) setDrag({ ...drag, moved: true });
      }
    } else if (drag.kind === 'quad' && project.quad) {
      const q = project.quad.map((c, i) => (i === drag.index ? p : c)) as Quad;
      setQuad(q);
    } else if (drag.kind === 'rect' || drag.kind === 'move' || drag.kind === 'resize' || drag.kind === 'uline') {
      setDrag({ ...drag, cur: snapPt(p) } as Drag);
    }
  };
  const onPointerUp = () => {
    if (!drag) return;
    if (drag.kind === 'pan' && !drag.moved) patch({ selectedId: null, selectedEntity: null });
    if (drag.kind === 'rect') {
      const r = normRect(drag.start, drag.cur);
      if (r.w > 3 && r.h > 3) {
        if (drag.purpose === 'ignore') addIgnoreRect(r, photo ? 'source' : 'rectified');
        else if (model) {
          const res = addOpening(model, drag.purpose === 'addDoor' ? 'door' : 'window', r);
          commit(res.model);
          patch({ selectedId: res.id, tool: 'select' });
        }
      }
    }
    if ((drag.kind === 'move' || drag.kind === 'resize' || drag.kind === 'uline') && preview) {
      const moved = drag.kind === 'uline' || Math.abs(drag.cur.x - drag.start.x) + Math.abs(drag.cur.y - drag.start.y) > 0.5;
      if (moved) commit(preview);
    }
    setDrag(null);
  };

  const snapPt = (p: Pt): Pt => {
    if (!model) return p;
    const tol = 5 / pxPerUnit;
    let { x, y } = p;
    let bx = tol, by = tol;
    for (const o of model.openings) {
      for (const ex of [o.rect.x, o.rect.x + o.rect.w]) if (Math.abs(ex - p.x) < bx) { bx = Math.abs(ex - p.x); x = ex; }
      for (const ey of [o.rect.y, o.rect.y + o.rect.h]) if (Math.abs(ey - p.y) < by) { by = Math.abs(ey - p.y); y = ey; }
    }
    return { x, y };
  };

  const selectEntity = (e: React.PointerEvent, ent: Entity) => {
    if (tool !== 'select' || !ent.src) return;
    e.stopPropagation();
    patch({ selectedId: ent.src, selectedEntity: ent.id });
    const p = toSvg(e);
    const ref = model ? findElement(model, ent.src) : null;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (ref?.kind === 'opening') setDrag({ kind: 'move', id: ent.src, start: p, cur: p, axis: 'xy' });
    else if (ref?.kind === 'band' || ref?.kind === 'balcony' || ref?.kind === 'floor') setDrag({ kind: 'move', id: ent.src, start: p, cur: p, axis: 'y' });
    else if (ref?.kind === 'vertical') setDrag({ kind: 'move', id: ent.src, start: p, cur: p, axis: 'x' });
  };

  const sel = shownModel && selectedId ? findElement(shownModel, selectedId) : null;
  const selRect = sel?.kind === 'opening' ? sel.o.rect : null;
  const cursor = drag?.kind === 'pan' && drag.moved ? 'grabbing' : tool === 'select' ? 'default' : tool === 'pan' ? 'grab' : 'crosshair';

  return (
    <div className="canvas-wrap">
      <svg ref={svgRef} className={`canvas view-${view}`} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setHover(null)} style={{ cursor }}>
        {photo && <image href={project.fileUrl} x={0} y={0} width={project.srcW} height={project.srcH} />}
        {photo && project.quad && <QuadEditor quad={project.quad} hs={hs} onStart={(i) => setDrag({ kind: 'quad', index: i })} auto={project.quadSource === 'auto'} />}
        {photo && [...project.ignore, ...project.occluders].map((q, i) => <polygon key={i} points={q.map((c) => `${c.x},${c.y}`).join(' ')} className="ignore-poly" />)}

        {!photo && project.rectifiedUrl && view !== 'drawing' && (
          <image href={project.rectifiedUrl} x={0} y={0} width={model?.width} height={model?.height} opacity={view === 'overlay' ? opacity : 1} />
        )}
        {!photo && view === 'drawing' && drawing && <rect x={drawing.bounds.x0} y={drawing.bounds.y0} width={drawing.bounds.x1 - drawing.bounds.x0} height={drawing.bounds.y1 - drawing.bounds.y0} fill="#fff" />}
        {!photo && view === 'rectified' && shownModel && <DetectionOverlay model={shownModel} />}
        {!photo && (view === 'drawing' || view === 'overlay') && drawing && shownModel && (
          <>
            {tool === 'select' && <OpeningHitAreas model={shownModel} onDown={(e, id) => { e.stopPropagation(); patch({ selectedId: id, selectedEntity: null }); const p = toSvg(e); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ kind: 'move', id, start: p, cur: p, axis: 'xy' }); }} />}
            <Entities drawing={drawing} layers={layers} colored={view === 'overlay'} selectedId={selectedId} pxPerUnit={pxPerUnit} onDown={selectEntity} />
          </>
        )}
        {!photo && shownModel && showQC && (
          <g className="qc-marks">
            {shownModel.openings.filter((o) => o.confidence < 0.5 || o.source !== 'detected').map((o) => (
              <rect key={o.id} x={o.rect.x - 3} y={o.rect.y - 3} width={o.rect.w + 6} height={o.rect.h + 6} className={`qc-${o.source}`} />
            ))}
          </g>
        )}
        {!photo && shownModel && [...shownModel.occlusions].map((r, i) => <rect key={`oc${i}`} x={r.x} y={r.y} width={r.w} height={r.h} className="occ-rect" />)}
        {selRect && tool === 'select' && (
          <g className="sel">
            <rect x={selRect.x} y={selRect.y} width={selRect.w} height={selRect.h} className="sel-rect" />
            {HANDLES.map((h) => {
              const [hx, hy] = handlePos(selRect, h);
              return <rect key={h} x={hx - hs / 2} y={hy - hs / 2} width={hs} height={hs} className={`handle h-${h}`}
                onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); const p = toSvg(e); setDrag({ kind: 'resize', id: selectedId!, handle: h, start: p, cur: p, orig: selRect }); }} />;
            })}
          </g>
        )}
        {sel?.kind === 'userLine' && shownModel!.userLines.find((u) => u.id === selectedId)!.pts.map((pt, i) => (
          <rect key={i} x={pt.x - hs / 2} y={pt.y - hs / 2} width={hs} height={hs} className="handle"
            onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ kind: 'uline', id: selectedId!, index: i, cur: pt }); }} />
        ))}
        {focusRect && !photo && <rect key={focusRect.t} x={focusRect.x - 6} y={focusRect.y - 6} width={focusRect.w + 12} height={focusRect.h + 12} className="focus-rect" />}
        {drag?.kind === 'rect' && (() => { const r = normRect(drag.start, drag.cur); return <rect x={r.x} y={r.y} width={r.w} height={r.h} className={drag.purpose === 'ignore' ? 'ignore-draft' : 'draft-rect'} />; })()}
        {lineStart && hover && tool === 'addLine' && <line x1={lineStart.x} y1={lineStart.y} x2={ortho(lineStart, hover, false).x} y2={ortho(lineStart, hover, false).y} className="draft-line" />}
        {tool === 'scalePoints' && scalePts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={hs * 0.7} className="scale-pt" />)}
        {tool === 'scalePoints' && scalePts.length === 2 && <line x1={scalePts[0].x} y1={scalePts[0].y} x2={scalePts[1].x} y2={scalePts[1].y} className="scale-line" />}
      </svg>
      <div className="canvas-hud">
        <button onClick={() => setVb(fit())} title="Fit to view (F)">Fit</button>
        <button onClick={() => setVb(pad(vb, -0.2))} title="Zoom in">+</button>
        <button onClick={() => setVb(pad(vb, 0.25))} title="Zoom out">−</button>
        {hover && <span className="coords">{coordLabel(hover, project, derived, photo)}</span>}
      </div>
      {photo && project.quad && (
        <div className="canvas-hint">
          {project.quadSource === 'auto' ? 'Automatic corners – ' : ''}Drag the four corners onto the facade: bottom corners at ground level, top corners at the top of the wall (eave/cornice). Then press <b>Apply correction</b>.
        </div>
      )}
      {!photo && tool === 'addLine' && <div className="canvas-hint">Click start and end point (Shift: free angle, Ctrl/⌘: continue polyline). Layer: {lineLayer}</div>}
      {!photo && tool === 'scalePoints' && <div className="canvas-hint">Click two points whose real distance you know, then enter it in the Scale panel.</div>}
      {tool === 'ignore' && <div className="canvas-hint">Drag rectangles over trees, cars, people or signs to exclude them, then re-run the analysis.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function applyMove(m: FacadeModel, id: string, axis: 'xy' | 'x' | 'y', dx: number, dy: number): FacadeModel {
  const ref = findElement(m, id);
  if (!ref) return m;
  if (ref.kind === 'opening') return moveOpening(m, id, dx, dy);
  if (axis === 'y') return moveHorizontal(m, id, dy);
  if (axis === 'x') return moveVertical(m, id, dx);
  return m;
}

const pad = (r: VB, f: number): VB => ({ x: r.x - r.w * f, y: r.y - r.h * f, w: r.w * (1 + 2 * f), h: r.h * (1 + 2 * f) });
const normRect = (a: Pt, b: Pt): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
function ortho(a: Pt, b: Pt, free: boolean): Pt {
  if (free) return b;
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  if (dy < dx * 0.09) return { x: b.x, y: a.y };
  if (dx < dy * 0.09) return { x: a.x, y: b.y };
  return b;
}
function handlePos(r: Rect, h: string): [number, number] {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2;
  return [x, y];
}
function resizeRect(o: Rect, h: string, dx: number, dy: number): Rect {
  let { x, y, w, h: hh } = o;
  if (h.includes('w')) { x += dx; w -= dx; }
  if (h.includes('e')) w += dx;
  if (h.includes('n')) { y += dy; hh -= dy; }
  if (h.includes('s')) hh += dy;
  if (w < 2) { w = 2; } if (hh < 2) hh = 2;
  return { x, y, w, h: hh };
}
function coordLabel(p: Pt, project: Project, derived: Derived | null, photo: boolean) {
  if (photo || !project.model) return `${p.x.toFixed(0)}, ${p.y.toFixed(0)} px`;
  const f = project.model.facade;
  const k = derived?.scale.mmPerPx;
  if (!k) return `x ${(p.x - f.x0).toFixed(0)}  y ${(f.ground - p.y).toFixed(0)} (units)`;
  return `x ${(((p.x - f.x0) * k) / 1000).toFixed(2)} m   y ${(((f.ground - p.y) * k) / 1000).toFixed(2)} m`;
}

function QuadEditor({ quad, hs, onStart, auto }: { quad: Quad; hs: number; onStart: (i: number) => void; auto: boolean }) {
  return (
    <g className={`quad ${auto ? 'auto' : ''}`}>
      <polygon points={quad.map((c) => `${c.x},${c.y}`).join(' ')} />
      {quad.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r={hs * 1.4} className="quad-handle" onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); onStart(i); }} />
          <line x1={c.x - hs * 3} y1={c.y} x2={c.x + hs * 3} y2={c.y} className="quad-cross" />
          <line x1={c.x} y1={c.y - hs * 3} x2={c.x} y2={c.y + hs * 3} className="quad-cross" />
        </g>
      ))}
    </g>
  );
}

function DetectionOverlay({ model }: { model: FacadeModel }) {
  const f = model.facade;
  const col = (c: number) => (c >= 0.75 ? '#1b998b' : c >= 0.5 ? '#e9b200' : '#d7263d');
  return (
    <g className="det">
      <rect x={f.x0} y={f.top} width={f.x1 - f.x0} height={f.ground - f.top} className="det-facade" />
      <polyline points={model.roof.line.map((p) => `${p.x},${p.y}`).join(' ')} className="det-roof" />
      {model.bands.map((b) => b.lines.map((y, i) => <line key={b.id + i} x1={b.x0} x2={b.x1} y1={y} y2={y} className="det-band" />))}
      {model.openings.map((o) => <rect key={o.id} x={o.rect.x} y={o.rect.y} width={o.rect.w} height={o.rect.h} stroke={col(o.confidence)} className="det-open" />)}
      {model.balconies.map((k) => <rect key={k.id} x={k.x0} y={k.railTop} width={k.x1 - k.x0} height={k.slabBottom - k.railTop} className="det-balc" />)}
      {model.verticals.map((v) => <rect key={v.id} x={v.x0} y={v.y0} width={Math.max(1, v.x1 - v.x0)} height={v.y1 - v.y0} className="det-vert" />)}
      {model.symmetryAxis !== null && <line x1={model.symmetryAxis} x2={model.symmetryAxis} y1={f.top} y2={f.ground} className="det-sym" />}
    </g>
  );
}

function OpeningHitAreas({ model, onDown }: { model: FacadeModel; onDown: (e: React.PointerEvent, id: string) => void }) {
  return (
    <g className="hit-areas">
      {model.openings.map((o) => <rect key={o.id} x={o.rect.x} y={o.rect.y} width={o.rect.w} height={o.rect.h} onPointerDown={(e) => onDown(e, o.id)} />)}
    </g>
  );
}

const Entities = memo(function Entities({ drawing, layers, colored, selectedId, pxPerUnit, onDown }: {
  drawing: Drawing; layers: LayerSettings; colored: boolean; selectedId: string | null; pxPerUnit: number; onDown: (e: React.PointerEvent, ent: Entity) => void;
}) {
  return (
    <g className="ents" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {drawing.entities.map((e) => {
        const L = layers[e.layer];
        if (!L?.visible) return null;
        const sel = !!selectedId && e.src === selectedId;
        const color = sel ? '#ff3d7f' : colored ? LAYER_COLORS[e.layer] : '#111';
        if (e.type === 'text') {
          return <text key={e.id} x={e.p.x} y={e.p.y} fontSize={e.h} fill={color} textAnchor={e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'} className="ent-text">{e.text}</text>;
        }
        const d = entityPath(e);
        const lw = Math.max(0.6, (e.lw ?? L.lw) * 4.2);
        return (
          <g key={e.id}>
            <path d={d} stroke={color} strokeWidth={sel ? lw + 1 : lw} vectorEffect="non-scaling-stroke" strokeDasharray={e.ltype === 'DASHED' ? '6 4' : undefined} />
            {e.src && <path d={d} className="hit" vectorEffect="non-scaling-stroke" onPointerDown={(ev) => onDown(ev, e)} />}
          </g>
        );
      })}
      {void pxPerUnit}
    </g>
  );
});
