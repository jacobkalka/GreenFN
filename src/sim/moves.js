// Dribble moves. Each move redirects the ball through the dribble controller (real bounce paths or
// carried wrap paths), drives posture/footwork, and applies root motion that actually changes the
// ball handler's position, speed and direction. Moves chain inside a window, cost stamina, and lose
// effectiveness when spammed.
import * as THREE from 'three';
import { makeSpec } from './dribble.js';
import { Handling } from './athlete.js';
import { clamp, clamp01, lerp, smoothstep, bell, rotateYaw, easeInOut } from '../core/math.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** World direction of the body-local vector (x left, z fwd). */
function bodyDir(out, a, x, z) {
  rotateYaw(out, x, z, a.yaw);
  out.y = 0;
  return out.normalize();
}

/** Input direction if held, else `fallback` (world). */
function inputDir(out, a, fallback) {
  const m = a.input.move;
  if (m.lengthSq() > 0.05) return out.set(m.x, 0, m.z).normalize();
  return out.copy(fallback);
}

function addImpulse(a, dir, mag) {
  a.impulse.addScaledVector(dir, mag);
}

export const MOVES = {
  cross: {
    name: 'Crossover',
    T: 0.32,
    recover: 0.1,
    chainFrom: 0.55,
    shootFrom: 0.7,
    cost: 0.02,
    fake: 0.55,
    switches: true,
    spec: (m, a) => ({
      name: 'cross',
      catchHand: -m.hand0,
      catchLocal: V(-m.hand0 * 0.32, 0.8, 0.24),
      uCatch: 2.5,
      contactDur: 0.085,
      maxRel: 6,
      steer: 16,
    }),
    begin(m, a) {
      bodyDir(_v, a, -m.hand0, 0.25);
      if (a.input.move.lengthSq() > 0.05) _v.lerp(_w.set(a.input.move.x, 0, a.input.move.z).normalize(), 0.45).normalize();
      m.impDir.copy(_v);
    },
    apply(m, a, u, dt) {
      const an = a.anim;
      const b = bell(u);
      an.leanS += -m.hand0 * 0.24 * b;
      an.crouch += 0.13 * b;
      an.chestYaw += m.hand0 * 0.22 * b;
      an.stanceWidth = 0.5;
      if (m.once(0.22)) addImpulse(a, m.impDir, 2.6 * m.power);
      if (u > 0.2) a.mods.accelMul = 1.6;
    },
  },

  btl: {
    name: 'Between the Legs',
    T: 0.4,
    recover: 0.1,
    chainFrom: 0.5,
    shootFrom: 0.65,
    cost: 0.022,
    fake: 0.35,
    switches: true,
    spec: (m, a) => ({
      name: 'btl',
      catchHand: -m.hand0,
      releaseLocal: V(m.hand0 * 0.24, 0.6, 0.24),
      catchLocal: V(-m.hand0 * 0.3, 0.72, -0.08),
      uCatch: 2.1,
      contactDur: 0.1,
      maxRel: 5,
      steer: 12,
    }),
    begin(m, a) {
      // receiving-side foot steps forward to make the bridge
      const g = a.animator.gait;
      const f = -m.hand0 > 0 ? g.L : g.R;
      rotateYaw(_v, -m.hand0 * 0.19, 0.42, a.yaw);
      _v.x += a.pos.x + a.vel.x * 0.18;
      _v.z += a.pos.z + a.vel.z * 0.18;
      _v.y = 0;
      g.forceStep(f, _v, a.yaw + f.side * 0.1, 0.17, 0.08);
      bodyDir(m.impDir, a, -m.hand0 * 0.4, 1);
    },
    apply(m, a, u, dt) {
      const an = a.anim;
      const b = bell(u);
      an.crouch = Math.max(an.crouch, 0.5 * b + 0.3);
      an.stagger = -m.hand0 * 0.5;
      an.stanceWidth = 0.42;
      an.spineBend += 0.1 * b;
      a.mods.speedMul = 0.7;
      if (m.once(0.3)) addImpulse(a, m.impDir, 0.9 * m.power);
    },
  },

  btb: {
    name: 'Behind the Back',
    T: 0.42,
    recover: 0.12,
    chainFrom: 0.55,
    shootFrom: 0.7,
    cost: 0.025,
    fake: 0.45,
    switches: true,
    spec: (m, a) => ({
      name: 'btb',
      catchHand: -m.hand0,
      carry: [
        { t: 0, x: 0, y: 0, z: 0 },
        { t: 0.45, x: m.hand0 * 0.2, y: 0.84, z: -0.2 },
        { t: 1, x: -m.hand0 * 0.04, y: 0.78, z: -0.3 },
      ],
      palmLocal: V(m.hand0 * 0.7, 0.25, -0.35),
      catchLocal: V(-m.hand0 * 0.34, 0.84, 0.22),
      uCatch: 1.9,
      contactDur: 0.2,
      maxRel: 5,
      steer: 14,
    }),
    begin(m, a) {
      bodyDir(_v, a, -m.hand0, 0.5);
      if (a.input.move.lengthSq() > 0.05) _v.lerp(_w.set(a.input.move.x, 0, a.input.move.z).normalize(), 0.5).normalize();
      m.impDir.copy(_v);
    },
    apply(m, a, u, dt) {
      const an = a.anim;
      const b = bell(u);
      an.chestYaw += -m.hand0 * 0.4 * b;
      an.hipYaw += -m.hand0 * 0.15 * b;
      an.leanS += -m.hand0 * 0.16 * b;
      an.crouch += 0.08 * b;
      if (m.once(0.4)) addImpulse(a, m.impDir, 2.2 * m.power);
      if (u > 0.35) a.mods.accelMul = 1.4;
    },
  },

  spin: {
    name: 'Spin Move',
    T: 0.56,
    recover: 0.12,
    chainFrom: 0.72,
    shootFrom: 0.85,
    cost: 0.04,
    fake: 0.6,
    switches: true,
    spec: (m, a) => ({
      name: 'spin',
      catchHand: -m.hand0,
      carry: [
        { t: 0, x: 0, y: 0, z: 0 },
        { t: 0.25, x: m.hand0 * 0.38, y: 0.96, z: 0.02 },
        { t: 0.85, x: m.hand0 * 0.36, y: 0.94, z: -0.06 },
        { t: 1, x: m.hand0 * 0.3, y: 0.86, z: 0.05 },
      ],
      palmLocal: V(m.hand0 * 0.85, 0.35, -0.15),
      catchLocal: V(-m.hand0 * 0.32, 0.86, 0.3),
      uCatch: 1.7,
      contactDur: 0.48,
      maxRel: 5,
      steer: 14,
    }),
    begin(m, a) {
      m.spinSide = -m.hand0; // spin toward the off hand
      m.yaw0 = a.yaw;
      // travel: around the defender toward the spin side and forward
      bodyDir(_v, a, m.spinSide * 1.0, 0.65);
      m.impDir.copy(_v);
      m.speed0 = Math.max(2.4, Math.min(4.2, a.speedNow + 1.2));
    },
    apply(m, a, u, dt) {
      const an = a.anim;
      const k = easeInOut(clamp01(u / 0.92));
      a.mods.yawOverride = m.yaw0 + m.spinSide * Math.PI * 2 * k;
      a.mods.velOverride = _w.copy(m.impDir).multiplyScalar(m.speed0 * m.power * (0.6 + 0.4 * bell(u)));
      an.lockFoot = u < 0.75 ? m.spinSide : 0;
      an.crouch = 0.42;
      an.stanceWidth = 0.4;
      an.leanF += 0.1;
      an.lookAt = null;
    },
  },

  hesi: {
    name: 'Hesitation',
    T: 0.62,
    recover: 0.08,
    chainFrom: 0.42,
    shootFrom: 0.22,
    cost: 0.02,
    fake: 0.7,
    switches: false,
    spec: (m, a) => ({
      name: 'hesi',
      catchLocal: V(m.hand0 * 0.3, 1.04, 0.24),
      uCatch: 0.85,
      contactDur: 0.22,
    }),
    begin(m, a) {
      bodyDir(_v, a, 0, 1);
      m.goDir.copy(_v);
    },
    apply(m, a, u, dt) {
      const an = a.anim;
      if (u < 0.5) {
        const k = smoothstep(0, 0.3, u);
        a.mods.speedMul = lerp(1, 0.12, k);
        a.mods.accelMul = 1.4;
        an.crouch = lerp(an.crouch, 0.06, k);
        an.headPitch -= 0.14 * k;
        an.chestPitch -= 0.1 * k;
        an.pelvisLift += 0.035 * k;
        an.leanF -= 0.08 * k;
      } else {
        if (m.once(0.5)) {
          inputDir(_v, a, m.goDir);
          m.goDir.copy(_v);
          addImpulse(a, m.goDir, 2.9 * m.power);
          m.a.events.emit('move:go', { athlete: a, move: m });
        }
        a.mods.accelMul = 2.0;
        a.mods.speedMul = 1.1;
        an.leanF += 0.22 * bell((u - 0.5) * 2);
        an.crouch += 0.1;
      }
    },
  },

  stepback: {
    name: 'Stepback',
    T: 0.5,
    recover: 0.08,
    chainFrom: 0.62,
    shootFrom: 0.42,
    cost: 0.035,
    fake: 0.45,
    switches: false,
    spec: (m, a) => ({
      name: 'stepback',
      catchLocal: V(m.hand0 * 0.3, 0.88, 0.16),
      uCatch: 2.3,
      contactDur: 0.09,
    }),
    begin(m, a) {
      // hop away from the defender (or straight back from the facing direction)
      const d = a.opponent;
      if (d && d.pos.distanceTo(a.pos) < 3) _v.set(a.pos.x - d.pos.x, 0, a.pos.z - d.pos.z).normalize();
      else bodyDir(_v, a, 0, -1);
      // keep it mostly "back" relative to the rim line so it creates shooting space
      bodyDir(_w, a, 0, -1);
      m.impDir.copy(_v.lerp(_w, 0.5).normalize());
    },
    apply(m, a, u, dt) {
      const an = a.anim;
      if (u < 0.16) {
        a.mods.speedMul = 0;
        a.mods.accelMul = 2.2;
        an.crouch += 0.15 * (u / 0.16);
        an.leanF += 0.12;
      }
      if (m.once(0.16)) {
        a.vel.x *= 0.2;
        a.vel.z *= 0.2;
        addImpulse(a, m.impDir, 3.9 * m.power);
        a.jump(1.35);
        a.stepbackT = a.game.time;
      }
      if (u >= 0.16) {
        a.mods.allowMove = false;
        an.crouch = a.grounded ? 0.42 : 0.12;
        an.airTuck = a.grounded ? 0 : 0.15;
        an.leanF -= 0.12 * bell((u - 0.16) / 0.84);
      }
    },
  },

  burst: {
    name: 'Quick First Step',
    T: 0.46,
    recover: 0.12,
    chainFrom: 0.7,
    shootFrom: 0.8,
    cost: 0.05,
    fake: 0.3,
    switches: false,
    spec: (m, a) => ({
      name: 'burst',
      catchLocal: V(m.hand0 * 0.28, 0.86, 0.5),
      uCatch: 1.5,
      contactDur: 0.08,
      maxRel: 5.5,
      steer: 16,
    }),
    begin(m, a) {
      bodyDir(_w, a, 0, 1);
      inputDir(_v, a, _w);
      m.impDir.copy(_v);
      m.a.events.emit('move:go', { athlete: a, move: m });
    },
    apply(m, a, u, dt) {
      const an = a.anim;
      if (m.once(0.0)) addImpulse(a, m.impDir, 3.0 * m.power);
      a.mods.accelMul = 2.4;
      a.mods.speedMul = 1.15;
      a.mods.sprintOk = true;
      if (a.input.move.lengthSq() < 0.05) a.input.move.copy(m.impDir); // keep driving
      a.input.sprint = true;
      an.leanF += 0.3 * bell(u);
      an.crouch += 0.12;
      an.cadenceScale = 0.88;
    },
  },

  pace: {
    name: 'Change of Pace',
    T: 0.8,
    recover: 0.08,
    chainFrom: 0.5,
    shootFrom: 0.35,
    cost: 0.03,
    fake: 0.5,
    switches: false,
    spec: (m, a) => ({
      name: 'pace',
      catchLocal: V(m.hand0 * 0.3, 1.0, 0.3),
      uCatch: 0.85,
      contactDur: 0.16,
    }),
    begin(m, a) {
      bodyDir(_v, a, 0, 1);
      m.goDir.copy(_v);
    },
    apply(m, a, u, dt) {
      const an = a.anim;
      if (u < 0.45) {
        a.mods.speedMul = 0.42;
        an.crouch = lerp(an.crouch, 0.04, smoothstep(0, 0.2, u));
        an.leanF -= 0.05;
        an.cadenceScale = 0.85;
      } else {
        if (m.once(0.45)) {
          inputDir(_v, a, m.goDir);
          m.goDir.copy(_v);
          addImpulse(a, m.goDir, 2.6 * m.power);
          m.a.events.emit('move:go', { athlete: a, move: m });
        }
        a.mods.accelMul = 2.2;
        a.mods.speedMul = 1.12;
        an.leanF += 0.25 * bell((u - 0.45) / 0.55);
        an.crouch += 0.08;
        if (a.input.move.lengthSq() < 0.05) a.input.move.copy(m.goDir);
      }
    },
  },
};

export const MOVE_IDS = Object.keys(MOVES);

export function canStartMove(a, id) {
  if (!MOVES[id]) return false;
  if (!a.hasBall()) return false;
  if (a.handling !== Handling.DRIBBLE && a.handling !== Handling.TRIPLE) return false;
  if (!a.grounded || a.stumble > 0) return false;
  return true;
}

export class MoveAction {
  constructor(a, game, id, chain = 0) {
    this.a = a;
    this.game = game;
    this.id = id;
    this.def = MOVES[id];
    this.type = 'move';
    this.locks = true;
    this.t = 0;
    this.phase = 'wait';
    this.waitT = 0;
    this.chain = chain;
    this.hand0 = a.dribble.hand || -1;
    this.impDir = new THREE.Vector3();
    this.goDir = new THREE.Vector3();
    this.fired = new Set();
    this.power = 1;
    this.queuedNext = null;
    this.u = 0;
  }

  /** True exactly once when normalized time first reaches `u0`. */
  once(u0) {
    if (this.u >= u0 && !this.fired.has(u0)) {
      this.fired.add(u0);
      return true;
    }
    return false;
  }

  start() {
    const a = this.a;
    const now = this.game.time;
    // spam / fatigue limits: the same move repeated quickly is less effective
    const recent = a.recentMoves.filter((r) => now - r.t < 1.6);
    const same = recent.filter((r) => r.id === this.id).length;
    this.power = clamp(1 - same * 0.22, 0.45, 1) * (a.stamina < 0.25 ? 0.82 : 1);
    a.recentMoves.push({ id: this.id, t: now });
    if (a.recentMoves.length > 12) a.recentMoves.shift();
    a.spendStamina(this.def.cost * (1 + same * 0.3));
    this.spec = makeSpec(this.def.spec(this, a));
    this.spec.move = this;
    // a tired, careless handle can lose the ball on complex moves
    const risk = Math.max(0, 0.3 - a.stamina) * 0.5 * (1.2 - a.ratings.handle) + same * 0.012 * (1.1 - a.ratings.handle);
    if (Math.random() < risk) this.spec.fumble = true;
    const r = a.dribble.queue(this.spec);
    if (r === 'now') this._begin();
    const opp = a.opponent;
    this.game.events.emit('move:start', {
      athlete: a,
      move: this,
      id: this.id,
      chain: this.chain,
      power: this.power,
      fake: this.def.fake * this.power * (1 + Math.min(0.6, this.chain * 0.25)),
      hand0: this.hand0,
      defDist: opp ? Math.hypot(opp.pos.x - a.pos.x, opp.pos.z - a.pos.z) : 9,
    });
  }

  _begin() {
    this.phase = 'exec';
    this.t = 0;
    this.u = 0;
    if (this.def.begin) this.def.begin(this, this.a);
  }

  onInput(inp) {
    if (this.phase === 'wait') return;
    if (inp.move1 && MOVES[inp.move1] && this.u >= this.def.chainFrom) {
      this.queuedNext = inp.move1;
    }
    if (inp.shootPressed && this.u >= this.def.shootFrom) this.queuedShot = true;
  }

  update(dt) {
    const a = this.a;
    const an = a.anim;
    if (this.phase === 'wait') {
      if (a.dribble.cur === this.spec) this._begin();
      else {
        this.waitT += dt;
        // anticipation: sink and load
        an.crouch += 0.08 * smoothstep(0, 0.2, this.waitT);
        a.mods.speedMul = 0.85;
        if (!a.dribble.active || this.waitT > 0.7) return false;
        return true;
      }
    }
    this.t += dt;
    const T = this.def.T;
    this.u = clamp01(this.t / T);
    if (this.t <= T) this.def.apply(this, a, this.u, dt);
    else {
      // recovery: settle posture
      an.crouch += 0.05;
      a.mods.accelMul = Math.max(a.mods.accelMul, 1.2);
    }
    if (this.queuedShot) {
      a.events.emit('move:end', { athlete: a, move: this });
      this.queuedShot = false;
      a.setAction(null);
      a.input.shootPressed = true; // handled next routing pass
      this.game.startShot(a);
      return true;
    }
    if (this.queuedNext) {
      const id = this.queuedNext;
      this.queuedNext = null;
      if (canStartMove(a, id)) {
        a.setAction(new MoveAction(a, this.game, id, this.chain + 1));
        return true;
      }
    }
    if (this.t >= T + this.def.recover) {
      a.lastMoveEnd = this.game.time;
      a.events.emit('move:end', { athlete: a, move: this });
      return false;
    }
    return true;
  }

  end() {}
}
