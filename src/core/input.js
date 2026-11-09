// Keyboard + gamepad input. Produces an Intent for the user's athlete each simulation tick.
// Edge-triggered presses are queued and consumed exactly once (robust to multiple ticks per frame).
import { clamp } from './math.js';

export const MOVE_KEYS = {
  KeyJ: 'cross',
  KeyK: 'btl',
  KeyL: 'btb',
  KeyU: 'spin',
  KeyI: 'hesi',
  KeyO: 'stepback',
  KeyH: 'burst',
  KeyN: 'pace',
};

export const MOVE_LABELS = {
  cross: 'Crossover',
  btl: 'Between the Legs',
  btb: 'Behind the Back',
  spin: 'Spin Move',
  hesi: 'Hesitation',
  stepback: 'Stepback',
  burst: 'Quick First Step',
  pace: 'Change of Pace',
};

export const MOVE_KEY_LABEL = { cross: 'J', btl: 'K', btb: 'L', spin: 'U', hesi: 'I', stepback: 'O', burst: 'H', pace: 'N' };

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = [];
    this.released = [];
    this.enabled = true;
    this.listeners = [];
    this.gamepadIndex = -1;
    this.padPrev = [];
    this.padStickPrev = { x: 0, y: 0, mag: 0 };
    this.padFlickCooldown = 0;
    this.lastDevice = 'keyboard';
    this.rotAccum = 0;
    this.prevAngle = null;
    this.onKey = null; // global UI hook (pause etc.)
    const kd = (e) => {
      if (e.repeat) return;
      if (this.onKey && this.onKey(e) === true) return;
      if (!this.enabled) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.down.add(e.code);
      this.pressed.push(e.code);
      this.lastDevice = 'keyboard';
    };
    const ku = (e) => {
      this.down.delete(e.code);
      this.released.push(e.code);
    };
    const blur = () => {
      for (const c of this.down) this.released.push(c);
      this.down.clear();
    };
    target.addEventListener('keydown', kd);
    target.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    this.listeners.push(['keydown', kd], ['keyup', ku]);
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = -1;
    });
  }

  clearAll() {
    this.down.clear();
    this.pressed.length = 0;
    this.released.length = 0;
  }

  _pad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.gamepadIndex >= 0 && pads[this.gamepadIndex]) return pads[this.gamepadIndex];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /**
   * Fill `intent` for this tick.
   * camYaw: camera facing yaw (yaw 0 = +Z). ctx: { offense: bool }
   */
  sample(intent, camYaw, ctx, dt) {
    let mx = 0;
    let my = 0;
    const d = this.down;
    if (this.enabled) {
      if (d.has('KeyW') || d.has('ArrowUp')) my += 1;
      if (d.has('KeyS') || d.has('ArrowDown')) my -= 1;
      if (d.has('KeyD') || d.has('ArrowRight')) mx += 1;
      if (d.has('KeyA') || d.has('ArrowLeft')) mx -= 1;
    }
    let sprint = d.has('ShiftLeft') || d.has('ShiftRight');
    let shoot = d.has('Space');
    let move1 = null;
    let steal = false;
    let jump = false;
    let emote = false;
    let shootPressed = false;
    let shootReleased = false;
    for (const c of this.pressed) {
      if (c === 'Space') shootPressed = true;
      if (MOVE_KEYS[c]) {
        if (ctx.offense) move1 = MOVE_KEYS[c];
        else if (c === 'KeyJ') steal = true;
        else if (c === 'KeyK') jump = true;
      }
      if (c === 'KeyT') emote = true;
    }
    for (const c of this.released) if (c === 'Space') shootReleased = true;
    this.pressed.length = 0;
    this.released.length = 0;

    // ---------------------------------------------------------------- gamepad
    const pad = this._pad();
    if (pad && this.enabled) {
      const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
      const bp = (i) => b(i) && !this.padPrev[i];
      const br = (i) => !b(i) && this.padPrev[i];
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      const lx = dz(pad.axes[0] || 0);
      const ly = dz(pad.axes[1] || 0);
      if (Math.abs(lx) + Math.abs(ly) > 0) {
        mx = lx;
        my = -ly;
        this.lastDevice = 'gamepad';
      }
      if (b(7) || b(5)) sprint = true;
      if (b(0)) shoot = true;
      if (bp(0)) shootPressed = true;
      if (br(0)) shootReleased = true;
      if (ctx.offense) {
        if (bp(2)) move1 = 'hesi';
        if (bp(1)) move1 = 'spin';
        if (bp(3)) move1 = 'stepback';
        if (bp(4)) move1 = 'btb';
        if (bp(6)) move1 = 'pace';
      } else {
        if (bp(2)) steal = true;
        if (bp(3) || bp(1)) jump = true;
      }
      // right stick "pro stick" flicks
      const rx = dz(pad.axes[2] || 0);
      const ry = dz(pad.axes[3] || 0);
      const mag = Math.hypot(rx, ry);
      this.padFlickCooldown -= dt;
      if (ctx.offense && mag > 0.85 && this.padStickPrev.mag < 0.5 && this.padFlickCooldown <= 0) {
        const ang = Math.atan2(rx, -ry); // 0 = up
        const a = Math.abs(ang);
        if (a < 0.6) move1 = 'burst';
        else if (a > 2.5) move1 = 'stepback';
        else if (a > 1.9) move1 = 'btl';
        else move1 = 'cross';
        intent.flickSide = rx > 0 ? -1 : 1;
        this.padFlickCooldown = 0.2;
      }
      this.padStickPrev.x = rx;
      this.padStickPrev.y = ry;
      this.padStickPrev.mag = mag;
      for (let i = 0; i < pad.buttons.length; i++) this.padPrev[i] = b(i);
    }

    // camera-relative world move vector. The control frame is locked while a direction is held so
    // paths don't curve as the follow camera rotates; it re-syncs when the input changes.
    if (this.ctrlYaw === undefined) this.ctrlYaw = camYaw;
    const changed = Math.abs(mx - (this._lmx || 0)) > 0.35 || Math.abs(my - (this._lmy || 0)) > 0.35;
    if (changed || (mx === 0 && my === 0)) this.ctrlYaw = camYaw;
    else {
      let d = camYaw - this.ctrlYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.ctrlYaw += d * Math.min(1, dt * 0.6);
    }
    this._lmx = mx;
    this._lmy = my;
    camYaw = this.ctrlYaw;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const fx = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    // right = (-cos, 0, sin)
    intent.move.set(fx * my - Math.cos(camYaw) * mx, 0, fz * my + Math.sin(camYaw) * mx);
    intent.sprint = sprint;
    intent.shoot = shoot;
    intent.shootPressed = intent.shootPressed || shootPressed;
    intent.shootReleased = intent.shootReleased || shootReleased;
    if (move1) intent.move1 = move1;
    if (steal) intent.steal = true;
    if (jump) intent.jump = true;
    if (emote) intent.emote = true;
    // on defense / loose ball, Space is jump (contest / rebound)
    if (!ctx.offense && shootPressed) intent.jump = true;
  }
}
