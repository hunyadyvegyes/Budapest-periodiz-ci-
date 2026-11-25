import { describe, expect, it } from 'vitest';
import { apply, homographyFrom4, inv3, iou, simplify } from '../src/core/geom';
import { computeRectification, estimateQuadAspect, warpPerspective } from '../src/core/rectify';
import { cleanup } from '../src/drawing/cleanup';
import { Entity } from '../src/drawing/types';
import { bulgePoints } from '../src/export/geometry';

describe('projective geometry', () => {
  it('maps four points exactly and inverts', () => {
    const src = [{ x: 10, y: 20 }, { x: 400, y: 35 }, { x: 380, y: 300 }, { x: 30, y: 280 }];
    const dst = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }];
    const H = homographyFrom4(src, dst);
    src.forEach((p, i) => { const q = apply(H, p); expect(q.x).toBeCloseTo(dst[i].x, 6); expect(q.y).toBeCloseTo(dst[i].y, 6); });
    const back = apply(inv3(H), dst[2]);
    expect(back.x).toBeCloseTo(380, 6);
  });

  it('recovers the true aspect ratio of a rectangle seen in perspective', () => {
    // 20 m x 10 m facade, pinhole camera f = 1200 px looking up and sideways
    const f = 1200, W = 1600, H = 1200;
    const yaw = 0.2, pitch = 0.18;
    const C = [10 - 30 * Math.tan(yaw), 1.6, -30];
    const proj = (u: number, v: number) => {
      const P = [u - C[0], v - C[1], 0 - C[2]];
      const ry = [Math.cos(yaw) * P[0] - Math.sin(yaw) * P[2], P[1], Math.sin(yaw) * P[0] + Math.cos(yaw) * P[2]];
      const X = [ry[0], Math.cos(pitch) * ry[1] - Math.sin(pitch) * ry[2], Math.sin(pitch) * ry[1] + Math.cos(pitch) * ry[2]];
      return { x: (f * X[0]) / X[2] + W / 2, y: (-f * X[1]) / X[2] + H / 2 };
    };
    const quad = [proj(0, 10), proj(20, 10), proj(20, 0), proj(0, 0)] as [any, any, any, any];
    const est = estimateQuadAspect(quad, W, H);
    expect(est.focalEstimated).toBe(true);
    expect(est.focalPx).toBeGreaterThan(1100);
    expect(est.focalPx).toBeLessThan(1300);
    expect(est.aspect).toBeGreaterThan(1.96);
    expect(est.aspect).toBeLessThan(2.04);
  });

  it('warps an image so the quad becomes the facade rectangle', () => {
    const w = 60, h = 40, data = new Uint8ClampedArray(w * h * 4).fill(255);
    const quad = [{ x: 5, y: 5 }, { x: 55, y: 8 }, { x: 52, y: 35 }, { x: 8, y: 33 }] as [any, any, any, any];
    const r = computeRectification(quad, w, h, { aspect: 2, margin: { top: 0, bottom: 0, left: 0, right: 0 }, maxSide: 100 });
    expect(r.facade.w / r.facade.h).toBeCloseTo(2, 2);
    const out = warpPerspective({ w, h, data }, r.Hinv, r.outW, r.outH);
    expect(out.data[(Math.floor(r.outH / 2) * r.outW + Math.floor(r.outW / 2)) * 4 + 3]).toBe(255);
  });

  it('simplifies closed loops without collapsing them', () => {
    const sq = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }];
    expect(simplify(sq, 0.5).length).toBe(5);
  });

  it('computes IoU', () => {
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 })).toBeCloseTo(1 / 3, 6);
  });

  it('bulge 1 is a semicircle over the top', () => {
    const pts = bulgePoints({ x: 10, y: 0 }, { x: -10, y: 0 }, 1, 10);
    const top = pts.reduce((a, b) => (b.y < a.y ? b : a));
    expect(top.y).toBeCloseTo(-10, 3); // y-down: apex above the chord
  });
});

describe('drawing cleanup', () => {
  it('removes duplicates and merges collinear fragments', () => {
    const L = (id: string, x0: number, x1: number): Entity => ({ type: 'line', id, layer: '02_WALLS', a: { x: x0, y: 5 }, b: { x: x1, y: 5 } });
    const res = cleanup([L('a', 0, 10), L('b', 10, 0), L('c', 10, 20), L('d', 15, 30), L('e', 40, 50)]);
    expect(res.duplicatesRemoved).toBe(1);
    const lines = res.entities.filter((e) => e.type === 'line');
    expect(lines.length).toBe(2);
  });
});
