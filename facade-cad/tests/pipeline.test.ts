// End-to-end recognition quality on the synthetic photographs (ground truth in public/samples/*.json).
// Thresholds are regression gates, set a little below the measured values.
import { describe, expect, it } from 'vitest';
import { run, score } from '../scripts/evalLib';
import { generateDrawing } from '../src/drawing/generate';
import { runQC } from '../src/qc/qc';
import { computeScale } from '../src/core/scale';

const GATES: Record<string, { manual: [number, number]; auto: [number, number] }> = {
  'budapest-eclectic': { manual: [0.9, 0.9], auto: [0.85, 0.9] },
  'modernist-office': { manual: [0.85, 0.85], auto: [0.6, 0.7] },
  'brick-townhouse': { manual: [0.75, 0.9], auto: [0.5, 0.8] },
};

describe('facade recognition on sample photographs', () => {
  for (const [name, g] of Object.entries(GATES)) {
    for (const mode of ['manual', 'auto'] as const) {
      it(`${name} (${mode} corners)`, () => {
        const { res, truth } = run(name, mode);
        const s = score(truth, res, mode);
        expect(s.precision).toBeGreaterThanOrEqual(g[mode][0]);
        expect(s.recall).toBeGreaterThanOrEqual(g[mode][1]);
        if (mode === 'manual') expect(Math.abs(s.aspectErr)).toBeLessThan(0.02);
        expect(s.doorsFound).toBe('1/1');
      });
    }
  }

  it('reconstructs structure of the eclectic facade (bands, balconies, roof, levels)', () => {
    const { res, truth } = run('budapest-eclectic', 'manual');
    const m = res.model;
    expect(m.roof.pitched).toBe(true);
    expect(m.bands.some((b) => b.kind === 'cornice')).toBe(true);
    expect(m.bands.some((b) => b.kind === 'string_course')).toBe(true);
    expect(m.balconies.length).toBe(2);
    expect(m.verticals.some((v) => v.kind === 'downpipe')).toBe(true);
    expect(m.materials.some((z) => z.pattern === 'rustication')).toBe(true);
    expect(m.floors.length).toBe(truth.openings.reduce((a, o) => Math.max(a, o.floor), 0) + 1);
    // scale from the known facade width reproduces the eave height (17.2 m) within 2 %
    const sc = computeScale(m, { mode: 'known', target: 'facadeWidth', mm: truth.facade.width_m * 1000 }, { rectificationConfidence: 0.9, aspectFixed: false, focalEstimated: true, residualTiltDeg: 0 });
    const eave = ((m.facade.ground - m.roof.eaveY) * sc.mmPerPx!) / 1000;
    expect(Math.abs(eave - truth.facade.wall_height_m) / truth.facade.wall_height_m).toBeLessThan(0.02);
    // all three levels generate, each adds detail, QC runs without errors
    const n = ([1, 2, 3] as const).map((l) => generateDrawing(m, l, { mmPerPx: sc.mmPerPx }).entities.length);
    expect(n[0]).toBeLessThan(n[1]);
    expect(n[1]).toBeLessThan(n[2]);
    const qc = runQC(m, generateDrawing(m, 2, { mmPerPx: sc.mmPerPx }), sc);
    expect(qc.counts.error).toBe(0);
  });
});
