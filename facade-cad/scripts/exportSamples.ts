// Writes DXF (R2000 + R12), SVG and PDF for every sample and detail level into eval-out/ (used by tests).
import fs from 'node:fs';
import path from 'node:path';
import { run } from './evalLib';
import { generateDrawing } from '../src/drawing/generate';
import { exportDXF } from '../src/export/dxf';
import { exportSVG } from '../src/export/svg';
import { exportPDF } from '../src/export/pdf';

const out = path.resolve(__dirname, '../eval-out/export');
fs.mkdirSync(out, { recursive: true });
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['budapest-eclectic', 'brick-townhouse', 'modernist-office'];
for (const name of names) {
  const { res, truth } = run(name, 'manual');
  const mmPerPx = (truth.facade.width_m * 1000) / res.rect.facade.w;
  for (const level of [1, 2, 3] as const) {
    const d = generateDrawing(res.model, level, { mmPerPx, title: truth.name.toUpperCase() });
    fs.writeFileSync(path.join(out, `${name}-L${level}.dxf`), exportDXF(d));
    fs.writeFileSync(path.join(out, `${name}-L${level}-r12.dxf`), exportDXF(d, { version: 'R12' }));
    fs.writeFileSync(path.join(out, `${name}-L${level}.svg`), exportSVG(d).svg);
    fs.writeFileSync(path.join(out, `${name}-L${level}.pdf`), exportPDF(d));
    console.log(name, 'L' + level, 'entities', d.entities.length, 'dupes removed', d.stats.duplicatesRemoved, 'merged', d.stats.merged);
  }
}
