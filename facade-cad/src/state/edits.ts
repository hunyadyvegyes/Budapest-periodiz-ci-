// Pure editing operations on the semantic model (each returns a new model -> trivial undo/redo).
import { Pt, Rect } from '../core/geom';
import { FacadeModel, Opening, OpeningKind, uid } from '../core/model';

const clone = (m: FacadeModel): FacadeModel => structuredClone(m);

export type ElementRef =
  | { kind: 'opening'; o: Opening }
  | { kind: 'band'; id: string }
  | { kind: 'vertical'; id: string }
  | { kind: 'balcony'; id: string }
  | { kind: 'ornament'; id: string }
  | { kind: 'material'; id: string }
  | { kind: 'userLine'; id: string }
  | { kind: 'floor'; index: number }
  | { kind: 'other'; id: string };

export function findElement(m: FacadeModel, id: string): ElementRef | null {
  const o = m.openings.find((x) => x.id === id);
  if (o) return { kind: 'opening', o };
  if (m.bands.some((b) => b.id === id)) return { kind: 'band', id };
  if (m.verticals.some((v) => v.id === id)) return { kind: 'vertical', id };
  if (m.balconies.some((b) => b.id === id)) return { kind: 'balcony', id };
  if (m.ornaments.some((n) => n.id === id)) return { kind: 'ornament', id };
  if (m.materials.some((z) => z.id === id)) return { kind: 'material', id };
  if (m.userLines.some((u) => u.id === id)) return { kind: 'userLine', id };
  const f = /^floor(\d+)$/.exec(id);
  if (f) return { kind: 'floor', index: +f[1] };
  return id ? { kind: 'other', id } : null;
}

const shiftOpening = (o: Opening, dx: number, dy: number) => {
  o.rect = { ...o.rect, x: o.rect.x + dx, y: o.rect.y + dy };
  if (o.sill) o.sill = { ...o.sill, x: o.sill.x + dx, y: o.sill.y + dy };
  if (o.hood) o.hood = { ...o.hood, x: o.hood.x + dx, y: o.hood.y + dy };
  o.handles = o.handles.map((h) => ({ x: h.x + dx, y: h.y + dy }));
};

export function setOpeningRect(m0: FacadeModel, id: string, r: Rect, applyToGroup = false): FacadeModel {
  const m = clone(m0);
  const o = m.openings.find((x) => x.id === id);
  if (!o) return m0;
  const sx = r.w / o.rect.w, sy = r.h / o.rect.h;
  const resize = (t: Opening, nr: Rect) => {
    const ox = t.rect.x, oy = t.rect.y, ow = t.rect.w, oh = t.rect.h;
    t.rect = nr;
    // keep sill/hood attached and proportionally sized
    if (t.sill) t.sill = { x: nr.x - (ox - t.sill.x) * (nr.w / ow), y: nr.y + nr.h + (t.sill.y - (oy + oh)), w: t.sill.w * (nr.w / ow), h: t.sill.h };
    if (t.hood) t.hood = { x: nr.x - (ox - t.hood.x) * (nr.w / ow), y: nr.y - t.hood.h, w: t.hood.w * (nr.w / ow), h: t.hood.h };
    if (t.arch) t.arch = { ...t.arch, rise: t.arch.type === 'round' ? nr.w / 2 : Math.min(nr.w / 2, t.arch.rise * (nr.w / ow)) };
    if (t.source !== 'user') t.flags = [...t.flags.filter((f) => f !== 'edited by user'), 'edited by user'];
    t.confidence = Math.max(t.confidence, 0.9);
  };
  resize(o, r);
  if (applyToGroup && o.templateId) {
    for (const t of m.openings) if (t !== o && t.templateId === o.templateId) {
      const cx = t.rect.x + t.rect.w / 2, bottom = t.rect.y + t.rect.h;
      resize(t, { x: cx - (t.rect.w * sx) / 2, y: bottom - t.rect.h * sy, w: t.rect.w * sx, h: t.rect.h * sy });
    }
  }
  return m;
}

export function moveOpening(m0: FacadeModel, id: string, dx: number, dy: number): FacadeModel {
  const m = clone(m0);
  const o = m.openings.find((x) => x.id === id);
  if (!o) return m0;
  shiftOpening(o, dx, dy);
  return m;
}

export function patchOpening(m0: FacadeModel, id: string, patch: Partial<Opening>, applyToGroup = false): FacadeModel {
  const m = clone(m0);
  const o = m.openings.find((x) => x.id === id);
  if (!o) return m0;
  const targets = applyToGroup && o.templateId ? m.openings.filter((t) => t.templateId === o.templateId) : [o];
  for (const t of targets) {
    Object.assign(t, structuredClone(patch));
    if (patch.arch && t.arch) t.arch = { ...patch.arch, rise: patch.arch.type === 'round' ? t.rect.w / 2 : patch.arch.rise };
  }
  return m;
}

/** Evenly spaced subdivisions (n mullions -> n+1 lights). */
export function setSubdivisions(m: FacadeModel, id: string, mullions: number, transoms: number, applyToGroup = false): FacadeModel {
  const even = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
  return patchOpening(m, id, { mullions: even(mullions), mullionStrength: even(mullions).map(() => 1), transoms: even(transoms), transomStrength: even(transoms).map(() => 1) }, applyToGroup);
}

export function addOpening(m0: FacadeModel, kind: OpeningKind, r: Rect): { model: FacadeModel; id: string } {
  const m = clone(m0);
  const id = uid('o');
  m.openings.push({
    id, kind, rect: r, frame: Math.max(1.5, 0.07 * Math.min(r.w, r.h)), mullions: [], transoms: [], mullionStrength: [], transomStrength: [],
    handles: [], floor: 0, confidence: 1, source: 'user', flags: ['added by user'],
  });
  return { model: m, id };
}

export function deleteElement(m0: FacadeModel, id: string): FacadeModel {
  const m = clone(m0);
  m.openings = m.openings.filter((x) => x.id !== id);
  m.bands = m.bands.filter((x) => x.id !== id);
  m.verticals = m.verticals.filter((x) => x.id !== id);
  m.balconies = m.balconies.filter((x) => x.id !== id);
  m.ornaments = m.ornaments.filter((x) => x.id !== id && x.hostId !== id);
  m.materials = m.materials.filter((x) => x.id !== id);
  m.userLines = m.userLines.filter((x) => x.id !== id);
  const f = /^floor(\d+)$/.exec(id);
  if (f) m.floors = m.floors.filter((fl) => fl.index !== +f[1]);
  return m;
}

/** Hide one generated drawing entity without changing the element it belongs to. */
export function suppressEntity(m0: FacadeModel, entityId: string): FacadeModel {
  const m = clone(m0);
  if (!m.suppressed.includes(entityId)) m.suppressed.push(entityId);
  return m;
}
export const restoreSuppressed = (m0: FacadeModel): FacadeModel => ({ ...clone(m0), suppressed: [] });

export function addUserLine(m0: FacadeModel, layer: string, pts: Pt[], closed = false): { model: FacadeModel; id: string } {
  const m = clone(m0);
  const id = uid('u');
  m.userLines.push({ id, layer, pts, closed });
  return { model: m, id };
}

export function moveUserLinePoint(m0: FacadeModel, id: string, index: number, p: Pt): FacadeModel {
  const m = clone(m0);
  const u = m.userLines.find((x) => x.id === id);
  if (!u) return m0;
  u.pts[index] = p;
  return m;
}

export function moveHorizontal(m0: FacadeModel, id: string, dy: number): FacadeModel {
  const m = clone(m0);
  const b = m.bands.find((x) => x.id === id);
  if (b) { b.y0 += dy; b.y1 += dy; b.lines = b.lines.map((y) => y + dy); b.source = 'user'; return m; }
  const k = m.balconies.find((x) => x.id === id);
  if (k) { k.railTop += dy; k.slabTop += dy; k.slabBottom += dy; k.posts = [...k.posts]; return m; }
  const f = /^floor(\d+)$/.exec(id);
  if (f) { const fl = m.floors.find((x) => x.index === +f[1]); if (fl) { fl.y += dy; fl.estimated = false; } return m; }
  return m0;
}

export function moveVertical(m0: FacadeModel, id: string, dx: number): FacadeModel {
  const m = clone(m0);
  const v = m.verticals.find((x) => x.id === id);
  if (!v) return m0;
  v.x0 += dx; v.x1 += dx; v.lines = v.lines.map((x) => x + dx); v.source = 'user';
  return m;
}
