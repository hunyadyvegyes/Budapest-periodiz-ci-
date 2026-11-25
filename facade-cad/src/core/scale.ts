// Scale calibration and an explicit, conservative error model.
// The drawing never claims more accuracy than the photograph supports.
import { Pt, clamp, dist } from './geom';
import { FacadeModel } from './model';

export type ScaleSpec =
  | { mode: 'none' }
  | { mode: 'known'; target: 'facadeWidth' | 'facadeHeight' | 'elementWidth' | 'elementHeight'; mm: number; elementId?: string }
  | { mode: 'points'; a: Pt; b: Pt; mm: number };

export interface ScaleResult {
  mmPerPx: number | null;
  /** 1-sigma relative error of lengths measured along the reference direction */
  relErr: number;
  /** relative error for lengths in the other direction (depends on aspect-ratio certainty) */
  relErrCross: number;
  confidence: number;
  referencePx: number;
  label: string;
  notes: string[];
}

export interface PerspectiveInfo {
  /** 0..1 */
  rectificationConfidence: number;
  /** aspect ratio came from user-given width and height */
  aspectFixed: boolean;
  /** focal length was estimated from vanishing points (otherwise assumed) */
  focalEstimated: boolean;
  residualTiltDeg: number;
}

const EDGE_SIGMA_PX = 1.5; // localisation uncertainty of one end of a measured length

export function computeScale(m: FacadeModel, spec: ScaleSpec, p: PerspectiveInfo): ScaleResult {
  const notes: string[] = [];
  if (spec.mode === 'none' || !(('mm' in spec) && spec.mm > 0)) {
    return { mmPerPx: null, relErr: NaN, relErrCross: NaN, confidence: 0, referencePx: 0, label: 'Unscaled (arbitrary units)', notes: ['No reference dimension: the drawing is unscaled.'] };
  }
  let px = 0, horizontal = true, endSigma = EDGE_SIGMA_PX, what = '';
  if (spec.mode === 'points') {
    px = dist(spec.a, spec.b);
    horizontal = Math.abs(spec.b.x - spec.a.x) >= Math.abs(spec.b.y - spec.a.y);
    endSigma = 2.0; // clicked points
    what = 'two reference points';
  } else {
    const f = m.facade;
    switch (spec.target) {
      case 'facadeWidth': px = f.x1 - f.x0; horizontal = true; what = 'facade width'; break;
      case 'facadeHeight': px = f.ground - m.roof.eaveY; horizontal = false; what = 'facade height (ground to eave)'; break;
      case 'elementWidth':
      case 'elementHeight': {
        const o = m.openings.find((x) => x.id === spec.elementId);
        if (!o) return { mmPerPx: null, relErr: NaN, relErrCross: NaN, confidence: 0, referencePx: 0, label: 'Unscaled', notes: ['Select an opening to use as reference.'] };
        horizontal = spec.target === 'elementWidth';
        px = horizontal ? o.rect.w : o.rect.h;
        endSigma = EDGE_SIGMA_PX * (o.confidence < 0.6 ? 2 : 1.3);
        what = `${o.kind} ${horizontal ? 'width' : 'height'}`;
        if (o.templateId) notes.push('Reference opening belongs to a repeated group – its size is the group median.');
        break;
      }
    }
  }
  if (px < 5) return { mmPerPx: null, relErr: NaN, relErrCross: NaN, confidence: 0, referencePx: px, label: 'Unscaled', notes: ['Reference is too short to scale from.'] };
  const mmPerPx = spec.mm / px;
  const meas = (Math.SQRT2 * endSigma) / px;
  // residual projective error: imperfect corners leave a scale gradient across the facade
  const persp = 0.004 + (1 - p.rectificationConfidence) * 0.04 + Math.sin((p.residualTiltDeg * Math.PI) / 180) * 0.5;
  const relErr = Math.sqrt(meas * meas + persp * persp);
  const aspectErr = p.aspectFixed ? 0.003 : p.focalEstimated ? 0.02 : 0.04;
  const relErrCross = Math.sqrt(relErr * relErr + aspectErr * aspectErr);
  if (px < 150) notes.push(`Reference spans only ${px.toFixed(0)} px – use a longer dimension (e.g. the facade width) for better accuracy.`);
  if (!p.aspectFixed) notes.push(`${horizontal ? 'Vertical' : 'Horizontal'} dimensions depend on the estimated aspect ratio (±${(aspectErr * 100).toFixed(0)}%). Enter both facade width and height to fix it.`);
  const worst = Math.max(relErr, relErrCross);
  return {
    mmPerPx, relErr, relErrCross, confidence: clamp(1 - worst * 10, 0.05, 0.98), referencePx: px,
    label: `Scaled from ${what}: ±${(relErr * 100).toFixed(1)}% along, ±${(relErrCross * 100).toFixed(1)}% across`, notes,
  };
}

/** Plausibility of real dimensions after scaling (catches a wrong reference or unit). */
export function scalePlausibility(m: FacadeModel, mmPerPx: number): string[] {
  const issues: string[] = [];
  const toM = (px: number) => (px * mmPerPx) / 1000;
  const floors = m.floors.filter((f) => f.index > 0).map((f, i, arr) => (i === 0 ? m.facade.ground - f.y : arr[i - 1].y - f.y));
  for (const h of floors) if (toM(h) < 2.2 || toM(h) > 7) { issues.push(`Storey height of ${toM(h).toFixed(2)} m is unusual.`); break; }
  const wins = m.openings.filter((o) => o.kind === 'window');
  const ww = wins.map((o) => toM(o.rect.w)).sort((a, b) => a - b);
  if (ww.length && (ww[Math.floor(ww.length / 2)] < 0.3 || ww[Math.floor(ww.length / 2)] > 4)) issues.push(`Typical window width of ${ww[Math.floor(ww.length / 2)].toFixed(2)} m is unusual.`);
  for (const d of m.openings.filter((o) => o.kind === 'door' || o.kind === 'portal')) {
    const h = toM(d.rect.h);
    if (h < 1.8 || h > 7) { issues.push(`Door height of ${h.toFixed(2)} m is unusual.`); break; }
  }
  const W = toM(m.facade.x1 - m.facade.x0);
  if (W < 3 || W > 300) issues.push(`Facade width of ${W.toFixed(1)} m is unusual.`);
  return issues;
}
