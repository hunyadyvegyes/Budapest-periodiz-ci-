// Architectural regularisation: repeated elements share geometry, rows and columns align,
// symmetric facades are snapped to their axis, and gaps in a clear pattern that coincide with
// occluders are filled with clearly-flagged inferred openings.
import { Ctx } from './ctx';
import { Rect, cluster1D, coverage, iou, median, rcx, rcy } from './geom';
import { Opening, uid } from './model';
import { OpeningMaps, evidence } from './openings';

const similar = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(a, b);

export function dedupe(openings: Opening[]): Opening[] {
  const sorted = [...openings].sort((a, b) => b.confidence * b.rect.w * b.rect.h - a.confidence * a.rect.w * a.rect.h);
  const kept: Opening[] = [];
  for (const o of sorted) {
    if (kept.some((k) => iou(k.rect, o.rect) > 0.3 || coverage(o.rect, k.rect) > 0.7)) continue;
    kept.push(o);
  }
  return kept;
}

export interface Pattern { rows: Opening[][]; columns: { x: number; members: Opening[] }[]; templates: Map<string, Opening[]> }

/** Group openings into rows (vertical overlap) – each row is one storey's opening band. */
export function rowsOf(openings: Opening[]): Opening[][] {
  const rows: { y0: number; y1: number; m: Opening[] }[] = [];
  for (const o of [...openings].sort((a, b) => rcy(a.rect) - rcy(b.rect))) {
    const r = rows.find((row) => {
      const ov = Math.min(row.y1, o.rect.y + o.rect.h) - Math.max(row.y0, o.rect.y);
      return ov > 0.5 * Math.min(o.rect.h, row.y1 - row.y0);
    });
    if (r) { r.m.push(o); r.y0 = median(r.m.map((x) => x.rect.y)); r.y1 = median(r.m.map((x) => x.rect.y + x.rect.h)); }
    else rows.push({ y0: o.rect.y, y1: o.rect.y + o.rect.h, m: [o] });
  }
  return rows.map((r) => r.m.sort((a, b) => a.rect.x - b.rect.x));
}

function assignTemplates(openings: Opening[]): Map<string, Opening[]> {
  const groups: Opening[][] = [];
  for (const o of openings) {
    const g = groups.find((gr) => {
      const r = gr[0];
      return r.kind === o.kind && similar(r.rect.w, o.rect.w, 0.12) && similar(r.rect.h, o.rect.h, 0.12) && !!r.arch === !!o.arch;
    });
    if (g) g.push(o); else groups.push([o]);
  }
  const map = new Map<string, Opening[]>();
  for (const g of groups) {
    if (g.length < 2) { g[0].templateId = undefined; continue; }
    const id = uid('T');
    g.forEach((o) => (o.templateId = id));
    map.set(id, g);
  }
  return map;
}

/** Consensus subdivisions for a template: positions present in at least half of the members. */
function consensus(members: Opening[], key: 'mullions' | 'transoms', sKey: 'mullionStrength' | 'transomStrength') {
  const all: { p: number; s: number }[] = [];
  members.forEach((o) => o[key].forEach((p, i) => all.push({ p, s: o[sKey][i] ?? 0.5 })));
  const clusters = cluster1D(all, (a) => a.p, 0.06);
  const pos: number[] = [], str: number[] = [];
  for (const c of clusters) {
    const support = c.length / members.length;
    if (support >= 0.45) {
      pos.push(median(c.map((a) => a.p)));
      str.push(Math.min(1, median(c.map((a) => a.s)) * Math.min(1, support + 0.2)));
    }
  }
  return { pos, str, agreement: clusters.length ? clusters.filter((c) => c.length / members.length >= 0.45).reduce((a, c) => a + c.length, 0) / Math.max(1, all.length) : 1 };
}

export function applyTemplates(templates: Map<string, Opening[]>) {
  for (const members of templates.values()) {
    const w = median(members.map((o) => o.rect.w)), h = median(members.map((o) => o.rect.h));
    const frame = median(members.map((o) => o.frame));
    const m = consensus(members, 'mullions', 'mullionStrength');
    const t = consensus(members, 'transoms', 'transomStrength');
    const archs = members.filter((o) => o.arch);
    const arch = archs.length > members.length / 2 ? { type: archs.filter((a) => a.arch!.type === 'round').length >= archs.length / 2 ? 'round' as const : 'segmental' as const, rise: median(archs.map((a) => a.arch!.rise)) } : undefined;
    const sills = members.filter((o) => o.sill);
    const hoods = members.filter((o) => o.hood);
    const sillRel = sills.length > members.length / 2 ? {
      ext: median(sills.map((o) => (o.sill!.w - o.rect.w) / 2)), dy: median(sills.map((o) => o.sill!.y - (o.rect.y + o.rect.h))), h: median(sills.map((o) => o.sill!.h)),
    } : null;
    const hoodRel = hoods.length > members.length / 2 ? {
      ext: median(hoods.map((o) => (o.hood!.w - o.rect.w) / 2)), h: median(hoods.map((o) => o.hood!.h)),
    } : null;
    for (const o of members) {
      const dw = Math.abs(o.rect.w - w) / w, dh = Math.abs(o.rect.h - h) / h;
      if (dw > 0.06 || dh > 0.06) o.flags.push(`size harmonised with ${members.length} similar openings`);
      const cx = rcx(o.rect), cy = rcy(o.rect);
      o.rect = { x: cx - w / 2, y: cy - h / 2, w, h };
      o.frame = frame;
      o.mullions = m.pos; o.mullionStrength = m.str;
      o.transoms = t.pos; o.transomStrength = t.str;
      o.arch = arch && { ...arch };
      o.sill = sillRel ? { x: o.rect.x - sillRel.ext, y: o.rect.y + o.rect.h + sillRel.dy, w: o.rect.w + 2 * sillRel.ext, h: sillRel.h } : undefined;
      o.hood = hoodRel ? { x: o.rect.x - hoodRel.ext, y: o.rect.y - hoodRel.h, w: o.rect.w + 2 * hoodRel.ext, h: hoodRel.h } : undefined;
      o.confidence = Math.min(1, o.confidence * 0.8 + 0.2 * (0.5 + 0.5 * m.agreement) + 0.05);
    }
  }
}

/** Align tops/bottoms in rows and centres in columns. */
function align(rows: Opening[][], ctx: Ctx) {
  const tolY = Math.max(3, 0.012 * ctx.fh);
  for (const row of rows) {
    for (const grp of cluster1D(row.filter((o) => o.kind === 'window'), (o) => o.rect.h, 0.1 * median(row.map((o) => o.rect.h)))) {
      if (grp.length < 2) continue;
      const top = median(grp.map((o) => o.rect.y));
      for (const o of grp) if (Math.abs(o.rect.y - top) < tolY * 2) { if (o.sill) o.sill.y += top - o.rect.y; if (o.hood) o.hood.y += top - o.rect.y; o.rect.y = top; }
    }
  }
  const all = rows.flat().filter((o) => o.kind === 'window');
  const tolX = Math.max(3, 0.25 * (median(all.map((o) => o.rect.w)) || 10));
  const cols = cluster1D(all, (o) => rcx(o.rect), tolX);
  for (const col of cols) {
    if (col.length < 2) continue;
    // weight by confidence
    const cx = median(col.map((o) => rcx(o.rect)));
    for (const o of col) {
      const dx = cx - rcx(o.rect);
      if (Math.abs(dx) < tolX) { o.rect.x += dx; if (o.sill) o.sill.x += dx; if (o.hood) o.hood.x += dx; }
    }
  }
  return cols.map((c) => ({ x: median(c.map((o) => rcx(o.rect))), members: c }));
}

/** Mirror axis if the facade is clearly symmetric (>= 80% of openings paired). */
export function findSymmetry(openings: Opening[], ctx: Ctx): number | null {
  if (openings.length < 4) return null;
  const tol = 0.012 * ctx.fw;
  const cands: number[] = [];
  for (let i = 0; i < openings.length; i++) for (let j = i + 1; j < openings.length; j++) {
    const a = openings[i], b = openings[j];
    if (Math.abs(rcy(a.rect) - rcy(b.rect)) < tol * 2 && similar(a.rect.w, b.rect.w, 0.15)) cands.push((rcx(a.rect) + rcx(b.rect)) / 2);
  }
  openings.forEach((o) => cands.push(rcx(o.rect)));
  const mid = (ctx.facade.x0 + ctx.facade.x1) / 2;
  let best: { axis: number; score: number } | null = null;
  for (const c of cluster1D(cands, (v) => v, tol)) {
    const axis = median(c);
    if (Math.abs(axis - mid) > 0.15 * ctx.fw) continue;
    let paired = 0;
    for (const o of openings) {
      const mx = 2 * axis - rcx(o.rect);
      if (openings.some((p) => Math.abs(rcx(p.rect) - mx) < tol * 1.5 && Math.abs(rcy(p.rect) - rcy(o.rect)) < tol * 3 && similar(p.rect.w, o.rect.w, 0.15))) paired++;
    }
    const score = paired / openings.length;
    if (!best || score > best.score) best = { axis, score };
  }
  return best && best.score >= 0.8 ? best.axis : null;
}

function snapSymmetric(openings: Opening[], axis: number, ctx: Ctx) {
  const tol = 0.015 * ctx.fw;
  const done = new Set<string>();
  for (const o of openings) {
    if (done.has(o.id)) continue;
    const mx = 2 * axis - rcx(o.rect);
    if (Math.abs(rcx(o.rect) - axis) < tol) { // on the axis: centre it
      const dx = axis - rcx(o.rect); o.rect.x += dx; if (o.sill) o.sill.x += dx; if (o.hood) o.hood.x += dx; done.add(o.id); continue;
    }
    const p = openings.find((q) => q !== o && !done.has(q.id) && Math.abs(rcx(q.rect) - mx) < tol && Math.abs(rcy(q.rect) - rcy(o.rect)) < tol * 2);
    if (!p) continue;
    const d = (Math.abs(rcx(o.rect) - axis) + Math.abs(rcx(p.rect) - axis)) / 2;
    for (const [q, s] of [[o, Math.sign(rcx(o.rect) - axis)], [p, Math.sign(rcx(p.rect) - axis)]] as const) {
      const dx = axis + s * d - rcx(q.rect);
      q.rect.x += dx; if (q.sill) q.sill.x += dx; if (q.hood) q.hood.x += dx;
    }
    done.add(o.id); done.add(p.id);
  }
}

/** Trim candidates that merged with a dark occluder below (e.g. a car) back to the row's template. */
function trimToTemplates(openings: Opening[], templates: Map<string, Opening[]>, ctx: Ctx) {
  for (const o of openings) {
    if (o.templateId || o.kind === 'window') continue;
    for (const members of templates.values()) {
      const t = members[0];
      if (t.kind !== 'window') continue;
      const sameTop = members.some((m) => Math.abs(m.rect.y - o.rect.y) < 0.015 * ctx.fh);
      if (sameTop && similar(t.rect.w, o.rect.w, 0.2) && o.rect.h > 1.25 * t.rect.h) {
        const cx = rcx(o.rect);
        o.kind = 'window';
        o.rect = { x: cx - t.rect.w / 2, y: t.rect.y, w: t.rect.w, h: t.rect.h };
        o.flags.push('trimmed to the repeated window size (dark object merged below)');
        o.confidence *= 0.8;
        o.templateId = t.templateId;
        members.push(o);
        break;
      }
    }
  }
}

function inferMissing(rows: Opening[][], cols: { x: number; members: Opening[] }[], all: Opening[], ctx: Ctx, maps: OpeningMaps): Opening[] {
  const added: Opening[] = [];
  for (const row of rows) {
    const wins = row.filter((o) => o.kind === 'window' && o.templateId);
    if (wins.length < 2) continue;
    const counts = new Map<string, number>();
    wins.forEach((o) => counts.set(o.templateId!, (counts.get(o.templateId!) ?? 0) + 1));
    const tId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const tmpl = wins.find((o) => o.templateId === tId)!;
    for (const col of cols) {
      if (col.members.length < 2) continue;
      if (!col.members.some((m) => m.templateId === tId || Math.abs(m.rect.w - tmpl.rect.w) < 0.2 * tmpl.rect.w)) continue;
      const cell: Rect = { x: col.x - tmpl.rect.w / 2, y: tmpl.rect.y, w: tmpl.rect.w, h: tmpl.rect.h };
      if (cell.x < ctx.facade.x0 || cell.x + cell.w > ctx.facade.x1) continue;
      if ([...all, ...added].some((o) => iou(o.rect, cell) > 0.05 || coverage(cell, o.rect) > 0.1)) continue;
      // occluded?
      let occ = 0;
      for (const r of ctx.occlusions) occ += coverage(cell, r);
      let occPix = 0, n = 0;
      for (let y = Math.round(cell.y); y < cell.y + cell.h; y += 2) for (let x = Math.round(cell.x); x < cell.x + cell.w; x += 2) { n++; if (ctx.occ[y * ctx.W + x]) occPix++; }
      occ = Math.max(Math.min(1, occ), occPix / Math.max(1, n));
      const ev = evidence(maps, cell);
      let conf = 0, why = '';
      if (occ > 0.3 && ctx.opt.inferOccluded) { conf = 0.35; why = `inferred from repeated pattern (${Math.round(occ * 100)}% occluded in photo)`; }
      else if (ev > 0.55) { conf = 0.3 + 0.2 * Math.min(1, ev); why = 'weak photographic evidence – completes the repeated pattern'; }
      if (!conf) continue;
      added.push({
        ...structuredClone(tmpl), id: uid('o'), rect: cell, confidence: conf, source: 'inferred', flags: [why],
        sill: tmpl.sill && { ...tmpl.sill, x: cell.x - (tmpl.rect.x - tmpl.sill.x) }, hood: tmpl.hood && { ...tmpl.hood, x: cell.x - (tmpl.rect.x - tmpl.hood.x) },
      });
    }
  }
  return added;
}

/**
 * A wide, ragged dark region at ground level spanning several window columns of the storeys
 * above is a parked vehicle (or similar) merged with the openings behind it: drop it, mask it as
 * an occluder, and let pattern inference recover the openings.
 */
function removeMergedOccluders(ctx: Ctx, openings: Opening[], maps: OpeningMaps): Opening[] {
  const wins = openings.filter((o) => o.kind === 'window');
  if (wins.length < 4) return openings;
  const ww = median(wins.map((o) => o.rect.w));
  const cols = cluster1D(wins, (o) => rcx(o.rect), 0.3 * ww).filter((c) => c.length >= 2).map((c) => median(c.map((o) => rcx(o.rect))));
  return openings.filter((o) => {
    if (o.kind === 'window' || o.rect.w < 2.2 * ww) return true;
    const spanned = cols.filter((x) => x > o.rect.x + 0.2 * ww && x < o.rect.x + o.rect.w - 0.2 * ww).length;
    let on = 0, n = 0;
    for (let y = Math.round(o.rect.y); y < o.rect.y + o.rect.h; y += 2) for (let x = Math.round(o.rect.x); x < o.rect.x + o.rect.w; x += 2) {
      const lx = x - maps.ox, ly = y - maps.oy;
      if (lx < 0 || ly < 0 || lx >= maps.dark.w || ly >= maps.dark.h) continue;
      n++; if (maps.dark.data[ly * maps.dark.w + lx]) on++;
    }
    const fill = n ? on / n : 1;
    if (spanned >= 2 && fill < 0.8) {
      // mask only the lower part (the vehicle); the window heads above remain usable evidence
      const occ = { x: o.rect.x, y: o.rect.y + o.rect.h * 0.45, w: o.rect.w, h: o.rect.h * 0.55 };
      ctx.occlusions.push(occ);
      for (let y = Math.round(occ.y); y < occ.y + occ.h; y++) ctx.occ.fill(1, y * ctx.W + Math.round(occ.x), y * ctx.W + Math.round(occ.x + occ.w));
      ctx.notes.push('A dark foreground object merged with ground-floor openings was masked (likely a vehicle).');
      return false;
    }
    return true;
  });
}

/** Within a storey, windows that share width and sill but disagree in height/arch are harmonised to the majority. */
function harmoniseRows(rows: Opening[][], ctx: Ctx) {
  for (const row of rows) {
    const wins = row.filter((o) => o.kind === 'window');
    if (wins.length < 3) continue;
    const ww = median(wins.map((o) => o.rect.w)), sill = median(wins.map((o) => o.rect.y + o.rect.h)), hh = median(wins.map((o) => o.rect.h));
    const peers = wins.filter((o) => similar(o.rect.w, ww, 0.12) && Math.abs(o.rect.y + o.rect.h - sill) < 0.02 * ctx.fh);
    if (peers.length < 3) continue;
    const arched = peers.filter((o) => o.arch);
    const majorityArch = arched.length >= peers.length * 0.6 ? arched[0].arch : arched.length <= peers.length * 0.4 ? undefined : null;
    for (const o of peers) {
      if (!similar(o.rect.h, hh, 0.1)) {
        o.rect = { ...o.rect, y: o.rect.y + o.rect.h - hh, h: hh };
        o.flags.push('height harmonised with its storey');
        o.confidence *= 0.9;
      }
      if (majorityArch !== null && !!o.arch !== !!majorityArch) {
        o.arch = majorityArch && { ...majorityArch };
        o.flags.push('head shape harmonised with its storey');
      }
    }
  }
}

export function regularize(ctx: Ctx, input: Opening[], maps: OpeningMaps): { openings: Opening[]; symmetryAxis: number | null; rows: Opening[][] } {
  let openings = removeMergedOccluders(ctx, dedupe(input), maps);
  harmoniseRows(rowsOf(openings), ctx);
  let templates = assignTemplates(openings);
  trimToTemplates(openings, templates, ctx);
  openings = dedupe(openings);
  templates = assignTemplates(openings);
  applyTemplates(templates);
  let rows = rowsOf(openings);
  const cols = align(rows, ctx);
  let axis: number | null = null;
  if (ctx.opt.symmetry) {
    axis = findSymmetry(openings, ctx);
    if (axis !== null) snapSymmetric(openings, axis, ctx);
  }
  const added = inferMissing(rows, cols, openings, ctx, maps);
  openings = [...openings, ...added];
  rows = rowsOf(openings);
  return { openings, symmetryAxis: axis, rows };
}
