// Merge a refiner's review into the locally computed model. The photo-derived geometry stays
// authoritative: the refiner can confirm, re-classify, reject or add openings, never reshape them freely.
import { Rect, clamp, iou } from '../core/geom';
import { FacadeModel, Opening, uid } from '../core/model';
import { NormBox, RefineResult, fromNorm } from './provider';

export interface MergeSummary { rejected: number; reclassified: number; added: number; uncertain: number }

export function mergeRefinement(model: FacadeModel, res: RefineResult, candidateBoxes: Map<string, NormBox>): { model: FacadeModel; summary: MergeSummary } {
  const m: FacadeModel = structuredClone(model);
  const W = m.width, H = m.height;
  const summary: MergeSummary = { rejected: 0, reclassified: 0, added: 0, uncertain: 0 };
  const byBox = (b: NormBox) => {
    const r = fromNorm(b, W, H);
    let best: Opening | null = null, bv = 0;
    for (const o of m.openings) { const v = iou(o.rect, r); if (v > bv) { bv = v; best = o; } }
    return bv > 0.4 ? best : null;
  };
  const remove = new Set<string>();
  for (const v of res.verdicts) {
    const box = candidateBoxes.get(v.id);
    const o = (box && byBox(box)) || m.openings.find((x) => x.id === v.id);
    if (!o) continue;
    const c = clamp(v.confidence, 0, 1);
    if (v.verdict === 'not_an_opening') {
      if (c >= 0.6 && o.source !== 'user') { remove.add(o.id); summary.rejected++; }
      else { o.confidence *= 0.7; o.flags.push(`AI review: probably not an opening (${Math.round(c * 100)}%)`); summary.uncertain++; }
    } else if (v.verdict === 'uncertain') {
      o.confidence *= 0.85; o.flags.push('AI review: uncertain'); summary.uncertain++;
    } else {
      if (v.verdict !== o.kind && c >= 0.6) { o.flags.push(`AI review: re-classified ${o.kind} → ${v.verdict}`); o.kind = v.verdict; summary.reclassified++; }
      o.confidence = clamp(0.5 * o.confidence + 0.5 * c, 0, 1);
      if (!o.flags.some((f) => f.startsWith('AI review'))) o.flags.push('AI review: confirmed');
    }
  }
  m.openings = m.openings.filter((o) => !remove.has(o.id));
  for (const mi of res.missed) {
    const r: Rect = fromNorm(mi.box, W, H);
    if (r.w < 4 || r.h < 4 || m.openings.some((o) => iou(o.rect, r) > 0.2)) continue;
    m.openings.push({
      id: uid('o'), kind: mi.kind, rect: r, frame: Math.max(1.5, 0.06 * Math.min(r.w, r.h)), mullions: [], transoms: [], mullionStrength: [], transomStrength: [],
      handles: [], floor: 0, confidence: 0.4, source: 'ai', flags: ['added by AI review – geometry approximate, verify against the photo'],
    });
    summary.added++;
  }
  m.meta.provider = `local-cv + ${res.model}`;
  if (res.notes) m.meta.notes.push(`AI review: ${res.notes}`);
  return { model: m, summary };
}
