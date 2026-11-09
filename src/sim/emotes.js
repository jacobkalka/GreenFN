// Celebrations (cosmetic emotes) and the menu "showcase" controller.
import * as THREE from 'three';
import { clamp01, lerp, smoothstep, bell, rotateYaw } from '../core/math.js';
import { BallState } from './ball.js';
import { Handling } from './athlete.js';

const _t = new THREE.Vector3();

// Keyframes in chest space: [t, Lx, Ly, Lz, Rx, Ry, Rz] (x left, y up, z fwd); plus body params.
const EMOTES = {
  fist: {
    dur: 1.3,
    keys: [
      [0, 0.3, -0.45, 0.12, -0.3, -0.45, 0.12],
      [0.2, 0.3, -0.45, 0.15, -0.28, 0.35, 0.2],
      [0.38, 0.3, -0.45, 0.15, -0.22, -0.05, 0.32],
      [0.55, 0.3, -0.45, 0.15, -0.28, 0.32, 0.2],
      [0.75, 0.3, -0.45, 0.15, -0.22, -0.08, 0.32],
      [1, 0.3, -0.45, 0.12, -0.3, -0.45, 0.12],
    ],
    body: (an, u) => {
      an.crouch = 0.2 + 0.15 * Math.abs(Math.sin(u * Math.PI * 4)) * (1 - u);
    },
  },
  point: {
    dur: 1.4,
    keys: [
      [0, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
      [0.25, 0.3, -0.42, 0.1, -0.18, 0.75, 0.15],
      [0.8, 0.3, -0.42, 0.1, -0.18, 0.78, 0.15],
      [1, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
    ],
    body: (an, u) => {
      an.headPitch = -0.5 * bell(u);
    },
  },
  shrug: {
    dur: 1.3,
    keys: [
      [0, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
      [0.3, 0.5, -0.2, 0.3, -0.5, -0.2, 0.3],
      [0.75, 0.52, -0.18, 0.32, -0.52, -0.18, 0.32],
      [1, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
    ],
    body: (an, u) => {
      an.pelvisLift = 0.03 * bell(u);
      an.chestPitch = -0.1 * bell(u);
    },
  },
  flex: {
    dur: 1.4,
    keys: [
      [0, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
      [0.3, 0.42, 0.22, 0.05, -0.42, 0.22, 0.05],
      [0.8, 0.44, 0.24, 0.04, -0.44, 0.24, 0.04],
      [1, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
    ],
    body: (an, u) => {
      an.crouch = 0.3 * bell(u);
      an.chestPitch = 0.12 * bell(u);
    },
  },
  goggles: {
    dur: 1.4,
    keys: [
      [0, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
      [0.3, 0.06, 0.42, 0.24, -0.06, 0.42, 0.24],
      [0.8, 0.06, 0.43, 0.25, -0.06, 0.43, 0.25],
      [1, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
    ],
    body: (an, u) => {
      an.headPitch = 0.1 * bell(u);
    },
  },
  chest: {
    dur: 1.3,
    keys: [
      [0, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
      [0.2, 0.3, -0.45, 0.1, -0.02, 0.12, 0.42],
      [0.35, 0.3, -0.45, 0.1, -0.05, 0.1, 0.22],
      [0.5, 0.3, -0.45, 0.1, -0.02, 0.12, 0.42],
      [0.65, 0.3, -0.45, 0.1, -0.05, 0.1, 0.22],
      [1, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
    ],
    body: (an, u) => {
      an.chestPitch = -0.12 * bell(u);
    },
  },
  bow: {
    dur: 1.6,
    keys: [
      [0, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
      [0.3, 0.05, -0.05, 0.3, -0.45, -0.3, -0.05],
      [0.75, 0.05, -0.05, 0.3, -0.45, -0.3, -0.05],
      [1, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
    ],
    body: (an, u) => {
      an.spineBend = 0.75 * bell(u);
      an.headPitch = 0.35 * bell(u);
    },
  },
  ice: {
    dur: 1.5,
    keys: [
      [0, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
      [0.25, 0.12, -0.1, 0.45, -0.08, -0.02, 0.3],
      [0.45, 0.12, -0.1, 0.45, -0.1, -0.06, 0.36],
      [0.65, 0.12, -0.1, 0.45, -0.08, -0.02, 0.3],
      [0.85, 0.12, -0.1, 0.45, -0.1, -0.06, 0.36],
      [1, 0.3, -0.45, 0.1, -0.3, -0.45, 0.1],
    ],
    body: (an, u) => {
      an.headPitch = 0.2 * bell(u);
    },
  },
};

export const EMOTE_IDS = Object.keys(EMOTES);

export class EmoteAction {
  constructor(a, id) {
    this.a = a;
    this.id = EMOTES[id] ? id : 'fist';
    this.def = EMOTES[this.id];
    this.type = 'emote';
    this.locks = true;
    this.t = 0;
  }
  start() {
    const a = this.a;
    // holding the ball (locker preview): tuck it under the left arm
    if (a.hasBall()) {
      this.tuck = true;
      a.dribble.stop();
      a.game.ball.state = BallState.HELD;
      a.handling = Handling.TRIPLE;
    }
    a.events.emit('emote', { athlete: a, id: this.id });
  }
  update(dt) {
    const a = this.a;
    const an = a.anim;
    this.t += dt;
    const u = clamp01(this.t / this.def.dur);
    const ks = this.def.keys;
    let i = 0;
    while (i < ks.length - 2 && u > ks[i + 1][0]) i++;
    const k0 = ks[i];
    const k1 = ks[i + 1];
    const w = smoothstep(0, 1, (u - k0[0]) / Math.max(1e-4, k1[0] - k0[0]));
    an.arms = 'pose';
    an.poseL.set(lerp(k0[1], k1[1], w), lerp(k0[2], k1[2], w), lerp(k0[3], k1[3], w));
    an.poseR.set(lerp(k0[4], k1[4], w), lerp(k0[5], k1[5], w), lerp(k0[6], k1[6], w));
    an.poseFingerL.set(0.1, an.poseL.y > 0 ? 1 : -1, 0.3);
    an.poseFingerR.set(-0.1, an.poseR.y > 0 ? 1 : -1, 0.3);
    an.poseStiff = 9;
    an.lookAt = null;
    a.mods.allowMove = this.t > this.def.dur * 0.7;
    this.def.body(an, u);
    if (this.tuck && a.hasBall()) {
      rotateYaw(_t, 0.27, 0.06, a.yaw);
      an.ballPos.set(a.pos.x + _t.x, 1.02 + a.pos.y, a.pos.z + _t.z);
      an.poseL.set(0.3, -0.36, 0.14);
      an.poseFingerL.set(0, -1, 0.4);
    }
    return this.t < this.def.dur;
  }
}

/**
 * Menu showcase: dribbles in place with an athletic rhythm, throws in moves and the odd jumper.
 */
export class ShowcaseController {
  constructor() {
    this.athlete = null;
    this.t = 0;
    this.next = 1.2;
    this.step = 0;
    this.home = new THREE.Vector3(0, 0, 9.5);
    this.seq = ['cross', 'btl', 'hesi', 'btb', 'cross', 'spin', 'btl', 'pace', 'cross', 'stepback'];
  }
  update(dt) {
    const a = this.athlete;
    const inp = a.input;
    this.t += dt;
    inp.move.set(0, 0, 0);
    inp.sprint = false;
    // drift back home gently
    const dx = this.home.x - a.pos.x;
    const dz = this.home.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.6) inp.move.set(dx / d, 0, dz / d).multiplyScalar(Math.min(0.5, d * 0.3));
    else if (Math.sin(this.t * 0.6) > 0.6) inp.move.set(Math.sin(this.t * 0.9) * 0.35, 0, 0);
    if (this.t >= this.next) {
      this.next = this.t + 1.0 + Math.random() * 1.1;
      if (!a.hasBall()) return;
      if (a.handling === 'triple') {
        inp.move.set(0.2, 0, 0);
        return;
      }
      inp.move1 = this.seq[this.step++ % this.seq.length];
    }
  }
}
