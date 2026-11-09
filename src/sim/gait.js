// Procedural stepping with world-locked foot plants.
// Feet are either planted (fixed in the world: zero sliding) or swinging along an arc toward a
// predicted landing spot. A phase clock drives cyclic gaits (walk/run/shuffle); when idle,
// feet only take corrective steps when the body drifts or turns away from them.
import * as THREE from 'three';
import { DIM } from './rig.js';
import { clamp, clamp01, lerp, angleDiff, wrapAngle, smoothstep, damp, rotateYaw, toLocalYaw } from '../core/math.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _l = new THREE.Vector3();
const _o = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_X = new THREE.Vector3(1, 0, 0);

export class Foot {
  constructor(side) {
    this.side = side; // +1 left, -1 right
    this.pos = new THREE.Vector3(); // ground reference point under the ankle
    this.yaw = 0;
    this.planted = true;
    this.t = 0; // swing progress 0..1
    this.dur = 0.3;
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.fromYaw = 0;
    this.toYaw = 0;
    this.height = 0.1;
    this.kick = 0;
    this.lift = 0;
    this.pitch = 0; // >0 heel raised (toes down), <0 toes up
    this.ankle = new THREE.Vector3(); // ankle IK target (output)
    this.quat = new THREE.Quaternion(); // foot world orientation (output)
    this.plantTime = 0;
    this.cyclic = false;
    this.phi0 = 0;
  }
}

export class Gait {
  constructor(events, owner) {
    this.events = events;
    this.owner = owner;
    this.L = new Foot(1);
    this.R = new Foot(-1);
    this.feet = [this.L, this.R];
    this.phase = 0;
    this.cadence = 0;
    this.duty = 0.6;
    this.swingFrac = 0.4;
    this.moving = false;
    this.airborne = false;
    this.runBlend = 0; // 0 walk .. 1 run
    this.bob = 0;
    this.pelvisShift = 0;
    this.stepCount = 0;
    this.lockedFoot = null; // pivot foot that must stay planted
    this.time = 0;
    // Pose hints
    this.hipYaw = 0;
    this.hipRoll = 0;
    this.armSwing = 0; // -1..1 (left arm forward = +1)
  }

  /** Place feet under the body instantly (spawn / reset). */
  reset(pos, yaw, stanceWidth = 0.34, stagger = 0) {
    for (const f of this.feet) {
      rotateYaw(_v, (f.side * stanceWidth) / 2, (f.side * stagger) / 2, yaw);
      f.pos.set(pos.x + _v.x, 0, pos.z + _v.z);
      f.yaw = yaw + f.side * 0.1;
      f.planted = true;
      f.t = 0;
      f.lift = 0;
      f.pitch = 0;
      f.cyclic = false;
      this._computeAnkle(f);
    }
    this.moving = false;
    this.airborne = false;
    this.phase = 0;
  }

  _home(out, f, body, stanceWidth, stagger) {
    rotateYaw(out, (f.side * stanceWidth) / 2, (f.side * stagger) / 2, body.yaw);
    out.x += body.pos.x;
    out.z += body.pos.z;
    out.y = 0;
    return out;
  }

  _beginSwing(f, to, toYaw, dur, height, kick = 0) {
    f.planted = false;
    f.t = 0;
    f.dur = Math.max(0.06, dur);
    f.from.copy(f.pos);
    f.to.copy(to);
    f.fromYaw = f.yaw;
    f.toYaw = toYaw;
    f.height = height;
    f.kick = kick;
  }

  _plant(f, body, intensity) {
    f.planted = true;
    f.pos.copy(f.to);
    f.pos.y = 0;
    f.yaw = f.toYaw;
    f.lift = 0;
    f.t = 0;
    f.plantTime = this.time;
    this.stepCount++;
    if (this.events) {
      this.events.emit('foot:plant', {
        athlete: this.owner,
        side: f.side,
        x: f.pos.x,
        z: f.pos.z,
        intensity,
        speed: body.speed,
      });
    }
  }

  /**
   * body: { pos, vel, acc, yaw, yawRate, speed, grounded, stanceWidth, stagger, lateral (0..1),
   *         stepScale, heightScale, pelvis (world pelvis pos, for airborne), crouch }
   */
  update(dt, body) {
    this.time += dt;
    const speed = body.speed;

    // ------------------------------------------------------------------ airborne
    if (!body.grounded) {
      if (!this.airborne) {
        this.airborne = true;
        for (const f of this.feet) {
          f.planted = false;
          f.from.copy(f.pos);
          f.t = 0;
        }
      }
      // feet hang under the hips, slightly tucked, following the body
      for (const f of this.feet) {
        rotateYaw(_v, f.side * 0.13, f.side * 0.05 + body.airTuckFwd * (f.side > 0 ? 1 : -0.4), body.yaw);
        const tuck = body.airTuck * (f.side > 0 ? 1 : 0.6);
        f.pos.set(body.pos.x + _v.x, body.pos.y + 0.0 + tuck * 0.22, body.pos.z + _v.z);
        f.yaw = body.yaw + f.side * 0.12;
        f.pitch = 0.35 + tuck * 0.3;
        f.lift = f.pos.y;
        f.to.copy(f.pos);
        f.to.y = 0;
        f.toYaw = f.yaw;
        this._computeAnkle(f, true);
      }
      this.bob = 0;
      return;
    }
    if (this.airborne) {
      // touchdown: plant both feet where they are
      this.airborne = false;
      for (const f of this.feet) {
        f.to.set(f.pos.x, 0, f.pos.z);
        f.toYaw = f.yaw;
        this._plant(f, body, 1.0);
        f.cyclic = false;
      }
      this.moving = false;
    }

    // ------------------------------------------------------------------ gait parameters
    const lat = body.lateral; // 0 normal, 1 defensive shuffle
    const run = smoothstep(1.6, 3.6, speed) * (1 - lat * 0.8);
    this.runBlend = damp(this.runBlend, run, 8, dt);
    const cRun = clamp(0.78 + 0.155 * speed, 0.78, 1.85);
    const cShuffle = clamp(speed / (2 * 0.42), 1.3, 4.4);
    const cadence = lerp(cRun, cShuffle, lat) * body.cadenceScale;
    this.duty = lerp(lerp(0.62, 0.34, this.runBlend), 0.55, lat);
    this.swingFrac = 1 - this.duty;
    const stepH = lerp(lerp(0.075, 0.13 + 0.018 * speed, this.runBlend), 0.04, lat) * body.heightScale;
    const kick = this.runBlend * clamp((speed - 3) * 0.06, 0, 0.22) * (1 - lat);

    const startMove = speed > 0.42;
    const keepMove = speed > 0.24;
    if (!this.moving && startMove && !this.lockedFoot) {
      this.moving = true;
      this._startCycle(body);
    } else if (this.moving && (!keepMove || this.lockedFoot)) {
      this.moving = false;
      // convert cyclic swings to timed swings toward their home spots
      for (const f of this.feet) {
        if (!f.planted && f.cyclic) {
          f.cyclic = false;
          const remain = this.cadence > 0 ? ((1 - f.t) * this.swingFrac) / this.cadence : 0.12;
          f.dur = Math.max(0.08, remain / Math.max(0.05, 1 - f.t));
        }
      }
    }

    if (this.moving) {
      this.cadence = cadence;
      this.phase = (this.phase + cadence * dt) % 1;
      for (let i = 0; i < 2; i++) {
        const f = this.feet[i];
        const offset = i === 0 ? 0 : 0.5;
        let phi = this.phase + offset;
        phi -= Math.floor(phi);
        if (phi < this.swingFrac) {
          const timeLeft = (this.swingFrac - phi) / cadence;
          if (f.planted) {
            // lift off only if the other foot is down (prevents both feet airborne while walking)
            const other = this.feet[1 - i];
            if (!other.planted && this.runBlend < 0.5 && phi < this.swingFrac * 0.5) continue;
            this._predictLanding(_w, f, body, timeLeft, cadence);
            this._beginSwing(f, _w, this._landingYaw(f, body), timeLeft, stepH, kick);
            f.cyclic = true;
            f.phi0 = phi;
          }
          if (f.cyclic) {
            f.t = clamp01((phi - f.phi0) / Math.max(1e-3, this.swingFrac - f.phi0));
            this._predictLanding(_w, f, body, timeLeft, cadence);
            // retarget smoothly (the target keeps moving with the body)
            const k = 1 - Math.exp(-28 * dt);
            f.to.x += (_w.x - f.to.x) * k;
            f.to.z += (_w.z - f.to.z) * k;
            f.toYaw = f.toYaw + angleDiff(f.toYaw, this._landingYaw(f, body)) * k;
            f.height = stepH;
            f.kick = kick;
          }
        } else if (!f.planted && f.cyclic) {
          this._plant(f, body, clamp01(0.25 + speed * 0.13));
        }
      }
    } else {
      this.cadence = 0;
      this._idleStepping(dt, body);
    }

    // advance non-cyclic swings
    for (const f of this.feet) {
      if (!f.planted && !f.cyclic) {
        f.t = Math.min(1, f.t + dt / f.dur);
        if (f.t >= 1) this._plant(f, body, 0.25 + speed * 0.1);
      }
    }

    // ------------------------------------------------------------------ outputs
    for (const f of this.feet) {
      if (!f.planted) this._swingPose(f, body);
      else this._stancePose(f, body, dt);
      this._computeAnkle(f);
    }

    // pelvis bob: two oscillations per cycle
    if (this.moving) {
      const midL = this.swingFrac + this.duty * 0.5;
      const ph = (this.phase - midL) * Math.PI * 4;
      const amp = lerp(0.018, -0.03 - 0.004 * speed, this.runBlend) * (1 - lat * 0.6);
      this.bob = damp(this.bob, amp * Math.cos(ph), 30, dt);
      // hip yaw toward the swinging leg, arm swing opposite to legs
      const s = Math.sin(this.phase * Math.PI * 2);
      this.hipYaw = damp(this.hipYaw, s * lerp(0.08, 0.16, this.runBlend) * (1 - lat), 20, dt);
      this.hipRoll = damp(this.hipRoll, -Math.cos(this.phase * Math.PI * 2) * 0.05 * (1 - lat), 20, dt);
      this.armSwing = damp(this.armSwing, -s, 25, dt);
    } else {
      this.bob = damp(this.bob, 0, 10, dt);
      this.hipYaw = damp(this.hipYaw, 0, 8, dt);
      this.hipRoll = damp(this.hipRoll, 0, 8, dt);
      this.armSwing = damp(this.armSwing, 0, 6, dt);
    }
  }

  _startCycle(body) {
    // Lead with the foot that is farthest behind its next ideal spot, or the side we move toward.
    toLocalYaw(_l, body.vel.x, body.vel.z, body.yaw);
    let lead;
    if (body.lateral > 0.5 && Math.abs(_l.x) > Math.abs(_l.z) * 0.6) {
      lead = _l.x > 0 ? 0 : 1; // moving left (local +x): left foot leads
    } else {
      let best = -1;
      let bi = 0;
      for (let i = 0; i < 2; i++) {
        const f = this.feet[i];
        this._home(_o, f, body, body.stanceWidth, 0);
        _o.addScaledVector(body.vel, 0.25);
        const d = Math.hypot(_o.x - f.pos.x, _o.z - f.pos.z);
        if (d > best) {
          best = d;
          bi = i;
        }
      }
      lead = bi;
    }
    // If a foot is mid-swing already, continue that one.
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      if (!f.planted) {
        lead = i;
        break;
      }
    }
    const offset = lead === 0 ? 0 : 0.5;
    const leadFoot = this.feet[lead];
    const swingFrac = this.swingFrac;
    const phi = leadFoot.planted ? 0.0 : clamp01(leadFoot.t) * swingFrac;
    let ph = phi - offset;
    ph -= Math.floor(ph);
    this.phase = ph;
    if (!leadFoot.planted) {
      leadFoot.cyclic = true;
      leadFoot.phi0 = phi - clamp01(leadFoot.t) * swingFrac; // keep current progress continuous
      if (leadFoot.phi0 < 0) leadFoot.phi0 = 0;
    }
    const other = this.feet[1 - lead];
    if (!other.planted) {
      // finish the other's step on its own timer
      other.cyclic = false;
    }
  }

  _landingYaw(f, body) {
    return body.yaw + f.side * 0.1;
  }

  _predictLanding(out, f, body, timeLeft, cadence) {
    const stance = this.duty / Math.max(cadence, 0.1);
    const lead = timeLeft + stance * lerp(0.5, 0.36, this.runBlend);
    const ax = clamp(body.acc.x, -12, 12);
    const az = clamp(body.acc.z, -12, 12);
    const tA = Math.min(timeLeft, 0.25);
    out.x = body.pos.x + body.vel.x * lead + 0.5 * ax * tA * tA;
    out.z = body.pos.z + body.vel.z * lead + 0.5 * az * tA * tA;
    const yaw = body.yaw + clamp(body.yawRate * timeLeft, -0.6, 0.6);
    const width = lerp(body.stanceWidth, 0.17, this.runBlend);
    rotateYaw(_v, (f.side * width) / 2, (f.side * body.stagger * (1 - this.runBlend)) / 2, yaw);
    out.x += _v.x;
    out.z += _v.z;
    out.y = 0;
    // no-cross constraint (relative to the other foot) in body space
    const other = f === this.L ? this.R : this.L;
    toLocalYaw(_l, out.x - other.pos.x, out.z - other.pos.z, yaw);
    const minGap = lerp(0.2, 0.1, this.runBlend);
    const lateral = _l.x * f.side; // positive = on own side
    if (lateral < minGap) {
      _l.x += (minGap - lateral) * f.side;
      rotateYaw(_v, _l.x, _l.z, yaw);
      out.x = other.pos.x + _v.x;
      out.z = other.pos.z + _v.z;
    }
    // limit step length (reach)
    const maxStep = lerp(0.85, 2.3, this.runBlend);
    const dx = out.x - f.pos.x;
    const dz = out.z - f.pos.z;
    const len = Math.hypot(dx, dz);
    if (len > maxStep) {
      out.x = f.pos.x + (dx / len) * maxStep;
      out.z = f.pos.z + (dz / len) * maxStep;
    }
    return out;
  }

  _idleStepping(dt, body) {
    if (this.L.planted === false || this.R.planted === false) {
      // retarget the swinging foot toward its home
      for (const f of this.feet) {
        if (!f.planted && !f.cyclic) {
          if (f === this.lockedFoot) continue;
          this._home(_w, f, body, body.stanceWidth, body.stagger);
          _w.addScaledVector(body.vel, (1 - f.t) * f.dur);
          const k = 1 - Math.exp(-14 * dt);
          f.to.x += (_w.x - f.to.x) * k;
          f.to.z += (_w.z - f.to.z) * k;
          f.toYaw += angleDiff(f.toYaw, this._landingYaw(f, body)) * k;
        }
      }
      return;
    }
    // both planted: decide on a corrective step
    let worst = null;
    let worstScore = 0;
    for (const f of this.feet) {
      if (f === this.lockedFoot) continue;
      this._home(_w, f, body, body.stanceWidth, body.stagger);
      const d = Math.hypot(_w.x - f.pos.x, _w.z - f.pos.z);
      const yawErr = Math.abs(angleDiff(f.yaw, this._landingYaw(f, body)));
      const score = Math.max(d / 0.13, yawErr / 0.55, d > 0.045 && this.time - f.plantTime > 1.2 ? 1.01 : 0);
      if (score > worstScore) {
        worstScore = score;
        worst = f;
      }
    }
    if (worst && worstScore >= 1 && this.time - worst.plantTime > 0.07) {
      this._home(_w, worst, body, body.stanceWidth, body.stagger);
      const dur = clamp(0.17 + Math.hypot(_w.x - worst.pos.x, _w.z - worst.pos.z) * 0.18, 0.16, 0.3) * body.cadenceScaleIdle;
      _w.addScaledVector(body.vel, dur);
      this._beginSwing(worst, _w, this._landingYaw(worst, body), dur, 0.055 * body.heightScale, 0);
      worst.cyclic = false;
    }
  }

  _swingPose(f, body) {
    const t = f.t;
    // horizontal: ease in/out, slightly front-loaded for a snappy step
    const sh = t * t * (3 - 2 * t);
    f.pos.x = f.from.x + (f.to.x - f.from.x) * sh;
    f.pos.z = f.from.z + (f.to.z - f.from.z) * sh;
    // lift arc (peak a bit before mid-swing)
    const arc = Math.sin(Math.PI * Math.pow(t, 0.85));
    f.lift = f.height * arc;
    // heel kick back during early swing when running
    if (f.kick > 0) {
      const k = f.kick * Math.sin(Math.PI * Math.min(1, t * 1.6)) * (1 - t);
      const dx = f.to.x - f.from.x;
      const dz = f.to.z - f.from.z;
      const len = Math.hypot(dx, dz) || 1;
      f.pos.x -= (dx / len) * k * 0.35;
      f.pos.z -= (dz / len) * k * 0.35;
      f.lift += k * 0.9;
    }
    f.pos.y = 0;
    f.yaw = f.fromYaw + angleDiff(f.fromYaw, f.toYaw) * sh;
    // toe-off -> toes up before contact
    f.pitch = lerp(0.55, -0.22, smoothstep(0.0, 0.85, t)) * Math.min(1, f.height / 0.06);
  }

  _stancePose(f, body, dt) {
    // heel rises as the hip passes the planted foot (toe pivot); flat otherwise
    let target = 0;
    if (this.moving) {
      const vx = body.vel.x;
      const vz = body.vel.z;
      const sp = Math.hypot(vx, vz) || 1;
      const behind = ((body.pos.x - f.pos.x) * vx + (body.pos.z - f.pos.z) * vz) / sp;
      target = clamp((behind - 0.12) / 0.4, 0, 1) * 0.8 * (1 - body.lateral * 0.5);
    }
    // planted feet in a deep stance stay flat
    f.pitch = damp(f.pitch, target, 22, dt);
    f.lift = 0;
  }

  _computeAnkle(f, air = false) {
    const p = f.pitch;
    const fwdX = Math.sin(f.yaw);
    const fwdZ = Math.cos(f.yaw);
    const a = DIM.ankleH;
    let up, fwd;
    if (air) {
      up = a;
      fwd = 0;
      f.ankle.set(f.pos.x, f.pos.y + up, f.pos.z);
    } else if (!f.planted) {
      f.ankle.set(f.pos.x, f.lift + a, f.pos.z);
    } else if (p > 0) {
      // pivot at the toe
      const ff = DIM.footFwd;
      up = a * Math.cos(p) + ff * Math.sin(p);
      fwd = ff + (a * Math.sin(p) - ff * Math.cos(p));
      f.ankle.set(f.pos.x + fwdX * fwd, up, f.pos.z + fwdZ * fwd);
    } else {
      const b = DIM.footBack;
      up = a * Math.cos(p) - b * Math.sin(p);
      fwd = -b + (a * Math.sin(p) + b * Math.cos(p));
      f.ankle.set(f.pos.x + fwdX * fwd, up, f.pos.z + fwdZ * fwd);
    }
    _qa.setFromAxisAngle(AX_Y, f.yaw);
    _qb.setFromAxisAngle(AX_X, p);
    f.quat.copy(_qa).multiply(_qb);
  }

  /** Force a foot to step to a world target (moves / pivots). */
  forceStep(f, target, yaw, dur, height = 0.06) {
    this._beginSwing(f, target, yaw, dur, height, 0);
    f.cyclic = false;
  }

  anyPlanted() {
    return this.L.planted || this.R.planted;
  }
}

export { wrapAngle };
