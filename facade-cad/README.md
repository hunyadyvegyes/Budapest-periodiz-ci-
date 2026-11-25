# Facade → CAD

Browser-based MVP that converts facade photographs into editable 2D architectural elevation
drawings. It corrects perspective, recognises the facade's architectural elements, rebuilds them
as clean vector geometry at three detail levels, and exports layered **DXF** (plus SVG, PDF, PNG).

Everything runs locally in the browser (Web Worker); photos are not uploaded anywhere. An optional
AI review (Claude) can be enabled with your own API key.

Design, algorithms and measured accuracy: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Run

Requires Node ≥ 20.

```bash
cd facade-cad
npm install
npm run dev        # http://localhost:5174
```

Production build: `npm run build` (static files in `dist/`, host anywhere; set `BASE_PATH` for a
sub-path). Use “Load a sample photo…” in the top bar to try it without your own photo.

| Command | What it does |
|---|---|
| `npm test` | Geometry, recognition accuracy gates on the sample photos, DXF/PDF/SVG validity (DXF via `ezdxf`, PDF via `pypdf` when Python has them) |
| `npm run eval` | Precision/recall/IoU table per sample, debug overlays in `eval-out/` |
| `npm run gen:samples` | Re-render the synthetic sample photographs + ground truth (Python, Pillow, NumPy) |
| `python3 scripts/validate_dxf.py f.dxf` | ezdxf strict load + audit of any exported DXF |
| `python3 scripts/render_dxf.py f.dxf out.png` | Render a DXF with ezdxf (independent visual check) |

## Workflow

1. **Upload** one or more JPG/PNG photos (each becomes a tab). Corners are proposed automatically.
2. **Photo view**: drag the four corners onto the facade: bottom corners on the ground, top
   corners at the top of the wall (eave or cornice). Optionally mask trees, cars or signs.
   Press *Apply correction & analyse*.
3. **Detail level**: 1 Simplified · 2 Architectural (default) · 3 Detailed, switchable at any time.
4. **Scale**: known dimension (facade width/height or a selected opening), two reference points,
   or unscaled. Entering facade width *and* height also fixes the proportions exactly.
   The estimated dimensional uncertainty is always shown; unscaled drawings are labelled as such.
5. **Review & edit** in *Elevation* or *Overlay* (drawing over the corrected photo):
   select, move, resize (handles), delete an element or a single line (Shift+Del), add
   windows/doors/lines, change type, frame, arch, mullion/transom counts (optionally for the whole
   repeated group), toggle layers, edit line weights, undo/redo.
6. **Quality check**: missing/inferred/low-confidence openings, inconsistent repeats, overlaps,
   merged fragments, residual perspective tilt, unclosed contours, scale plausibility. Click an
   item to zoom to it.
7. **Export**: DXF R2000 (layers, colours, lineweights, dashed floor levels, arched openings as
   bulged polylines, mm units), DXF R12, SVG/PDF at 1:50–1:500, PNG, JSON model.

Shortcuts: `1/2/3` levels · `V` select · `H` pan · `W` window · `D` door · `L` line · `F` fit ·
`Del` delete · `Ctrl+Z / Ctrl+Y` undo/redo · wheel zoom · drag background to pan.

## AI review (optional)

In *Recognition → AI review*, enter an Anthropic API key and press *Review with Claude*. The corrected
photo and candidate boxes are sent to `claude-opus-5-5` (structured JSON output). It confirms,
rejects or re-classifies openings, reports occluders (which are then masked and the analysis re-run)
and points out missed openings (added as low-confidence `ai` elements). The key is kept in memory,
or in `sessionStorage` if you tick “remember”, and is sent only to api.anthropic.com. The provider
sits behind `src/ai/provider.ts`, so another model or vendor can be plugged in.

## Honest limits

* Accuracy figures come from synthetic photographs with ground truth (see ARCHITECTURE §7); real
  photos with reflections, clutter and weathering will need more manual review.
* Dimensions are only as good as the reference you give; one photo cannot provide absolute scale.
* Ornament is traced, not modelled; uncertain detail is simplified rather than invented.
* DXF validity is verified with ezdxf, and ezdxf renders the files correctly. The files were not
  opened in AutoCAD, Archicad, Rhino or BricsCAD in this environment.
