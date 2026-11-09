// Defensive actions: steal reach, contest/block/rebound jump, stumble (ankle breaker), and block /
// goaltending resolution against the ball.
import * as THREE from 'three';
import { BallState } from './ball.js';
import { BALL, HOOP } from './constants.js';
import { clamp01, lerp, bell, toLocalYaw } from '../core/math.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _l = new THREE.Vector3();

export class StealAction {
  constructor(a, game) {
    this.a = a;
    this.game = game;
    this.type = 'steal';
    this.locks = true;
    this.t = 0;
    this.dur = 0.42;
    this.resolved = false;
    const ball = game.ball;
    toLocalYaw(_l, ball.pos.x - a.pos.x, ball.pos.z - a.pos.z, a.yaw);
    this.side = _l.x >= 0 ? 1 : -1;
    this.lunge = new THREE.Vector3();
  }

  start() {
    const a = this.a;
    a.cooldowns.steal = 0.85;
    _v.set(this.game.ball.pos.x - a.pos.x, 0, this.game.ball.pos.z - a.pos.z);
    if (_v.lengthSq() > 1e-4) _v.normalize();
    this.lunge.copy(_v);
    a.impulse.addScaledVector(_v, 0.9);
    a.spendStamina(0.015);
    this.game.events.emit('steal:attempt', { athlete: a });
  }

  update(dt) {
    const a = this.a;
    const an = a.anim;
    const ball = this.game.ball;
    this.t += dt;
    const u = this.t / this.dur;
    // reach toward the ball, clamped to arm's length
    const sh = a.animator.chestWorld;
    _v.subVectors(ball.pos, sh);
    const len = _v.length();
    if (len > 0.78) _v.multiplyScalar(0.78 / len);
    _v.add(sh);
    an.reachTarget.copy(_v);
    an.arms = 'reach';
    an.reachSide = this.side;
    an.crouch = 0.52;
    an.leanF += 0.25 * bell(u);
    an.leanS += this.side * 0.1 * bell(u);
    a.mods.speedMul = 0.6;
    if (!this.resolved && this.t >= 0.15) this._resolve();
    return this.t < this.dur;
  }

  _resolve() {
    this.resolved = true;
    const a = this.a;
    const game = this.game;
    const ball = game.ball;
    const h = game.opponentOf(a);
    if (!h || !h.hasBall()) return;
    const palm = a.animator.palmWorld[this.side > 0 ? 'L' : 'R'];
    const dist = palm.distanceTo(ball.pos);
    let exposure;
    if (ball.state === BallState.DRIBBLE) {
      exposure = h.dribble.contact ? 0.45 : ball.pos.y < 0.45 ? 0.75 : 1.0;
    } else exposure = 0.25; // two hands on the ball
    // ball shielded by the handler's body (ball on the far side)?
    const toBallX = ball.pos.x - h.pos.x;
    const toBallZ = ball.pos.z - h.pos.z;
    const toDefX = a.pos.x - h.pos.x;
    const toDefZ = a.pos.z - h.pos.z;
    const dl = Math.hypot(toDefX, toDefZ) || 1;
    const side = (toBallX * toDefX + toBallZ * toDefZ) / dl;
    if (side < -0.05) exposure *= 0.3;
    else if (side < 0.12) exposure *= 0.7;
    // protective moves
    if (h.action && h.action.type === 'move' && ['btl', 'btb', 'spin'].includes(h.action.id)) exposure *= 0.55;
    if (h.action && h.action.type === 'move' && h.action.id === 'cross' && h.action.u > 0.1 && h.action.u < 0.6) exposure *= 1.35; // crossover in front is risky
    const prox = dist < 0.3 ? 1 : dist < 0.55 ? 0.55 : dist < 0.75 ? 0.18 : 0;
    const p = clamp01((0.25 + a.ratings.steal * 0.55) * exposure * (1.2 - h.ratings.handle * 0.55) * prox);
    if ((game.rng || Math.random)() < p) {
      // knock it loose
      game.releaseBall();
      ball.state = BallState.FREE;
      ball.live = true;
      ball.shot = null;
      ball.dragEnabled = true;
      _v.set(ball.pos.x - h.pos.x, 0, ball.pos.z - h.pos.z);
      if (_v.lengthSq() < 1e-4) _v.copy(this.lunge);
      _v.normalize().lerp(this.lunge, 0.5).normalize();
      ball.vel.set(_v.x * 3.2 + a.vel.x * 0.5, Math.max(1.2, ball.vel.y * 0.3 + 1.4), _v.z * 3.2 + a.vel.z * 0.5);
      ball.angVel.set(Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10);
      ball.lastTouch = a;
      ball.noPickupBy = h;
      ball.noPickupFor = 0.35;
      h.offBalance = 0.3;
      game.events.emit('steal', { athlete: a, victim: h });
    } else {
      a.offBalance = 0.45;
      game.events.emit('steal:miss', { athlete: a, victim: h, close: dist < 0.6 });
    }
  }
}

export class JumpAction {
  constructor(a, game, opts = {}) {
    this.a = a;
    this.game = game;
    this.type = 'jump';
    this.locks = true;
    this.t = 0;
    this.landT = -1;
    this.power = opts.power ?? 1;
    this.reason = opts.reason || 'contest';
  }

  start() {
    const a = this.a;
    const vy = (2.9 + a.ratings.vertical * 0.9) * this.power;
    a.vel.x *= 0.6;
    a.vel.z *= 0.6;
    a.jump(vy);
    a.cooldowns.jump = 0.5;
  }

  update(dt) {
    const a = this.a;
    const an = a.anim;
    const ball = this.game.ball;
    this.t += dt;
    an.arms = 'contest';
    // lead hand goes for the ball when it's close and above the shoulders
    const d = ball.pos.distanceTo(a.animator.chestWorld);
    if (d < 1.4 && ball.pos.y > a.animator.chestWorld.y) {
      toLocalYaw(_l, ball.pos.x - a.pos.x, ball.pos.z - a.pos.z, a.yaw);
      an.reachSide = _l.x >= 0 ? 1 : -1;
      _v.subVectors(ball.pos, a.animator.chestWorld);
      if (_v.length() > 0.85) _v.setLength(0.85);
      an.contestVec.copy(a.animator.chestWorld).add(_v);
      an.contestTarget = an.contestVec;
    }
    an.crouch = a.grounded ? 0.3 : -0.05;
    an.airTuck = a.grounded ? 0 : 0.2;
    a.mods.allowMove = false;
    if (a.grounded && this.t > 0.08) {
      if (this.landT < 0) this.landT = this.t;
      if (this.t - this.landT > 0.16) return false;
    }
    return true;
  }
}

export class StumbleAction {
  constructor(a, game, dir, dur = 0.95) {
    this.a = a;
    this.game = game;
    this.type = 'stumble';
    this.locks = true;
    this.t = 0;
    this.dur = dur;
    this.dir = dir.clone();
  }
  start() {
    const a = this.a;
    a.stumble = this.dur;
    a.impulse.addScaledVector(this.dir, 1.6);
    toLocalYaw(_l, this.dir.x, this.dir.z, a.yaw);
    this.sideSign = _l.x >= 0 ? 1 : -1;
    this.game.events.emit('ankles', { athlete: a });
  }
  update(dt) {
    const a = this.a;
    const an = a.anim;
    this.t += dt;
    const u = this.t / this.dur;
    const k = bell(Math.min(1, u * 1.4));
    an.crouch = 0.35 + 0.45 * k;
    an.leanS += this.sideSign * 0.45 * k;
    an.leanF -= 0.25 * k;
    an.stanceWidth = 0.7;
    an.arms = 'pose';
    an.poseL.set(0.55, 0.15 * k, 0.1);
    an.poseR.set(-0.55, 0.1 * k, 0.15);
    an.poseFingerL.set(1, 0.2, 0);
    an.poseFingerR.set(-1, 0.2, 0);
    an.poseStiff = 9;
    a.mods.speedMul = 0.15;
    return this.t < this.dur;
  }
}

/**
 * Block / goaltending checks. Called once per tick after physics.
 * Returns the blocking athlete or null.
 */
export function tryBlock(game) {
  const ball = game.ball;
  // 1) shots in early flight (or any shot above the rim on the way down -> goaltending)
  if (ball.state === BallState.FREE && ball.shot && !ball.shot.blocked && !ball.touchedRim && !ball.touchedBoard) {
    const shooter = ball.shot.shooter;
    const d = game.opponentOf(shooter);
    if (!d) return null;
    const since = game.time - ball.shot.time;
    for (const k of ['L', 'R']) {
      const palm = d.animator.palmWorld[k];
      if (palm.distanceTo(ball.pos) < BALL.radius + 0.075) {
        const descending = ball.vel.y < 0;
        const nearRim = Math.hypot(ball.pos.x, ball.pos.z) < 1.0;
        if (descending && ball.pos.y > HOOP.rimY && nearRim) {
          ball.shot.goaltend = true;
          game.events.emit('goaltend', { athlete: d, shot: ball.shot });
          deflect(ball, d, palm, 2.2);
          ball.shot.blocked = true;
          return d;
        }
        if (since < 0.75 || ball.vel.y > 0) {
          if (ball.shot.tipped) continue;
          // clean block needs a jumping defender; a standing hand only tips it
          const rng = game.rng || Math.random;
          const pBlock = d.grounded ? 0 : 0.3 + d.ratings.block * 0.45;
          if (rng() < pBlock) {
            ball.shot.blocked = true;
            deflect(ball, d, palm, 3.6);
            game.events.emit('block', { athlete: d, victim: shooter, shot: ball.shot });
            return d;
          }
          // fingertip: slows and skews the ball (usually a miss), the shot stays live
          ball.shot.tipped = true;
          ball.vel.multiplyScalar(0.86 + rng() * 0.08);
          ball.vel.x += (rng() - 0.5) * 0.9;
          ball.vel.z += (rng() - 0.5) * 0.9;
          game.events.emit('tip', { athlete: d, shot: ball.shot });
          return null;
        }
      }
    }
  }
  // 2) ball still in the shooter's hands high in the air (blocked at the release point)
  if (ball.state === BallState.HELD && ball.owner) {
    const s = ball.owner;
    const act = s.action;
    if (!act || (act.type !== 'shot' && act.type !== 'layup') || s.grounded) return null;
    const d = game.opponentOf(s);
    if (!d || d.grounded) return null;
    if (act.stripChecked && act.stripChecked > game.time - 0.25) return null;
    for (const k of ['L', 'R']) {
      const palm = d.animator.palmWorld[k];
      if (palm.distanceTo(ball.pos) < BALL.radius + 0.05) {
        act.stripChecked = game.time;
        const rng = game.rng || Math.random;
        if (rng() > 0.25 + d.ratings.block * 0.35) return null; // shooter protects it
        // stripped / blocked before release
        act.meter && (act.meter.active = false);
        act.released = true;
        act.phase = act.type === 'layup' ? 'air2' : 'follow';
        act.releaseT = act.t;
        act.relLocal && act.relLocal.set(0, 2.2, 0.3);
        game.releaseBall();
        ball.state = BallState.FREE;
        ball.live = true;
        ball.shot = null;
        deflect(ball, d, palm, 3.2);
        game.events.emit('block', { athlete: d, victim: s, shot: null, early: true });
        return d;
      }
    }
  }
  return null;
}

function deflect(ball, d, palm, mag) {
  _v.set(ball.pos.x - d.pos.x, 0, ball.pos.z - d.pos.z);
  if (_v.lengthSq() < 1e-4) _v.set(0, 0, 1);
  _v.normalize();
  ball.vel.set(_v.x * mag + d.vel.x * 0.4, 1.0 + Math.random() * 1.6, _v.z * mag + d.vel.z * 0.4);
  ball.angVel.set(Math.random() * 30 - 15, Math.random() * 30 - 15, Math.random() * 30 - 15);
  ball.lastTouch = d;
  ball.noPickupBy = d;
  ball.noPickupFor = 0.3;
  ball.touchedRim = false;
  ball.dragEnabled = true;
}
