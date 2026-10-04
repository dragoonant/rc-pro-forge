'use strict';
// Track geometry (centerline, queries) and pre-rendered isometric ground.

const CELL = 128;
const HALF_W = 40;          // road half-width (world px)
const CURB = 6;
const WALL_OFF = HALF_W + CURB;
const WALL_H = 7;           // wall height in screen px
const STEP = 8;             // centerline sample spacing
const MARGIN = 300;

class Track {
  constructor(def, IMG) {
    this.def = def;
    this.theme = THEMES[def.theme];
    this.IMG = IMG;
    this.buildPath();
    this.placeFeatures();
    this.scatterProps();
    this.render();
  }

  // ---------- geometry ----------
  buildPath() {
    const P = this.def.pts.map(([x, y]) => ({ x: x * CELL, y: y * CELL }));
    const n = P.length, poly = [];
    for (let i = 0; i < n; i++) {
      const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n];
      const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
      const ux = (b.x - a.x) / l1, uy = (b.y - a.y) / l1, wx = (c.x - b.x) / l2, wy = (c.y - b.y) / l2;
      const th = Math.acos(clamp(ux * wx + uy * wy, -1, 1));
      const t = Math.min(CELL * Math.tan(th / 2), l1 * 0.5, l2 * 0.5);
      const p0 = { x: b.x - ux * t, y: b.y - uy * t }, p2 = { x: b.x + wx * t, y: b.y + wy * t };
      const K = Math.max(2, Math.ceil(th * 10));
      for (let k = 0; k <= K; k++) {
        const s = k / K, m = 1 - s;
        poly.push({ x: m * m * p0.x + 2 * m * s * b.x + s * s * p2.x, y: m * m * p0.y + 2 * m * s * b.y + s * s * p2.y });
      }
    }
    // resample the closed polyline at uniform spacing
    const segs = [];
    let T = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l > 1e-6) { segs.push({ a, b, l, s0: T }); T += l; }
    }
    const N = Math.round(T / STEP), step = T / N;
    let pts = [], si = 0;
    for (let k = 0; k < N; k++) {
      const s = k * step;
      while (segs[si].s0 + segs[si].l < s) si++;
      const g = segs[si], f = (s - g.s0) / g.l;
      pts.push({ x: lerp(g.a.x, g.b.x, f), y: lerp(g.a.y, g.b.y, f) });
    }
    // start line: middle of the first listed straight
    const mid = { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 };
    let si0 = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = dist2(p.x, p.y, mid.x, mid.y); if (d < bd) { bd = d; si0 = i; } });
    pts = pts.slice(si0).concat(pts.slice(0, si0));

    pts.forEach((p, i) => {
      const a = pts[(i + N - 1) % N], b = pts[(i + 1) % N];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      p.tx = (b.x - a.x) / l; p.ty = (b.y - a.y) / l;
      p.nx = -p.ty; p.ny = p.tx;
      p.ang = Math.atan2(p.ty, p.tx);
      p.s = i * step;
      p.i = i;
    });
    pts.forEach((p, i) => {
      const a = pts[(i + N - 4) % N], b = pts[(i + 4) % N];
      p.curv = angDiff(a.ang, b.ang) / (8 * step); // rad per px
    });
    this.pts = pts; this.N = N; this.step = step; this.L = T;

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    this.bounds = { x0: x0 - MARGIN, y0: y0 - MARGIN, x1: x1 + MARGIN, y1: y1 + MARGIN };
  }

  // Nearest centerline sample. hint = previous index for a local search.
  locate(x, y, hint = -1) {
    const P = this.pts, N = this.N;
    let best = 0, bd = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i++) { const d = dist2(x, y, P[i].x, P[i].y); if (d < bd) { bd = d; best = i; } }
    } else {
      for (let k = -14; k <= 14; k++) {
        const i = (hint + k + N) % N, d = dist2(x, y, P[i].x, P[i].y);
        if (d < bd) { bd = d; best = i; }
      }
    }
    const p = P[best], dx = x - p.x, dy = y - p.y;
    let s = p.s + dx * p.tx + dy * p.ty;
    if (s < 0) s += this.L; else if (s >= this.L) s -= this.L;
    return { i: best, s, lat: dx * p.nx + dy * p.ny, p };
  }

  at(s) {
    s = ((s % this.L) + this.L) % this.L;
    return this.pts[Math.floor(s / this.step) % this.N];
  }

  worldAt(s, lat) {
    const p = this.at(s);
    return { x: p.x + p.nx * lat, y: p.y + p.ny * lat, ang: p.ang, s: p.s };
  }

  // nearest position at/after frac*L where the track is straight for a while
  straightAfter(frac) {
    const start = Math.floor(frac * this.N);
    for (let k = 0; k < this.N; k++) {
      const i = (start + k) % this.N;
      let ok = true;
      for (let j = -7; j <= 7 && ok; j++) if (Math.abs(this.pts[(i + j + this.N) % this.N].curv) > 0.002) ok = false;
      if (ok) return this.pts[i].s;
    }
    return start * this.step;
  }

  // ---------- content placement ----------
  placeFeatures() {
    const d = this.def;
    this.ramps = d.ramps.map((f) => ({ s: this.straightAfter(f), len: 22 }));
    const near = (s, list, gap) => list.some((r) => Math.abs(angDiff(s / this.L * TAU, r.s / this.L * TAU)) * this.L / TAU < gap);
    const decal = (kind, [f, lat], size) => ({ kind, ...this.worldAt(f * this.L, lat * HALF_W), size, lat: lat * HALF_W });
    this.boosts = d.boosts.map(([f, lat]) => {
      const s = this.straightAfter(f);
      return { kind: 'boost', ...this.worldAt(s, lat * HALF_W), size: 22 };
    });
    this.oils = d.oil.map((o) => decal('oil', o, 26));
    this.puddles = d.puddles.map((o) => decal('puddle', o, 30));
    this.cloudSpots = d.clouds.map((f) => f * this.L);
    // pickup spots: evenly spaced, avoiding ramps
    this.pickupSpots = [];
    const lanes = [-0.5, 0.45, 0, -0.3, 0.55];
    for (let k = 0; k < 10; k++) {
      let s = ((k + 0.5) / 10) * this.L;
      while (near(s, this.ramps, 70)) s += 30;
      this.pickupSpots.push(this.worldAt(s, lanes[k % lanes.length] * HALF_W));
    }
  }

  scatterProps() {
    const th = this.theme, r = makeRng(this.def.seed);
    const total = th.props.reduce((a, p) => a + p[1], 0);
    const pickKind = () => { let x = r() * total; for (const [k, w] of th.props) { if ((x -= w) < 0) return k; } return th.props[0][0]; };
    const b = this.bounds, props = [];
    const SP = 30;
    for (let y = b.y0; y < b.y1; y += SP) {
      for (let x = b.x0; x < b.x1; x += SP) {
        if (r() > th.propDensity) continue;
        const px = x + r.range(-SP * 0.4, SP * 0.4), py = y + r.range(-SP * 0.4, SP * 0.4);
        const dc = Math.sqrt(this.minDist2(px, py));
        if (dc < WALL_OFF + 20) continue;
        if (th.propsOnApronOnly && dc > WALL_OFF + th.apronW - 14) continue;
        props.push({ x: px, y: py, kind: pickKind(), flip: r() < 0.5 });
      }
    }
    this.props = props;
  }

  minDist2(x, y) {
    let bd = Infinity;
    for (const p of this.pts) { const d = dist2(x, y, p.x, p.y); if (d < bd) bd = d; }
    return bd;
  }

  // ---------- rendering ----------
  sx(x, y) { return x - y + this.offX; }
  sy(x, y) { return (x + y) / 2 + this.offY; }

  render() {
    const th = this.theme, IMG = this.IMG, b = this.bounds;
    const TOP = 70;
    this.offX = -(b.x0 - b.y1);
    this.offY = -(b.x0 + b.y0) / 2 + TOP;
    const W = Math.ceil((b.x1 - b.y0) - (b.x0 - b.y1));
    const H = Math.ceil((b.x1 + b.y1) / 2 - (b.x0 + b.y0) / 2 + TOP + 20);
    this.W = W; this.H = H;
    const ground = makeCanvas(W, H), g = ground.getContext('2d');
    const iso = (ctx) => ctx.setTransform(1, 0.5, -1, 0.5, this.offX, this.offY);
    const fillFor = (key, fb) => (IMG[key] ? g.createPattern(IMG[key], 'repeat') : fb);

    const path = new Path2D();
    this.pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
    path.closePath();

    // crisp (thresholded) band mask around the centerline
    const bandMask = (width) => {
      const m = makeCanvas(W, H), mg = m.getContext('2d');
      iso(mg);
      mg.lineWidth = width; mg.lineJoin = 'round'; mg.strokeStyle = '#fff';
      mg.stroke(path);
      const id = mg.getImageData(0, 0, W, H), d = id.data;
      for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
      mg.putImageData(id, 0, 0);
      return m;
    };
    const fillBand = (width, fill) => {
      const m = bandMask(width), mg = m.getContext('2d');
      mg.setTransform(1, 0, 0, 1, 0, 0);
      mg.globalCompositeOperation = 'source-in';
      mg.fillStyle = fill; mg.fillRect(0, 0, W, H);
      g.drawImage(m, 0, 0);
    };

    g.fillStyle = fillFor(th.outer, th.fallback.outer);
    g.fillRect(0, 0, W, H);
    if (th.apron !== th.outer) fillBand(2 * (WALL_OFF + th.apronW), fillFor(th.apron, th.fallback.apron));

    // curbs: alternating stripes clipped to the curb band
    {
      const m = bandMask(2 * WALL_OFF), stripes = makeCanvas(W, H), sg = stripes.getContext('2d');
      iso(sg);
      const P = this.pts, N = this.N, R = WALL_OFF + 6;
      for (let i = 0; i < N; i++) {
        const a = P[i], c = P[(i + 1) % N];
        sg.fillStyle = Math.floor(a.s / 16) % 2 ? th.curbA : th.curbB;
        sg.beginPath();
        sg.moveTo(a.x + a.nx * R - a.tx, a.y + a.ny * R - a.ty);
        sg.lineTo(c.x + c.nx * R + c.tx, c.y + c.ny * R + c.ty);
        sg.lineTo(c.x - c.nx * R + c.tx, c.y - c.ny * R + c.ty);
        sg.lineTo(a.x - a.nx * R - a.tx, a.y - a.ny * R - a.ty);
        sg.fill();
      }
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.globalCompositeOperation = 'destination-in';
      sg.drawImage(m, 0, 0);
      g.drawImage(stripes, 0, 0);
    }
    fillBand(2 * HALF_W, fillFor(th.road, th.fallback.road));

    // start/finish checkers
    iso(g);
    {
      const p = this.pts[0], sq = 5;
      for (let row = 0; row < 2; row++) {
        for (let k = -HALF_W; k < HALF_W; k += sq) {
          g.fillStyle = ((k / sq + row) & 1) ? '#000' : '#fcfcfc';
          const l = row * sq - sq;
          g.beginPath();
          const pt = (u, v) => [p.x + p.tx * u + p.nx * v, p.y + p.ty * u + p.ny * v];
          g.moveTo(...pt(l, k)); g.lineTo(...pt(l + sq, k)); g.lineTo(...pt(l + sq, k + sq)); g.lineTo(...pt(l, k + sq));
          g.fill();
        }
      }
    }
    // ramps: yellow/black stripes, lighter top half
    for (const r of this.ramps) {
      const p = this.at(r.s);
      const pt = (u, v) => [p.x + p.tx * u + p.nx * v, p.y + p.ty * u + p.ny * v];
      for (let u = -r.len / 2, k = 0; u < r.len / 2; u += 4, k++) {
        g.fillStyle = k % 2 ? '#202020' : u > 0 ? '#fcd858' : '#f8b800';
        g.beginPath();
        g.moveTo(...pt(u, -HALF_W)); g.lineTo(...pt(u + 4, -HALF_W)); g.lineTo(...pt(u + 4, HALF_W)); g.lineTo(...pt(u, HALF_W));
        g.fill();
      }
      g.fillStyle = '#fcfcfc';
      g.beginPath();
      g.moveTo(...pt(r.len / 2, -HALF_W)); g.lineTo(...pt(r.len / 2 + 2, -HALF_W)); g.lineTo(...pt(r.len / 2 + 2, HALF_W)); g.lineTo(...pt(r.len / 2, HALF_W));
      g.fill();
    }
    // decals
    const decal = (d, rot) => {
      const img = IMG[d.kind];
      g.save();
      g.translate(d.x, d.y); g.rotate(rot);
      if (img) {
        const sc = d.size / Math.max(img.width, img.height);
        g.drawImage(img, -img.width * sc / 2, -img.height * sc / 2, img.width * sc, img.height * sc);
      } else {
        g.fillStyle = d.kind === 'oil' ? '#101010' : d.kind === 'puddle' ? '#3878f8' : '#f8d800';
        g.beginPath(); g.ellipse(0, 0, d.size / 2, d.size / 3, 0, 0, TAU); g.fill();
      }
      g.restore();
    };
    const dr = makeRng(this.def.seed + 5);
    this.boosts.forEach((d) => decal(d, d.ang + Math.PI / 2));
    this.oils.forEach((d) => decal(d, dr() * TAU));
    this.puddles.forEach((d) => decal(d, dr() * TAU));
    g.setTransform(1, 0, 0, 1, 0, 0);

    // prop shadows
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (const p of this.props) {
      const img = IMG[p.kind], w = img ? img.width : 16;
      g.beginPath(); g.ellipse(this.sx(p.x, p.y), this.sy(p.x, p.y), w * 0.4, w * 0.18, 0, 0, TAU); g.fill();
    }

    // walls: far side baked, near side kept as sortable chunks
    this.nearWalls = [];
    const P = this.pts, N = this.N;
    for (const side of [-1, 1]) {
      let chunk = null;
      for (let i = 0; i < N; i++) {
        const a = P[i], c = P[(i + 1) % N];
        const ax = a.x + a.nx * side * WALL_OFF, ay = a.y + a.ny * side * WALL_OFF;
        const cx = c.x + c.nx * side * WALL_OFF, cy = c.y + c.ny * side * WALL_OFF;
        const near = side * (a.nx + a.ny) > 0;
        const q = { x0: this.sx(ax, ay), y0: this.sy(ax, ay), x1: this.sx(cx, cy), y1: this.sy(cx, cy),
                    col: Math.floor(a.s / 24) % 2 ? th.wallA : th.wallB };
        if (!near) {
          this.drawWallQuad(g, q, 0, 0);
          chunk = null;
        } else {
          if (!chunk || chunk.quads.length >= 3) {
            chunk = { quads: [], depth: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
            this.nearWalls.push(chunk);
          }
          chunk.quads.push(q);
          chunk.depth = Math.max(chunk.depth, q.y0, q.y1);
          chunk.minX = Math.min(chunk.minX, q.x0, q.x1); chunk.maxX = Math.max(chunk.maxX, q.x0, q.x1);
          chunk.minY = Math.min(chunk.minY, q.y0, q.y1) - WALL_H; chunk.maxY = Math.max(chunk.maxY, q.y0, q.y1);
        }
      }
    }
    this.ground = ground;

    // minimap
    const mw = 84, mh = 56;
    const ix0 = Math.min(...P.map((p) => this.sx(p.x, p.y))), ix1 = Math.max(...P.map((p) => this.sx(p.x, p.y)));
    const iy0 = Math.min(...P.map((p) => this.sy(p.x, p.y))), iy1 = Math.max(...P.map((p) => this.sy(p.x, p.y)));
    const ms = Math.min((mw - 8) / (ix1 - ix0), (mh - 8) / (iy1 - iy0));
    this.mini = { ms, ix0, iy0, w: mw, h: mh, ox: (mw - (ix1 - ix0) * ms) / 2, oy: (mh - (iy1 - iy0) * ms) / 2 };
    const mc = makeCanvas(mw, mh), mg = mc.getContext('2d');
    mg.lineJoin = 'round';
    for (const [w, col] of [[5, '#000'], [3, '#fcfcfc']]) {
      mg.lineWidth = w; mg.strokeStyle = col; mg.beginPath();
      P.forEach((p, i) => { const [x, y] = this.miniXY(p.x, p.y); i ? mg.lineTo(x, y) : mg.moveTo(x, y); });
      mg.closePath(); mg.stroke();
    }
    this.miniCanvas = mc;
  }

  miniXY(x, y) {
    const m = this.mini;
    return [m.ox + (this.sx(x, y) - m.ix0) * m.ms, m.oy + (this.sy(x, y) - m.iy0) * m.ms];
  }

  drawWallQuad(ctx, q, dx, dy) {
    const x0 = q.x0 + dx, y0 = q.y0 + dy, x1 = q.x1 + dx, y1 = q.y1 + dy;
    ctx.fillStyle = q.col;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1 + Math.sign(x1 - x0) * 0.5, y1); ctx.lineTo(x1 + Math.sign(x1 - x0) * 0.5, y1 - WALL_H); ctx.lineTo(x0, y0 - WALL_H);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 - 2); ctx.lineTo(x0, y0 - 2);
    ctx.fill();
    ctx.fillStyle = this.theme.wallTop;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - WALL_H); ctx.lineTo(x1, y1 - WALL_H); ctx.lineTo(x1, y1 - WALL_H - 2); ctx.lineTo(x0, y0 - WALL_H - 2);
    ctx.fill();
  }
}
