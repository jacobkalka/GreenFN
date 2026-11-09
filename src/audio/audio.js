// Procedural audio: every sound is synthesized into AudioBuffers at startup (no audio files).
// Buses: master -> {sfx, ambience, ui}; sfx also feeds a synthetic arena reverb.
import { clamp, mulberry32 } from '../core/math.js';

function makeRng(seed) {
  return mulberry32(seed);
}

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.buffers = {};
    this.vol = { master: 0.8, sfx: 0.9, ambience: 0.55, ui: 0.7, muted: false };
    this.listener = { x: 0, z: 10, yaw: Math.PI };
    this.lastPlay = {};
    this.ambienceSrc = null;
    this.crowdLevel = 0.35;
  }

  /** Must be called from a user gesture (autoplay policy). Safe to call repeatedly. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.sfx = c.createGain();
    this.amb = c.createGain();
    this.ui = c.createGain();
    this.sfx.connect(this.master);
    this.amb.connect(this.master);
    this.ui.connect(this.master);
    // arena reverb
    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(1.6, 2.6);
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.22;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.sfx);
    this.applyVolumes();
    this._generate();
    this.ready = true;
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.vol.muted ? 0 : this.vol.master;
    this.master.gain.setTargetAtTime(m, t, 0.02);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.02);
    this.amb.gain.setTargetAtTime(this.vol.ambience, t, 0.05);
    this.ui.gain.setTargetAtTime(this.vol.ui, t, 0.02);
  }

  setListener(x, z, yaw) {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  // ------------------------------------------------------------------------------ synthesis
  _buf(dur, fn, seed = 1) {
    const c = this.ctx;
    const sr = c.sampleRate;
    const n = Math.max(1, Math.floor(dur * sr));
    const b = c.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    const rnd = makeRng(seed);
    fn(d, sr, rnd);
    // normalize to avoid clipping
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0.98) for (let i = 0; i < n; i++) d[i] *= 0.98 / peak;
    return b;
  }

  _impulse(dur, decay) {
    const c = this.ctx;
    const sr = c.sampleRate;
    const n = Math.floor(dur * sr);
    const b = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      const rnd = makeRng(11 + ch);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = (rnd() * 2 - 1) * Math.pow(1 - t / dur, decay) * (t < 0.012 ? t / 0.012 : 1) * 0.6;
      }
    }
    return b;
  }

  _generate() {
    const B = this.buffers;
    // dribble: low thump + ball cavity ring + contact click
    for (let v = 0; v < 4; v++) {
      B['dribble' + v] = this._buf(0.28, (d, sr, rnd) => {
        const f0 = 92 + v * 7;
        const ring = 620 + v * 45;
        let lp = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          const thump = Math.sin(2 * Math.PI * (f0 * t - 35 * t * t)) * Math.exp(-t * 26);
          const ping = Math.sin(2 * Math.PI * ring * t) * Math.exp(-t * 55) * 0.42;
          const ping2 = Math.sin(2 * Math.PI * ring * 1.52 * t) * Math.exp(-t * 80) * 0.18;
          const n = rnd() * 2 - 1;
          lp += (n - lp) * 0.35;
          const click = lp * Math.exp(-t * 180) * 0.5;
          d[i] = thump * 0.95 + ping + ping2 + click;
        }
      }, 20 + v);
    }
    // footsteps
    for (let v = 0; v < 3; v++) {
      B['step' + v] = this._buf(0.09, (d, sr, rnd) => {
        let lp = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          lp += ((rnd() * 2 - 1) - lp) * (0.12 + v * 0.03);
          d[i] = lp * Math.exp(-t * 60) * 1.6 + Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 50) * 0.3;
        }
      }, 40 + v);
    }
    // sneaker squeaks: chirpy narrow-band sweep with vibrato
    for (let v = 0; v < 4; v++) {
      B['squeak' + v] = this._buf(0.16 + v * 0.03, (d, sr, rnd) => {
        const base = 1900 + v * 420;
        const dur = d.length / sr;
        let ph = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          const u = t / dur;
          const f = base * (1 + 0.25 * Math.sin(Math.PI * u)) + Math.sin(2 * Math.PI * (70 + v * 9) * t) * 260;
          ph += (2 * Math.PI * f) / sr;
          const env = Math.min(1, t / 0.012) * Math.pow(1 - u, 1.4);
          d[i] = (Math.sin(ph) * 0.7 + Math.sin(ph * 2.01) * 0.18 + (rnd() - 0.5) * 0.12) * env;
        }
      }, 60 + v);
    }
    // rim clanks: inharmonic metallic partials
    for (let v = 0; v < 3; v++) {
      B['rim' + v] = this._buf(1.1, (d, sr, rnd) => {
        const f0 = 360 + v * 70;
        const parts = [
          [1, 1, 3.2],
          [2.33, 0.6, 4.5],
          [3.86, 0.45, 6],
          [5.41, 0.3, 7.5],
          [6.93, 0.2, 9],
        ];
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          let s = 0;
          for (const [r, a, k] of parts) s += Math.sin(2 * Math.PI * f0 * r * t + r) * a * Math.exp(-t * k);
          const hit = (rnd() * 2 - 1) * Math.exp(-t * 90) * 0.6;
          d[i] = s * 0.55 + hit;
        }
      }, 80 + v);
    }
    // backboard: dull thud + short glassy ring
    B.board = this._buf(0.45, (d, sr, rnd) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        lp += ((rnd() * 2 - 1) - lp) * 0.25;
        d[i] = Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t * 22) * 0.9 + lp * Math.exp(-t * 40) * 0.6 + Math.sin(2 * Math.PI * 930 * t) * Math.exp(-t * 30) * 0.18;
      }
    }, 90);
    // net swish
    B.swish = this._buf(0.5, (d, sr, rnd) => {
      let a = 0;
      let b = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const n = rnd() * 2 - 1;
        a += (n - a) * 0.55; // lowpass
        b = n - a; // highpass-ish
        const env = Math.min(1, t / 0.03) * Math.exp(-t * 7.5);
        d[i] = (b * 0.9 + a * 0.25) * env;
      }
    }, 91);
    // crowd cheer swell
    B.cheer = this._buf(2.6, (d, sr, rnd) => {
      let a = 0;
      let b = 0;
      const mods = [];
      for (let k = 0; k < 12; k++) mods.push([3 + rnd() * 6, rnd() * 6]);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const n = rnd() * 2 - 1;
        a += (n - a) * 0.12;
        b += (a - b) * 0.3;
        let m = 0;
        for (const [f, p] of mods) m += Math.sin(2 * Math.PI * f * t + p);
        const env = Math.min(1, t / 0.25) * Math.exp(-Math.max(0, t - 0.4) * 1.4);
        d[i] = (a - b * 0.6) * (0.75 + 0.25 * (m / mods.length)) * env * 2.2;
      }
    }, 92);
    // crowd "ooh"
    B.ooh = this._buf(1.3, (d, sr, rnd) => {
      let a = 0;
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        a += ((rnd() * 2 - 1) - a) * 0.08;
        const f = 260 - 60 * (t / 1.3);
        ph += (2 * Math.PI * f) / sr;
        const env = Math.min(1, t / 0.15) * Math.exp(-Math.max(0, t - 0.25) * 2.2);
        d[i] = (a * 1.6 * (0.6 + 0.4 * Math.sin(ph)) + Math.sin(ph) * 0.08) * env;
      }
    }, 93);
    // crowd ambience loop (murmur)
    B.crowdLoop = this._buf(6, (d, sr, rnd) => {
      let a = 0;
      let b = 0;
      const mods = [];
      for (let k = 0; k < 20; k++) mods.push([0.3 + rnd() * 2.5, rnd() * 6, rnd()]);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        a += ((rnd() * 2 - 1) - a) * 0.09;
        b += (a - b) * 0.25;
        let m = 0;
        for (const [f, p, w] of mods) m += Math.sin(2 * Math.PI * f * t + p) * w;
        // seamless loop: crossfade the edges
        const edge = Math.min(1, t / 0.3, (6 - t) / 0.3);
        d[i] = (a - b * 0.5) * (0.65 + 0.12 * m) * 1.4 * edge;
      }
    }, 94);
    // whistle
    B.whistle = this._buf(0.55, (d, sr, rnd) => {
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const f = 2850 + Math.sin(2 * Math.PI * 28 * t) * 120;
        ph += (2 * Math.PI * f) / sr;
        const am = 0.75 + 0.25 * Math.sin(2 * Math.PI * 30 * t);
        const env = Math.min(1, t / 0.02) * (t < 0.42 ? 1 : Math.max(0, 1 - (t - 0.42) / 0.12));
        d[i] = (Math.sin(ph) * 0.6 + (rnd() - 0.5) * 0.15) * am * env;
      }
    }, 95);
    // buzzer
    B.buzzer = this._buf(1.0, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const sq = (f) => (Math.sin(2 * Math.PI * f * t) > 0 ? 1 : -1);
        const env = Math.min(1, t / 0.01) * (t < 0.85 ? 1 : Math.max(0, 1 - (t - 0.85) / 0.15));
        d[i] = (sq(205) * 0.35 + sq(207.5) * 0.3 + Math.sin(2 * Math.PI * 410 * t) * 0.25) * env * 0.6;
      }
    }, 96);
    // shot clock beep
    B.beep = this._buf(0.12, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = Math.sin(2 * Math.PI * 1250 * t) * Math.min(1, t / 0.005) * Math.exp(-Math.max(0, t - 0.07) * 60) * 0.6;
      }
    }, 97);
    // green release chime
    B.green = this._buf(1.0, (d, sr) => {
      const notes = [1046.5, 1568, 2093];
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let s = 0;
        notes.forEach((f, k) => {
          const tt = t - k * 0.035;
          if (tt > 0) s += Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * (4 + k)) * (0.5 - k * 0.1);
        });
        d[i] = s * Math.min(1, t / 0.004);
      }
    }, 98);
    // ordinary release tick
    B.release = this._buf(0.06, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = Math.sin(2 * Math.PI * 520 * t) * Math.exp(-t * 70) * 0.4;
      }
    }, 99);
    // whoosh (steal swipe / spin)
    B.whoosh = this._buf(0.32, (d, sr, rnd) => {
      let a = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const k = 0.05 + 0.4 * Math.sin((Math.PI * t) / 0.32);
        a += ((rnd() * 2 - 1) - a) * k;
        d[i] = a * Math.sin((Math.PI * t) / 0.32) * 1.2;
      }
    }, 100);
    // block slap
    B.slap = this._buf(0.25, (d, sr, rnd) => {
      let a = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        a += ((rnd() * 2 - 1) - a) * 0.6;
        d[i] = a * Math.exp(-t * 45) + Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 30) * 0.5;
      }
    }, 101);
    // ui
    B.uiHover = this._buf(0.035, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = Math.sin(2 * Math.PI * 2200 * t) * Math.exp(-t * 140) * 0.25;
      }
    }, 102);
    B.uiClick = this._buf(0.07, (d, sr) => {
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        ph += (2 * Math.PI * (900 + 900 * (t / 0.07))) / sr;
        d[i] = Math.sin(ph) * Math.exp(-t * 55) * 0.45;
      }
    }, 103);
    B.uiBack = this._buf(0.07, (d, sr) => {
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        ph += (2 * Math.PI * (1500 - 700 * (t / 0.07))) / sr;
        d[i] = Math.sin(ph) * Math.exp(-t * 55) * 0.4;
      }
    }, 104);
    B.purchase = this._buf(0.7, (d, sr) => {
      const notes = [784, 1046.5, 1318.5, 1568];
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let s = 0;
        notes.forEach((f, k) => {
          const tt = t - k * 0.07;
          if (tt > 0) s += Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 6) * 0.3;
        });
        d[i] = s;
      }
    }, 105);
    B.error = this._buf(0.18, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = (Math.sin(2 * Math.PI * 180 * t) > 0 ? 0.3 : -0.3) * Math.exp(-t * 14);
      }
    }, 106);
    B.levelup = this._buf(1.2, (d, sr) => {
      const notes = [523, 659, 784, 1046.5, 1318.5];
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let s = 0;
        notes.forEach((f, k) => {
          const tt = t - k * 0.09;
          if (tt > 0) s += (Math.sin(2 * Math.PI * f * tt) + 0.3 * Math.sin(4 * Math.PI * f * tt)) * Math.exp(-tt * 3.5) * 0.22;
        });
        d[i] = s;
      }
    }, 107);
  }

  // ------------------------------------------------------------------------------ playback
  /**
   * Play a sound. opts: { vol, rate, x, z (world position for panning/attenuation), bus, cooldown, reverb }
   */
  play(name, opts = {}) {
    if (!this.ready || this.vol.muted) return;
    const buf = this.buffers[name];
    if (!buf) return;
    const c = this.ctx;
    const now = c.currentTime;
    const cd = opts.cooldown ?? 0.03;
    if (this.lastPlay[name] && now - this.lastPlay[name] < cd) return;
    this.lastPlay[name] = now;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const g = c.createGain();
    let vol = opts.vol ?? 1;
    let pan = 0;
    if (opts.x !== undefined) {
      // listener-relative stereo pan + distance attenuation
      const L = this.listener;
      const dx = opts.x - L.x;
      const dz = opts.z - L.z;
      const dist = Math.hypot(dx, dz);
      const rx = -Math.cos(L.yaw);
      const rz = Math.sin(L.yaw);
      pan = clamp(((dx * rx + dz * rz) / Math.max(1, dist)) * 0.8, -0.85, 0.85);
      vol *= 1 / (1 + Math.max(0, dist - 4) * 0.09);
    }
    g.gain.value = vol;
    let node = src;
    node.connect(g);
    if (c.createStereoPanner && pan !== 0) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      node = p;
    } else node = g;
    const bus = opts.bus === 'ui' ? this.ui : opts.bus === 'amb' ? this.amb : this.sfx;
    node.connect(bus);
    if (opts.bus !== 'ui' && opts.reverb !== false) node.connect(this.reverbSend);
    src.start();
    return src;
  }

  startAmbience() {
    if (!this.ready || this.ambienceSrc) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.buffers.crowdLoop;
    src.loop = true;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(g);
    g.connect(this.amb);
    src.start();
    this.ambienceSrc = src;
    this.ambienceGain = g;
    this.setCrowd(this.crowdLevel);
  }

  stopAmbience() {
    if (!this.ambienceSrc) return;
    const t = this.ctx.currentTime;
    this.ambienceGain.gain.setTargetAtTime(0, t, 0.3);
    const s = this.ambienceSrc;
    setTimeout(() => {
      try {
        s.stop();
      } catch (e) {
        /* already stopped */
      }
    }, 1500);
    this.ambienceSrc = null;
  }

  setCrowd(level) {
    this.crowdLevel = level;
    if (this.ambienceGain) this.ambienceGain.gain.setTargetAtTime(0.18 + level * 0.5, this.ctx.currentTime, 0.4);
  }
}

/**
 * Connect simulation events to sounds. Returns an unsubscribe function.
 */
export function bindGameAudio(audio, events, getUser) {
  const offs = [];
  const on = (t, f) => offs.push(events.on(t, f));
  let dv = 0;
  on('ball:impact', (e) => {
    const imp = e.impact;
    if (e.surface === 'floor') {
      const name = 'dribble' + (dv++ % 4);
      audio.play(name, { x: e.x, z: e.z, vol: clamp(imp / 6, 0.15, 1) * (e.dribble ? 0.8 : 1), rate: 0.94 + Math.random() * 0.12, cooldown: 0.02 });
    } else if (e.surface === 'rim') {
      audio.play('rim' + Math.floor(Math.random() * 3), { x: e.x, z: e.z, vol: clamp(imp / 6, 0.2, 1), rate: 0.95 + Math.random() * 0.1, cooldown: 0.05 });
    } else if (e.surface === 'board') {
      audio.play('board', { x: e.x, z: e.z, vol: clamp(imp / 7, 0.25, 1), rate: 0.95 + Math.random() * 0.1 });
    } else if (e.surface === 'support' || e.surface === 'pad') {
      audio.play('board', { x: e.x, z: e.z, vol: clamp(imp / 8, 0.15, 0.7), rate: 0.7 });
    } else if (e.surface === 'body') {
      audio.play('step0', { x: e.x, z: e.z, vol: 0.6, rate: 0.6 });
    }
  });
  let sv = 0;
  on('foot:plant', (e) => {
    if (e.intensity < 0.2) return;
    audio.play('step' + (sv++ % 3), { x: e.x, z: e.z, vol: 0.12 + e.intensity * 0.25, rate: 0.9 + Math.random() * 0.2, cooldown: 0.015 });
  });
  let qv = 0;
  on('athlete:plant', (e) => {
    if (Math.random() < 0.85) audio.play('squeak' + (qv++ % 4), { x: e.athlete.pos.x, z: e.athlete.pos.z, vol: clamp(e.speed / 6, 0.25, 0.75), rate: 0.9 + Math.random() * 0.25, cooldown: 0.12 });
  });
  on('move:start', (e) => {
    if ((e.id === 'cross' || e.id === 'spin' || e.id === 'stepback' || e.id === 'burst') && Math.random() < 0.7)
      audio.play('squeak' + (qv++ % 4), { x: e.athlete.pos.x, z: e.athlete.pos.z, vol: 0.45, rate: 1 + Math.random() * 0.2, cooldown: 0.15 });
    if (e.id === 'spin') audio.play('whoosh', { x: e.athlete.pos.x, z: e.athlete.pos.z, vol: 0.35, rate: 1.3 });
  });
  on('athlete:land', (e) => {
    if (e.speed > 2) audio.play('step1', { x: e.athlete.pos.x, z: e.athlete.pos.z, vol: clamp(e.speed / 5, 0.3, 0.9), rate: 0.75 });
  });
  on('ball:rimEnter', (e) => {
    audio.play('swish', { x: 0, z: 0, vol: e.ball.touchedRim ? 0.55 : 0.95, rate: 0.95 + Math.random() * 0.1 });
  });
  on('steal:attempt', (e) => audio.play('whoosh', { x: e.athlete.pos.x, z: e.athlete.pos.z, vol: 0.4 }));
  on('steal', (e) => {
    audio.play('slap', { x: e.athlete.pos.x, z: e.athlete.pos.z, vol: 0.7 });
    audio.play('ooh', { vol: 0.5, bus: 'amb' });
  });
  on('block', (e) => {
    audio.play('slap', { x: e.athlete.pos.x, z: e.athlete.pos.z, vol: 1 });
    audio.play('ooh', { vol: 0.8, bus: 'amb', cooldown: 0.5 });
  });
  on('ankles', () => audio.play('ooh', { vol: 0.9, bus: 'amb', cooldown: 0.5 }));
  on('dunk', () => audio.play('rim0', { x: 0, z: 0, vol: 1, rate: 0.8 }));
  on('rules:score', (e) => {
    const user = getUser();
    const big = e.value === 2 || (e.shot && e.shot.kind === 'dunk');
    audio.play('cheer', { vol: (e.athlete === user ? 0.85 : 0.45) * (big ? 1 : 0.7), bus: 'amb', rate: 0.95 + Math.random() * 0.1, cooldown: 0.4 });
  });
  on('rules:shotclockWarn', () => audio.play('beep', { vol: 0.55, bus: 'ui' }));
  on('rules:state', (e) => {
    if (e.state === 'live') audio.play('whistle', { vol: 0.45, reverb: true, cooldown: 0.5 });
    if (e.state === 'dead' && (e.reason === 'Shot clock violation' || e.reason === 'Out of bounds' || e.reason === 'Ball not cleared')) audio.play('whistle', { vol: 0.5, rate: 0.95 });
  });
  on('rules:over', () => audio.play('buzzer', { vol: 0.6 }));
  return () => offs.forEach((f) => f());
}
