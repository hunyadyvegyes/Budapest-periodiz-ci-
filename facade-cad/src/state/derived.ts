// Derived data for the active project: scale, drawing at the selected level, quality report.
import { useMemo } from 'react';
import { computeScale, ScaleResult } from '../core/scale';
import { FacadeModel } from '../core/model';
import { generateDrawing } from '../drawing/generate';
import { DetailLevel, Drawing } from '../drawing/types';
import { QCReport, runQC } from '../qc/qc';
import { Project, useActive, useStore } from './store';

export interface Derived { scale: ScaleResult; drawing: Drawing; qc: QCReport }

export function scaleFor(p: Project, model: FacadeModel): ScaleResult {
  return computeScale(model, p.scale, {
    rectificationConfidence: model.meta.rectificationConfidence,
    aspectFixed: !!(p.aspectOverride || (p.knownWidthMm && p.knownHeightMm)),
    focalEstimated: !!p.rect?.focalEstimated,
    residualTiltDeg: model.meta.residualTiltDeg,
  });
}

export function drawingFor(p: Project, model: FacadeModel, level: DetailLevel, scale: ScaleResult): Drawing {
  return generateDrawing(model, level, { mmPerPx: scale.mmPerPx, title: p.name.replace(/\.[a-z]+$/i, '').toUpperCase() });
}

export function useDerived(): Derived | null {
  const p = useActive();
  const level = useStore((s) => s.level);
  return useMemo(() => {
    if (!p?.model || !p.rect) return null;
    const scale = scaleFor(p, p.model);
    const drawing = drawingFor(p, p.model, level, scale);
    return { scale, drawing, qc: runQC(p.model, drawing, scale) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.model, p?.scale, p?.rect, p?.aspectOverride, p?.knownWidthMm, p?.knownHeightMm, level]);
}
