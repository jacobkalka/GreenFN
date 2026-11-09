// Ball-handling controller: hand contact (cushion + push, or a carried "wrap" path) and a
// physically simulated bounce flight.
// The release velocity is solved so that, after one real floor bounce (restitution e), the ball rises
// back into the predicted catch spot of the receiving hand. During flight the vertical motion is pure
// physics; limited horizontal steering compensates for the dribbler changing direction.
//
// Spec lifecycle: a move spec is queued; it becomes the *contact* spec at the next catch (or
// immediately if the ball is early in a contact), drives that contact (duration, carry path) and the
// release/flight that follows (receiving hand, catch spot, tempo). Then the base spec resumes.
import * as THREE from 'three';
import { BALL, GRAVITY } from './constants.js';
import { BallState } from './ball.js';
import { clamp, clamp01, lerp, smoothstep, hermite, hermiteVel, rotateYaw, toLocalYaw } from '../core/math.js';

const g = GRAVITY;
const R = BALL.radius;
const E = BALL.floorRestitution;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();
const _rel = new THREE.Vector3();

export function makeSpec(over = {}) {
  return Object.assign(
    {
      name: 'base',
      catchHand: 0, // 0 = same hand, else -1 right / +1 left
      catchLocal: null, // THREE.Vector3 body-space catch spot (x left, y height, z fwd)
      releaseLocal: null, // body-space release spot (non-carry)
      uCatch: null, // catch up-speed (tempo); null = style default
      contactDur: null,
      carry: null, // [{x,y,z,t}] body-space waypoints for wrap moves (t in 0..1)
      palmLocal: null, // body-space dir ball->palm during carry
      steer: 14,
      maxRel: 3.2,
      move: null, // owning move action (for callbacks)
    },
    over
  );
}

export class DribbleController {
  constructor(athlete, events) {
    this.a = athlete;
    this.events = events;
    this.active = false;
    this.contact = true;
    this.hand = -1; // -1 right, +1 left
    this.t = 0;
    this.contactDur = 0.12;
    this.catchPos = new THREE.Vector3();
    this.catchVel = new THREE.Vector3();
    this.carryStart = new THREE.Vector3();
    this.relPos = new THREE.Vector3();
    this.relVel = new THREE.Vector3();
    this.flightT = 0;
    this.flightTotal = 0.5;
    this.catchY = 0.92;
    this.uCatch = 1;
    this.bounced = false;
    this.handTarget = new THREE.Vector3();
    this.handFinger = new THREE.Vector3(0, 0, 1);
    this.handPalm = new THREE.Vector3(0, -1, 0);
    this.base = makeSpec();
    this.cur = this.base; // contact spec
    this.flightSpec = this.base;
    this.pending = null; // queued spec
    this.pickupRequested = false;
    this.onPickup = null;
    this.count = 0;
    this.lastBounceTime = 0;
  }

  get ball() {
    return this.a.game.ball;
  }

  /** Begin dribbling with the ball currently in the athlete's hands. */
  start(hand = this.hand) {
    const ball = this.ball;
    this.active = true;
    this.hand = hand;
    this.pending = null;
    this.pickupRequested = false;
    this.onPickup = null;
    this._beginContact(this.base, ball.pos, this.a.vel);
    this.contactDur = 0.1;
    ball.state = BallState.DRIBBLE;
    ball.owner = this.a;
    ball.lastTouch = this.a;
    ball.dragEnabled = false;
    this._updateHandContact();
  }

  stop() {
    this.active = false;
    this.pending = null;
    this.pickupRequested = false;
    this.onPickup = null;
  }

  /** Queue a move. Returns 'now' if applied to the current contact, else 'pending'. */
  queue(spec) {
    if (this.contact && this.t < this.contactDur * 0.55) {
      this._beginContact(spec, this.ball.pos, this.ball.vel);
      return 'now';
    }
    this.pending = spec;
    return 'pending';
  }

  hasPending() {
    return !!this.pending;
  }

  /** Ask to end the dribble: callback fires when the ball is secured in the hand. */
  requestPickup(cb) {
    this.pickupRequested = true;
    this.onPickup = cb;
    this.pending = null;
    if (this.contact) this._finishPickup();
  }

  _finishPickup() {
    this.pickupRequested = false;
    this.active = false;
    const cb = this.onPickup;
    this.onPickup = null;
    if (cb) cb();
  }

  _beginContact(spec, pos, vel) {
    this.contact = true;
    this.t = 0;
    this.cur = spec;
    this.contactDur = spec.contactDur || this.a.dribbleStyle.contactDur;
    this.catchPos.copy(pos);
    this.catchVel.copy(vel);
    this.catchVel.y = Math.min(this.catchVel.y, 2.5);
    if (spec.carry) {
      toLocalYaw(this.carryStart, pos.x - this.a.pos.x, pos.z - this.a.pos.z, this.a.yaw);
      this.carryStart.y = pos.y;
    }
    if (spec !== this.base) this.events.emit('dribble:moveContact', { athlete: this.a, spec });
  }

  _defaultCatchLocal(out, hand) {
    const st = this.a.dribbleStyle;
    return out.set(hand * st.side, st.height, st.fwd);
  }

  /** Predict root position and yaw `t` seconds ahead. */
  _predictBody(out, t) {
    const a = this.a;
    a.predictPos(out, t);
    return a.yaw + clamp(a.yawRate * t * 0.6, -1.0, 1.0);
  }

  _localToWorld(out, local, basePos, yaw) {
    rotateYaw(out, local.x, local.z, yaw);
    out.x += basePos.x;
    out.z += basePos.z;
    out.y = local.y;
    return out;
  }

  /** Vertical timing for a release at height yR caught rising at yC with up-speed uC. */
  _solveVertical(yR, yC, uC) {
    let u0 = Math.sqrt(uC * uC + 2 * g * Math.max(0.05, yC - R));
    let vi = u0 / E;
    const vd2 = vi * vi - 2 * g * (yR - R);
    let vd;
    if (vd2 < 0) {
      vd = 0;
      vi = Math.sqrt(2 * g * Math.max(0.01, yR - R));
      u0 = E * vi;
      uC = Math.sqrt(Math.max(0, u0 * u0 - 2 * g * (yC - R)));
    } else vd = Math.sqrt(vd2);
    return { vd, T: (vi - vd) / g + (u0 - uC) / g, uC };
  }

  /** Compute release velocity (relVel) for a release at relPos under `spec`. Returns receiving hand. */
  _computeRelease(spec) {
    const a = this.a;
    const st = a.dribbleStyle;
    const nextHand = spec.catchHand || this.hand;
    this.catchY = spec.catchLocal ? spec.catchLocal.y : st.height;
    const sol = this._solveVertical(this.relPos.y, this.catchY, spec.uCatch || st.uCatch);
    this.uCatch = sol.uC;
    this.flightTotal = sol.T;
    const yaw = this._predictBody(_p, sol.T);
    if (spec.catchLocal) _c.copy(spec.catchLocal);
    else this._defaultCatchLocal(_c, nextHand);
    this._localToWorld(_w, _c, _p, yaw);
    let hx = (_w.x - this.relPos.x) / sol.T;
    let hz = (_w.z - this.relPos.z) / sol.T;
    // keep the push plausible relative to the body's own motion
    const rx = hx - a.vel.x;
    const rz = hz - a.vel.z;
    const rl = Math.hypot(rx, rz);
    const maxRel = spec.maxRel || 3.2;
    if (rl > maxRel) {
      hx = a.vel.x + (rx * maxRel) / rl;
      hz = a.vel.z + (rz * maxRel) / rl;
    }
    this.relVel.set(hx, -sol.vd, hz);
    return nextHand;
  }

  update(dt) {
    if (!this.active) return;
    const ball = this.ball;
    if (ball.owner !== this.a || ball.state !== BallState.DRIBBLE) {
      this.active = false;
      return;
    }
    if (this.contact) this._updateContact(dt);
    else this._updateFlight(dt);
    ball.integrateRotation(dt);
  }

  _updateContact(dt) {
    const a = this.a;
    const ball = this.ball;
    const spec = this.cur;
    this.t += dt;
    const T = this.contactDur;
    const s = clamp01(this.t / T);
    if (spec.carry) {
      const pts = spec.carry;
      let i = 0;
      while (i < pts.length - 2 && s > pts[i + 1].t) i++;
      const p0 = i === 0 ? this.carryStart : pts[i];
      const p1 = pts[i + 1];
      const t0 = pts[i].t;
      const u = smoothstep(0, 1, clamp01((s - t0) / Math.max(1e-4, p1.t - t0)));
      _v.set(lerp(p0.x, p1.x, u), lerp(p0.y, p1.y, u), lerp(p0.z, p1.z, u));
      _rel.copy(ball.pos);
      this._localToWorld(ball.pos, _v, a.pos, a.yaw);
      ball.vel.subVectors(ball.pos, _rel).multiplyScalar(1 / Math.max(dt, 1e-4));
      if (s >= 1) {
        this.relPos.copy(ball.pos);
        this._release();
        return;
      }
    } else {
      if (spec.releaseLocal) this._localToWorld(this.relPos, spec.releaseLocal, a.pos, a.yaw);
      else {
        const st = a.dribbleStyle;
        this._defaultCatchLocal(_c, this.hand);
        _c.y = Math.max(0.45, st.height - 0.07);
        _c.z += 0.03;
        this._localToWorld(this.relPos, _c, a.pos, a.yaw);
        this.relPos.x += a.vel.x * 0.025;
        this.relPos.z += a.vel.z * 0.025;
      }
      this._computeRelease(spec);
      if (this.t < dt * 1.5) {
        // first contact tick: stretch the contact if the hand must carry the ball a long way
        const carry = Math.hypot(this.relPos.x - this.catchPos.x, this.relPos.z - this.catchPos.z);
        const need = carry / 2.4;
        if (need > this.contactDur) this.contactDur = Math.min(0.24, need);
      }
      hermite(ball.pos, this.catchPos, this.catchVel, this.relPos, this.relVel, this.contactDur, this.t);
      hermiteVel(ball.vel, this.catchPos, this.catchVel, this.relPos, this.relVel, this.contactDur, this.t);
      if (this.t >= this.contactDur) {
        ball.pos.copy(this.relPos);
        this._release();
        return;
      }
    }
    ball.angVel.multiplyScalar(Math.exp(-14 * dt));
    this._updateHandContact();
  }

  _release() {
    const ball = this.ball;
    const spec = this.cur;
    const nextHand = this._computeRelease(spec);
    ball.vel.copy(this.relVel);
    if (spec.fumble) {
      // lost the handle: the ball squirts away
      const s = Math.random() < 0.5 ? -1 : 1;
      ball.vel.x += s * (1.6 + Math.random()) * Math.cos(this.a.yaw);
      ball.vel.z += -s * (1.6 + Math.random()) * Math.sin(this.a.yaw);
    }
    // no-slip spin: floor contact preserves horizontal velocity (predictable bounce)
    ball.angVel.set(ball.vel.z, 0, -ball.vel.x).multiplyScalar(1 / R);
    this.contact = false;
    this.flightT = 0;
    this.bounced = false;
    this.hand = nextHand;
    this.count++;
    this.flightSpec = spec;
    this.cur = this.base;
    this.events.emit('dribble:release', { athlete: this.a, hand: nextHand, spec });
  }

  _timeRemaining(ball) {
    const y = ball.pos.y;
    const vy = ball.vel.y;
    if (!this.bounced) {
      const disc = vy * vy + 2 * g * Math.max(0, y - R);
      const vi = Math.sqrt(disc);
      const t1 = (vy + vi) / g;
      const u0 = E * vi;
      const d2 = u0 * u0 - 2 * g * (this.catchY - R);
      return t1 + (d2 > 0 ? (u0 - Math.sqrt(d2)) / g : u0 / g);
    }
    if (vy <= 0) return 0;
    const d2 = vy * vy - 2 * g * (this.catchY - y);
    return d2 > 0 ? (vy - Math.sqrt(d2)) / g : vy / g;
  }

  _updateFlight(dt) {
    const a = this.a;
    const ball = this.ball;
    this.flightT += dt;
    ball.vel.y -= g * dt;
    ball.pos.addScaledVector(ball.vel, dt);
    if (ball.pos.y < R && ball.vel.y < 0) {
      ball.pos.y = R + (R - ball.pos.y) * E;
      const impact = -ball.vel.y;
      ball.vel.y = impact * E;
      this.bounced = true;
      ball.squash = Math.min(1, impact / 7);
      ball.squashDir.set(0, 1, 0);
      this.events.emit('ball:impact', { surface: 'floor', impact, ball, dribble: true, athlete: a, x: ball.pos.x, y: R, z: ball.pos.z });
    }
    // horizontal steering toward the receiving hand's predicted spot
    const tRem = Math.max(0.025, this._timeRemaining(ball));
    const spec = this.flightSpec;
    const yaw = this._predictBody(_p, tRem);
    if (spec.catchLocal) _c.copy(spec.catchLocal);
    else this._defaultCatchLocal(_c, this.hand);
    this._localToWorld(_w, _c, _p, yaw);
    const steer = (spec.fumble ? 0 : spec.steer) * (this.bounced ? 1.7 : 1) * dt;
    let dx = (_w.x - ball.pos.x) / tRem - ball.vel.x;
    let dz = (_w.z - ball.pos.z) / tRem - ball.vel.z;
    const dl = Math.hypot(dx, dz);
    if (dl > steer) {
      dx *= steer / dl;
      dz *= steer / dl;
    }
    ball.vel.x += dx;
    ball.vel.z += dz;
    ball.angVel.set(ball.vel.z, 0, -ball.vel.x).multiplyScalar(1 / R);

    // receiving hand waits above the catch spot in the body's *current* frame (the body moves
    // to meet it); near the catch it tracks the rising ball
    const ft = this.flightT / Math.max(0.1, this.flightTotal);
    this._localToWorld(this.handTarget, _c, a.pos, a.yaw);
    this.handTarget.y = this.catchY + R + 0.012;
    if (this.bounced) {
      const near = smoothstep(0.45, 0.05, this.catchY - ball.pos.y);
      this.handTarget.x = lerp(this.handTarget.x, ball.pos.x, near);
      this.handTarget.z = lerp(this.handTarget.z, ball.pos.z, near);
      // meet the ball slightly early (hand comes down to cushion)
      this.handTarget.y -= near * 0.04;
    }
    // follow-through right after release (only if the same hand keeps the ball)
    this.handTarget.y -= (1 - smoothstep(0.03, 0.38, ft)) * 0.13;
    this._handOrientation(false);

    // catch
    const early = (this.pickupRequested || this.pending) && this.bounced && ball.vel.y > 0 && ball.pos.y > 0.5;
    if ((this.bounced && ball.vel.y > 0 && ball.pos.y >= this.catchY - 0.005) || early || (this.bounced && ball.vel.y <= 0)) {
      _rel.subVectors(ball.pos, a.animator.chestWorld);
      if (_rel.length() > 1.3) {
        this._fumble();
        return;
      }
      this._catch();
    } else if (this.flightT > 2.0) {
      this._fumble();
    }
  }

  _catch() {
    const ball = this.ball;
    ball.lastTouch = this.a;
    this.lastBounceTime = 0;
    const spec = this.pending || this.base;
    this.pending = null;
    this._beginContact(spec, ball.pos, ball.vel);
    this._updateHandContact();
    this.events.emit('dribble:catch', { athlete: this.a, hand: this.hand });
    if (this.pickupRequested) this._finishPickup();
  }

  _fumble() {
    const ball = this.ball;
    this.active = false;
    this.contact = false;
    this.pending = null;
    ball.state = BallState.FREE;
    ball.owner = null;
    ball.dragEnabled = true;
    ball.live = true;
    ball.noPickupFor = 0.2;
    ball.noPickupBy = this.a;
    this.events.emit('dribble:fumble', { athlete: this.a });
  }

  _updateHandContact() {
    const ball = this.ball;
    const spec = this.cur;
    if (spec.carry && spec.palmLocal) {
      rotateYaw(_v, spec.palmLocal.x, spec.palmLocal.z, this.a.yaw);
      _v.y = spec.palmLocal.y;
      _v.normalize();
      this.handTarget.copy(ball.pos).addScaledVector(_v, R + 0.012);
      this.handPalm.copy(_v).negate();
      rotateYaw(this.handFinger, 0, 1, this.a.yaw);
      this.handFinger.y = -0.5;
      this.handFinger.addScaledVector(this.handPalm, -this.handFinger.dot(this.handPalm)).normalize();
      return;
    }
    this.handTarget.copy(ball.pos);
    this.handTarget.y += R + 0.012;
    this._handOrientation(true);
  }

  _handOrientation(contact) {
    const a = this.a;
    const side = this.hand;
    rotateYaw(this.handFinger, side * 0.35, 1, a.yaw);
    this.handFinger.y = contact ? -0.2 : -0.05;
    this.handFinger.normalize();
    rotateYaw(this.handPalm, side * 0.1, -0.1, a.yaw);
    this.handPalm.y = -1;
    this.handPalm.normalize();
  }
}
