// Pre-export quality control: flags what a person should look at before trusting the drawing.
import { Rect, coverage, iou, median, rcx } from '../core/geom';
import { FacadeModel } from '../core/model';
import { ScaleResult, scalePlausibility } from '../core/scale';
import { Drawing } from '../drawing/types';

export type Severity = 'error' | 'warning' | 'info';
export interface QCIssue {
  id: string;
  severity: Severity;
  category: 'missing' | 'detection' | 'consistency' | 'geometry' | 'duplicates' | 'perspective' | 'contours' | 'scale' | 'uncertain';
  message: string;
  elementId?: string;
  rect?: Rect;
}
export interface QCReport { issues: QCIssue[]; score: number; counts: Record<Severity, number> }

export function runQC(m: FacadeModel, d: Drawing, scale: ScaleResult): QCReport {
  const issues: QCIssue[] = [];
  let n = 0;
  const add = (i: Omit<QCIssue, 'id'>) => issues.push({ id: `qc${++n}`, ...i });
  const wins = m.openings.filter((o) => o.kind === 'window');

  if (!m.openings.length) add({ severity: 'error', category: 'detection', message: 'No openings recognised. Check the perspective corners, the masked areas or raise the sensitivity.' });

  // missing elements: empty cells in a clear grid that were not inferred
  const ww = median(wins.map((o) => o.rect.w)) || 0;
  if (wins.length >= 4) {
    const cols: number[][] = [];
    for (const o of [...wins].sort((a, b) => rcx(a.rect) - rcx(b.rect))) {
      const c = cols.find((cc) => Math.abs(median(cc) - rcx(o.rect)) < 0.3 * ww);
      if (c) c.push(rcx(o.rect)); else cols.push([rcx(o.rect)]);
    }
    const rows = new Map<number, typeof wins>();
    for (const o of wins) {
      const key = [...rows.keys()].find((k) => Math.abs(k - o.rect.y) < 0.4 * o.rect.h) ?? o.rect.y;
      rows.set(key, [...(rows.get(key) ?? []), o]);
    }
    for (const [, row] of rows) {
      if (row.length < 2) continue;
      const h = median(row.map((o) => o.rect.h)), y = median(row.map((o) => o.rect.y));
      for (const c of cols) {
        if (c.length < 3) continue;
        const x = median(c);
        const cell = { x: x - ww / 2, y, w: ww, h };
        if (m.openings.some((o) => coverage(cell, o.rect) > 0.2) || m.balconies.some((k) => x > k.x0 && x < k.x1 && Math.abs(k.railTop - (y + h)) < h)) continue;
        add({ severity: 'info', category: 'missing', message: 'Gap in a repeated opening pattern – a window may be missing (or the wall is genuinely blank here).', rect: cell });
      }
    }
  }
  // detection quality
  for (const o of m.openings) {
    if (o.source === 'inferred') add({ severity: 'warning', category: 'detection', message: `Inferred ${o.kind}: ${o.flags[0] ?? 'completes a repeated pattern'}. Verify against the photo.`, elementId: o.id, rect: o.rect });
    else if (o.confidence < 0.5) add({ severity: 'warning', category: 'detection', message: `Low-confidence ${o.kind} (${Math.round(o.confidence * 100)}%).`, elementId: o.id, rect: o.rect });
  }
  // consistency of repeated elements
  for (let i = 0; i < wins.length; i++) for (let j = i + 1; j < wins.length; j++) {
    const a = wins[i], b = wins[j];
    if (a.templateId && a.templateId === b.templateId) continue;
    const sameRow = Math.abs(a.rect.y - b.rect.y) < 0.03 * (m.facade.ground - m.facade.top);
    const dw = Math.abs(a.rect.w - b.rect.w) / Math.max(a.rect.w, b.rect.w), dh = Math.abs(a.rect.h - b.rect.h) / Math.max(a.rect.h, b.rect.h);
    if (sameRow && dw > 0.04 && dw < 0.15 && dh < 0.15) add({ severity: 'info', category: 'consistency', message: `Two openings in the same storey differ by ${Math.round(dw * 100)}% in width – check whether they should be identical.`, elementId: b.id, rect: b.rect });
  }
  // duplicates / overlaps
  for (let i = 0; i < m.openings.length; i++) for (let j = i + 1; j < m.openings.length; j++) {
    if (iou(m.openings[i].rect, m.openings[j].rect) > 0.05) add({ severity: 'error', category: 'duplicates', message: 'Overlapping openings.', elementId: m.openings[j].id, rect: m.openings[j].rect });
  }
  if (d.stats.duplicatesRemoved) add({ severity: 'info', category: 'duplicates', message: `${d.stats.duplicatesRemoved} duplicate or zero-length line(s) removed from the drawing.` });
  if (d.stats.merged) add({ severity: 'info', category: 'geometry', message: `${d.stats.merged} fragmented collinear segment(s) merged into continuous lines.` });
  // perspective
  if (m.meta.residualTiltDeg > 0.8) add({ severity: 'warning', category: 'perspective', message: `Long vertical lines are still tilted by ${m.meta.residualTiltDeg.toFixed(1)}° after correction – adjust the corner points.` });
  if (m.meta.rectificationConfidence < 0.6) add({ severity: 'warning', category: 'perspective', message: 'Perspective correction is uncertain (strongly oblique photo or automatic corners). Place the four facade corners manually.' });
  // contours
  const ol = m.outline;
  if (ol.length < 4) add({ severity: 'error', category: 'contours', message: 'Building outline is incomplete.' });
  for (const u of m.userLines) if (u.layer === '01_BUILDING_OUTLINE' && !u.closed) add({ severity: 'warning', category: 'contours', message: 'A user-drawn outline polyline is not closed.', elementId: u.id });
  for (const e of d.entities) if (e.type === 'poly' && e.layer === '03_OPENINGS' && !e.closed) add({ severity: 'warning', category: 'contours', message: 'Unclosed opening contour.', elementId: e.src });
  // scale
  if (!scale.mmPerPx) add({ severity: 'info', category: 'scale', message: 'The drawing is unscaled (arbitrary units). Enter a known dimension or two reference points to scale it.' });
  else {
    for (const s of scalePlausibility(m, scale.mmPerPx)) add({ severity: 'warning', category: 'scale', message: `${s} The reference dimension may be wrong.` });
    if (scale.relErrCross > 0.03) add({ severity: 'info', category: 'scale', message: `Estimated dimensional uncertainty up to ±${(scale.relErrCross * 100).toFixed(1)}%.` });
  }
  // uncertain geometry
  const weak = [...m.bands, ...m.balconies, ...m.verticals].filter((e) => e.confidence < 0.5).length;
  if (weak) add({ severity: 'info', category: 'uncertain', message: `${weak} structural element(s) (bands, balconies, verticals) have low confidence – highlighted on the QC layer.` });
  if (m.ornaments.length) add({ severity: 'info', category: 'uncertain', message: `${m.ornaments.length} ornament outline(s) traced from the photo (level 3) – simplified, check against the original.` });
  for (const note of m.meta.notes) add({ severity: 'info', category: 'uncertain', message: note });

  const counts = { error: 0, warning: 0, info: 0 } as Record<Severity, number>;
  issues.forEach((i) => counts[i.severity]++);
  const score = Math.max(0, Math.min(1, m.meta.geometryConfidence - 0.15 * counts.error - 0.03 * counts.warning));
  return { issues, score, counts };
}
