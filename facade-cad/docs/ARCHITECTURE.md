# Facade → CAD: feasibility, approach and architecture

## 1. Feasibility

Turning a facade photograph into a *useful* CAD elevation is feasible for a working MVP when:

* the facade is roughly planar and the photo shows it with moderate perspective (both vertical
  convergence and some yaw are corrected);
* openings contrast with the wall (true for daylight photos of almost all buildings: glazing and
  door leaves are darker than the wall, or framed by strong edges);
* the user accepts a short review step (corners, quality check, a few edits).

The hard parts, and how this MVP treats them:

| Problem | Treatment |
|---|---|
| Real dimensions from one photo | Impossible without a reference. The drawing is *unscaled* unless the user gives a known dimension or two reference points. A conservative error model is always shown. |
| True proportions (aspect ratio) | Metric rectification from the two vanishing points; the focal length is estimated from them when both are finite, otherwise a typical value is assumed and the uncertainty is reported. Entering width *and* height fixes it exactly. |
| Occluders (trees, cars, people) | Vegetation mask (colour + texture), shape test for dark objects merged with ground-floor openings, user mask rectangles, optional AI occluder detection. Openings hidden by occluders are inferred from the repeated pattern and flagged. |
| Ornament | Traced as vector contours only where the photo shows clear relief, and only at level 3. Never synthesised. |
| Semantic understanding (what is a window vs a sign) | Classical CV gives geometry; an optional vision-model review (Claude) can confirm/reject/re-classify candidates. Geometry stays photo-derived. |

Out of scope for the MVP: curved or strongly non-planar facades, multi-photo stitching into one
elevation (several photos are handled as separate projects), and night photos.

## 2. Technology stack

| Layer | Choice | Why |
|---|---|---|
| App | **React 19 + TypeScript + Vite**, zustand state | Same stack as the rest of this repository; static hosting (GitHub Pages), no server. |
| Processing | **Pure TypeScript CV library** (`src/core`) running in a **Web Worker** | Photos never leave the browser; no native dependencies; the identical code runs in Node for tests and evaluation. ~3–5 s per photo at 1800 px. |
| Vector output | Own **DXF writer** (R2000 with handles/objects/lineweights, plus R12), SVG, minimal **PDF** writer | Full control over layers, lineweights, bulged polylines; no runtime dependency. Validated with **ezdxf** (strict loader + auditor) and **pypdf** in the test-suite. |
| Optional AI | `@anthropic-ai/sdk`, model `claude-opus-5-5`, structured JSON output, loaded lazily | Behind a provider interface (`src/ai/provider.ts`), so the model or vendor can be swapped. |
| Tests | Vitest + procedurally rendered photographs with ground truth | No real photos could be downloaded in the build environment; the generator renders facades and photographs them with a pinhole camera, so accuracy is *measured*. |

## 3. Computer-vision approach (`src/core`)

1. **Perspective** (`lines.ts`, `rectify.ts`): LSD-style line-segment detector → RANSAC vanishing
   points (vertical, dominant horizontal) → metric homography `R·K⁻¹` with focal length from
   orthogonal VPs. Manual mode uses the four user corners; the same metric step estimates the true
   width/height ratio of the quad. Automatic mode runs a fast whole-image pass, then isolates the
   main facade (window columns that share the storey rows of the central column, widened to long
   vertical building edges, topped at the cornice) and continues as if those corners were placed.
2. **Masks** (`masks.ts`): sky (region growing from the top), vegetation (hue + saturation +
   texture), user/AI occluders.
3. **Openings** (`openings.ts`): wall background = grey opening (removes frames, mullions, mortar)
   followed by a storey-sized closing; *relative darkness* `(background − L)/background` is
   thresholded (Otsu, bounded), textured regions are suppressed, storey-wide strips removed.
   Candidates are extended along their jambs (reflective upper panes), split panes are merged when
   the gap is a single bar (≤ 4 lights per window), then refined against edge profiles to the outer
   opening edge and the frame width. Arched heads are fitted as circular segments to the frame edge.
   Mullions/transoms are bar-shaped deviations across the glazing; sills and hoods are horizontal
   edge runs just below/above.
4. **Regularisation** (`regularize.ts`): de-duplication, removal of vehicles merged with openings,
   storey harmonisation, **templates** for repeated openings (shared size, frame, subdivisions,
   sills, hoods, arch), row/column alignment, mirror-symmetry snapping, and flagged inference of
   occluded openings in a clear grid.
5. **Structure** (`structure.ts`): roofline (sky boundary → Douglas-Peucker → orthogonal snapping),
   ground line (auto mode), horizontal bands from edge *coverage* excluding openings (cornices,
   string courses, plinth, projection by cast shadow), periodic line runs → masonry coursing
   (brick, ashlar, rustication), pilasters/downpipes/wall edges from vertical coverage and edge
   polarity, balustrades from dense vertical-edge texture, floor levels from storey rows, string
   courses and balcony slabs.
6. **Details** (`details.ts`, level 3): band-pass relief contours (marching squares) above openings,
   shared across a template; roof tile courses; brick head-joint spacing by autocorrelation.

Every element carries a **confidence** and **source** (`detected | inferred | ai | user`) and short
flags explaining what changed it. This drives the QC panel and the `18_QC_REVIEW` layer.

## 4. Geometry → drawing (`src/drawing`)

The semantic `FacadeModel` is the single source of truth; `generateDrawing(model, level)` builds the
vector drawing, so switching level never re-runs analysis and edits apply to every level.

* **Level 1**: outline incl. roof, ground, floor levels, openings (arches as true arcs), main
  cornice, simplified balconies.
* **Level 2** (default): + frames, sashes, major mullions/transoms, sills, hoods, all bands with a
  heavier shadow line under projections, pilasters, downpipes, railings with posts, roof line,
  material transitions, major ornament.
* **Level 3**: + every subdivision, frame components, glazing beads, balusters with width, full
  cornice profiles and returns, ornament contours, brick/stone/rustication/tile coursing clipped
  around openings, pipe brackets.

`cleanup.ts` removes zero-length and duplicate lines and merges collinear fragments per layer.

## 5. CAD export (`src/export`)

* DXF **R2000**: HEADER (`$INSUNITS` = mm when scaled, extents, `$LWDISPLAY`), all symbol tables,
  BLOCK_RECORDs, OBJECTS (root dictionary, groups, layouts, plot-style placeholder, mline style).
  Entities: LINE, LWPOLYLINE (closed, with **bulges** for arched heads), ARC, CIRCLE, TEXT; layer
  colour/linetype/**lineweight**, entity lineweight overrides for depth lines.
  CAD origin = facade bottom-left on the ground line, y up.
* DXF **R12** fallback for very old readers (no lineweights in that format).
* **SVG** in paper millimetres at a drawing scale (1:50/100/200…), one `<g>` per layer
  (Inkscape layers), true arcs; **PDF** single page with real line widths; **PNG** rasterised
  from the SVG.

Layer standard: `00_REFERENCE … 13_HATCHING` as specified, plus `14_COLUMNS_PILASTERS`,
`15_FLOOR_LEVELS` (dashed), `16_DRAINAGE`, `17_ANNOTATION` (level marks, title, scale bar),
`18_QC_REVIEW` (off, not plotted).

## 6. Application architecture

```
src/
  core/        image ops, geometry, perspective, analysis pipeline   (pure TS, Node + Worker)
  drawing/     layer standard, level-dependent generation, cleanup
  export/      DXF R2000/R12, SVG, PDF
  qc/          quality checks
  ai/          provider interface, Claude refiner, merge rules
  worker/      Web Worker + typed protocol + promise client
  state/       zustand store (projects, history), pure edit operations, derived data
  ui/          React components (canvas editor, panels)
scripts/       sample generator (Python), evaluation, DXF validation/rendering
tests/         geometry, recognition accuracy gates, export validity
```

## 7. Measured results (synthetic photographs, `npm run eval`)

| Sample | Corners | Precision | Recall | Mean IoU | Door |
|---|---|---|---|---|---|
| Eclectic apartment house (balconies, car, pediments) | manual | 1.00 | 1.00 | 0.83 | ✓ |
| | automatic | 1.00 | 1.00 | 0.85 | ✓ |
| Modernist office (dense grid, tree occluding) | manual | 0.93 | 0.89 | 0.91 | ✓ |
| | automatic | 0.78 | 0.86 | 0.91 | ✓ |
| Brick townhouse (arched windows, brick texture) | manual | 0.82 | 1.00 | 0.75 | ✓ |
| | automatic | 0.62 | 0.89 | 0.81 | ✓ |

Aspect ratio error with manual corners: ≤ 0.3 %. Eave height from a known facade width: < 2 %.
These are synthetic scenes; real photographs are harder (reflections, clutter, weathering) and
were not available in the build environment. Expect to use masks, the AI review and edits more often.

## 8. Next steps

* Evaluate on a real-photo set (e.g. CMP Facade, ECP) and tune thresholds; add a learned
  segmentation model (ONNX in the worker) behind the same candidate interface.
* Multi-photo fusion for long facades (homography chaining) and higher-resolution tiles.
* Snapping/constraint editing (equal spacing, align), DXF blocks for repeated window templates,
  DXF IMAGE reference of the rectified photo on `00_REFERENCE`.
