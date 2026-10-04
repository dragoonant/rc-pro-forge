'use strict';
// Game shell: asset loading, state machine (title/intro/race/results/shop/gameover/victory), HUD, main loop.

const VW = 640, VH = 360;
const TOTAL_ROUNDS = 8;
const PRIZES = [1000, 600, 300, 0];
const AI_NAMES = ['BLAZE', 'DOZER', 'VIPER'];
const SHOP = [
  { key: 'engine', label: 'ENGINE', desc: 'TOP SPEED', price: (l) => 400 + l * 250 },
  { key: 'tires', label: 'TIRES', desc: 'GRIP + STEERING', price: (l) => 350 + l * 200 },
  { key: 'battery', label: 'BATTERY', desc: 'ACCELERATION', price: (l) => 350 + l * 200 },
  { key: 'missile', label: 'MISSILES X3', desc: 'HOMING ROCKETS', price: () => 150 },
  { key: 'bomb', label: 'BOMBS X2', desc: 'DROP BEHIND YOU', price: () => 120 },
  { key: 'done', label: 'NEXT RACE', desc: '', price: () => 0 },
];

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.IMG = {};
    this.trackCache = {};
    this.state = 'loading';
    this.t = 0;
    this.menuIdx = 0;
    this.paused = false;
    this.songs = {
      title: Audio2.makeSong(99, 'major', 140),
      menu: Audio2.makeSong(7, 'mixo', 120),
      tracks: TRACKS.map((t, i) => Audio2.makeSong(t.seed * 13 + 1, THEMES[t.theme].mood, 150 + i * 6)),
    };
    this.load();
  }

  // ---------- loading ----------
  load() {
    const names = typeof ASSET_NAMES !== 'undefined' ? ASSET_NAMES : [];
    let left = names.length;
    if (!left) return this.toTitle();
    names.forEach((n) => {
      const img = new Image();
      img.onload = () => { this.IMG[n] = img; if (--left === 0) this.toTitle(); };
      img.onerror = () => { if (--left === 0) this.toTitle(); };
      img.src = `assets/${n}.png`;
    });
  }

  getTrack(i) {
    if (!this.trackCache[i]) { this.trackCache = {}; this.trackCache[i] = new Track(TRACKS[i], this.IMG); }
    return this.trackCache[i];
  }

  // ---------- flow ----------
  toTitle() {
    this.state = 'title'; this.menuIdx = 0; this.t = 0;
    Audio2.playMusic(this.songs.title);
  }

  newGame(numPlayers) {
    this.numPlayers = numPlayers;
    Input.setTwoPlayer(numPlayers === 2);
    const colors = ['red', 'blue'];
    this.players = [];
    for (let i = 0; i < numPlayers; i++) {
      this.players.push({ idx: i, color: colors[i], money: 0, upgrades: { engine: 0, tires: 0, battery: 0 },
                          body: 'buggy', letters: 0, continues: 3, out: false, ammo: { missile: 3, bomb: 1 } });
    }
    this.round = 0;
    this.toIntro();
  }

  activePlayers() { return this.players.filter((p) => !p.out); }

  toIntro() {
    this.state = 'intro'; this.t = 0;
    this.trackIndex = this.round % TRACKS.length;
    Audio2.stopMusic();
    // build the track during the intro card
    setTimeout(() => this.getTrack(this.trackIndex), 30);
  }

  startRace() {
    const humans = this.activePlayers();
    const aiColors = ['green', 'yellow', 'blue', 'red'].filter((c) => !humans.some((h) => h.color === c));
    const lvl = Math.floor(this.round * 0.7);
    const roster = [];
    const nAI = 4 - humans.length;
    for (let k = 0; k < nAI; k++) {
      roster.push({
        name: AI_NAMES[k], color: aiColors[k], human: false,
        upgrades: { engine: Math.min(5, lvl), tires: Math.min(5, lvl), battery: Math.min(5, lvl) },
        body: this.round >= 5 && k === 0 ? 'formula' : 'buggy',
        ammo: { missile: 2 + Math.floor(this.round / 2), bomb: 1 + Math.floor(this.round / 3) },
        baseSkill: 0.85 + this.round * 0.022 + [0.03, 0, -0.025][k], aggro: 0.5 + this.round * 0.12,
      });
    }
    humans.forEach((p) => roster.push({ name: `${p.idx + 1}P`, color: p.color, human: true, player: p.idx,
                                         upgrades: p.upgrades, body: p.body, ammo: p.ammo }));
    this.race = new Race(this, this.trackIndex, roster);
    this.state = 'race'; this.t = 0; this.paused = false;
    Audio2.playMusic(this.songs.tracks[this.trackIndex]);
  }

  finishRace() {
    const r = this.race;
    this.results = r.order.map((c) => ({ car: c, place: c.place }));
    this.resultLines = [];
    let anyAdvance = false;
    for (const c of r.humans) {
      const P = this.players[c.player];
      P.upgrades = { ...c.upgrades }; P.body = c.body; P.ammo = { ...c.ammo };
      const prize = PRIZES[c.place - 1];
      P.money += prize;
      if (c.place === 4) {
        P.continues--;
        if (P.continues <= 0) { P.out = true; this.resultLines.push(`${c.player + 1}P IS OUT OF CONTINUES!`); }
        else this.resultLines.push(`${c.player + 1}P FINISHED LAST - ${P.continues} CONTINUE${P.continues > 1 ? 'S' : ''} LEFT`);
      } else anyAdvance = true;
    }
    this.advance = anyAdvance;
    this.state = 'results'; this.t = 0;
    Audio2.playMusic(this.songs.menu);
  }

  afterResults() {
    if (this.activePlayers().length === 0) { this.state = 'gameover'; this.t = 0; Audio2.stopMusic(); return; }
    if (this.advance) this.round++;
    if (this.round >= TOTAL_ROUNDS) { this.state = 'victory'; this.t = 0; return; }
    if (this.numPlayers === 1 || this.activePlayers().length === 1) Input.setTwoPlayer(false);
    this.shopQueue = this.activePlayers().map((p) => p.idx);
    this.toShop();
  }

  toShop() {
    if (!this.shopQueue.length) return this.toIntro();
    this.shopPlayer = this.shopQueue.shift();
    this.state = 'shop'; this.menuIdx = 0; this.t = 0;
  }

  // ---------- update ----------
  update(dt) {
    this.t += dt;
    Input.pollPads();
    const m = Input.menu();
    if (m.mute) Audio2.toggleMute();
    switch (this.state) {
      case 'title': {
        if (m.up || m.down) { this.menuIdx = (this.menuIdx + (m.up ? 2 : 1)) % 3; Audio2.sfx('move'); }
        if (m.ok) {
          Audio2.sfx('ok');
          if (this.menuIdx === 2) { this.state = 'controls'; break; }
          this.newGame(this.menuIdx + 1);
        }
        break;
      }
      case 'controls': if (m.ok || m.back) { this.state = 'title'; Audio2.sfx('ok'); } break;
      case 'intro': if (this.t > 2.6 || (this.t > 0.6 && m.ok)) this.startRace(); break;
      case 'race': {
        if (m.pause) { this.paused = !this.paused; Audio2.sfx('ok'); if (this.paused) Audio2.stopEngines(); }
        if (this.paused) {
          if (m.back && !m.pause) { this.paused = false; Audio2.stopEngines(); this.toTitle(); }
          break;
        }
        const controls = [Input.player(0), Input.player(1)];
        this.race.update(dt, controls);
        if (this.race.done) this.finishRace();
        break;
      }
      case 'results': if (this.t > 1 && m.ok) { Audio2.sfx('ok'); this.afterResults(); } break;
      case 'shop': this.updateShop(m); break;
      case 'gameover': case 'victory': if (this.t > 1.5 && m.ok) this.toTitle(); break;
    }
    Input.endFrame();
  }

  updateShop(m) {
    const P = this.players[this.shopPlayer];
    if (m.up) { this.menuIdx = (this.menuIdx + SHOP.length - 1) % SHOP.length; Audio2.sfx('move'); }
    if (m.down) { this.menuIdx = (this.menuIdx + 1) % SHOP.length; Audio2.sfx('move'); }
    if (m.back) { this.menuIdx = SHOP.length - 1; }
    if (!m.ok) return;
    const it = SHOP[this.menuIdx];
    if (it.key === 'done') { Audio2.sfx('ok'); return this.toShop(); }
    const isUp = it.key in P.upgrades;
    const lvl = isUp ? P.upgrades[it.key] : 0;
    const price = it.price(lvl);
    const full = isUp ? lvl >= 5 : P.ammo[it.key] >= MAX_AMMO;
    if (full || P.money < price) return Audio2.sfx('deny');
    P.money -= price;
    if (isUp) P.upgrades[it.key]++;
    else P.ammo[it.key] = Math.min(MAX_AMMO, P.ammo[it.key] + (it.key === 'missile' ? 3 : 2));
    Audio2.sfx('cash');
  }

  // ---------- render ----------
  render(dt) {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, VW, VH);
    switch (this.state) {
      case 'loading': Font.draw(g, 'LOADING...', VW / 2, VH / 2, { align: 'center' }); break;
      case 'title': this.drawTitle(g); break;
      case 'controls': this.drawControls(g); break;
      case 'intro': this.drawIntro(g); break;
      case 'race': this.drawRace(g, dt); break;
      case 'results': this.drawResults(g); break;
      case 'shop': this.drawShop(g); break;
      case 'gameover': this.drawEnd(g, 'GAME OVER', '#f83800'); break;
      case 'victory': this.drawEnd(g, 'CHAMPION!', '#f8b800'); break;
    }
  }

  drawBackdrop(g, dim = 0.55) {
    const art = this.IMG.title_art;
    if (art) g.drawImage(art, 0, 0, art.width, art.height, 0, 0, VW, Math.round(VW * art.height / art.width));
    else { g.fillStyle = '#0058f8'; g.fillRect(0, 0, VW, VH); }
    g.fillStyle = `rgba(0,0,0,${dim})`; g.fillRect(0, 0, VW, VH);
  }

  drawLogo(g, y) {
    const wob = (i) => Math.round(Math.sin(this.t * 3 + i * 0.5) * 2);
    const text = 'RC PRO FORGE';
    const s = 5, w = Font.width(text, s);
    for (let i = 0; i < text.length; i++) {
      const x = VW / 2 - w / 2 + i * 6 * s;
      Font.draw(g, text[i], x + 3, y + wob(i) + 3, { scale: s, color: '#000', shadow: null });
      Font.draw(g, text[i], x, y + wob(i), { scale: s, color: i < 2 ? '#f83800' : i < 6 ? '#f8b800' : '#3cbcfc', shadow: '#fcfcfc' });
    }
  }

  drawTitle(g) {
    this.drawBackdrop(g, 0.25);
    this.drawLogo(g, 40);
    Font.draw(g, 'A RADIO CONTROLLED RACING TRIBUTE', VW / 2, 86, { align: 'center', color: '#fcfcfc' });
    const items = ['1 PLAYER', '2 PLAYERS', 'CONTROLS'];
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(VW / 2 - 80, 222, 160, 76);
    items.forEach((s, i) => {
      const sel = i === this.menuIdx;
      Font.draw(g, (sel ? '> ' : '  ') + s, VW / 2 - 56, 234 + i * 20, { scale: 1, color: sel ? '#f8b800' : '#bcbcbc' });
    });
    if (Math.floor(this.t * 2) % 2) Font.draw(g, 'PRESS ENTER / START', VW / 2, 316, { align: 'center', color: '#fcfcfc' });
    Font.draw(g, 'ART GENERATED WITH SDXL  -  M: MUTE', VW / 2, 346, { align: 'center', color: '#7c7c7c' });
  }

  drawControls(g) {
    this.drawBackdrop(g, 0.8);
    Font.draw(g, 'CONTROLS', VW / 2, 24, { align: 'center', scale: 3, color: '#f8b800' });
    const rows = [
      ['', '1 PLAYER', '2P: PLAYER 1', '2P: PLAYER 2'],
      ['GAS', 'W / UP / Z', 'W', 'UP'],
      ['BRAKE', 'S / DOWN / X', 'S', 'DOWN'],
      ['STEER', 'A D / LEFT RIGHT', 'A D', 'LEFT RIGHT'],
      ['MISSILE', 'SPACE / F / C', 'F', '/ OR ENTER'],
      ['BOMB', 'SHIFT / G / V', 'G', '. OR R-SHIFT'],
      ['PAUSE', 'ESC / P', 'ESC / P', ''],
    ];
    rows.forEach((r, i) => r.forEach((c, j) => Font.draw(g, c, [40, 130, 300, 450][j], 80 + i * 22, { color: i === 0 || j === 0 ? '#3cbcfc' : '#fcfcfc' })));
    Font.draw(g, 'GAMEPAD: A/RT GAS  B/LT BRAKE  X/RB MISSILE  Y/LB BOMB', VW / 2, 252, { align: 'center', color: '#b8f818' });
    Font.draw(g, 'COLLECT F-O-R-G-E LETTERS TO EARN A NEW CAR.', VW / 2, 280, { align: 'center' });
    Font.draw(g, 'FINISH LAST AND YOU LOSE A CONTINUE!', VW / 2, 296, { align: 'center', color: '#f87858' });
    Font.draw(g, 'PRESS ENTER', VW / 2, 336, { align: 'center', color: '#f8b800' });
  }

  drawIntro(g) {
    this.drawBackdrop(g, 0.7);
    const def = TRACKS[this.round % TRACKS.length];
    Font.draw(g, `ROUND ${this.round + 1} OF ${TOTAL_ROUNDS}`, VW / 2, 110, { align: 'center', scale: 2, color: '#3cbcfc' });
    Font.draw(g, def.name, VW / 2, 150, { align: 'center', scale: 4, color: '#f8b800' });
    Font.draw(g, `${def.laps} LAPS`, VW / 2, 200, { align: 'center', scale: 2 });
    const tips = ['RAMPS LAUNCH YOU OVER TROUBLE', 'AVOID OIL SLICKS AND PUDDLES', 'RAIN CLOUDS STALL YOUR ENGINE', 'YELLOW PADS GIVE A SPEED BOOST'];
    Font.draw(g, 'TIP: ' + tips[this.round % tips.length], VW / 2, 260, { align: 'center', color: '#bcbcbc' });
  }

  drawRace(g, dt) {
    const r = this.race;
    const hs = r.humans.filter((h) => !this.players[h.player].out || true);
    if (hs.length === 1) {
      r.drawView(g, hs[0], 0, 0, VW, VH, dt);
      this.drawHud(g, hs[0], 0, 0, VW, VH, true);
    } else {
      const w = VW / 2 - 1;
      hs.forEach((h, i) => {
        r.drawView(g, h, i * (w + 2), 0, w, VH, dt);
        this.drawHud(g, h, i * (w + 2), 0, w, VH, false);
      });
      g.fillStyle = '#000'; g.fillRect(w, 0, 2, VH);
    }
    // countdown lights
    if (r.countdown > 0 || r.time - (r.raceStart || 0) < 0.8) {
      const n = Math.ceil(r.countdown);
      const cx = VW / 2, cy = 70;
      g.fillStyle = '#000'; g.fillRect(cx - 44, cy - 14, 88, 28);
      for (let i = 0; i < 3; i++) {
        const on = r.countdown > 0 ? 3 - n >= i : true;
        g.fillStyle = r.countdown <= 0 ? '#00b800' : on ? '#f83800' : '#503000';
        g.beginPath(); g.arc(cx - 26 + i * 26, cy, 9, 0, TAU); g.fill();
      }
      const label = r.countdown > 0 ? String(n) : 'GO!';
      Font.draw(g, label, cx, cy + 22, { align: 'center', scale: 3, color: r.countdown > 0 ? '#fcfcfc' : '#b8f818' });
    }
    if (this.paused) {
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, VW, VH);
      Font.draw(g, 'PAUSED', VW / 2, 140, { align: 'center', scale: 4, color: '#f8b800' });
      Font.draw(g, 'ESC/P: RESUME    BACKSPACE/X: QUIT TO TITLE', VW / 2, 200, { align: 'center' });
    }
  }

  drawHud(g, car, vx, vy, vw, vh, solo) {
    const r = this.race, P = this.players[car.player];
    // place
    const placeCol = ['#f8b800', '#bcbcbc', '#e45c10', '#f83800'][car.place - 1];
    Font.draw(g, ordinal(car.place), vx + 8, vy + 8, { scale: 3, color: placeCol });
    const lap = Math.min(r.laps, Math.max(1, Math.floor(Math.max(0, car.dist) / r.track.L) + 1));
    Font.draw(g, car.finished ? 'FINISHED' : `LAP ${lap}/${r.laps}`, vx + 8, vy + 36, { color: '#fcfcfc' });
    // race time
    const t = Math.max(0, (car.finished ? car.finishTime : r.time) - (r.raceStart || r.time));
    Font.draw(g, `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`, vx + 8, vy + 48, { color: '#bcbcbc' });

    // ammo
    const by = vy + vh - 20;
    const mi = this.IMG.missile;
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(vx + 4, by - 6, 92, 22);
    if (mi) g.drawImage(mi, vx + 10, by - 4); else { g.fillStyle = '#f83800'; g.fillRect(vx + 10, by - 2, 4, 12); }
    Font.draw(g, `x${car.ammo.missile}`, vx + 20, by + 2);
    const bi = this.IMG.bomb;
    if (bi) g.drawImage(bi, vx + 50, by - 2); else { g.fillStyle = '#000'; g.fillRect(vx + 50, by, 8, 8); }
    Font.draw(g, `x${car.ammo.bomb}`, vx + 64, by + 2);

    // letters
    const lx = vx + vw - 6 * 9 - 6;
    for (let i = 0; i < LETTERS.length; i++) {
      const got = i < P.letters;
      g.fillStyle = got ? '#f8b800' : 'rgba(0,0,0,0.5)';
      g.fillRect(lx + i * 9 - 1, by - 2, 9, 11);
      Font.draw(g, LETTERS[i], lx + i * 9 + 1, by, { color: got ? '#000' : '#7c7c7c', shadow: null });
    }
    // speed bar
    const sp = clamp(car.speed / (car.maxSpeed * 1.45), 0, 1);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(vx + 102, by - 2, 52, 9);
    g.fillStyle = car.boost > 0 ? '#3cbcfc' : sp > 0.66 ? '#f83800' : '#f8b800';
    g.fillRect(vx + 103, by - 1, Math.round(50 * sp), 7);

    // minimap
    if (solo || vw > 300) {
      const T = r.track, mm = T.mini, mx = vx + vw - mm.w - 4, my = vy + 4;
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(mx, my, mm.w, mm.h);
      g.drawImage(T.miniCanvas, mx, my);
      for (const c of [...r.cars].reverse()) {
        const [x, y] = T.miniXY(c.x, c.y);
        g.fillStyle = { red: '#f83800', blue: '#3cbcfc', green: '#00b800', yellow: '#f8b800' }[c.color];
        const s = c === car ? 4 : 3;
        g.fillRect(Math.round(mx + x - s / 2), Math.round(my + y - s / 2), s, s);
      }
    }
    // popup
    if (car.popup) {
      const a = car.popup.t;
      if (a > 0.3 || Math.floor(a * 20) % 2) Font.draw(g, car.popup.text, vx + vw / 2, vy + vh * 0.3, { align: 'center', scale: 2, color: '#f8b800' });
    }
    if (car.place === 4 && car.lap === r.laps - 1 && !car.finished && Math.floor(r.time * 3) % 2) {
      Font.draw(g, 'LAST PLACE!', vx + vw / 2, vy + vh * 0.3 + 22, { align: 'center', color: '#f83800' });
    }
  }

  drawResults(g) {
    this.drawBackdrop(g, 0.8);
    Font.draw(g, 'RACE RESULTS', VW / 2, 30, { align: 'center', scale: 3, color: '#f8b800' });
    Font.draw(g, TRACKS[this.trackIndex].name, VW / 2, 64, { align: 'center', color: '#3cbcfc' });
    const trophy = this.IMG.trophy;
    this.results.forEach(({ car, place }, i) => {
      const y = 96 + i * 34;
      const show = this.t > 0.2 + i * 0.25;
      if (!show) return;
      Font.draw(g, ordinal(place), 150, y, { scale: 2, color: ['#f8b800', '#bcbcbc', '#e45c10', '#f83800'][i] });
      g.save(); g.translate(220, y + 7); g.rotate(-Math.PI / 2); g.drawImage(car.spr.top, -(car.spr.top.width >> 1), -(car.spr.top.height >> 1)); g.restore();
      Font.draw(g, car.human ? `PLAYER ${car.player + 1}` : car.name, 246, y + 4, { scale: 1, color: car.human ? '#fcfcfc' : '#bcbcbc' });
      if (car.human) Font.draw(g, `+$${PRIZES[place - 1]}`, 400, y + 4, { color: '#b8f818' });
      if (place === 1 && trophy) g.drawImage(trophy, 470, y - 20, 28, Math.round(28 * trophy.height / trophy.width));
    });
    this.resultLines.forEach((s, i) => Font.draw(g, s, VW / 2, 244 + i * 14, { align: 'center', color: '#f87858' }));
    if (this.t > 1 && Math.floor(this.t * 2) % 2) Font.draw(g, this.advance ? 'PRESS ENTER' : 'PRESS ENTER TO RETRY', VW / 2, 330, { align: 'center' });
  }

  drawShop(g) {
    this.drawBackdrop(g, 0.82);
    const P = this.players[this.shopPlayer];
    Font.draw(g, `PIT SHOP - PLAYER ${P.idx + 1}`, VW / 2, 20, { align: 'center', scale: 2, color: '#f8b800' });
    Font.draw(g, `CASH $${P.money}`, VW / 2, 46, { align: 'center', scale: 2, color: '#b8f818' });
    SHOP.forEach((it, i) => {
      const y = 86 + i * 32, sel = i === this.menuIdx;
      if (sel) { g.fillStyle = 'rgba(248,184,0,0.18)'; g.fillRect(70, y - 6, 500, 26); }
      const icon = { engine: 'icon_engine', tires: 'icon_tire', battery: 'icon_battery', missile: 'missile', bomb: 'bomb' }[it.key];
      if (icon && this.IMG[icon]) g.drawImage(this.IMG[icon], 82, y - 2);
      Font.draw(g, it.label, 110, y, { color: sel ? '#f8b800' : '#fcfcfc' });
      if (it.desc) Font.draw(g, it.desc, 110, y + 10, { color: '#7c7c7c' });
      if (it.key in P.upgrades) {
        const l = P.upgrades[it.key];
        for (let k = 0; k < 5; k++) { g.fillStyle = k < l ? '#00b800' : '#404040'; g.fillRect(300 + k * 12, y, 10, 8); }
        Font.draw(g, l >= 5 ? 'MAX' : `$${it.price(l)}`, 480, y, { color: P.money >= it.price(l) && l < 5 ? '#b8f818' : '#7c7c7c' });
      } else if (it.key !== 'done') {
        Font.draw(g, `HAVE ${P.ammo[it.key]}`, 300, y, { color: '#bcbcbc' });
        Font.draw(g, `$${it.price(0)}`, 480, y, { color: P.money >= it.price(0) ? '#b8f818' : '#7c7c7c' });
      }
    });
    Font.draw(g, `CAR: ${P.body === 'formula' ? 'FORGE FORMULA' : 'BUGGY'}    LETTERS ${LETTERS.slice(0, P.letters) || '-'}    CONTINUES ${P.continues}`, VW / 2, 300, { align: 'center', color: '#3cbcfc' });
    Font.draw(g, 'UP/DOWN SELECT   ENTER BUY', VW / 2, 330, { align: 'center', color: '#bcbcbc' });
  }

  drawEnd(g, title, col) {
    this.drawBackdrop(g, 0.75);
    Font.draw(g, title, VW / 2, 100, { align: 'center', scale: 6, color: col });
    const trophy = this.IMG.trophy;
    if (title === 'CHAMPION!' && trophy) g.drawImage(trophy, VW / 2 - trophy.width, 160, trophy.width * 2, trophy.height * 2);
    this.players.forEach((p, i) => Font.draw(g, `PLAYER ${i + 1}: $${p.money}`, VW / 2, 300 + i * 14, { align: 'center' }));
    Font.draw(g, `REACHED ROUND ${Math.min(this.round + 1, TOTAL_ROUNDS)}`, VW / 2, 180 + (title === 'CHAMPION!' ? 100 : 0), { align: 'center', color: '#bcbcbc' });
    if (this.t > 1.5) Font.draw(g, 'PRESS ENTER', VW / 2, 336, { align: 'center', color: '#f8b800' });
  }
}

// ---------- boot ----------
(() => {
  const canvas = document.getElementById('game');
  const game = new Game(canvas);
  window.game = game;
  const fit = () => {
    const s = Math.max(1, Math.min(innerWidth / VW, innerHeight / VH));
    const k = s >= 2 ? Math.floor(s) : s;
    canvas.style.width = `${VW * k}px`;
    canvas.style.height = `${VH * k}px`;
  };
  addEventListener('resize', fit); fit();
  const DT = 1 / 60;
  let last = performance.now(), acc = 0;
  function frame(now) {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    let steps = 0;
    while (acc >= DT && steps < 5) { game.update(DT); acc -= DT; steps++; }
    game.render(DT * Math.max(1, steps));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
