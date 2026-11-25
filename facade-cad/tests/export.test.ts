// Export formats: DXF validated with ezdxf (independent reader + auditor), PDF parsed with pypdf, SVG structure.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { run } from '../scripts/evalLib';
import { generateDrawing } from '../src/drawing/generate';
import { Drawing, LAYER_DEFS } from '../src/drawing/types';
import { exportDXF } from '../src/export/dxf';
import { exportPDF } from '../src/export/pdf';
import { exportSVG } from '../src/export/svg';
import { addOpening, deleteElement, setOpeningRect, setSubdivisions } from '../src/state/edits';

const hasPy = (mod: string) => spawnSync('python3', ['-c', `import ${mod}`]).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facade-export-'));
let drawings: Drawing[] = [];

beforeAll(() => {
  const { res, truth } = run('brick-townhouse', 'manual');
  const mm = (truth.facade.width_m * 1000) / res.rect.facade.w;
  let m = res.model;
  // exercise editing operations before export
  const added = addOpening(m, 'window', { x: m.facade.x0 + 20, y: m.facade.top + 40, w: 30, h: 50 });
  m = setSubdivisions(added.model, added.id, 1, 1);
  m = setOpeningRect(m, added.id, { x: m.facade.x0 + 22, y: m.facade.top + 40, w: 32, h: 52 });
  m = deleteElement(m, added.id);
  drawings = ([1, 2, 3] as const).map((l) => generateDrawing(m, l, { mmPerPx: mm }));
  drawings.push(generateDrawing(m, 2, { mmPerPx: null })); // unscaled
});

describe('DXF', () => {
  it('uses the CAD layer standard and real lineweights', () => {
    const dxf = exportDXF(drawings[1]);
    for (const L of LAYER_DEFS) expect(dxf).toContain(`\r\n${L.name}\r\n`);
    expect(dxf).toContain('AC1015');
    expect(dxf).toMatch(/\r\n370\r\n50\r\n/); // 0.50 mm outline layer
    expect(dxf).toContain('LWPOLYLINE');
    // bulges on LWPOLYLINE vertices = arched window heads (one more group 42 is the text style height)
    expect((dxf.match(/\r\n 42\r\n/g) ?? []).length).toBeGreaterThan(1);
  });
  it.skipIf(!hasPy('ezdxf'))('passes the ezdxf strict loader and auditor (R2000 and R12, all levels)', () => {
    const files: string[] = [];
    drawings.forEach((d, i) => {
      for (const v of ['R2000', 'R12'] as const) {
        const f = path.join(tmp, `d${i}-${v}.dxf`);
        fs.writeFileSync(f, exportDXF(d, { version: v }));
        files.push(f);
      }
    });
    const out = execFileSync('python3', [path.resolve(__dirname, '../scripts/validate_dxf.py'), ...files], { encoding: 'utf8' });
    expect(out).not.toContain('FAIL');
    expect(out.match(/^OK /gm)?.length).toBe(files.length);
  });
});

describe('PDF / SVG', () => {
  it.skipIf(!hasPy('pypdf'))('produces a valid single-page vector PDF', () => {
    const f = path.join(tmp, 'e.pdf');
    fs.writeFileSync(f, exportPDF(drawings[2]));
    const out = execFileSync('python3', ['-c', `import pypdf,sys;r=pypdf.PdfReader(sys.argv[1],strict=True);p=r.pages[0];c=p.get_contents().get_data();print(len(r.pages), float(p.mediabox.width)>100, c.count(b' S'))`, f], { encoding: 'utf8' });
    const [pages, sized, strokes] = out.trim().split(' ');
    expect(pages).toBe('1');
    expect(sized).toBe('True');
    expect(+strokes).toBeGreaterThan(100);
  });
  it('produces layered SVG in paper millimetres', () => {
    const { svg, paper } = exportSVG(drawings[1]);
    expect(svg).toMatch(/width="[\d.]+mm"/);
    expect(svg).toContain('<g id="03_OPENINGS"');
    expect(paper.scaleDenom).toBeGreaterThan(0);
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(50);
  });
  it('labels unscaled drawings as unscaled', () => {
    expect(drawings[3].entities.some((e) => e.type === 'text' && /UNSCALED/.test(e.text))).toBe(true);
    expect(exportDXF(drawings[3])).toMatch(/\$INSUNITS\r\n 70\r\n0\r\n/);
  });
});

describe('zip container (hosted DXF save)', () => {
  it.skipIf(!hasPy('zipfile'))('is readable by a standard unzip', async () => {
    const { zip } = await import('../src/platform');
    const f = path.join(tmp, 'x.zip');
    const dxf = exportDXF(drawings[0]);
    fs.writeFileSync(f, zip([{ name: 'facade.dxf', data: new TextEncoder().encode(dxf) }]));
    const out = execFileSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(z.namelist()[0], len(z.read("facade.dxf")))', f], { encoding: 'utf8' });
    expect(out.trim()).toBe(`facade.dxf ${new TextEncoder().encode(dxf).length}`);
  });
});
