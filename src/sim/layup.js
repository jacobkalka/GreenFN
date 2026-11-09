// Layups and dunks: two-step gather, one-foot takeoff, outside-hand finish (timed release) or a
// physical dunk that drives the ball down through the ring.
import * as THREE from 'three';
import { BallState } from './ball.js';
import { Handling } from './athlete.js';
import { HOOP, BALL, isBeyondArc } from './constants.js';
import { perfectWindow, gradeRelease, computeContest, launchShot } from './shooting.js';
import { clamp, clamp01, lerp, smoothstep, rotateYaw, toLocalYaw, yawOf, bell, easeOut } from '../core/math.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _l = new THREE.Vector3();

function towardRimSpeed(a) {
  const d = a.distToRim();
  return -(a.vel.x * a.pos.x + a.vel.z * a.pos.z) / Math.max(0.3, d);
}

export function wantsLayup(game, a) {
  const d = a.distToRim();
  if (d > 4.4) return false;
  if (a.pos.z < -0.9) return false; // behind the backboard
  const toward = towardRimSpeed(a);
  return d < 2.4 || (toward > 1.4 && d < 4.4);
}

export function wantsDunk(game, a) {
  const d = a.distToRim();
  if (!(d < 3.8 && d > 1.2 && towardRimSpeed(a) > 3.4 && a.input.sprint && a.stamina > 0.2 && a.ratings.vertical >= 0.55)) return false;
  // the lane must be open: no defender planted between the driver and the rim
  const o = game.opponentOf(a);
  if (o) {
    const ux = -a.pos.x / d;
    const uz = -a.pos.z / d;
    const rx = o.pos.x - a.pos.x;
    const rz = o.pos.z - a.pos.z;
    const along = rx * ux + rz * uz;
    const perp = Math.abs(rx * uz - rz * ux);
    if (along > -0.2 && along < d + 0.3 && perp < 1.0) return false;
  }
  return true;
}

export class LayupAction {
  constructor(a, game) {
    this.a = a;
    this.game = game;
    this.type = 'layup';
    this.locks = true;
    this.kind = wantsDunk(game, a) ? 'dunk' : 'layup';
    this.phase = 'pickup';
    this.t = 0;
    this.buttonDown = true;
    this.released = false;
    this.meter = { active: false, t: 0, ideal: 0.5, w: 0.06, released: false, grade: null, kind: this.kind };
    this.dir = new THREE.Vector3();
    this.takeoff = new THREE.Vector3();
    this.relLocal = new THREE.Vector3();
    this.landT = -1;
    this.fromX = a.pos.x;
    this.fromZ = a.pos.z;
    this.hand = -1;
  }

  start() {
    const a = this.a;
    a.shotMeter = this.meter;
    if (a.handling === Handling.DRIBBLE) a.dribble.requestPickup(() => this._secured());
    else this._secured();
  }

  _secured() {
    const a = this.a;
    const ball = this.game.ball;
    ball.state = BallState.HELD;
    ball.owner = a;
    a.handling = Handling.PICKED;
    this.phase = 'steps';
    this.t = 0;
    this.fromX = a.pos.x;
    this.fromZ = a.pos.z;
    // approach direction toward the rim
    this.dir.set(-a.pos.x, 0, -a.pos.z);
    const d = this.dir.length() || 1;
    this.dir.multiplyScalar(1 / d);
    // finishing hand: the side of the rim the player is on (outside hand), else shooting hand
    toLocalYaw(_l, -a.pos.x, -a.pos.z, a.yaw);
    this.hand = Math.abs(_l.x) < 0.25 ? a.shootHand : _l.x > 0 ? -1 : 1;
    const speed = Math.max(2.6, Math.min(6.5, a.speedNow));
    this.speed = speed;
    this.stepDur = clamp(0.5 - speed * 0.035, 0.26, 0.42); // two gather steps
    const takeoffDist = this.kind === 'dunk' ? 1.55 : 1.15;
    const along = Math.max(0, d - takeoffDist);
    // don't travel more than the steps physically allow
    const maxTravel = speed * this.stepDur * 1.05;
    this.travel = Math.min(along, maxTravel);
    this.takeoff.set(a.pos.x + this.dir.x * this.travel, 0, a.pos.z + this.dir.z * this.travel);
    this.startPos = a.pos.clone();
    toLocalYaw(_l, ball.pos.x - a.pos.x, ball.pos.z - a.pos.z, a.yaw);
    this.ball0 = _l.clone();
    this.ball0.y = ball.pos.y;
    const diffMul = a.isUser ? this.game.userTimingMul || 1 : 1;
    this.meter.w = perfectWindow(a, 'layup', 1, diffMul);
    this.game.events.emit('shot:gather', { athlete: a, layup: true, dunk: this.kind === 'dunk' });
  }

  update(dt) {
    const a = this.a;
    const an = a.anim;
    const game = this.game;
    if (!a.input.shoot) this.buttonDown = false;
    if (this.phase === 'pickup') {
      a.mods.speedMul = 0.9;
      an.crouch += 0.05;
      return true;
    }
    this.t += dt;
    a.mods.faceYaw = yawOf(this.dir.x, this.dir.z);
    a.mods.turnMul = 3;

    if (this.phase === 'steps') {
      const u = clamp01(this.t / this.stepDur);
      // root motion along the approach line to the takeoff spot
      const remain = Math.hypot(this.takeoff.x - a.pos.x, this.takeoff.z - a.pos.z);
      const tl = Math.max(0.03, this.stepDur - this.t);
      const sp = Math.min(this.speed * 1.1, remain / tl);
      _v.set(this.takeoff.x - a.pos.x, 0, this.takeoff.z - a.pos.z);
      if (_v.lengthSq() > 1e-6) _v.normalize();
      else _v.copy(this.dir);
      a.mods.velOverride = _w.copy(_v).multiplyScalar(sp);
      an.crouch = lerp(0.25, 0.48, smoothstep(0.4, 1, u));
      an.hingeScale = 0.5;
      an.leanF += 0.12;
      // ball gathered to the chest, protected on the inside
      this._ballPath(u * 0.35);
      if (this.t >= this.stepDur) {
        this.phase = 'air';
        this.t = 0;
        this.fromX = a.pos.x;
        this.fromZ = a.pos.z;
        const vy = (this.kind === 'dunk' ? 3.75 : 3.1) + (a.ratings.vertical - 0.7) * 0.9;
        // horizontal carry: land near (not under) the rim
        const d = a.distToRim();
        const airT = (2 * vy) / 9.81;
        const want = this.kind === 'dunk' ? Math.max(0.2, d - 0.55) : Math.max(0.15, d - 0.55);
        const h = Math.min(want / airT, this.speed * 0.75);
        a.vel.x = this.dir.x * h;
        a.vel.z = this.dir.z * h;
        a.jump(vy);
        this.apexT = vy / 9.81;
        this.meter.ideal = this.apexT * 0.85;
        this.meter.active = this.kind === 'layup';
        a.spendStamina(this.kind === 'dunk' ? 0.06 : 0.03);
      }
      return true;
    }

    if (this.phase === 'air') {
      an.crouch = -0.05;
      an.airTuck = 0.85;
      an.airTuckSide = this.hand; // knee on the finishing-hand side drives up
      an.airTuckFwd = 0.25;
      if (this.kind === 'dunk') return this._dunkAir(dt);
      this.meter.t = this.t;
      const u = clamp01(this.t / Math.max(0.1, this.meter.ideal));
      this._ballPath(0.35 + 0.65 * u);
      if (!this.released && (!this.buttonDown || this.t >= this.meter.ideal + 0.22)) this._release();
      if (this.released) this._follow();
      if (a.grounded && this.t > 0.1) {
        this.phase = 'land';
        this.landT = 0;
      }
      return true;
    }

    if (this.phase === 'hang') {
      // hanging on the rim after a dunk
      this.hangT += dt;
      a.vel.set(0, 0, 0);
      a.pos.y = Math.max(a.pos.y, this.hangY);
      an.arms = 'pose';
      bodyLocalHand(an.poseL, a, this.hand > 0 ? 0.12 : 0.3, 0.92, 0.25);
      bodyLocalHand(an.poseR, a, this.hand < 0 ? -0.12 : -0.3, 0.92, 0.25);
      an.poseFingerL.set(0, 1, 0.2);
      an.poseFingerR.set(0, 1, 0.2);
      an.poseStiff = 18;
      an.airTuck = 0.35;
      an.crouch = -0.05;
      if (this.hangT > 0.32) {
        this.phase = 'air2';
        a.vel.y = -0.5;
      }
      return true;
    }

    if (this.phase === 'air2') {
      an.airTuck = 0.2;
      if (a.grounded) {
        this.phase = 'land';
        this.landT = 0;
      }
      return true;
    }

    if (this.phase === 'land') {
      this.landT += dt;
      an.crouch = 0.35;
      a.mods.allowMove = this.landT > 0.15;
      if (this.released) this._follow();
      if (this.landT > 0.24) {
        this.meter.active = false;
        return false;
      }
      return true;
    }
    return false;
  }

  _ballPath(k) {
    const a = this.a;
    const an = a.anim;
    const h = this.hand;
    // body-space keys: gather at the chest, then the finishing hand lifts it toward the rim
    let x, y, z;
    if (k < 0.35) {
      const u = smoothstep(0, 1, k / 0.35);
      x = lerp(this.ball0.x, -h * 0.05, u);
      y = lerp(this.ball0.y - a.pos.y, 1.25, u);
      z = lerp(this.ball0.z, 0.3, u);
    } else {
      const u = smoothstep(0, 1, (k - 0.35) / 0.65);
      x = lerp(-h * 0.05, h * 0.2, u);
      y = lerp(1.25, 2.38, u);
      z = lerp(0.3, 0.42, u);
    }
    rotateYaw(_v, x, z, a.yaw);
    an.ballPos.set(a.pos.x + _v.x, y + a.pos.y, a.pos.z + _v.z);
    an.arms = k < 0.5 ? 'hold' : 'shoot';
    an.shootSide = h;
    an.shotDir.copy(this.dir);
    an.gripFwd.copy(this.dir);
    an.gripUp.set(0, 1, 0);
    an.holdKinematic = true;
    an.released = false;
    an.lookTarget.set(0, HOOP.rimY, 0);
    an.lookAt = an.lookTarget;
  }

  _release() {
    const a = this.a;
    const game = this.game;
    game.ball.pos.copy(a.anim.ballPos);
    const delta = this.t - this.meter.ideal;
    const grade = gradeRelease(delta, this.meter.w);
    this.meter.released = true;
    this.meter.grade = grade;
    this.meter.delta = delta;
    this.meter.releaseT = this.t;
    const contest = computeContest(game, a, game.ball.pos);
    const d = Math.hypot(game.ball.pos.x, game.ball.pos.z);
    launchShot(game, a, {
      kind: 'layup',
      grade,
      contest,
      moveSpeed: Math.hypot(a.vel.x, a.vel.z) * 0.3,
      arc: (62 + clamp((1.2 - d) * 6, -4, 6)) * (Math.PI / 180),
      fromX: this.fromX,
      fromZ: this.fromZ,
      spin: 9,
    });
    toLocalYaw(this.relLocal, game.ball.pos.x - a.pos.x, game.ball.pos.z - a.pos.z, a.yaw);
    this.relLocal.y = game.ball.pos.y - a.pos.y + 0.05;
    this.relLocal.z += 0.06;
    this.released = true;
    this.releaseT = this.t;
    a.handling = Handling.NONE;
  }

  _follow() {
    const a = this.a;
    const an = a.anim;
    an.arms = 'shoot';
    an.released = true;
    an.shootSide = this.hand;
    an.followT = (this.t - this.releaseT + (this.landT > 0 ? this.landT : 0)) / 0.6;
    rotateYaw(_v, this.relLocal.x, this.relLocal.z, a.yaw);
    an.followPos.set(a.pos.x + _v.x, 0, a.pos.z + _v.z);
    an.releaseHeight = this.relLocal.y + a.pos.y;
    an.shotDir.copy(this.dir);
  }

  _dunkAir(dt) {
    const a = this.a;
    const an = a.anim;
    const game = this.game;
    const ball = game.ball;
    const T = this.apexT;
    if (!this.released) {
      // carry the ball up and over the rim, then throw it down through the ring
      const u = clamp01(this.t / T);
      const h = this.hand;
      // horizontal: from in front of the body to over the rim center
      rotateYaw(_v, h * 0.15, 0.4, a.yaw);
      const sx = a.pos.x + _v.x;
      const sz = a.pos.z + _v.z;
      const k = smoothstep(0.35, 1, u);
      const tx = lerp(sx, 0, k * 0.9);
      const tz = lerp(sz, 0.04, k * 0.9);
      const y = lerp(1.5 + a.pos.y, HOOP.rimY + 0.32, smoothstep(0, 0.85, u));
      an.ballPos.set(tx, y, tz);
      an.arms = u < 0.3 ? 'hold' : 'shoot';
      an.shootSide = h;
      an.shotDir.copy(this.dir);
      an.gripFwd.copy(this.dir);
      an.holdKinematic = true;
      an.released = false;
      if (this.t >= T * 0.95) {
        // slam: drive the ball down through the ring (physics + score detection take over)
        const contest = computeContest(game, a, ball.pos);
        ball.pos.copy(an.ballPos);
        game.releaseBall();
        ball.state = BallState.FREE;
        ball.live = true;
        ball.resetFlags();
        ball.vel.set(-ball.pos.x * 2.2, -5.2, -ball.pos.z * 2.2);
        // heavy contest can turn it into a rattle out
        if (Math.random() < contest * 0.6) {
          ball.vel.x += (Math.random() - 0.5) * 3.2;
          ball.vel.z += 1.2;
        }
        ball.angVel.set(0, 0, 0);
        ball.lastTouch = a;
        ball.noPickupBy = a;
        ball.noPickupFor = 10;
        const value = isBeyondArc(this.fromX, this.fromZ) ? 2 : 1;
        ball.shot = { shooter: a, kind: 'dunk', value, dist: 0.5, grade: { id: 'perfect', label: 'SLAM' }, contest, sigma: 0, time: game.time, blocked: false, fromX: this.fromX, fromZ: this.fromZ };
        game.events.emit('shot:release', { shot: ball.shot, athlete: a });
        game.events.emit('dunk', { athlete: a });
        this.released = true;
        a.handling = Handling.NONE;
        this.phase = 'hang';
        this.hangT = 0;
        this.hangY = Math.max(0.55, HOOP.rimY - 2.42);
      }
    }
    return true;
  }
}

function bodyLocalHand(out, a, x, y, z) {
  // chest-relative pose target (x left, y up, z fwd)
  return out.set(x, y, z);
}
