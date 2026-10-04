'use strict';
// Keyboard + Gamepad. Input.player(i) returns {steer, gas, brake, missile, bomb} for player slot i.
// Input.menu() returns edge-triggered menu actions merged from every device.

const Input = (() => {
  const down = new Set();
  const pressed = new Set(); // keys pressed since last frame
  let twoPlayer = false;

  addEventListener('keydown', (e) => {
    if (!down.has(e.code)) pressed.add(e.code);
    down.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    Audio2.unlock();
  });
  addEventListener('keyup', (e) => down.delete(e.code));
  addEventListener('blur', () => down.clear());
  addEventListener('pointerdown', () => Audio2.unlock());

  const KEYS = {
    p1: { left: ['KeyA'], right: ['KeyD'], gas: ['KeyW'], brake: ['KeyS'], missile: ['KeyF'], bomb: ['KeyG'] },
    p2: { left: ['ArrowLeft'], right: ['ArrowRight'], gas: ['ArrowUp'], brake: ['ArrowDown'],
          missile: ['Slash', 'Numpad1', 'Enter'], bomb: ['Period', 'Numpad2', 'ShiftRight'] },
    solo: { left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], gas: ['KeyW', 'ArrowUp', 'KeyZ'],
            brake: ['KeyS', 'ArrowDown', 'KeyX'], missile: ['Space', 'KeyF', 'KeyC'], bomb: ['ShiftLeft', 'ShiftRight', 'KeyG', 'KeyV'] },
  };
  const any = (codes) => codes.some((c) => down.has(c));
  const anyPressed = (codes) => codes.some((c) => pressed.has(c));

  let pads = [], prevPadButtons = [];
  function pollPads() {
    pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter((p) => p && p.connected);
  }
  const btn = (p, i) => !!(p && p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5));
  const padPressed = (pi, i) => btn(pads[pi], i) && !(prevPadButtons[pi] && prevPadButtons[pi][i]);

  // Which gamepad drives player slot i.
  function padFor(i) {
    if (!twoPlayer) return i === 0 ? 0 : -1;
    if (pads.length >= 2) return i;
    return i === 1 ? 0 : -1; // one pad in 2P: P2 gets it, P1 uses keyboard
  }

  function player(i) {
    const k = twoPlayer ? (i === 0 ? KEYS.p1 : KEYS.p2) : KEYS.solo;
    let steer = (any(k.right) ? 1 : 0) - (any(k.left) ? 1 : 0);
    let gas = any(k.gas), brake = any(k.brake);
    let missile = anyPressed(k.missile), bomb = anyPressed(k.bomb);
    const pi = padFor(i), p = pads[pi];
    if (p) {
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.25) steer = clamp(ax * 1.3, -1, 1);
      if (btn(p, 14)) steer = -1;
      if (btn(p, 15)) steer = 1;
      gas = gas || btn(p, 0) || btn(p, 7);
      brake = brake || btn(p, 1) || btn(p, 6);
      missile = missile || padPressed(pi, 2) || padPressed(pi, 5);
      bomb = bomb || padPressed(pi, 3) || padPressed(pi, 4);
    }
    return { steer, gas, brake, missile, bomb };
  }

  function menu() {
    const r = {
      up: anyPressed(['ArrowUp', 'KeyW']), down: anyPressed(['ArrowDown', 'KeyS']),
      left: anyPressed(['ArrowLeft', 'KeyA']), right: anyPressed(['ArrowRight', 'KeyD']),
      ok: anyPressed(['Enter', 'Space', 'KeyZ', 'NumpadEnter']), back: anyPressed(['Escape', 'Backspace', 'KeyX']),
      pause: anyPressed(['Escape', 'KeyP']), mute: anyPressed(['KeyM']),
    };
    pads.forEach((p, pi) => {
      const ay = p.axes[1] || 0, ax = p.axes[0] || 0, prev = prevPadButtons[pi];
      const prevAy = prev ? prev.ay : 0, prevAx = prev ? prev.ax : 0;
      r.up = r.up || padPressed(pi, 12) || (ay < -0.6 && prevAy >= -0.6);
      r.down = r.down || padPressed(pi, 13) || (ay > 0.6 && prevAy <= 0.6);
      r.left = r.left || padPressed(pi, 14) || (ax < -0.6 && prevAx >= -0.6);
      r.right = r.right || padPressed(pi, 15) || (ax > 0.6 && prevAx <= 0.6);
      r.ok = r.ok || padPressed(pi, 0) || padPressed(pi, 9);
      r.back = r.back || padPressed(pi, 1);
      r.pause = r.pause || padPressed(pi, 9);
    });
    return r;
  }

  // Call once per frame after game logic has read input.
  function endFrame() {
    pressed.clear();
    prevPadButtons = pads.map((p) => Object.assign(p.buttons.map((b) => b.pressed || b.value > 0.5), { ax: p.axes[0] || 0, ay: p.axes[1] || 0 }));
  }

  return {
    pollPads, player, menu, endFrame,
    setTwoPlayer: (v) => (twoPlayer = v),
    padCount: () => pads.length,
  };
})();
