'use strict';
// Web Audio synth: SFX, engine drones, and a procedural chiptune sequencer. No audio files.

const Audio2 = (() => {
  let ctx = null, master, musicBus, sfxBus, noiseBuf, pulse25, pulse12;
  let muted = false;
  const engines = [];

  function pulseWave(duty) {
    const N = 64, real = new Float32Array(N), imag = new Float32Array(N);
    for (let n = 1; n < N; n++) {
      real[n] = (2 / (n * Math.PI)) * Math.sin(2 * Math.PI * n * duty);
      imag[n] = (2 / (n * Math.PI)) * (1 - Math.cos(2 * Math.PI * n * duty));
    }
    return ctx.createPeriodicWave(real, imag);
  }

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
      musicBus = ctx.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
      sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      pulse25 = pulseWave(0.25); pulse12 = pulseWave(0.125);
      if (pendingSong) playMusic(pendingSong);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  }

  // ---------- primitive voices ----------
  function osc(type, f0, f1, t0, dur, vol, bus = sfxBus) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    if (type === 'p25') o.setPeriodicWave(pulse25);
    else if (type === 'p12') o.setPeriodicWave(pulse12);
    else o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(t0, dur, vol, filter = 'lowpass', f0 = 3000, f1 = f0, bus = sfxBus) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = filter;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02);
  }

  // ---------- SFX ----------
  const SFX = {
    missile: (t) => { noise(t, 0.45, 0.35, 'bandpass', 900, 3500); osc('sawtooth', 600, 200, t, 0.3, 0.12); },
    bomb: (t) => { osc('square', 400, 120, t, 0.18, 0.15); },
    explode: (t) => { noise(t, 0.8, 0.6, 'lowpass', 2500, 80); osc('triangle', 120, 30, t, 0.5, 0.4); },
    bump: (t) => { noise(t, 0.12, 0.35, 'lowpass', 600, 150); },
    pickup: (t) => [0, 4, 7, 12].forEach((n, i) => osc('p25', 523 * 2 ** (n / 12), 523 * 2 ** (n / 12), t + i * 0.05, 0.08, 0.12)),
    letter: (t) => [0, 7, 12, 16, 19].forEach((n, i) => osc('p25', 660 * 2 ** (n / 12), 660 * 2 ** (n / 12), t + i * 0.06, 0.1, 0.13)),
    upgrade: (t) => [0, 4, 7, 12, 7, 12, 16, 24].forEach((n, i) => osc('p25', 392 * 2 ** (n / 12), 392 * 2 ** (n / 12), t + i * 0.06, 0.1, 0.13)),
    splash: (t) => noise(t, 0.35, 0.3, 'highpass', 1500, 4000),
    slip: (t) => osc('sine', 900, 300, t, 0.4, 0.15),
    boost: (t) => { osc('sawtooth', 200, 900, t, 0.35, 0.12); noise(t, 0.35, 0.15, 'highpass', 2000, 6000); },
    jump: (t) => osc('square', 200, 500, t, 0.15, 0.08),
    land: (t) => noise(t, 0.15, 0.3, 'lowpass', 400, 100),
    stall: (t) => [0, 0.09, 0.18, 0.27].forEach((d) => osc('square', 90, 60, t + d, 0.06, 0.12)),
    count: (t) => osc('p25', 440, 440, t, 0.25, 0.18),
    go: (t) => osc('p25', 880, 880, t, 0.5, 0.18),
    lap: (t) => [0, 12].forEach((n, i) => osc('p25', 784 * 2 ** (n / 12), 784 * 2 ** (n / 12), t + i * 0.08, 0.12, 0.12)),
    move: (t) => osc('p25', 660, 660, t, 0.05, 0.08),
    ok: (t) => { osc('p25', 660, 660, t, 0.06, 0.1); osc('p25', 990, 990, t + 0.06, 0.1, 0.1); },
    deny: (t) => osc('square', 150, 110, t, 0.2, 0.12),
    cash: (t) => [0, 7, 12].forEach((n, i) => osc('triangle', 1046 * 2 ** (n / 12), 1046 * 2 ** (n / 12), t + i * 0.04, 0.12, 0.2)),
  };
  const lastPlayed = {};
  function sfx(name, vol = 1) {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    if (lastPlayed[name] && now - lastPlayed[name] < 0.04) return;
    lastPlayed[name] = now;
    SFX[name] && SFX[name](now);
  }

  // ---------- engine drones ----------
  function setEngine(i, speed01, on) {
    if (!ctx) return;
    let e = engines[i];
    if (!e) {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o1.type = 'sawtooth'; o2.setPeriodicWave(pulse25);
      f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(sfxBus);
      o1.start(); o2.start();
      e = engines[i] = { o1, o2, f, g };
    }
    const t = ctx.currentTime;
    const base = 55 + speed01 * 150 + i * 7;
    e.o1.frequency.setTargetAtTime(base, t, 0.05);
    e.o2.frequency.setTargetAtTime(base * 1.007 * 2, t, 0.05);
    e.f.frequency.setTargetAtTime(500 + speed01 * 1800, t, 0.05);
    e.g.gain.setTargetAtTime(on ? 0.05 + speed01 * 0.07 : 0, t, 0.08);
  }
  function stopEngines() { engines.forEach((e, i) => e && setEngine(i, 0, false)); }

  // ---------- music ----------
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10], mixo: [0, 2, 4, 5, 7, 9, 10],
  };
  const PROGS = [[0, 5, 3, 4], [0, 3, 4, 4], [0, 6, 5, 4], [0, 4, 5, 3], [5, 3, 0, 4], [0, 3, 0, 4], [3, 4, 0, 0], [0, 2, 3, 4]];
  const RHYTHMS = [ // 16-step cells, 1 = note onset
    [1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0], [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0],
    [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0], [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    [1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0], [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1],
  ];

  // Builds a 16-bar song (A A' B A) as step arrays of MIDI notes. Deterministic per seed.
  function makeSong(seed, mood = 'major', bpm = 150) {
    const r = makeRng(seed * 2654435761);
    const scale = SCALES[mood];
    const root = 45 + r.int(0, 7);
    const deg = (d, oct = 0) => root + 12 * (oct + Math.floor(d / 7)) + scale[((d % 7) + 7) % 7];
    const progA = r.pick(PROGS), progB = r.pick(PROGS.filter((p) => p !== progA));

    function motif(prog) {
      const notes = [];
      for (let bar = 0; bar < 2; bar++) {
        const rh = r.pick(RHYTHMS), chord = prog[bar];
        let cur = chord + r.pick([0, 2, 4, 7]);
        for (let s = 0; s < 16; s++) {
          if (!rh[s]) { notes.push(s % 4 === 0 && r() < 0.15 ? -1 : null); continue; }
          if (s % 4 === 0) cur = chord + r.pick([0, 2, 4, 7]); // chord tone on beats
          else cur += r.pick([-2, -1, -1, 1, 1, 2]);
          notes.push(deg(cur, 2));
        }
      }
      return notes;
    }
    const mA = motif(progA), mA2 = motif(progA), mB = motif(progB);
    const lead = [], bass = [], arp = [], drum = [];
    const sections = [[progA, mA, mA2], [progA, mA, mA], [progB, mB, mB], [progA, mA, mA2]];
    sections.forEach(([prog, m1, m2], si) => {
      for (let bar = 0; bar < 4; bar++) {
        const chord = prog[bar];
        const m = bar < 2 ? m1 : m2, mOff = (bar % 2) * 16;
        for (let s = 0; s < 16; s++) {
          lead.push(m[mOff + s]);
          bass.push(s % 2 === 0 ? deg(chord, s % 4 === 0 ? 0 : 1) - 12 : null);
          arp.push(si === 0 && bar < 2 ? null : deg(chord + [0, 2, 4, 7][s % 4], 1));
          const fill = bar === 3 && s >= 12;
          drum.push(s % 8 === 0 ? 'k' : s % 8 === 4 ? 's' : fill && s % 2 ? 's' : s % 2 === 0 ? 'h' : null);
        }
      }
    });
    return { bpm, lead, bass, arp, drum, len: lead.length };
  }

  let song = null, pendingSong = null, step = 0, nextTime = 0, timer = null;
  const mf = (m) => 440 * 2 ** ((m - 69) / 12);

  function schedule() {
    if (!song || !ctx) return;
    const stepDur = 60 / song.bpm / 4;
    while (nextTime < ctx.currentTime + 0.15) {
      const t = nextTime, i = step % song.len;
      const L = song.lead[i], B = song.bass[i], A = song.arp[i], D = song.drum[i];
      if (L > 0) {
        let n = 1; while (song.lead[(i + n) % song.len] === null && n < 4) n++;
        osc('p25', mf(L), mf(L), t, stepDur * n * 0.95, 0.16, musicBus);
      }
      if (B) osc('triangle', mf(B), mf(B), t, stepDur * 1.9, 0.38, musicBus);
      if (A) osc('p12', mf(A), mf(A), t, stepDur * 0.8, 0.045, musicBus);
      if (D === 'k') { osc('sine', 150, 40, t, 0.12, 0.5, musicBus); }
      else if (D === 's') noise(t, 0.12, 0.22, 'bandpass', 1800, 1200, musicBus);
      else if (D === 'h') noise(t, 0.03, 0.07, 'highpass', 7000, 7000, musicBus);
      nextTime += stepDur; step++;
    }
  }

  function playMusic(s) {
    pendingSong = s;
    if (!ctx) return;
    song = s; step = 0; nextTime = ctx.currentTime + 0.1;
    if (!timer) timer = setInterval(schedule, 30);
  }
  function stopMusic() { song = null; pendingSong = null; }

  return { unlock, sfx, setEngine, stopEngines, makeSong, playMusic, stopMusic, toggleMute, isMuted: () => muted };
})();
