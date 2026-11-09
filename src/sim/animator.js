// Procedural full-body animation.
// Layers: gait (world-locked feet) -> pelvis (height, bob, weight shift, lean) -> spine/head (lean
// into acceleration, twist, look-at) -> arms (mode-based hand targets, spring-smoothed in chest
// space, solved with hinge-correct IK) -> hands (palm orientation for ball contact).
import * as THREE from 'three';
import { Gait } from './gait.js';
import { DIM, handQuat } from './rig.js';
import { BALL } from './constants.js';
import {
  clamp, clamp01, lerp, damp, smoothstep, Spring, Spring3, angleDiff, rotateYaw, toLocalYaw, bell,
} from '../core/math.js';

const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _fd = new THREE.Vector3();
const _pd = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _tgt = new THREE.Vector3();
const _loc = new THREE.Vector3();
const _qid = new THREE.Quaternion();

const LEG_LEN = DIM.thigh + DIM.shin;

/** Per-arm target description produced by arm layers. */
class ArmTarget {
  constructor() {
    this.pos = new THREE.Vector3(); // wrist target, world
    this.pole = new THREE.Vector3(); // elbow direction, world
    this.finger = new THREE.Vector3(0, -1, 0); // world
    this.palm = new THREE.Vector3(1, 0, 0); // world
    this.kinematic = false; // bypass smoothing (ball contact)
    this.stiff = 12; // spring frequency
  }
}

export class Animator {
  constructor(athlete, events) {
    this.a = athlete;
    this.rig = athlete.rig;
    this.gait = new Gait(events, athlete);
    this.crouch = new Spring(3.2, 0.85, 0.25);
    this.leanF = new Spring(2.6, 0.62, 0);
    this.leanS = new Spring(2.6, 0.62, 0);
    this.twist = new Spring(4, 0.9, 0);
    this.dip = new Spring(4.5, 0.42, 0); // landing / plant compression
    this.shift = new Spring(3, 0.8, 0); // lateral weight shift
    this.headYaw = new Spring(5, 0.9, 0);
    this.headPitch = new Spring(5, 0.9, 0);
    this.pelvisY = DIM.pelvisH;
    this.arm = { L: new ArmTarget(), R: new ArmTarget() };
    this.handSpring = { L: new Spring3(12, 1), R: new Spring3(12, 1) }; // chest-local
    this.handLocal = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    this.handQ = { L: new THREE.Quaternion(), R: new THREE.Quaternion() };
    this.handQSmooth = { L: new THREE.Quaternion(), R: new THREE.Quaternion() };
    this.palmWorld = { L: new THREE.Vector3(), R: new THREE.Vector3() }; // palm center
    this.palmNormal = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    this.fingerWorld = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    this.wristWorld = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    this.headWorld = new THREE.Vector3();
    this.chestWorld = new THREE.Vector3();
    this.pelvisWorld = new THREE.Vector3();
    this.time = 0;
    this.prevGrounded = true;
    this.body = {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      acc: new THREE.Vector3(),
      yaw: 0,
      yawRate: 0,
      speed: 0,
      grounded: true,
      stanceWidth: 0.36,
      stagger: 0,
      lateral: 0,
      cadenceScale: 1,
      cadenceScaleIdle: 1,
      heightScale: 1,
      airTuck: 0,
      airTuckFwd: 0,
    };
    this.flutter = Math.random() * 10;
    this.initialized = false;
  }

  reset() {
    const a = this.a;
    this.gait.reset(a.pos, a.yaw, a.anim.stanceWidth, a.anim.stagger);
    this.crouch.set(a.anim.crouch);
    this.leanF.set(0);
    this.leanS.set(0);
    this.twist.set(0);
    this.dip.set(0);
    this.shift.set(0);
    this.initialized = false;
    this.update(1 / 120);
    this.update(1 / 120);
    this.rig.snapPose();
  }

  /** Landing / hard plant compression impulse. */
  impulseDip(amount) {
    this.dip.v -= amount;
  }

  update(dt) {
    const a = this.a;
    const an = a.anim;
    const rig = this.rig;
    this.time += dt;

    // ------------------------------------------------------------ body description for gait
    const b = this.body;
    b.pos.copy(a.pos);
    b.vel.set(a.vel.x, 0, a.vel.z);
    b.acc.copy(a.accSmooth);
    b.yaw = a.yaw;
    b.yawRate = a.yawRate;
    b.speed = Math.hypot(a.vel.x, a.vel.z);
    b.grounded = a.grounded;
    b.stanceWidth = an.stanceWidth;
    b.stagger = an.stagger;
    b.lateral = an.lateral;
    b.cadenceScale = an.cadenceScale;
    b.heightScale = an.stepHeight;
    b.airTuck = an.airTuck;
    b.airTuckFwd = an.airTuckFwd;
    this.gait.lockedFoot = an.lockFoot === 1 ? this.gait.L : an.lockFoot === -1 ? this.gait.R : null;
    this.gait.update(dt, b);

    if (a.grounded && !this.prevGrounded) this.impulseDip(clamp(a.landingSpeed * 0.55, 0.4, 2.6));
    this.prevGrounded = a.grounded;

    // ------------------------------------------------------------ posture springs
    const speed = b.speed;
    toLocalYaw(_v1, a.accSmooth.x, a.accSmooth.z, a.yaw);
    const accF = _v1.z;
    const accS = _v1.x;
    toLocalYaw(_v2, a.vel.x, a.vel.z, a.yaw);
    const velF = _v2.z;
    const runPosture = smoothstep(2, 6.5, Math.max(0, velF)) * 0.16;
    const leanFT = clamp(Math.atan2(accF, 9.81) * 0.5 + runPosture + an.leanF, -0.45, 0.6);
    const leanST = clamp(Math.atan2(accS, 9.81) * 0.42 + an.leanS, -0.4, 0.4);
    this.leanF.update(dt, leanFT);
    this.leanS.update(dt, leanST);
    this.crouch.update(dt, an.crouch);
    this.twist.update(dt, an.twist);
    this.dip.update(dt, 0);
    // weight over the planted foot when moving slowly
    const g = this.gait;
    let shiftT = 0;
    if (g.moving && g.runBlend < 0.6) {
      if (g.L.planted && !g.R.planted) shiftT = 0.035;
      else if (g.R.planted && !g.L.planted) shiftT = -0.035;
    }
    this.shift.update(dt, shiftT * (1 - an.lateral));

    // ------------------------------------------------------------ root + pelvis
    const root = rig.j('root');
    root.position.set(a.pos.x, 0, a.pos.z);
    root.quaternion.setFromAxisAngle(AX_Y, a.yaw);

    const crouch = clamp(this.crouch.x, -0.1, 1);
    let pelvisH = DIM.pelvisH - crouch * 0.42 + g.bob + Math.min(0, this.dip.x) * 0.12 + an.pelvisLift;
    pelvisH += a.pos.y; // jump height
    // Clamp by leg reach for planted feet so knees never hyper-extend and feet never float.
    if (a.grounded) {
      for (const f of g.feet) {
        if (!f.planted && f.t < 0.85) continue;
        rotateYaw(_hip, f.side * DIM.hipX, 0, a.yaw);
        const hx = a.pos.x + _hip.x;
        const hz = a.pos.z + _hip.z;
        const dh = Math.hypot(f.ankle.x - hx, f.ankle.z - hz);
        const reach = LEG_LEN * 0.985;
        if (dh < reach) {
          const maxH = f.ankle.y + Math.sqrt(reach * reach - dh * dh) - DIM.hipY;
          if (pelvisH > maxH) pelvisH = maxH;
        } else {
          pelvisH = Math.min(pelvisH, f.ankle.y + 0.05 - DIM.hipY);
        }
      }
    }
    if (!this.initialized) {
      this.pelvisY = pelvisH;
      this.initialized = true;
    }
    // limit vertical pelvis speed for smoothness (except when jumping)
    const maxRate = a.grounded ? 3.2 : 30;
    this.pelvisY += clamp(pelvisH - this.pelvisY, -maxRate * dt, maxRate * dt);
    const pelvis = rig.j('pelvis');
    // lean shifts hips backward a little so the head stays over the base of support
    const lf = this.leanF.x;
    const ls = this.leanS.x;
    pelvis.position.set(this.shift.x - ls * 0.06, this.pelvisY, -lf * 0.06 - crouch * 0.05 + an.pelvisFwd);
    _e.set(lf * 0.35 + crouch * 0.18 + an.pelvisPitch, g.hipYaw + this.twist.x * 0.25 + an.hipYaw, -ls * 0.4 + g.hipRoll, 'YXZ');
    pelvis.quaternion.setFromEuler(_e);

    // ------------------------------------------------------------ spine / chest
    const spine = rig.j('spine');
    const chest = rig.j('chest');
    // crouching hinges the torso forward at the hips; chest counter-rotates the hip swing
    const fwdBend = lf * 0.35 + crouch * 0.42 + an.spineBend;
    _e.set(fwdBend * 0.55, -g.hipYaw * 0.5 + this.twist.x * 0.35, -ls * 0.3, 'YXZ');
    spine.quaternion.setFromEuler(_e);
    _e.set(fwdBend * 0.45 - crouch * 0.2 + an.chestPitch, -g.hipYaw * 0.6 + this.twist.x * 0.4 + an.chestYaw, -ls * 0.2 + an.chestRoll, 'YXZ');
    chest.quaternion.setFromEuler(_e);
    rig.update();

    // ------------------------------------------------------------ head look
    const neck = rig.j('neck');
    const head = rig.j('head');
    let hy = 0;
    let hp = 0;
    if (an.lookAt) {
      chest.updateWorldMatrix(true, false);
      _inv.copy(chest.matrixWorld).invert();
      _v1.copy(an.lookAt).applyMatrix4(_inv);
      _v1.y -= DIM.neck + DIM.head + 0.08;
      hy = clamp(Math.atan2(_v1.x, _v1.z), -1.2, 1.2);
      hp = clamp(-Math.atan2(_v1.y, Math.hypot(_v1.x, _v1.z)), -0.6, 0.7);
    }
    hp += an.headPitch;
    this.headYaw.update(dt, hy);
    this.headPitch.update(dt, hp);
    _e.set(this.headPitch.x * 0.4, this.headYaw.x * 0.4, 0, 'YXZ');
    neck.quaternion.setFromEuler(_e);
    _e.set(this.headPitch.x * 0.6 - crouch * 0.15, this.headYaw.x * 0.6, 0, 'YXZ');
    head.quaternion.setFromEuler(_e);

    // ------------------------------------------------------------ legs (IK)
    this._legIK('L', g.L, a.yaw);
    this._legIK('R', g.R, a.yaw);

    // ------------------------------------------------------------ arms
    rig.update();
    chest.getWorldPosition(this.chestWorld);
    pelvis.getWorldPosition(this.pelvisWorld);
    head.getWorldPosition(this.headWorld);
    this._armLayers(dt);
    this._armIK('L', dt);
    this._armIK('R', dt);
    rig.update();
    this._captureHands();
    rig.commitPose();
  }

  _legIK(sideKey, foot, yaw) {
    const rig = this.rig;
    const thigh = rig.j('thigh' + sideKey);
    const shin = rig.j('shin' + sideKey);
    const footJ = rig.j('foot' + sideKey);
    // knee points along the foot direction, slightly outward
    const fy = foot.yaw + foot.side * 0.12;
    _pole.set(Math.sin(fy), 0.12, Math.cos(fy));
    rig.solveTwoBone(thigh, shin, DIM.thigh, DIM.shin, foot.ankle, _pole, 1);
    footJ.updateWorldMatrix(true, false);
    rig.setWorldQuat(footJ, foot.quat);
  }

  // ---------------------------------------------------------------------------------------------
  // Arm layers produce world-space wrist targets.
  _chestToWorld(out, x, y, z) {
    return out.set(x, y, z).applyMatrix4(this.rig.j('chest').matrixWorld);
  }
  _dirChestToWorld(out, x, y, z) {
    const m = this.rig.j('chest').matrixWorld;
    return out.set(x, y, z).transformDirection(m);
  }
  _dirBodyToWorld(out, x, y, z) {
    rotateYaw(out, x, z, this.a.yaw);
    out.y = y;
    return out.normalize();
  }

  _armLayers(dt) {
    const a = this.a;
    const an = a.anim;
    const mode = an.arms;
    for (const key of ['L', 'R']) {
      const side = key === 'L' ? 1 : -1;
      const t = this.arm[key];
      t.kinematic = false;
      t.stiff = 11;
      switch (mode) {
        case 'dribble':
          if (side === a.dribble.hand) this._dribbleHand(t, side);
          else this._guardHand(t, side);
          break;
        case 'hold':
          this._holdHand(t, side, an.ballPos, an.gripFwd, an.gripUp);
          break;
        case 'shoot':
          this._shootHand(t, side);
          break;
        case 'defend':
          this._defendHand(t, side, dt);
          break;
        case 'reach':
          if (side === an.reachSide) this._reachHand(t, side);
          else this._defendHand(t, side, dt);
          break;
        case 'contest':
          this._contestHand(t, side);
          break;
        case 'pose':
          this._poseHand(t, side);
          break;
        default:
          this._freeHand(t, side);
      }
    }
  }

  _freeHand(t, side) {
    const g = this.gait;
    const run = g.runBlend;
    const swing = (side > 0 ? -1 : 1) * g.armSwing;
    const amp = lerp(0.18, 0.85, run) * this.a.anim.armSwingScale;
    const th = swing * amp + 0.08;
    const flex = lerp(0.35, 1.45, run) + Math.max(0, swing) * 0.25 * run;
    const sx = side * (DIM.clavX + DIM.shoulderX);
    const sy = DIM.clavY;
    // upper arm direction in chest space (swinging forward/back), elbow slightly out
    const ux = side * 0.12;
    const uy = -Math.cos(th);
    const uz = Math.sin(th);
    const ex = sx + ux * DIM.upperArm;
    const ey = sy + uy * DIM.upperArm;
    const ez = uz * DIM.upperArm;
    const fx = side * 0.05;
    const fy = -Math.cos(th + flex);
    const fz = Math.sin(th + flex);
    this._chestToWorld(t.pos, ex + fx * DIM.forearm - side * 0.04 * run, ey + fy * DIM.forearm, ez + fz * DIM.forearm);
    this._dirChestToWorld(t.pole, side * 0.4, 0, -1);
    this._dirChestToWorld(t.finger, side * 0.1, fy, fz);
    this._dirChestToWorld(t.palm, -side, 0, 0.2);
    t.stiff = 14;
  }

  _guardHand(t, side) {
    const a = this.a;
    // off-arm protects the ball: forearm across in front, raised when the defender is close
    const threat = a.anim.guardUp;
    const flutter = Math.sin(this.time * 7 + this.flutter) * 0.015;
    this._chestToWorld(
      t.pos,
      side * lerp(0.3, 0.22, threat),
      lerp(-0.34, -0.12, threat) + flutter,
      lerp(0.28, 0.42, threat)
    );
    this._dirChestToWorld(t.pole, side * 0.9, -0.2, -0.4);
    this._dirChestToWorld(t.finger, side * 0.25, 0.45, 1);
    this._dirChestToWorld(t.palm, side * 0.3, -0.2, 1);
    t.stiff = 9;
  }

  _dribbleHand(t, side) {
    const d = this.a.dribble;
    t.pos.copy(d.handTarget);
    // hand target is the palm; move to the wrist along fingers/palm
    t.finger.copy(d.handFinger);
    t.palm.copy(d.handPalm);
    t.pos.addScaledVector(t.finger, -DIM.palm * 0.85).addScaledVector(t.palm, -0.025);
    this._dirBodyToWorld(t.pole, side * 0.75, -0.25, -0.65);
    t.kinematic = d.contact;
    t.stiff = d.contact ? 30 : 15;
  }

  _holdHand(t, side, ballPos, gripFwd, gripUp) {
    // two-handed grip: hands on the sides of the ball, slightly behind its center
    const a = this.a;
    _v1.set(1, 0, 0);
    this._dirBodyToWorld(_v1, 1, 0, 0); // body left
    _v2.copy(gripFwd);
    t.palm.copy(_v1).multiplyScalar(-side); // palms face the ball
    t.palm.addScaledVector(_v2, 0.15).normalize();
    t.finger.copy(gripUp).multiplyScalar(0.55).addScaledVector(_v2, 0.8).normalize();
    t.pos.copy(ballPos).addScaledVector(_v1, side * (BALL.radius + 0.022)).addScaledVector(_v2, -0.035);
    t.pos.addScaledVector(t.finger, -DIM.palm * 0.85);
    this._dirBodyToWorld(t.pole, side * 0.8, -0.5, -0.3);
    t.kinematic = a.anim.holdKinematic;
    t.stiff = 22;
  }

  _shootHand(t, side) {
    const a = this.a;
    const an = a.anim;
    const shooting = side === an.shootSide;
    const B = an.ballPos;
    // shooting direction (horizontal)
    _fd.set(an.shotDir.x, 0, an.shotDir.z).normalize();
    _v1.set(_fd.z, 0, -_fd.x); // left of shot direction (up x fwd)
    if (an.released) {
      const ft = clamp01(an.followT);
      if (shooting) {
        // follow-through: arm extended toward the target, wrist snapped down ("goose neck")
        const relH = an.releaseHeight;
        _v2.copy(an.followPos);
        t.pos.copy(_v2);
        t.finger.set(_fd.x * 0.55, -0.8, _fd.z * 0.55).normalize();
        t.palm.set(_fd.x * 0.3, -0.95, _fd.z * 0.3).normalize();
        this._dirBodyToWorld(t.pole, side * 0.3, -1, 0.2);
        t.pos.y = relH - lerp(0, 0.5, smoothstep(0.55, 1, ft));
        t.stiff = 16;
      } else {
        // guide hand stays up then relaxes away
        this._chestToWorld(t.pos, side * 0.3, lerp(0.42, -0.1, smoothstep(0.35, 1, ft)), 0.3);
        this._dirChestToWorld(t.finger, side * 0.2, 1, 0.3);
        this._dirChestToWorld(t.palm, -side, 0, 0.3);
        this._dirChestToWorld(t.pole, side, -0.3, -0.2);
        t.stiff = 10;
      }
      return;
    }
    if (shooting) {
      // palm under/behind the ball, fingers up toward the rim
      t.palm.copy(_fd).multiplyScalar(0.7).addScaledVector(AX_Y, 0.7).normalize();
      t.finger.copy(AX_Y).multiplyScalar(0.8).addScaledVector(_fd, 0.6).addScaledVector(_v1, side * 0.1).normalize();
      t.pos.copy(B).addScaledVector(t.palm, -(BALL.radius + 0.018)).addScaledVector(t.finger, -DIM.palm * 0.8);
      this._dirBodyToWorld(t.pole, side * 0.25, -1, 0.15);
    } else {
      // guide hand on the side of the ball
      t.palm.copy(_v1).multiplyScalar(-side).addScaledVector(_fd, 0.1).normalize();
      t.finger.copy(AX_Y).multiplyScalar(0.9).addScaledVector(_fd, 0.3).normalize();
      t.pos.copy(B).addScaledVector(_v1, side * (BALL.radius + 0.02)).addScaledVector(t.finger, -DIM.palm * 0.8);
      this._dirBodyToWorld(t.pole, side * 1, -0.6, -0.1);
    }
    t.kinematic = true;
    t.stiff = 30;
  }

  _defendHand(t, side, dt) {
    const an = this.a.anim;
    const high = side === an.highHand;
    const fl = Math.sin(this.time * 9 + this.flutter + side) * 0.03;
    const fl2 = Math.cos(this.time * 7.3 + this.flutter * 2 + side) * 0.03;
    if (high) {
      // hand up and out toward the ball handler (contest-ready)
      this._chestToWorld(t.pos, side * 0.34, 0.74 + fl, 0.42 + fl2);
      this._dirChestToWorld(t.finger, side * 0.12, 1, 0.3);
      this._dirChestToWorld(t.palm, 0, 0.15, 1);
      this._dirChestToWorld(t.pole, side * 0.6, -1, -0.15);
      t.stiff = 8;
      return;
    } else {
      // low hand wide and in front, palm up to dig at the dribble
      this._chestToWorld(t.pos, side * 0.48, -0.24 + fl2, 0.42 + fl);
      this._dirChestToWorld(t.finger, side * 0.5, -0.1, 1);
      this._dirChestToWorld(t.palm, -side * 0.2, 0.6, 0.8);
    }
    this._dirChestToWorld(t.pole, side, -0.6, -0.4);
    t.stiff = 8;
  }

  _contestHand(t, side) {
    const an = this.a.anim;
    // both arms up, the lead hand toward the ball
    if (an.contestTarget && side === an.reachSide) {
      _v3.copy(an.contestTarget);
      t.pos.copy(_v3);
      _v4.subVectors(_v3, this.chestWorld).normalize();
      t.finger.copy(_v4);
      t.palm.copy(_v4).multiplyScalar(0.3).addScaledVector(AX_Y, 0.2);
      this._dirBodyToWorld(_v2, 0, 0, 1);
      t.palm.addScaledVector(_v2, 0.8).normalize();
    } else {
      this._chestToWorld(t.pos, side * 0.2, 0.86, 0.12);
      this._dirChestToWorld(t.finger, side * 0.08, 1, 0.1);
      this._dirChestToWorld(t.palm, 0, 0, 1);
    }
    this._dirChestToWorld(t.pole, side, -0.2, -0.3);
    t.stiff = 16;
  }

  _reachHand(t, side) {
    const an = this.a.anim;
    t.pos.copy(an.reachTarget);
    _v4.subVectors(an.reachTarget, this.chestWorld).normalize();
    t.finger.copy(_v4);
    t.palm.set(0, -0.6, 0).addScaledVector(_v4, 0.5).normalize();
    this._dirChestToWorld(t.pole, side, -0.5, -0.3);
    t.stiff = 20;
  }

  _poseHand(t, side) {
    // keyframed pose from the active action (celebrations / emotes / misc)
    const an = this.a.anim;
    const p = side > 0 ? an.poseL : an.poseR;
    this._chestToWorld(t.pos, p.x, p.y, p.z);
    const f = side > 0 ? an.poseFingerL : an.poseFingerR;
    this._dirChestToWorld(t.finger, f.x, f.y, f.z);
    this._dirChestToWorld(t.palm, -side, 0, 0.3);
    this._dirChestToWorld(t.pole, side, -0.4, -0.4);
    t.stiff = an.poseStiff;
  }

  // ---------------------------------------------------------------------------------------------
  _armIK(key, dt) {
    const rig = this.rig;
    const side = key === 'L' ? 1 : -1;
    const t = this.arm[key];
    const chest = rig.j('chest');
    const clav = rig.j('clav' + key);
    const upper = rig.j('upperArm' + key);
    const fore = rig.j('forearm' + key);
    const hand = rig.j('hand' + key);

    // smoothing in chest space (keeps arm motion coupled to the torso)
    _inv.copy(chest.matrixWorld).invert();
    _loc.copy(t.pos).applyMatrix4(_inv);
    const sp = this.handSpring[key];
    if (!this._armInit) {
      sp.set(_loc);
    }
    if (t.kinematic) {
      // track exactly, keep spring velocity coherent
      sp.v.subVectors(_loc, sp.x).multiplyScalar(1 / Math.max(dt, 1e-4));
      sp.v.clampLength(0, 12);
      sp.x.copy(_loc);
    } else {
      sp.freq = t.stiff;
      sp.update(dt, _loc);
    }
    _tgt.copy(sp.x).applyMatrix4(chest.matrixWorld);

    // clavicle shrug / protraction based on where the hand is going
    const shoulderLocalY = DIM.clavY;
    const up = clamp((sp.x.y - shoulderLocalY + 0.1) / 0.55, 0, 1);
    const fwd = clamp((sp.x.z - 0.25) / 0.4, 0, 1);
    _e.set(0, -side * fwd * 0.22, side * up * 0.32, 'XYZ');
    clav.quaternion.setFromEuler(_e);
    clav.updateWorldMatrix(true, false);

    rig.solveTwoBone(upper, fore, DIM.upperArm, DIM.forearm, _tgt, t.pole, -1);

    // hand orientation (smoothed with slerp)
    handQuat(_q1, t.finger, t.palm, side);
    const hq = this.handQSmooth[key];
    if (!this._armInit || t.kinematic) hq.copy(_q1);
    else hq.slerp(_q1, 1 - Math.exp(-t.stiff * 2.2 * dt));
    hand.updateWorldMatrix(true, false);
    // limit wrist bend relative to the forearm to keep it anatomical
    fore.getWorldQuaternion(_q2);
    _q3.copy(_q2).invert().multiply(hq);
    const ang = 2 * Math.acos(clamp(Math.abs(_q3.w), 0, 1));
    const maxAng = 1.45;
    if (ang > maxAng) {
      _q3.slerp(_qid, 1 - maxAng / ang);
    }
    hand.quaternion.copy(_q3);
    if (key === 'R') this._armInit = true;
  }

  _captureHands() {
    const rig = this.rig;
    for (const key of ['L', 'R']) {
      const side = key === 'L' ? 1 : -1;
      const hand = rig.j('hand' + key);
      hand.getWorldPosition(this.wristWorld[key]);
      hand.getWorldQuaternion(_q1);
      // fingers = local -Y, palm normal = local -X (left) / +X (right)
      this.fingerWorld[key].set(0, -1, 0).applyQuaternion(_q1);
      this.palmNormal[key].set(-side, 0, 0).applyQuaternion(_q1);
      this.palmWorld[key].copy(this.wristWorld[key]).addScaledVector(this.fingerWorld[key], DIM.palm);
    }
  }
}
