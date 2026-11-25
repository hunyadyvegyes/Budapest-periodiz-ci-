// Geometry hygiene before display/export: no duplicate, zero-length or fragmented collinear lines.
import { Entity, LineE } from './types';

const q = (v: number) => Math.round(v * 4) / 4; // 0.25 px grid

export function cleanup(ents: Entity[]): { entities: Entity[]; duplicatesRemoved: number; merged: number } {
  const out: Entity[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;
  // axis-aligned lines grouped for merging: layer|orientation|coordinate|lw|ltype
  const groups = new Map<string, LineE[]>();
  for (const e of ents) {
    if (e.type === 'line') {
      const a = { x: q(e.a.x), y: q(e.a.y) }, b = { x: q(e.b.x), y: q(e.b.y) };
      if (a.x === b.x && a.y === b.y) { duplicatesRemoved++; continue; }
      const [p, r] = a.x < b.x || (a.x === b.x && a.y <= b.y) ? [a, b] : [b, a];
      const key = `${e.layer}|${p.x},${p.y},${r.x},${r.y}`;
      if (seen.has(key)) { duplicatesRemoved++; continue; }
      seen.add(key);
      const line: LineE = { ...e, a: p, b: r };
      if (p.y === r.y || p.x === r.x) {
        const gk = `${e.layer}|${p.y === r.y ? 'h' : 'v'}|${p.y === r.y ? p.y : p.x}|${e.lw ?? ''}|${e.ltype ?? ''}`;
        (groups.get(gk) ?? groups.set(gk, []).get(gk)!).push(line);
      } else out.push(line);
    } else if (e.type === 'poly') {
      const key = `${e.layer}|P|${e.pts.map((p) => `${q(p.x)},${q(p.y)}`).join(';')}`;
      if (seen.has(key)) { duplicatesRemoved++; continue; }
      seen.add(key);
      out.push(e);
    } else out.push(e);
  }
  let merged = 0;
  for (const [gk, lines] of groups) {
    const horizontal = gk.split('|')[1] === 'h';
    const lo = (l: LineE) => (horizontal ? l.a.x : l.a.y), hi = (l: LineE) => (horizontal ? l.b.x : l.b.y);
    lines.sort((a, b) => lo(a) - lo(b));
    let cur = lines[0];
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i];
      if (lo(l) <= hi(cur) + 0.25) {
        // overlapping or touching collinear segments -> one line (keeps the first id)
        if (hi(l) > hi(cur)) cur = { ...cur, b: { ...l.b } };
        merged++;
      } else { out.push(cur); cur = l; }
    }
    out.push(cur);
  }
  return { entities: out, duplicatesRemoved, merged };
}
