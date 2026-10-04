'use strict';
// One race: cars, weapons, pickups, hazards, particles, and per-viewport world rendering.

const LETTERS = 'FORGE';
const MAX_AMMO = 9;

class Race {
  // roster: [{name, color, human, player, upgrades, body, ammo, skill, aggro}]
  constructor(game, trackIndex, roster) {
    this.game = game;
    this.IMG = game.IMG;
    this.def = TRACKS[trackIndex];
    this.track = game.getTrack(trackIndex);
    this.laps = this.def.laps;
    this.time = 0;
    this.countdown = 3.6;
    this.lastCount = 4;
    this.particles = []; this.missiles = []; this.bombs = []; this.popups = [];
    this.finishOrder = [];
    this.endTimer = -1;
    this.done = false;

    const T = this.track, p0 = T.pts[0];
    this.cars = roster.map((r, k) => {
      const back = 26 + Math.floor(k / 2) * 26, lat = (k % 2 ? 1 : -1) * 15;
      const w = T.worldAt(T.L - back, lat);
      const car = new Car({
        ...r, x: w.x, y: w.y, h: p0.ang, s: T.L - back, dist: -back,
        upgrades: { ...r.upgrades }, ammo: { ...r.ammo },
      });
      car.idx = T.locate(car.x, car.y).i;
      car.computeStats(T.theme.grip);
      car.lap = 0;
      this.makeSprites(car);
      return car;
    });
    this.humans = this.cars.filter((c) => c.human);
    this.humans.forEach((c) => { c.cam = { x: T.sx(c.x, c.y), y: T.sy(c.x, c.y) }; c.popup = null; });

    // pickups
    const needLetters = this.humans.some((c) => game.players[c.player].letters < LETTERS.length);
    this.pickups = T.pickupSpots.map((sp, i) => {
      let type = i % 3 === 1 ? 'bomb' : 'missile', sub = null;
      if (i === 3 && needLetters) type = 'letter';
      if (i === 7) { type = 'upgrade'; sub = ['engine', 'tires', 'battery'][Math.floor(Math.random() * 3)]; }
      const loc = T.locate(sp.x, sp.y);
      return { x: sp.x, y: sp.y, s: loc.s, lat: loc.lat, type, sub, active: true, respawn: 0, humanOnly: type === 'letter' || type === 'upgrade' };
    });
    this.clouds = T.cloudSpots.map((s, i) => ({ base: s, ph: i * 2.1, x: 0, y: 0 }));
    this.updateClouds(0);
    const sOf = (d) => T.locate(d.x, d.y).s;
    this.staticHazards = [
      ...T.oils.map((d) => ({ s: sOf(d), lat: d.lat, r: 12 })),
      ...T.puddles.map((d) => ({ s: sOf(d), lat: d.lat, r: 13 })),
    ];
    this.hazardsForAI = this.staticHazards;
  }

  makeSprites(car) {
    const img = this.IMG[`car_${car.body}_${car.color}`];
    let top = img;
    if (!top) {
      top = makeCanvas(13, 21);
      const g = top.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 2, 13, 6); g.fillRect(0, 14, 13, 6);
      g.fillStyle = { red: '#d82800', blue: '#0058f8', green: '#00a800', yellow: '#f8b800' }[car.color];
      g.fillRect(2, 0, 9, 21);
      g.fillStyle = '#fcfcfc'; g.fillRect(4, 3, 5, 3);
    }
    car.spr = { top, dark: tinted(top, '#000', 0.5), shadow: tinted(top, '#000', 1) };
  }

  // ---------- events / fx ----------
  sfxAt(car, name) {
    // only play sounds that happen near a human
    if (this.humans.some((h) => dist2(h.x, h.y, car.x, car.y) < 300 * 300)) Audio2.sfx(name);
  }
  popup(car, text) { if (car.human) car.popup = { text, t: 2 }; }

  particle(x, y, z, vx, vy, vz, life, col, size = 1, grav = 300) {
    if (this.particles.length < 600) this.particles.push({ x, y, z, vx, vy, vz, life, max: life, col, size, grav });
  }
  dust(car, n) {
    const cols = this.track.theme === THEMES.snow ? ['#fcfcfc', '#a4e4fc'] : ['#c8a070', '#a07850', '#e0c098'];
    for (let i = 0; i < n; i++) this.particle(car.x + (Math.random() - 0.5) * 8, car.y + (Math.random() - 0.5) * 8, 1, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 20 + Math.random() * 30, 0.5, cols[i % cols.length], 1 + (Math.random() < 0.3));
  }
  sparks(x, y, n) {
    for (let i = 0; i < n; i++) this.particle(x, y, 3, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120, 40 + Math.random() * 60, 0.3, i % 2 ? '#fcfcfc' : '#f8b800');
  }
  explosion(x, y, z = 4) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU, v = 20 + Math.random() * 90;
      this.particle(x, y, z, Math.cos(a) * v, Math.sin(a) * v, 40 + Math.random() * 120, 0.4 + Math.random() * 0.5,
        ['#fcfcfc', '#f8b800', '#f83800', '#e45c10', '#7c7c7c'][i % 5], 1 + (i % 3 === 0 ? 1 : 0) + (i % 7 === 0 ? 1 : 0), 160);
    }
    this.flashes = this.flashes || [];
    this.flashes.push({ x, y, z, t: 0.25 });
  }
  splash(car) {
    for (let i = 0; i < 6; i++) this.particle(car.x, car.y, 1, (Math.random() - 0.5) * 50, (Math.random() - 0.5) * 50, 50 + Math.random() * 40, 0.4, i % 2 ? '#3cbcfc' : '#fcfcfc');
  }

  hitCar(car, x, y) {
    this.explosion(x, y);
    this.sfxAt(car, 'explode');
    if (car.invuln > 0) return;
    car.spin = 1.1; car.vx *= 0.2; car.vy *= 0.2; car.vz = 170; car.z = Math.max(car.z, 0.1); car.invuln = 2;
    this.popup(car, 'OUCH!');
  }

  fire(car, kind) {
    if (car.ammo[kind] <= 0 || car.spin > 0 || this.countdown > 0) return;
    car.ammo[kind]--;
    car.fireCd = 0.6;
    const fx = Math.cos(car.h), fy = Math.sin(car.h);
    if (kind === 'missile') {
      this.missiles.push({ x: car.x + fx * 12, y: car.y + fy * 12, h: car.h, v: Math.max(car.speed + 190, 330), owner: car, life: 2.2, idx: car.idx, z: 4 + car.z });
      this.sfxAt(car, 'missile');
    } else {
      this.bombs.push({ x: car.x - fx * 14, y: car.y - fy * 14, z: car.z + 6, vz: 60, owner: car, arm: 0.5, life: 25 });
      this.sfxAt(car, 'bomb');
    }
  }

  collect(car, pk) {
    if (pk.type === 'missile' || pk.type === 'bomb') {
      car.ammo[pk.type] = Math.min(MAX_AMMO, car.ammo[pk.type] + 2);
      pk.active = false; pk.respawn = 6;
      if (car.human) { this.sfxAt(car, 'pickup'); this.popup(car, pk.type === 'missile' ? '+2 MISSILES' : '+2 BOMBS'); }
    } else if (pk.type === 'upgrade') {
      const u = car.upgrades;
      u[pk.sub] = Math.min(5, u[pk.sub] + 1);
      car.computeStats(this.track.theme.grip);
      pk.active = false; pk.respawn = 1e9;
      this.sfxAt(car, 'upgrade');
      this.popup(car, `${pk.sub.toUpperCase()} UP!`);
    } else if (pk.type === 'letter') {
      const P = this.game.players[car.player];
      if (P.letters >= LETTERS.length) return;
      P.letters++;
      pk.active = false; pk.respawn = 1e9;
      this.sfxAt(car, 'letter');
      if (P.letters === LETTERS.length) {
        if (car.body !== 'formula') {
          car.body = P.body = 'formula';
          this.makeSprites(car);
          car.computeStats(this.track.theme.grip);
          this.popup(car, 'FORGE! NEW CAR!');
        } else { P.money += 2000; this.popup(car, 'FORGE! +$2000'); }
        P.letters = 0;
        this.sfxAt(car, 'upgrade');
      } else this.popup(car, `LETTER ${LETTERS[P.letters - 1]}!`);
    }
  }

  updateClouds(dt) {
    const T = this.track;
    for (const c of this.clouds) {
      const s = c.base + Math.sin(this.time * 0.22 + c.ph) * 150;
      const w = T.worldAt(s, Math.sin(this.time * 0.55 + c.ph) * HALF_W * 0.7);
      c.x = w.x; c.y = w.y;
    }
  }

  // ---------- simulation ----------
  update(dt, controls) {
    const T = this.track;
    this.time += dt;
    if (this.countdown > 0) {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n < this.lastCount && n >= 1 && n <= 3) Audio2.sfx('count');
      if (this.countdown <= 0) { Audio2.sfx('go'); this.raceStart = this.time; }
      this.lastCount = n;
    }
    this.hazardsForAI = this.staticHazards.concat(this.bombs.map((b) => ({ s: T.locate(b.x, b.y).s, lat: T.locate(b.x, b.y).lat, r: 10 })));

    // AI skill rubber band relative to the best human
    const bestHuman = Math.max(...this.humans.map((h) => h.dist));
    for (const car of this.cars) {
      let ctl;
      if (car.human) ctl = controls[car.player];
      else {
        const diff = (car.dist - bestHuman) / T.L;
        car.skill = car.baseSkill * (diff > 0.3 ? 0.92 : diff < -0.3 ? 1.06 : 1);
        ctl = aiControl(car, this, dt);
      }
      if (car.finished && car.human) ctl = { steer: 0, gas: false, brake: true };
      if (ctl.missile) this.fire(car, 'missile');
      if (ctl.bomb) this.fire(car, 'bomb');
      car.update(dt, ctl, this);
      if (car.human) Audio2.setEngine(car.player, clamp(car.speed / 260, 0, 1), true);

      // laps
      const lap = Math.floor(Math.max(0, car.dist) / T.L);
      if (lap > car.lap) {
        car.lap = lap;
        if (lap < this.laps && car.human) {
          Audio2.sfx('lap');
          this.popup(car, lap === this.laps - 1 ? 'FINAL LAP!' : `LAP ${lap + 1}`);
        }
      }
      if (!car.finished && car.dist >= this.laps * T.L) {
        car.finished = true; car.finishTime = this.time;
        this.finishOrder.push(car);
        if (car.human) { Audio2.sfx('go'); this.popup(car, `${ordinal(this.finishOrder.length)} PLACE!`); }
      }
    }
    this.collisions();
    this.features(dt);
    this.updateWeapons(dt);
    this.updateClouds(dt);

    for (const p of this.particles) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vz -= p.grav * dt; p.z += p.vz * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.6; p.vy *= 0.6; }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.flashes) { this.flashes.forEach((f) => (f.t -= dt)); this.flashes = this.flashes.filter((f) => f.t > 0); }
    for (const h of this.humans) if (h.popup && (h.popup.t -= dt) <= 0) h.popup = null;

    // places
    const order = [...this.cars].sort((a, b) =>
      a.finished && b.finished ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.dist - a.dist);
    order.forEach((c, i) => (c.place = i + 1));
    this.order = order;

    if (this.endTimer < 0 && this.humans.every((h) => h.finished)) this.endTimer = 2.5;
    if (this.endTimer > 0 && (this.endTimer -= dt) <= 0) { this.done = true; Audio2.stopEngines(); }
  }

  collisions() {
    const C = this.cars;
    for (let i = 0; i < C.length; i++) {
      for (let j = i + 1; j < C.length; j++) {
        const a = C[i], b = C[j];
        if (Math.abs(a.z - b.z) > 10) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= CAR_R * 2 || d < 1e-4) continue;
        const nx = dx / d, ny = dy / d, push = (CAR_R * 2 - d) / 2;
        a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vrel < 0) {
          const j2 = -(1.6 * vrel) / 2;
          a.vx -= nx * j2; a.vy -= ny * j2; b.vx += nx * j2; b.vy += ny * j2;
          if (vrel < -40) { this.sfxAt(a, 'bump'); this.sparks((a.x + b.x) / 2, (a.y + b.y) / 2, 3); }
        }
      }
    }
  }

  features(dt) {
    const T = this.track;
    for (const car of this.cars) {
      const ground = car.z <= 0;
      // ramps
      if (ground && car.prevS !== undefined) {
        const ds = (car.s - car.prevS + T.L) % T.L;
        for (const r of T.ramps) {
          const d0 = (r.s - car.prevS + T.L) % T.L;
          const vf = car.vx * Math.cos(car.h) + car.vy * Math.sin(car.h);
          if (ds < T.L / 2 && d0 > 0 && d0 <= ds && vf > 60) {
            car.vz = 100 + vf * 0.45; car.z = 0.1;
            this.sfxAt(car, 'jump');
          }
        }
      }
      if (!ground) continue;
      for (const b of T.boosts) {
        if (dist2(car.x, car.y, b.x, b.y) < 15 * 15 && car.boost < 0.4) { car.boost = 1.1; this.sfxAt(car, 'boost'); this.popup(car, 'BOOST!'); }
      }
      for (const o of T.oils) {
        if (dist2(car.x, car.y, o.x, o.y) < 12 * 12 && car.spin <= 0 && car.invuln <= 0) {
          car.spin = 0.55; car.invuln = 1.2; this.sfxAt(car, 'slip');
        }
      }
      for (const p of T.puddles) {
        if (dist2(car.x, car.y, p.x, p.y) < 14 * 14) {
          if (car.wet <= 0) { this.sfxAt(car, 'splash'); }
          car.wet = 0.45;
          if (Math.random() < 0.4) this.splash(car);
        }
      }
      for (const c of this.clouds) {
        if (dist2(car.x, car.y, c.x, c.y) < 20 * 20 && car.stall <= 0 && car.invuln <= 0) {
          car.stall = 1.0; car.invuln = 1.6; this.sfxAt(car, 'stall'); this.popup(car, 'ENGINE STALLED!');
        }
      }
      for (const pk of this.pickups) {
        if (pk.active && (!pk.humanOnly || car.human) && dist2(car.x, car.y, pk.x, pk.y) < 13 * 13) this.collect(car, pk);
      }
      if (car.speed > 120 && Math.random() < 0.15) this.dust(car, 1);
    }
    for (const pk of this.pickups) if (!pk.active && (pk.respawn -= dt) <= 0) pk.active = true;
  }

  updateWeapons(dt) {
    const T = this.track;
    for (const m of this.missiles) {
      m.life -= dt;
      let best = null, bd = 280;
      for (const c of this.cars) {
        if (c === m.owner || c.z > 20) continue;
        const dx = c.x - m.x, dy = c.y - m.y, d = Math.hypot(dx, dy);
        if (d < bd && Math.abs(angDiff(m.h, Math.atan2(dy, dx))) < 0.8) { bd = d; best = c; }
      }
      if (best) m.h += clamp(angDiff(m.h, Math.atan2(best.y - m.y, best.x - m.x)), -3.5 * dt, 3.5 * dt);
      else { // follow the track
        const loc = T.locate(m.x, m.y, m.idx), p = T.at(loc.s + 40);
        m.h += clamp(angDiff(m.h, Math.atan2(p.y - m.y, p.x - m.x)), -2.5 * dt, 2.5 * dt);
      }
      m.x += Math.cos(m.h) * m.v * dt; m.y += Math.sin(m.h) * m.v * dt;
      m.z = Math.max(3, m.z - 20 * dt);
      const loc = T.locate(m.x, m.y, m.idx); m.idx = loc.i;
      if (Math.abs(loc.lat) > WALL_OFF) { m.life = 0; this.explosion(m.x, m.y); this.sfxAt(m.owner, 'explode'); continue; }
      if (Math.random() < 0.8) this.particle(m.x, m.y, m.z, 0, 0, 5, 0.3, Math.random() < 0.5 ? '#bcbcbc' : '#fcfcfc', 1, 0);
      for (const c of this.cars) {
        if (c !== m.owner && Math.abs(c.z - m.z) < 16 && dist2(c.x, c.y, m.x, m.y) < (CAR_R + 4) ** 2) { m.life = 0; this.hitCar(c, m.x, m.y); break; }
      }
    }
    this.missiles = this.missiles.filter((m) => m.life > 0);
    for (const b of this.bombs) {
      b.life -= dt; b.arm -= dt;
      if (b.z > 0 || b.vz > 0) { b.vz -= GRAVITY * dt; b.z = Math.max(0, b.z + b.vz * dt); if (b.z === 0) b.vz = 0; }
      if (b.arm > 0) continue;
      for (const c of this.cars) {
        if (c.z < 8 && dist2(c.x, c.y, b.x, b.y) < (CAR_R + 4) ** 2) { b.life = 0; this.hitCar(c, b.x, b.y); break; }
      }
    }
    this.bombs = this.bombs.filter((b) => b.life > 0);
  }

  // ---------- rendering ----------
  drawView(ctx, car, vx, vy, vw, vh, dt) {
    const T = this.track, IMG = this.IMG;
    // camera leads in the direction of travel
    const tx = T.sx(car.x, car.y) + (car.vx - car.vy) * 0.32;
    const ty = T.sy(car.x, car.y) + (car.vx + car.vy) * 0.16;
    car.cam.x = lerp(car.cam.x, tx, clamp(5 * dt, 0, 1));
    car.cam.y = lerp(car.cam.y, ty, clamp(5 * dt, 0, 1));
    const left = Math.round(clamp(car.cam.x - vw / 2, 0, T.W - vw));
    const top = Math.round(clamp(car.cam.y - vh / 2, 0, T.H - vh));
    const ox = vx - left, oy = vy - top;

    ctx.save();
    ctx.beginPath(); ctx.rect(vx, vy, vw, vh); ctx.clip();
    ctx.drawImage(T.ground, left, top, vw, vh, vx, vy, vw, vh);

    const inView = (sx, sy, pad = 64) => sx > left - pad && sx < left + vw + pad && sy > top - pad && sy < top + vh + pad * 1.5;
    const ents = [];
    const S = (x, y) => [T.sx(x, y), T.sy(x, y)];

    // pickups
    for (const pk of this.pickups) {
      if (!pk.active) continue;
      const [sx, sy] = S(pk.x, pk.y);
      if (inView(sx, sy)) ents.push({ d: sy, f: () => this.drawPickup(ctx, pk, sx + ox, sy + oy) });
    }
    for (const b of this.bombs) {
      const [sx, sy] = S(b.x, b.y);
      if (inView(sx, sy)) ents.push({ d: sy, f: () => this.drawBomb(ctx, b, sx + ox, sy + oy) });
    }
    for (const c of this.cars) {
      const [sx, sy] = S(c.x, c.y);
      if (inView(sx, sy)) ents.push({ d: sy, f: () => this.drawCar(ctx, c, sx + ox, sy + oy) });
    }
    for (const m of this.missiles) {
      const [sx, sy] = S(m.x, m.y);
      if (inView(sx, sy)) ents.push({ d: sy, f: () => this.drawProjected(ctx, IMG.missile, m.h, sx + ox, sy + oy, m.z, '#f83800') });
    }
    for (const p of T.props) {
      const [sx, sy] = S(p.x, p.y);
      if (inView(sx, sy)) ents.push({ d: sy, f: () => this.drawProp(ctx, p, sx + ox, sy + oy) });
    }
    for (const w of T.nearWalls) {
      if (w.maxX < left - 4 || w.minX > left + vw + 4 || w.maxY < top - 4 || w.minY > top + vh + 4) continue;
      ents.push({ d: w.depth, f: () => w.quads.forEach((q) => T.drawWallQuad(ctx, q, ox, oy)) });
    }
    ents.sort((a, b) => a.d - b.d);
    ents.forEach((e) => e.f());

    // particles + flashes
    for (const p of this.particles) {
      const sx = T.sx(p.x, p.y) + ox, sy = T.sy(p.x, p.y) + oy - p.z;
      ctx.fillStyle = p.col;
      ctx.fillRect(Math.round(sx), Math.round(sy), p.size, p.size);
    }
    for (const f of this.flashes || []) {
      const sx = T.sx(f.x, f.y) + ox, sy = T.sy(f.x, f.y) + oy - f.z;
      ctx.fillStyle = f.t > 0.15 ? '#fcfcfc' : '#f8b800';
      const r = Math.round(4 + (0.25 - f.t) * 40);
      ctx.beginPath(); ctx.arc(Math.round(sx), Math.round(sy), r, 0, TAU); ctx.fill();
    }
    // clouds (shadow then cloud + rain)
    for (const c of this.clouds) {
      const sx = Math.round(T.sx(c.x, c.y) + ox), sy = Math.round(T.sy(c.x, c.y) + oy);
      if (!inView(sx - ox, sy - oy, 90)) continue;
      ctx.fillStyle = 'rgba(0,0,40,0.3)';
      ctx.beginPath(); ctx.ellipse(sx, sy, 22, 11, 0, 0, TAU); ctx.fill();
      const ch = 52;
      ctx.fillStyle = '#3cbcfc';
      for (let i = 0; i < 10; i++) {
        const rx = sx + ((i * 37 + Math.floor(this.time * 60) * 7) % 36) - 18;
        const ry = sy - ch + 8 + ((i * 13 + this.time * 160) % ch);
        ctx.fillRect(rx, Math.round(ry), 1, 3);
      }
      const img = IMG.cloud;
      if (img) ctx.drawImage(img, sx - (img.width >> 1), sy - ch - (img.height >> 1) + Math.round(Math.sin(this.time * 2) * 2));
      else { ctx.fillStyle = '#585858'; ctx.beginPath(); ctx.ellipse(sx, sy - ch, 24, 12, 0, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }

  drawCar(ctx, c, X, Y) {
    if (c.invuln > 0 && c.spin <= 0 && Math.floor(this.time * 20) % 2) return;
    const ang = Math.round((c.h + Math.PI / 2) / (TAU / 64)) * (TAU / 64);
    this.drawStack(ctx, c.spr, ang, X, Y, c.z);
    if (this.humans.length > 1 && c.human) {
      Font.draw(ctx, `${c.player + 1}P`, Math.round(X), Math.round(Y - c.z - 22), { align: 'center', color: c.player ? '#3cbcfc' : '#f87858' });
    }
  }

  drawStack(ctx, spr, ang, X, Y, z) {
    const w = spr.top.width, h = spr.top.height, Xi = Math.round(X), Yi = Math.round(Y), zi = Math.round(z);
    const layer = (img, dy) => {
      ctx.setTransform(1, 0.5, -1, 0.5, Xi, Yi - dy);
      ctx.rotate(ang);
      ctx.drawImage(img, -(w >> 1), -(h >> 1));
    };
    ctx.globalAlpha = 0.35; layer(spr.shadow, 0); ctx.globalAlpha = 1;
    for (let k = 1; k <= 3; k++) layer(spr.dark, zi + k);
    layer(spr.top, zi + 4);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawProjected(ctx, img, h, X, Y, z, fallback) {
    const Xi = Math.round(X), Yi = Math.round(Y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(Xi - 2, Yi - 1, 4, 2);
    ctx.setTransform(1, 0.5, -1, 0.5, Xi, Yi - Math.round(z));
    ctx.rotate(h + Math.PI / 2);
    if (img) ctx.drawImage(img, -(img.width >> 1), -(img.height >> 1));
    else { ctx.fillStyle = fallback; ctx.fillRect(-2, -6, 4, 12); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawProp(ctx, p, X, Y) {
    const img = this.IMG[p.kind];
    if (!img) {
      ctx.fillStyle = '#005800';
      ctx.beginPath(); ctx.moveTo(X, Y - 30); ctx.lineTo(X + 9, Y); ctx.lineTo(X - 9, Y); ctx.fill();
      return;
    }
    const x = Math.round(X - img.width / 2), y = Math.round(Y - img.height + 3);
    if (p.flip) {
      ctx.save(); ctx.translate(x + img.width, y); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0); ctx.restore();
    } else ctx.drawImage(img, x, y);
  }

  drawBomb(ctx, b, X, Y) {
    const img = this.IMG.bomb, Xi = Math.round(X), Yi = Math.round(Y - b.z);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(Math.round(X) - 4, Math.round(Y) - 1, 8, 3);
    if (img) ctx.drawImage(img, Xi - (img.width >> 1), Yi - img.height + 2);
    else { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(Xi, Yi - 4, 4, 0, TAU); ctx.fill(); }
    if (b.arm <= 0 && Math.floor(this.time * 6) % 2) { ctx.fillStyle = '#f83800'; ctx.fillRect(Xi - 1, Yi - 12, 2, 2); }
  }

  drawPickup(ctx, pk, X, Y) {
    const bob = Math.round(5 + Math.sin(this.time * 4 + pk.s) * 2);
    const Xi = Math.round(X), Yi = Math.round(Y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(Xi, Yi, 6, 3, 0, 0, TAU); ctx.fill();
    const by = Yi - bob - 12;
    const badge = (bg, fg) => {
      ctx.fillStyle = '#000'; ctx.fillRect(Xi - 7, by - 1, 14, 14);
      ctx.fillStyle = bg; ctx.fillRect(Xi - 6, by, 12, 12);
      ctx.fillStyle = fg; ctx.fillRect(Xi - 6, by, 12, 1); ctx.fillRect(Xi - 6, by, 1, 12);
    };
    if (pk.type === 'missile') { badge('#d82800', '#f87858'); Font.draw(ctx, 'M', Xi - 2, by + 3, { shadow: null }); }
    else if (pk.type === 'bomb') { badge('#0058f8', '#6888fc'); Font.draw(ctx, 'B', Xi - 2, by + 3, { shadow: null }); }
    else if (pk.type === 'letter') {
      const flash = Math.floor(this.time * 8) % 2;
      badge(flash ? '#f8b800' : '#fca044', '#fcfcfc');
      const P = this.game.players[this.humans[0].player];
      Font.draw(ctx, LETTERS[Math.min(P.letters, 4)], Xi - 2, by + 3, { color: '#000', shadow: null });
    } else {
      const icon = this.IMG['icon_' + (pk.sub === 'tires' ? 'tire' : pk.sub)];
      badge('#00a800', '#58d854');
      if (icon) ctx.drawImage(icon, Xi - (icon.width >> 1), by + 6 - (icon.height >> 1));
      else Font.draw(ctx, pk.sub[0], Xi - 2, by + 3, { shadow: null });
    }
  }
}
