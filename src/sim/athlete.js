// Athlete: movement physics, facing, stamina, ball-handling state and the per-tick animation intent.
// Both the user and the CPU drive an Athlete through the same Intent interface (fairness: the AI
// has exactly the same movement limits, animation and physics as the player).
import * as THREE from 'three';
import { Rig } from './rig.js';
import { Animator } from './animator.js';
import { DribbleController } from './dribble.js';
import { BallState } from './ball.js';
import { GRAVITY, PLAYER, COURT, HOOP } from './constants.js';
import { clamp, clamp01, lerp, damp, angleDiff, wrapAngle, yawOf, toLocalYaw, rotateYaw, smoothstep } from '../core/math.js';

const _v = new THREE.Vector3();
const _l = new THREE.Vector3();
const _d = new THREE.Vector3();

export const Handling = {
  NONE: 'none',
  TRIPLE: 'triple', // holding, may still dribble
  DRIBBLE: 'dribble',
  PICKED: 'picked', // holding after a dribble: shoot / pivot only
};

/** What a controller (human or AI) wants this tick. */
export class Intent {
  constructor() {
    this.move = new THREE.Vector3(); // world-space, length 0..1
    this.sprint = false;
    this.shoot = false; // held
    this.shootPressed = false;
    this.shootReleased = false;
    this.move1 = null; // dribble move request id
    this.steal = false;
    this.jump = false; // contest / rebound jump
    this.emote = false;
  }
  clearEdges() {
    this.shootPressed = false;
    this.shootReleased = false;
    this.move1 = null;
    this.steal = false;
    this.jump = false;
    this.emote = false;
  }
}

function makeAnimIntent() {
  return {
    crouch: 0.25,
    stanceWidth: 0.36,
    stagger: 0,
    lateral: 0,
    cadenceScale: 1,
    stepHeight: 1,
    leanF: 0,
    leanS: 0,
    twist: 0,
    hipYaw: 0,
    pelvisLift: 0,
    pelvisFwd: 0,
    pelvisPitch: 0,
    spineBend: 0,
    chestPitch: 0,
    chestYaw: 0,
    chestRoll: 0,
    headPitch: 0,
    lookTarget: new THREE.Vector3(0, 2, 0),
    lookAt: null,
    arms: 'free',
    armSwingScale: 1,
    guardUp: 0,
    ballPos: new THREE.Vector3(),
    gripFwd: new THREE.Vector3(0, 0, 1),
    gripUp: new THREE.Vector3(0, 1, 0),
    holdKinematic: true,
    shootSide: -1,
    shotDir: new THREE.Vector3(0, 0, -1),
    released: false,
    followT: 0,
    followPos: new THREE.Vector3(),
    releaseHeight: 2.6,
    highHand: 1,
    reachSide: -1,
    reachTarget: new THREE.Vector3(),
    contestTarget: null,
    contestVec: new THREE.Vector3(),
    poseL: new THREE.Vector3(0.3, -0.5, 0.1),
    poseR: new THREE.Vector3(-0.3, -0.5, 0.1),
    poseFingerL: new THREE.Vector3(0, -1, 0),
    poseFingerR: new THREE.Vector3(0, -1, 0),
    poseStiff: 10,
    airTuck: 0,
    airTuckFwd: 0,
    lockFoot: 0,
  };
}

const ANIM_DEFAULTS = makeAnimIntent();
const SCALAR_KEYS = Object.keys(ANIM_DEFAULTS).filter((k) => typeof ANIM_DEFAULTS[k] !== 'object' || ANIM_DEFAULTS[k] === null);

export class Athlete {
  constructor(game, opts = {}) {
    this.game = game;
    this.events = game.events;
    this.id = opts.id || 'p';
    this.name = opts.name || 'Player';
    this.isUser = !!opts.isUser;
    this.team = opts.team || 0;
    this.ratings = Object.assign(
      {
        speed: 0.75,
        accel: 0.75,
        handle: 0.75,
        shotClose: 0.8,
        shotMid: 0.75,
        shotLong: 0.72,
        release: 0.75,
        defense: 0.72,
        steal: 0.7,
        block: 0.65,
        vertical: 0.7,
        stamina: 0.8,
        strength: 0.7,
      },
      opts.ratings || {}
    );
    this.shootHand = opts.shootHand || -1; // right-handed by default
    this.jumpshot = opts.jumpshot || 'classic';
    this.appearance = opts.appearance || {};

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.prevVelH = new THREE.Vector3();
    this.accSmooth = new THREE.Vector3();
    this.yaw = Math.PI;
    this.yawRate = 0;
    this.grounded = true;
    this.landingSpeed = 0;
    this.airTime = 0;
    this.stamina = 1;
    this.handling = Handling.NONE;
    this.input = new Intent();
    this.action = null;
    this.actionTime = 0;
    this.offBalance = 0; // seconds of reduced control
    this.stumble = 0;
    this.cooldowns = { steal: 0, jump: 0, move: 0, pickup: 0 };
    this.recentMoves = []; // {id, t}
    this.lastMoveEnd = -10;
    this.lastMoveId = null;
    this.moveChain = 0;
    this.time = 0;
    this.impulse = new THREE.Vector3();
    this.desiredVel = new THREE.Vector3();
    this.accelLimit = 10;
    this.mods = { speedMul: 1, accelMul: 1, turnMul: 1, allowMove: true, faceYaw: null, sprintOk: true, lateralMul: 1 };
    this.anim = makeAnimIntent();
    this.dribbleStyle = { side: 0.3, height: 0.9, fwd: 0.22, uCatch: 1.2, contactDur: 0.11 };
    this.rig = new Rig();
    this.dribble = new DribbleController(this, this.events);
    this.animator = new Animator(this, this.events);
    this.stats = null;
    this.defStance = 0; // smoothed 0..1
    this.speedNow = 0;
    this.plantCooldown = 0;
    this.wasSprinting = false;
  }

  get ball() {
    return this.game.ball;
  }
  get opponent() {
    return this.game.opponentOf(this);
  }
  hasBall() {
    const b = this.game.ball;
    return b.owner === this && (b.state === BallState.DRIBBLE || b.state === BallState.HELD);
  }
  isOffense() {
    return this.game.offense === this;
  }
  isDefending() {
    const o = this.opponent;
    return !!o && o.hasBall();
  }

  /** Place the athlete (no interpolation smear). */
  place(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.accSmooth.set(0, 0, 0);
    this.prevVelH.set(0, 0, 0);
    this.yaw = yaw;
    this.yawRate = 0;
    this.grounded = true;
    this.impulse.set(0, 0, 0);
    this.animator.reset();
  }

  resetIntent() {
    const an = this.anim;
    for (const k of SCALAR_KEYS) an[k] = ANIM_DEFAULTS[k];
    an.lookAt = null;
    an.contestTarget = null;
    const m = this.mods;
    m.speedMul = 1;
    m.accelMul = 1;
    m.turnMul = 1;
    m.allowMove = true;
    m.faceYaw = null;
    m.sprintOk = true;
    m.lateralMul = 1;
  }

  /** Yaw facing the rim from the current position. */
  yawToRim() {
    return yawOf(-this.pos.x, -this.pos.z);
  }
  distToRim() {
    return Math.hypot(this.pos.x, this.pos.z);
  }

  // ------------------------------------------------------------------------------------------------
  /** Base posture + arms for the current situation (actions override afterwards). */
  basePosture() {
    const an = this.anim;
    const opp = this.opponent;
    const ball = this.ball;
    const speed = this.speedNow;
    const sprinting = this.wasSprinting;
    toLocalYaw(_l, this.vel.x, this.vel.z, this.yaw);
    const latFrac = speed > 0.3 ? Math.abs(_l.x) / speed : 0;
    if (this.hasBall()) {
      // ball handler: athletic stance, eyes on the rim/defender
      const near = opp ? clamp01(1 - (Math.hypot(opp.pos.x - this.pos.x, opp.pos.z - this.pos.z) - 0.9) / 1.8) : 0;
      an.crouch = lerp(0.3, 0.14, smoothstep(2, 6, speed)) + near * 0.1;
      an.stanceWidth = 0.4;
      an.stagger = this.handling === Handling.DRIBBLE ? -this.dribble.hand * 0.12 : 0.1;
      an.lateral = latFrac * 0.65 * (sprinting ? 0.3 : 1);
      an.lookTarget.set(0, HOOP.rimY - 0.6, 0);
      if (opp && near > 0.3) an.lookTarget.lerp(_v.set(opp.pos.x, 1.5, opp.pos.z), 0.5);
      an.lookAt = an.lookTarget;
      an.guardUp = near;
      if (this.handling === Handling.DRIBBLE) an.arms = 'dribble';
      else {
        an.arms = 'hold';
        // triple threat / picked up: ball at the hip on the shooting side
        rotateYaw(_v, this.shootHand * 0.16, 0.22, this.yaw);
        an.ballPos.set(this.pos.x + _v.x, 0.98 - an.crouch * 0.2 + this.pos.y, this.pos.z + _v.z);
        rotateYaw(an.gripFwd, 0, 1, this.yaw);
        an.gripUp.set(0, 1, 0);
        an.crouch = 0.42;
        an.stanceWidth = 0.44;
        an.stagger = 0.16 * -this.shootHand;
      }
      // dribble style (catch spot) by speed / pressure
      const st = this.dribbleStyle;
      const run = smoothstep(1.5, 5.5, speed);
      st.height = lerp(0.88, 1.0, run) - near * 0.12 - (an.crouch - 0.25) * 0.3;
      st.side = lerp(0.31, 0.26, run) + near * 0.05;
      toLocalYaw(_l, this.vel.x, this.vel.z, this.yaw);
      st.fwd = clamp(0.2 + _l.z * 0.045, 0.06, 0.46) - near * 0.06;
      st.uCatch = lerp(1.25, 2.0, run) + near * 0.6;
      st.contactDur = lerp(0.12, 0.1, run);
    } else if (this.isDefending()) {
      const d = opp ? Math.hypot(opp.pos.x - this.pos.x, opp.pos.z - this.pos.z) : 9;
      const engage = clamp01(1 - (d - 1.2) / 4.5) * (sprinting ? 0.15 : 1);
      this.defStance = engage;
      an.crouch = lerp(0.2, 0.55, engage);
      an.stanceWidth = lerp(0.38, 0.66, engage);
      an.stagger = 0.08 * engage * (opp ? opp.dribble.hand : 1);
      an.lateral = latFrac * engage;
      an.cadenceScale = 1;
      an.stepHeight = lerp(1, 0.75, engage);
      an.lookTarget.set(opp.pos.x, 1.2, opp.pos.z);
      if (ball.state === BallState.DRIBBLE) an.lookTarget.lerp(ball.pos, 0.4);
      an.lookAt = an.lookTarget;
      an.arms = engage > 0.25 ? 'defend' : 'free';
      // high hand on the opponent's ball side (mirror), low hand digs
      an.highHand = opp && opp.dribble ? -opp.dribble.hand : 1;
    } else {
      an.crouch = lerp(0.18, 0.12, smoothstep(2, 6, speed));
      an.stanceWidth = 0.36;
      an.lateral = latFrac * 0.4 * (sprinting ? 0 : 1);
      an.arms = 'free';
      if (ball.state === BallState.FREE) {
        an.lookTarget.copy(ball.pos);
        an.lookAt = an.lookTarget;
      } else if (opp) {
        an.lookTarget.set(opp.pos.x, 1.4, opp.pos.z);
        an.lookAt = an.lookTarget;
      }
    }
    if (this.stamina < 0.25 && speed < 0.5 && !this.hasBall()) an.crouch += 0.1;
  }

  // ------------------------------------------------------------------------------------------------
  updateMovement(dt) {
    const inp = this.input;
    const m = this.mods;
    const r = this.ratings;
    const offense = this.hasBall();
    const defense = this.isDefending();
    const opp = this.opponent;

    let mv = _d.copy(inp.move);
    mv.y = 0;
    let mag = Math.min(1, mv.length());
    if (!m.allowMove || this.stumble > 0) {
      mag = this.stumble > 0 ? mag * 0.15 : 0;
    }
    if (mag > 1e-3) mv.multiplyScalar(1 / Math.max(mv.length(), 1e-6));
    const sprint = inp.sprint && m.sprintOk && this.stamina > 0.04 && mag > 0.3;
    this.wasSprinting = sprint;

    const speed = Math.hypot(this.vel.x, this.vel.z);
    // ---------------------------------------------------------------- facing
    let faceYaw = this.yaw;
    if (m.faceYaw !== null) faceYaw = m.faceYaw;
    else if (defense && !sprint) {
      faceYaw = yawOf(opp.pos.x - this.pos.x, opp.pos.z - this.pos.z);
    } else if (offense) {
      const rimYaw = this.yawToRim();
      if (mag > 0.2) {
        const toward = -(mv.x * this.pos.x + mv.z * this.pos.z) / Math.max(0.5, this.distToRim());
        if (sprint || toward > 0.2) faceYaw = yawOf(mv.x, mv.z);
        else faceYaw = rimYaw;
      } else faceYaw = rimYaw;
    } else if (mag > 0.2) faceYaw = yawOf(mv.x, mv.z);
    else if (this.game.ball.state === BallState.FREE) {
      const b = this.game.ball.pos;
      if (Math.hypot(b.x - this.pos.x, b.z - this.pos.z) > 0.6) faceYaw = yawOf(b.x - this.pos.x, b.z - this.pos.z);
    }

    const turnMax = lerp(11, 5.2, clamp01(speed / 7)) * m.turnMul * (this.grounded ? 1 : 0.15);
    const w = 2 * Math.PI * 3.1;
    const diff = angleDiff(this.yaw, faceYaw);
    this.yawRate += (w * w * diff - 2 * 0.95 * w * this.yawRate) * dt;
    this.yawRate = clamp(this.yawRate, -turnMax, turnMax);
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

    // ---------------------------------------------------------------- target velocity
    const fatigue = this.stamina < 0.3 ? lerp(0.86, 1, this.stamina / 0.3) : 1;
    const jog = (offense ? 4.35 : 4.7) + (r.speed - 0.75) * 1.2;
    const sprintSpeed = (offense ? 6.75 : 7.2) + (r.speed - 0.75) * 1.6;
    const slide = 3.65 + (r.defense - 0.72) * 1.3;
    let fwdMax = sprint ? sprintSpeed : jog;
    let latMax = defense ? slide * m.lateralMul : offense ? 3.9 : 4.4;
    let backMax = defense ? 3.2 : offense ? 3.0 : 3.4;
    if (sprint) {
      latMax = Math.max(latMax, defense ? slide : 4.2);
      backMax = Math.max(backMax, 3.4);
    }
    toLocalYaw(_l, mv.x, mv.z, this.yaw);
    const lx = _l.x;
    const lz = _l.z;
    const zMax = lz >= 0 ? fwdMax : backMax;
    const maxAlong = 1 / Math.sqrt((lx * lx) / (latMax * latMax) + (lz * lz) / (zMax * zMax) + 1e-9);
    const desiredSpeed = mag * maxAlong * m.speedMul * fatigue;

    // ---------------------------------------------------------------- acceleration limits
    const accelBase = (defense ? 12.5 : 9.6) + (r.accel - 0.75) * 4;
    const aAcc = accelBase * (1 - 0.55 * Math.pow(clamp01(speed / sprintSpeed), 2)) * m.accelMul * fatigue;
    const aBrake = (defense ? 17 : 14.5) * m.accelMul;
    const aTurn = (defense ? 14 : 11) * m.accelMul;
    const dvx = mv.x * desiredSpeed - this.vel.x;
    const dvz = mv.z * desiredSpeed - this.vel.z;
    this.desiredVel.set(mv.x * desiredSpeed, 0, mv.z * desiredSpeed);
    this.accelLimit = Math.max(6, (aAcc + aBrake) * 0.5);
    if (this.grounded) {
      if (speed > 0.4) {
        const ux = this.vel.x / speed;
        const uz = this.vel.z / speed;
        let par = dvx * ux + dvz * uz;
        let px = dvx - par * ux;
        let pz = dvz - par * uz;
        par = par > 0 ? Math.min(par, aAcc * dt) : Math.max(par, -aBrake * dt);
        const pl = Math.hypot(px, pz);
        const pm = aTurn * dt;
        if (pl > pm) {
          px *= pm / pl;
          pz *= pm / pl;
        }
        this.vel.x += par * ux + px;
        this.vel.z += par * uz + pz;
        // hard plant detection (cuts / stops): squeak + compression
        const brakeAcc = -Math.min(0, (dvx * ux + dvz * uz)) ;
        if (this.plantCooldown <= 0 && speed > 3.2 && brakeAcc > 3.2 && (mag < 0.3 || (mv.x * ux + mv.z * uz) < -0.2)) {
          this.events.emit('athlete:plant', { athlete: this, speed });
          this.animator.impulseDip(Math.min(2.2, speed * 0.35));
          this.plantCooldown = 0.45;
        }
      } else {
        const l = Math.hypot(dvx, dvz);
        const mx = aAcc * dt * 1.15;
        const k = l > mx ? mx / l : 1;
        this.vel.x += dvx * k;
        this.vel.z += dvz * k;
      }
    }
    // root-motion impulses from moves
    this.vel.x += this.impulse.x;
    this.vel.z += this.impulse.z;
    this.impulse.set(0, 0, 0);

    // ---------------------------------------------------------------- vertical
    if (!this.grounded) {
      this.vel.y -= GRAVITY * dt;
      this.airTime += dt;
    }
    this.pos.addScaledVector(this.vel, dt);
    if (!this.grounded && this.pos.y <= 0 && this.vel.y <= 0) {
      this.pos.y = 0;
      this.landingSpeed = -this.vel.y;
      this.vel.y = 0;
      this.grounded = true;
      this.events.emit('athlete:land', { athlete: this, speed: this.landingSpeed });
      // landing friction
      this.vel.x *= 0.55;
      this.vel.z *= 0.55;
    }

    // court boundary (players may step slightly out; cannot run into the stands)
    const lim = COURT.halfWidth + 1.4;
    if (this.pos.x > lim) { this.pos.x = lim; this.vel.x = Math.min(0, this.vel.x); }
    if (this.pos.x < -lim) { this.pos.x = -lim; this.vel.x = Math.max(0, this.vel.x); }
    if (this.pos.z < COURT.baselineZ - 1.0) { this.pos.z = COURT.baselineZ - 1.0; this.vel.z = Math.max(0, this.vel.z); }
    if (this.pos.z > COURT.halfCourtZ + 2.0) { this.pos.z = COURT.halfCourtZ + 2.0; this.vel.z = Math.min(0, this.vel.z); }
    // keep out of the stanchion pad
    if (this.pos.z < -2.6 && Math.abs(this.pos.x) < 1.05) {
      this.pos.z = -2.6;
      this.vel.z = Math.max(0, this.vel.z);
    }

    // ---------------------------------------------------------------- derived
    const ax = (this.vel.x - this.prevVelH.x) / dt;
    const az = (this.vel.z - this.prevVelH.z) / dt;
    this.accSmooth.x = damp(this.accSmooth.x, clamp(ax, -25, 25), 14, dt);
    this.accSmooth.z = damp(this.accSmooth.z, clamp(az, -25, 25), 14, dt);
    this.prevVelH.set(this.vel.x, 0, this.vel.z);
    this.speedNow = Math.hypot(this.vel.x, this.vel.z);

    // stamina
    const drain = sprint && this.speedNow > 3 ? 0.075 / (0.6 + r.stamina * 0.6) : 0;
    const regen = this.speedNow < 1.5 ? 0.12 : 0.06;
    this.stamina = clamp01(this.stamina - drain * dt + (drain > 0 ? 0 : regen * dt));
    this.plantCooldown -= dt;
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    this.offBalance = Math.max(0, this.offBalance - dt);
    this.stumble = Math.max(0, this.stumble - dt);
  }

  /** Predict root position t seconds ahead assuming velocity approaches the intended velocity. */
  predictPos(out, t) {
    const dvx = this.desiredVel.x - this.vel.x;
    const dvz = this.desiredVel.z - this.vel.z;
    const dl = Math.hypot(dvx, dvz);
    const A = this.accelLimit;
    out.y = 0;
    if (dl < 1e-4 || !this.grounded) {
      out.x = this.pos.x + this.vel.x * t;
      out.z = this.pos.z + this.vel.z * t;
      return out;
    }
    const ux = dvx / dl;
    const uz = dvz / dl;
    const tr = Math.min(t, dl / A);
    out.x = this.pos.x + this.vel.x * tr + 0.5 * A * ux * tr * tr + this.desiredVel.x * (t - tr);
    out.z = this.pos.z + this.vel.z * tr + 0.5 * A * uz * tr * tr + this.desiredVel.z * (t - tr);
    if (t - tr <= 0) {
      // still accelerating at t
    }
    return out;
  }

  jump(vy) {
    if (!this.grounded) return false;
    this.grounded = false;
    this.vel.y = vy;
    this.airTime = 0;
    this.pos.y = 0.001;
    this.stamina = Math.max(0, this.stamina - 0.025);
    this.events.emit('athlete:jump', { athlete: this, vy });
    return true;
  }

  spendStamina(x) {
    this.stamina = Math.max(0, this.stamina - x);
  }

  /** Body capsule for ball collisions (feet to head). */
  capsule(out) {
    const an = this.animator;
    out.a.set(this.pos.x, this.pos.y + 0.35, this.pos.z);
    out.b.set(an.chestWorld.x, an.chestWorld.y + 0.12, an.chestWorld.z);
    out.r = 0.2;
    out.vel.copy(this.vel);
    out.athlete = this;
    return out;
  }

  setAction(action) {
    if (this.action && this.action.end) this.action.end(true);
    this.action = action;
    this.actionTime = 0;
    if (action && action.start) action.start();
  }
}

export { PLAYER };
