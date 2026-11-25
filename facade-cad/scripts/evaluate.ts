// Runs the recognition pipeline on every sample photo (manual corners and automatic perspective)
// and prints precision / recall / IoU against the generated ground truth.
//   npm run eval            (debug overlays are written to eval-out/)
import fs from 'node:fs';
import path from 'node:path';
import { SAMPLES, run, score, truthToRectified, writeOverlay } from './evalLib';

const index = JSON.parse(fs.readFileSync(path.join(SAMPLES, 'index.json'), 'utf8')) as { name: string }[];
const rows = [];
for (const { name } of index) {
  for (const mode of ['manual', 'auto'] as const) {
    const { res, truth } = run(name, mode);
    const s = score(truth, res, mode);
    rows.push(s);
    const truthRects = truth.openings.map((o) => truthToRectified(truth, res, o.u0, o.v0, o.u1, o.v1));
    writeOverlay(path.resolve(__dirname, `../eval-out/${name}-${mode}.png`), res, truthRects);
    const m = res.model;
    console.log(`${name} [${mode}] openings=${m.openings.length} bands=${m.bands.map((b) => b.kind[0]).join('')} verticals=${m.verticals.map((v) => v.kind).join(',')} balconies=${m.balconies.length} floors=${m.floors.length} ornaments=${m.ornaments.length} materials=${m.materials.map((z) => z.pattern).join(',')} pitched=${m.roof.pitched} sym=${m.symmetryAxis !== null} conf=${m.meta.geometryConfidence.toFixed(2)} tilt=${m.meta.residualTiltDeg.toFixed(2)} t=${JSON.stringify(res.timings)}`);
    if (m.meta.notes.length) console.log('   notes:', m.meta.notes.join(' | '));
  }
}
console.table(rows.map((r) => ({ ...r, precision: +r.precision.toFixed(2), recall: +r.recall.toFixed(2), meanIoU: +r.meanIoU.toFixed(2), aspectErr: isNaN(r.aspectErr) ? '' : (r.aspectErr * 100).toFixed(1) + '%' })));
