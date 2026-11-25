#!/usr/bin/env python3
"""
Procedural facade photographs with ground truth, used as demo images in the app and as the
evaluation set for the recognition pipeline (scripts/evaluate.ts, tests/pipeline.test.ts).

Each sample is rendered as an orthographic facade "scene" (sky, roof, wall, neighbours, street,
occluders) and then photographed with a pinhole camera (position, yaw, pitch, focal length),
plus blur, sensor noise and JPEG compression. Ground truth is written in facade metres.

    python3 scripts/make_samples.py            # writes public/samples/*.jpg + *.json
"""
import json, math, os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'samples')
PPM = 70  # scene pixels per metre


def rgb(*c):
    return tuple(int(max(0, min(255, v))) for v in c)


class Scene:
    def __init__(self, spec, seed):
        self.s = spec
        self.rng = random.Random(seed)
        self.np = np.random.default_rng(seed)
        W, H = spec['width'], spec['wall_height']
        self.u0, self.u1 = -26.0, W + 26.0
        self.v0, self.v1 = -12.0, H + spec.get('roof_height', 0) + 5.0
        self.w = int((self.u1 - self.u0) * PPM)
        self.h = int((self.v1 - self.v0) * PPM)
        self.img = Image.new('RGB', (self.w, self.h))
        self.d = ImageDraw.Draw(self.img)
        self.gt = {'openings': [], 'balconies': [], 'bands': [], 'downpipes': [], 'pilasters': [], 'occluders': []}

    # facade metres (u right, v up from ground) -> scene px
    def P(self, u, v):
        return ((u - self.u0) * PPM, (self.v1 - v) * PPM)

    def R(self, u0, v0, u1, v1):
        a, b = self.P(u0, v1), self.P(u1, v0)
        return [a[0], a[1], b[0], b[1]]

    def rect(self, u0, v0, u1, v1, fill, outline=None, width=1):
        self.d.rectangle(self.R(u0, v0, u1, v1), fill=fill, outline=outline, width=width)

    def noise_layer(self, box, amp, scale_px, color_jitter=(1, 1, 1)):
        x0, y0, x1, y1 = [int(round(t)) for t in box]
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(self.w, x1), min(self.h, y1)
        if x1 <= x0 or y1 <= y0:
            return
        h, w = y1 - y0, x1 - x0
        small = self.np.normal(0, 1, (max(2, h // scale_px + 2), max(2, w // scale_px + 2)))
        big = np.array(Image.fromarray(((small - small.min()) / (np.ptp(small) + 1e-9) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float32)
        big = (big / 255.0 - 0.5) * 2 * amp
        fine = self.np.normal(0, amp * 0.35, (h, w))
        a = np.asarray(self.img, dtype=np.float32)
        for k in range(3):
            a[y0:y1, x0:x1, k] += (big + fine) * color_jitter[k]
        self.img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        self.d = ImageDraw.Draw(self.img)

    def shadow(self, u0, v0, u1, v1, strength=0.55, fade=True):
        """Darken a region (cast shadow), optionally fading downward."""
        x0, y0, x1, y1 = [int(round(t)) for t in self.R(u0, v0, u1, v1)]
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(self.w, x1), min(self.h, y1)
        if x1 <= x0 or y1 <= y0:
            return
        a = np.asarray(self.img, dtype=np.float32)
        ramp = np.linspace(strength, strength * 0.25 if fade else strength, y1 - y0)[:, None, None]
        a[y0:y1, x0:x1] *= (1 - ramp)
        self.img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        self.d = ImageDraw.Draw(self.img)

    # ------------------------------------------------------------------ parts
    def sky(self):
        a = np.zeros((self.h, self.w, 3), np.float32)
        t = np.linspace(0, 1, self.h)[:, None]
        top, bot = np.array(self.s.get('sky_top', (110, 155, 210))), np.array(self.s.get('sky_bottom', (200, 220, 238)))
        a[:] = (top * (1 - t) + bot * t)[:, None, :].reshape(self.h, 1, 3)
        self.img = Image.fromarray(a.astype(np.uint8))
        self.d = ImageDraw.Draw(self.img)
        for _ in range(self.s.get('clouds', 3)):
            cx, cy = self.rng.uniform(0, self.w), self.rng.uniform(0, self.h * 0.2)
            for _ in range(8):
                r = self.rng.uniform(30, 90)
                ox, oy = self.rng.uniform(-120, 120), self.rng.uniform(-25, 25)
                self.d.ellipse([cx + ox - r, cy + oy - r * 0.6, cx + ox + r, cy + oy + r * 0.6], fill=rgb(236, 240, 246))
        self.img = self.img.filter(ImageFilter.GaussianBlur(6))
        self.d = ImageDraw.Draw(self.img)

    def neighbours(self):
        W, H = self.s['width'], self.s['wall_height']
        for side, (a, b) in (('L', (self.u0, -0.05)), ('R', (W + 0.05, self.u1))):
            hh = H * self.rng.uniform(0.8, 1.15)
            col = self.s.get('neighbour_color', (170, 160, 150))
            col = rgb(*(c + self.rng.uniform(-20, 20) for c in col))
            self.rect(a, 0, b, hh, col)
            self.noise_layer(self.R(a, 0, b, hh), 6, 40)
            # a few windows on neighbours
            for fl in range(int(hh / 3.4)):
                for k in range(3):
                    u = a + 0.8 + k * 2.2
                    if u + 1.1 > b - 0.3:
                        continue
                    self.rect(u, 1.0 + fl * 3.4, u + 1.1, 2.6 + fl * 3.4, rgb(70, 78, 88))
            self.rect(a, hh, b, hh + 0.35, rgb(120, 110, 100))

    def street(self):
        W = self.s['width']
        self.rect(self.u0, self.v0, self.u1, 0, rgb(120, 118, 115))
        self.noise_layer(self.R(self.u0, self.v0, self.u1, 0), 10, 6)
        self.rect(self.u0, -0.18, self.u1, 0, rgb(160, 158, 152))  # kerb / pavement edge

    def wall(self):
        W, H = self.s['width'], self.s['wall_height']
        self.rect(0, 0, W, H, self.s['wall'])
        self.noise_layer(self.R(0, 0, W, H), self.s.get('wall_noise', 7), 60, (1, 0.97, 0.9))
        # soot gradient toward the top
        a = np.asarray(self.img, dtype=np.float32)
        x0, y0, x1, y1 = [int(t) for t in self.R(0, 0, W, H)]
        grad = np.linspace(0.88, 1.0, y1 - y0)[:, None, None]
        a[y0:y1, x0:x1] *= grad
        self.img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        self.d = ImageDraw.Draw(self.img)

    def brick(self, v0, v1):
        W = self.s['width']
        course, brick_l = 0.075, 0.25
        mortar = rgb(205, 195, 180)
        self.rect(0, v0, W, v1, mortar)
        base = np.array(self.s['brick_color'])
        n = int((v1 - v0) / course)
        for i in range(n):
            vv = v0 + i * course
            off = (brick_l / 2) * (i % 2)
            u = -off
            while u < W:
                c = base + self.np.normal(0, 12, 3)
                self.rect(max(0, u + 0.01), vv + 0.012, min(W, u + brick_l - 0.01), vv + course - 0.004, rgb(*c))
                u += brick_l
        self.gt['material'] = {'pattern': 'brick', 'course_m': course}

    def rustication(self, v0, v1, step=0.42):
        W = self.s['width']
        v = v0 + step
        while v < v1 - 0.05:
            self.rect(0, v - 0.03, W, v, rgb(*(c * 0.62 for c in self.s['wall'])))
            self.rect(0, v - 0.045, W, v - 0.03, rgb(*(min(255, c * 1.08) for c in self.s['wall'])))
            v += step
        self.gt['rustication'] = {'v0': v0, 'v1': v1, 'step': step}

    def band(self, v, height, kind, project=0.6, profile=3):
        W = self.s['width']
        base = self.s.get('band', rgb(*(min(255, c * 1.06) for c in self.s['wall'])))
        self.rect(-0.02, v, W + 0.02, v + height, base)
        for k in range(1, profile):
            vv = v + height * k / profile
            self.rect(-0.02, vv - 0.02, W + 0.02, vv, rgb(*(c * 0.72 for c in base)))
        self.shadow(0, v - height * project, W, v, 0.42)
        self.gt['bands'].append({'kind': kind, 'v0': v, 'v1': v + height})

    def window(self, u, v, w, h, spec, floor):
        fr = spec.get('frame', 0.09)
        frame_col = spec.get('frame_color', (235, 232, 225))
        arch = spec.get('arch')
        # reveal shadow + frame
        if arch == 'round':
            r = w / 2
            box = self.R(u, v + h - 2 * r, u + w, v + h)
            self.d.ellipse(box, fill=rgb(*frame_col))
            self.rect(u, v, u + w, v + h - r, rgb(*frame_col))
        else:
            self.rect(u, v, u + w, v + h, rgb(*frame_col))
        # glass
        gi = (u + fr, v + fr, u + w - fr, v + h - fr)
        base = np.array(spec.get('glass', (55, 66, 80))) + self.rng.uniform(-14, 22)
        x0, y0, x1, y1 = [int(round(t)) for t in self.R(*gi)]
        if arch == 'round':
            r = w / 2 - fr
            self.d.ellipse(self.R(gi[0], v + h - fr - 2 * r, gi[2], v + h - fr), fill=rgb(*base))
            self.rect(gi[0], gi[1], gi[2], v + h - w / 2, rgb(*base))
        else:
            self.rect(*gi, rgb(*base))
        # reflection gradient
        a = np.asarray(self.img, dtype=np.float32)
        if y1 > y0 and x1 > x0:
            region = a[y0:y1, x0:x1]
            isglass = np.abs(region - base[None, None, :]).sum(axis=2) < 8
            grad = np.linspace(1.25, 0.85, y1 - y0)[:, None]
            region[isglass] = (region * grad[:, :, None])[isglass]
            if self.rng.random() < 0.25:  # curtain
                cw = int((x1 - x0) * self.rng.uniform(0.2, 0.45))
                region[: int((y1 - y0) * 0.8), :cw][isglass[: int((y1 - y0) * 0.8), :cw]] = (200, 196, 185)
        self.img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        self.d = ImageDraw.Draw(self.img)
        mull = spec.get('mullions', 1)
        tr = spec.get('transom')
        bar = fr * 0.8
        for k in range(1, mull + 1):
            uu = u + w * k / (mull + 1)
            self.rect(uu - bar / 2, v + fr, uu + bar / 2, v + h - fr - (w / 2 if arch == 'round' else 0), rgb(*frame_col))
        if tr:
            vv = v + h * tr
            self.rect(u + fr, vv - bar / 2, u + w - fr, vv + bar / 2, rgb(*frame_col))
        # sill
        if spec.get('sill', True):
            self.rect(u - 0.12, v - 0.1, u + w + 0.12, v, rgb(*(min(255, c * 1.1) for c in self.s['wall'])))
            self.shadow(u - 0.12, v - 0.3, u + w + 0.12, v - 0.1, 0.35)
        # hood moulding
        if spec.get('hood'):
            hv = v + h + 0.12
            self.rect(u - 0.2, hv, u + w + 0.2, hv + 0.16, rgb(*(min(255, c * 1.08) for c in self.s['wall'])))
            self.shadow(u - 0.2, hv - 0.12, u + w + 0.2, hv, 0.4)
            if spec['hood'] == 'pediment':
                p = [self.P(u - 0.25, hv + 0.16), self.P(u + w / 2, hv + 0.16 + w * 0.32), self.P(u + w + 0.25, hv + 0.16)]
                self.d.polygon(p, fill=rgb(*(min(255, c * 1.1) for c in self.s['wall'])), outline=rgb(*(c * 0.6 for c in self.s['wall'])))
                # tympanum ornament: a small rosette
                cx, cy = self.P(u + w / 2, hv + 0.16 + w * 0.12)
                rr = w * 0.07 * PPM
                self.d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=rgb(*(c * 0.55 for c in self.s['wall'])), width=3)
        self.gt['openings'].append({'kind': 'window', 'u0': u, 'v0': v, 'u1': u + w, 'v1': v + h, 'floor': floor,
                                    'mullions': mull, 'transom': tr is not None, 'arch': arch})

    def door(self, u, w, h, spec):
        col = spec.get('door_color', (92, 60, 38))
        arch = spec.get('arch')
        surround = 0.25
        stone = rgb(*(min(255, c * 1.12) for c in self.s['wall']))
        if arch == 'round':
            r = w / 2 + surround
            self.d.ellipse(self.R(u - surround, h - w / 2 - surround, u + w + surround, h + w / 2 + surround), fill=stone)
            self.rect(u - surround, 0, u + w + surround, h, stone)
            self.d.ellipse(self.R(u, h - w / 2, u + w, h + w / 2), fill=rgb(*col))
            top = h + w / 2
        else:
            self.rect(u - surround, 0, u + w + surround, h + surround, stone)
            top = h
        self.rect(u, 0, u + w, h, rgb(*col))
        self.noise_layer(self.R(u, 0, u + w, h), 8, 4, (1, 0.8, 0.6))
        # two leaves + panels
        self.rect(u + w / 2 - 0.02, 0, u + w / 2 + 0.02, h, rgb(*(c * 0.6 for c in col)))
        for k in range(2):
            for j in range(2):
                pu = u + 0.12 + k * w / 2
                self.rect(pu, 0.3 + j * h * 0.45, pu + w / 2 - 0.24, 0.3 + j * h * 0.45 + h * 0.35, None, rgb(*(c * 0.55 for c in col)), 3)
        self.gt['openings'].append({'kind': 'door', 'u0': u, 'v0': 0, 'u1': u + w, 'v1': top, 'floor': 0, 'arch': arch})

    def balcony(self, u0, u1, v, floor):
        stone = rgb(*(min(255, c * 1.1) for c in self.s['wall']))
        self.rect(u0, v - 0.22, u1, v, stone)
        self.shadow(u0, v - 0.9, u1, v - 0.22, 0.5)
        rail_h = 1.0
        self.rect(u0, v + rail_h - 0.1, u1, v + rail_h, stone)  # handrail
        n = int((u1 - u0) / 0.2)
        posts = []
        for k in range(n + 1):
            uu = u0 + 0.06 + k * (u1 - u0 - 0.12) / n
            self.rect(uu - 0.035, v, uu + 0.035, v + rail_h - 0.1, stone)
            posts.append(uu)
        self.rect(u0, v, u0 + 0.12, v + rail_h, stone)
        self.rect(u1 - 0.12, v, u1, v + rail_h, stone)
        self.gt['balconies'].append({'u0': u0, 'u1': u1, 'slab_v': v, 'rail_top': v + rail_h, 'floor': floor})

    def pilaster(self, u, w, v0, v1):
        col = rgb(*(min(255, c * 1.07) for c in self.s['wall']))
        self.rect(u, v0, u + w, v1, col)
        self.shadow(u + w, v0, u + w + 0.12, v1, 0.3, fade=False)
        self.gt['pilasters'].append({'u0': u, 'u1': u + w})

    def downpipe(self, u, v1):
        self.rect(u, 0, u + 0.11, v1, rgb(110, 112, 115))
        self.rect(u + 0.02, 0, u + 0.04, v1, rgb(150, 152, 155))
        self.gt['downpipes'].append({'u0': u, 'u1': u + 0.11})

    def roof(self):
        W, H = self.s['width'], self.s['wall_height']
        rh = self.s.get('roof_height', 0)
        if rh <= 0:
            # parapet
            self.rect(-0.02, H, W + 0.02, H + 0.5, rgb(*(c * 0.95 for c in self.s['wall'])))
            self.gt['roof'] = {'top_v': H + 0.5, 'pitched': False}
            return
        inset = rh * 0.9
        poly = [self.P(-0.3, H), self.P(inset, H + rh), self.P(W - inset, H + rh), self.P(W + 0.3, H)]
        self.d.polygon(poly, fill=rgb(*self.s.get('roof_color', (140, 70, 50))))
        self.noise_layer([poly[0][0], poly[1][1], poly[3][0], poly[0][1]], 9, 3)
        # re-sky outside the roof polygon happens implicitly because noise was clipped to bbox: redraw sky triangles
        # tile courses
        v = H + 0.25
        while v < H + rh:
            t = (v - H) / rh
            self.d.line([self.P(-0.3 + t * (inset + 0.3), v), self.P(W + 0.3 - t * (inset + 0.3), v)], fill=rgb(95, 45, 32), width=2)
            v += 0.32
        for (cu, ch) in self.s.get('chimneys', []):
            self.rect(cu, H + rh * 0.5, cu + 0.7, H + rh + ch, rgb(150, 110, 95))
            self.rect(cu - 0.08, H + rh + ch - 0.18, cu + 0.78, H + rh + ch, rgb(120, 90, 80))
        self.gt['roof'] = {'top_v': H + rh, 'pitched': True}

    def tree(self, u, spread, top):
        trunk_w = 0.35
        self.rect(u - trunk_w / 2, 0, u + trunk_w / 2, top * 0.45, rgb(80, 60, 40))
        cx, cy = self.P(u, top * 0.7)
        for _ in range(900):
            r = self.rng.uniform(6, 22)
            ang = self.rng.uniform(0, 2 * math.pi)
            rad = self.rng.uniform(0, 1) ** 0.6
            x = cx + math.cos(ang) * rad * spread * PPM
            y = cy + math.sin(ang) * rad * top * 0.32 * PPM
            g = self.rng.uniform(70, 150)
            self.d.ellipse([x - r, y - r, x + r, y + r], fill=rgb(g * 0.55, g, g * 0.35))
        self.gt['occluders'].append({'kind': 'tree', 'u0': u - spread, 'u1': u + spread, 'v0': top * 0.38, 'v1': top})

    def car(self, u, length=4.3):
        body = rgb(*self.rng.choice([(40, 45, 60), (150, 30, 30), (200, 200, 205), (30, 30, 32)]))
        self.d.rounded_rectangle(self.R(u, 0.3, u + length, 1.05), radius=18, fill=body)
        self.d.rounded_rectangle(self.R(u + 0.8, 1.0, u + length - 1.0, 1.5), radius=22, fill=body)
        self.rect(u + 1.0, 1.08, u + length - 1.2, 1.42, rgb(60, 70, 80))
        for wu in (u + 0.8, u + length - 0.8):
            cx, cy = self.P(wu, 0.32)
            self.d.ellipse([cx - 30, cy - 30, cx + 30, cy + 30], fill=rgb(20, 20, 20))
        self.gt['occluders'].append({'kind': 'car', 'u0': u, 'u1': u + length, 'v0': 0, 'v1': 1.5})


def build(spec, seed):
    sc = Scene(spec, seed)
    W, H = spec['width'], spec['wall_height']
    sc.sky()
    sc.neighbours()
    sc.roof()
    sc.wall()
    if spec.get('brick_from') is not None:
        sc.brick(spec['brick_from'], H - spec.get('cornice_h', 0.8))
    gf = spec['ground_floor_h']
    if spec.get('rustication'):
        sc.rustication(0.5, gf)
    sc.rect(0, 0, W, 0.5, rgb(*(c * 0.72 for c in spec['wall'])))  # plinth
    sc.gt['bands'].append({'kind': 'plinth', 'v0': 0, 'v1': 0.5})
    if spec.get('string_course', True):
        sc.band(gf, 0.28, 'string_course', project=0.5, profile=2)
    for pu in spec.get('pilasters', []):
        sc.pilaster(pu, 0.55, gf + 0.28, H - spec.get('cornice_h', 0.8))
    bays = spec['bays']
    for f, fl in enumerate(spec['floors']):
        for b, u in enumerate(bays):
            if f == 0 and b in spec.get('door_bays', []):
                continue
            if fl.get('skip_bays') and b in fl['skip_bays']:
                continue
            sc.window(u, fl['sill'], fl['w'], fl['h'], fl, f)
    for d in spec.get('doors', []):
        sc.door(d['u'], d['w'], d['h'], d)
    for bl in spec.get('balconies', []):
        sc.balcony(bl['u0'], bl['u1'], bl['v'], bl['floor'])
    sc.band(H - spec.get('cornice_h', 0.8), spec.get('cornice_h', 0.8), 'cornice', project=0.9, profile=4)
    for dp in spec.get('downpipes', []):
        sc.downpipe(dp, H - 0.1)
    sc.street()
    for t in spec.get('trees', []):
        sc.tree(*t)
    for c in spec.get('cars', []):
        sc.car(c)
    img = sc.img.filter(ImageFilter.GaussianBlur(0.7))
    return sc, img


def camera_homography(spec, cam, scene):
    """Homography scene-px -> photo-px for a pinhole camera looking at the facade plane."""
    W, H = spec['width'], spec['wall_height']
    f, pw, ph = cam['f'], cam['w'], cam['h']
    yaw, pitch = math.radians(cam['yaw']), math.radians(cam['pitch'])
    C = np.array([W / 2 - cam['dist'] * math.tan(yaw) + cam.get('dx', 0), cam.get('height', 1.6), -cam['dist']])
    Ry = np.array([[math.cos(yaw), 0, -math.sin(yaw)], [0, 1, 0], [math.sin(yaw), 0, math.cos(yaw)]])
    Rx = np.array([[1, 0, 0], [0, math.cos(pitch), -math.sin(pitch)], [0, math.sin(pitch), math.cos(pitch)]])
    R = Rx @ Ry

    def proj(u, v):
        P = np.array([u, v, 0.0]) - C
        X = R @ P
        return (f * X[0] / X[2] + pw / 2, -f * X[1] / X[2] + ph / 2)

    src = [(sc_u, sc_v) for sc_u, sc_v in [(scene.u0, scene.v0), (scene.u1, scene.v0), (scene.u1, scene.v1), (scene.u0, scene.v1)]]
    dst = [proj(u, v) for u, v in src]
    spx = [scene.P(u, v) for u, v in src]
    A, b = [], []
    for (x, y), (u, v) in zip(spx, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    h = np.linalg.solve(np.array(A), np.array(b))
    Hm = np.append(h, 1).reshape(3, 3)
    return Hm, proj


SPECS = {
    'budapest-eclectic': dict(
        title='Eclectic apartment house (historicist, 1890s style)',
        width=21.0, wall_height=17.2, roof_height=3.2, chimneys=[(4.0, 1.4), (15.5, 1.2)],
        wall=(214, 196, 160), neighbour_color=(175, 168, 160), ground_floor_h=4.6, rustication=True, cornice_h=0.95,
        bays=[1.3, 4.4, 7.5, 12.4, 15.5, 18.6], door_bays=[],
        floors=[
            dict(sill=1.0, w=1.3, h=2.6, mullions=1, transom=0.72, hood=None, frame=0.1, frame_color=(90, 70, 55)),
            dict(sill=5.6, w=1.3, h=2.5, mullions=1, transom=0.74, hood='pediment', frame=0.1),
            dict(sill=9.3, w=1.3, h=2.4, mullions=1, transom=0.74, hood='flat', frame=0.1),
            dict(sill=12.9, w=1.3, h=2.1, mullions=1, transom=None, hood=None, frame=0.1),
        ],
        doors=[dict(u=9.6, w=1.8, h=3.2, arch='round')],
        balconies=[dict(u0=3.9, u1=8.3, v=5.3, floor=1), dict(u0=11.9, u1=16.3, v=5.3, floor=1)],
        downpipes=[20.5], pilasters=[],
        trees=[], cars=[2.0],
        camera=dict(f=1500, w=2000, h=1500, dist=31.0, yaw=9.0, pitch=13.0, height=1.6, dx=0.0),
    ),
    'modernist-office': dict(
        title='Modernist office block (strip grid, flat roof)',
        width=24.0, wall_height=14.5, roof_height=0, wall=(196, 196, 192), neighbour_color=(150, 140, 130),
        ground_floor_h=4.0, rustication=False, string_course=True, cornice_h=0.6,
        bays=[0.9 + 2.0 * k for k in range(11)], door_bays=[5],
        floors=[
            dict(sill=0.9, w=1.5, h=2.6, mullions=0, transom=None, sill_=False, frame=0.06, frame_color=(60, 60, 62), glass=(70, 85, 100)),
            dict(sill=4.9, w=1.5, h=1.7, mullions=0, transom=None, frame=0.06, frame_color=(60, 60, 62), glass=(70, 85, 100)),
            dict(sill=7.9, w=1.5, h=1.7, mullions=0, transom=None, frame=0.06, frame_color=(60, 60, 62), glass=(70, 85, 100)),
            dict(sill=10.9, w=1.5, h=1.7, mullions=0, transom=None, frame=0.06, frame_color=(60, 60, 62), glass=(70, 85, 100)),
        ],
        doors=[dict(u=10.6, w=2.0, h=2.7, door_color=(50, 55, 60))],
        balconies=[], downpipes=[0.3], trees=[(19.5, 3.0, 8.5)], cars=[],
        camera=dict(f=1700, w=2000, h=1500, dist=33.0, yaw=-14.0, pitch=10.0, height=1.6, dx=0.0),
    ),
    'brick-townhouse': dict(
        title='Brick townhouse with arched windows (frontal photo)',
        width=11.0, wall_height=13.0, roof_height=2.6, chimneys=[(8.2, 1.0)],
        wall=(190, 120, 95), brick_from=4.2, brick_color=(150, 70, 50), neighbour_color=(190, 185, 175), ground_floor_h=4.0,
        rustication=False, cornice_h=0.7, band=(225, 215, 195),
        bays=[1.2, 4.75, 8.3], door_bays=[1],
        floors=[
            dict(sill=1.0, w=1.5, h=2.4, mullions=1, transom=0.7, frame=0.09, frame_color=(240, 238, 232)),
            dict(sill=5.2, w=1.4, h=2.6, mullions=1, transom=0.66, arch='round', frame=0.09, frame_color=(240, 238, 232)),
            dict(sill=8.8, w=1.4, h=2.4, mullions=1, transom=0.66, arch='round', frame=0.09, frame_color=(240, 238, 232)),
        ],
        doors=[dict(u=4.85, w=1.3, h=2.6, door_color=(30, 60, 50))],
        balconies=[], downpipes=[10.6], trees=[], cars=[],
        camera=dict(f=1600, w=1600, h=2000, dist=20.0, yaw=0.0, pitch=8.0, height=1.6, dx=0.0),
    ),
}


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for i, (name, spec) in enumerate(SPECS.items()):
        sc, img = build(spec, seed=100 + i)
        cam = spec['camera']
        Hm, proj = camera_homography(spec, cam, sc)
        Hinv = np.linalg.inv(Hm)
        coeffs = (Hinv / Hinv[2, 2]).flatten()[:8]
        photo = img.transform((cam['w'], cam['h']), Image.PERSPECTIVE, tuple(coeffs), Image.BICUBIC, fillcolor=(112, 156, 210))
        a = np.asarray(photo, dtype=np.float32)
        a += np.random.default_rng(7 + i).normal(0, 3.0, a.shape)
        # vignetting
        yy, xx = np.mgrid[0:cam['h'], 0:cam['w']]
        r = np.hypot((xx - cam['w'] / 2) / cam['w'], (yy - cam['h'] / 2) / cam['h'])
        a *= (1 - 0.25 * r ** 2)[:, :, None]
        photo = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        photo.save(os.path.join(OUT, f'{name}.jpg'), quality=88)
        W, H = spec['width'], spec['wall_height']
        quad = [proj(0, H), proj(W, H), proj(W, 0), proj(0, 0)]
        gt = dict(name=name, title=spec['title'], facade=dict(width_m=W, wall_height_m=H), quad_px=[[round(x, 2), round(y, 2)] for x, y in quad],
                  camera=cam, **sc.gt)
        with open(os.path.join(OUT, f'{name}.json'), 'w') as fh:
            json.dump(gt, fh, indent=1)
        index.append(dict(name=name, title=spec['title'], file=f'{name}.jpg', truth=f'{name}.json'))
        print('wrote', name, photo.size, 'openings:', len(sc.gt['openings']))
    with open(os.path.join(OUT, 'index.json'), 'w') as fh:
        json.dump(index, fh, indent=1)


if __name__ == '__main__':
    main()
