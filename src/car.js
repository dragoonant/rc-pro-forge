'use strict';
// Car physics + AI driver.

const CAR_R = 7;
const GRAVITY = 720;

class Car {
  constructor(opts) {
    Object.assign(this, {
      x: 0, y: 0, h: 0, vx: 0, vy: 0, z: 0, vz: 0,
      idx: -1, s: 0, dist: 0, lat: 0,
      finished: false, finishTime: 0, place: 1,
      spin: 0, stall: 0, boost: 0, wet: 0, invuln: 0, flash: 0,
      ammo: { missile: 0, bomb: 0 },
      upgrades: { engine: 0, tires: 0, battery: 0 }, body: 'buggy',
      human: false, player: -1, skill: 1, lane: 0, laneT: 0, fireCd: 0,
    }, opts);
    this.computeStats(1);
  }

  computeStats(themeGrip) {
    const u = this.upgrades, f = this.body === 'formula';
    this.maxSpeed = 172 + 13 * u.engine + (f ? 22 : 0);
    this.accel = 150 + 24 * u.battery + (f ? 20 : 0);
    this.grip = (6.5 + 1.1 * u.tires + (f ? 1 : 0)) * themeGrip;
    this.turn = 3.4 + 0.12 * u.tires;
  }

  get speed() { return Math.hypot(this.vx, this.vy); }

  update(dt, ctl, race) {
    let steer = ctl.steer, gas = ctl.gas ? 1 : 0, brake = ctl.brake ? 1 : 0;
    if (race.countdown > 0) { steer = 0; gas = 0; brake = 0; }
    if (this.spin > 0) { this.spin -= dt; this.h += 13 * dt; gas = brake = steer = 0; }
    if (this.stall > 0) { this.stall -= dt; gas = 0; }
    this.boost -= dt; this.wet -= dt; this.invuln -= dt; this.fireCd -= dt; this.flash -= dt;

    const air = this.z > 0;
    let fx = Math.cos(this.h), fy = Math.sin(this.h);
    let vf = this.vx * fx + this.vy * fy;
    if (!air) {
      this.h += steer * this.turn * clamp(vf / 70, -1, 1) * dt;
      fx = Math.cos(this.h); fy = Math.sin(this.h);
    }
    vf = this.vx * fx + this.vy * fy;
    let vl = -this.vx * fy + this.vy * fx;
    if (!air) {
      const boosting = this.boost > 0;
      const maxS = this.maxSpeed * (boosting ? 1.45 : 1) * (this.wet > 0 ? 0.55 : 1) * (this.finished ? 0.6 : 1);
      if (gas) { if (vf < maxS) vf = Math.min(maxS, vf + this.accel * (boosting ? 2 : 1) * dt); }
      else if (brake) { vf -= (vf > 0 ? 330 : 140) * dt; vf = Math.max(vf, -this.maxSpeed * 0.35); }
      else vf -= Math.sign(vf) * Math.min(Math.abs(vf), 70 * dt);
      if (vf > maxS) vf = lerp(vf, maxS, 2.5 * dt);
      vl *= Math.exp(-this.grip * dt);
    }
    this.vx = fx * vf - fy * vl;
    this.vy = fy * vf + fx * vl;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (air || this.vz > 0) {
      this.vz -= GRAVITY * dt;
      this.z += this.vz * dt;
      if (this.z <= 0) {
        if (this.vz < -140) { race.sfxAt(this, 'land'); race.dust(this, 6); }
        this.z = 0; this.vz = 0;
      }
    }

    // walls
    const T = race.track;
    const loc = T.locate(this.x, this.y, this.idx);
    this.idx = loc.i;
    const limit = WALL_OFF - CAR_R;
    if (Math.abs(loc.lat) > limit) {
      const sg = Math.sign(loc.lat), p = loc.p, over = loc.lat - sg * limit;
      this.x -= p.nx * over; this.y -= p.ny * over;
      const vn = (this.vx * p.nx + this.vy * p.ny) * sg;
      if (vn > 0) {
        this.vx -= p.nx * sg * vn * 1.5; this.vy -= p.ny * sg * vn * 1.5;
        this.vx *= 0.9; this.vy *= 0.9;
        if (vn > 35) { race.sfxAt(this, 'bump'); race.sparks(this.x + p.nx * sg * CAR_R, this.y + p.ny * sg * CAR_R, 4); }
      }
      loc.lat = sg * limit;
    }
    this.lat = loc.lat;
    let ds = loc.s - this.s;
    if (ds < -T.L / 2) ds += T.L; else if (ds > T.L / 2) ds -= T.L;
    this.prevS = this.s;
    this.s = loc.s;
    this.dist += ds;
  }
}

// AI driver: follows the centerline with a lane offset, dodges hazards, slows for curves, uses weapons.
function aiControl(car, race, dt) {
  const T = race.track, sp = car.speed;
  car.laneT -= dt;
  if (car.laneT <= 0) { car.lane = (Math.random() - 0.5) * HALF_W * 1.1; car.laneT = 1.5 + Math.random() * 2.5; }
  let lane = car.lane;
  const look = 34 + sp * 0.42;

  // dodge hazards a short way ahead
  const ahead = (s) => { let d = s - car.s; if (d < 0) d += T.L; return d; };
  for (const hz of race.hazardsForAI) {
    const d = ahead(hz.s);
    if (d > 10 && d < 130 && Math.abs(hz.lat - lane) < hz.r + 10) lane = hz.lat + (hz.lat > 0 ? -1 : 1) * (hz.r + 14);
  }
  // grab ammo now and then
  if (car.skill > 0.95 || Math.random() < 0.5) {
    for (const pk of race.pickups) {
      if (!pk.active || pk.humanOnly) continue;
      const d = ahead(pk.s);
      if (d > 20 && d < 150) { lane = pk.lat; break; }
    }
  }
  lane = clamp(lane, -HALF_W + 10, HALF_W - 10);

  const tgt = T.worldAt(car.s + look, lane);
  const desired = Math.atan2(tgt.y - car.y, tgt.x - car.x);
  const d = angDiff(car.h, desired);
  let steer = clamp(d * 3.2, -1, 1);

  let maxCurv = 0;
  for (let k = 0; k < look * 1.6; k += STEP * 2) maxCurv = Math.max(maxCurv, Math.abs(T.at(car.s + k).curv));
  const target = car.maxSpeed * car.skill * (1 - clamp(maxCurv * 22, 0, 0.3));
  let gas = sp < target && !(Math.abs(d) > 1.2 && sp > target * 0.6);
  let brake = sp > target + 25;

  // stuck against a wall or another car: back up with opposite lock
  car.stuckT = sp < 15 && race.countdown <= 0 && car.spin <= 0 ? (car.stuckT || 0) + dt : 0;
  if (car.stuckT > 1.2) car.reverseT = 0.7;
  if (car.reverseT > 0) { car.reverseT -= dt; gas = false; brake = true; steer = -Math.sign(d) || 1; }

  // weapons
  let missile = false, bomb = false;
  if (car.fireCd <= 0 && race.countdown <= 0) {
    for (const o of race.cars) {
      if (o === car || o.finished) continue;
      const dx = o.x - car.x, dy = o.y - car.y, dd = Math.hypot(dx, dy);
      if (car.ammo.missile > 0 && dd < 230 && dd > 20 && Math.abs(angDiff(car.h, Math.atan2(dy, dx))) < 0.35 && Math.random() < dt * 2.2 * car.aggro) missile = true;
      if (car.ammo.bomb > 0 && dd < 70 && o.dist < car.dist && Math.random() < dt * 1.5 * car.aggro) bomb = true;
    }
  }
  return { steer, gas, brake, missile, bomb };
}
