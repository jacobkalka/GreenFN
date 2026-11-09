// Action system. Input (from human or AI intents) is routed to actions that drive animation intents,
// movement modifiers and ball handling. Actions are shared by both players.
import * as THREE from 'three';
import { BallState } from './ball.js';
import { Handling } from './athlete.js';
import { BALL, HOOP, isBeyondArc, inCourtBounds } from './constants.js';
import { JUMPSHOTS, perfectWindow, gradeRelease, computeContest, launchShot } from './shooting.js';
import { clamp, clamp01, lerp, smoothstep, easeInOut, easeOut, rotateYaw, toLocalYaw, yawOf, angleDiff, bell } from '../core/math.js';
import { MoveAction, MOVES, canStartMove } from './moves.js';
import { LayupAction, wantsLayup } from './layup.js';
import { StealAction, JumpAction, StumbleAction, tryBlock } from './defense.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _l = new THREE.Vector3();

/** Catmull-Rom through body-space keys [{t,x,y,z}] at time t. */
export function samplePath(out, keys, t) {
  if (t <= keys[0].t) return out.set(keys[0].x, keys[0].y, keys[0].z);
  const n = keys.length;
  if (t >= keys[n - 1].t) return out.set(keys[n - 1].x, keys[n - 1].y, keys[n - 1].z);
  let i = 0;
  while (i < n - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(n - 1, i + 2)];
  const u = (t - k1.t) / Math.max(1e-5, k2.t - k1.t);
  const u2 = u * u;
  const u3 = u2 * u;
  const cr = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
  return out.set(cr(k0.x, k1.x, k2.x, k3.x), cr(k0.y, k1.y, k2.y, k3.y), cr(k0.z, k1.z, k2.z, k3.z));
}

/** Body-space (x left, y up absolute, z fwd) -> world, using athlete root and yaw. */
export function bodyToWorld(out, a, x, y, z, yaw = a.yaw) {
  rotateYaw(out, x, z, yaw);
  out.x += a.pos.x;
  out.z += a.pos.z;
  out.y = y;
  return out;
}

// ------------------------------------------------------------------------------------------------
// Ball catch / pickup: blend the ball from where it is into the hands.
export class CatchAction {
  constructor(a, from) {
    this.a = a;
    this.type = 'catch';
    this.locks = false;
    this.from = from.clone();
    this.t = 0;
    this.dur = 0.16;
  }
  update(dt) {
    const a = this.a;
    const an = a.anim;
    this.t += dt;
    const k = easeOut(this.t / this.dur);
    // basePosture already computed the triple-threat hold spot into an.ballPos
    an.ballPos.lerpVectors(this.from, an.ballPos, k);
    an.holdKinematic = false;
    if (!a.grounded) {
      // airborne rebound: hold overhead, protect
      bodyToWorld(_v, a, 0, a.pos.y + 1.9, 0.2);
      an.ballPos.copy(_v);
      an.airTuck = 0.4;
      return true;
    }
    return this.t < this.dur;
  }
}

// ------------------------------------------------------------------------------------------------
export class ShotAction {
  constructor(a, game) {
    this.a = a;
    this.game = game;
    this.type = 'shot';
    this.locks = true;
    this.kind = 'jumper';
    this.style = JUMPSHOTS[a.jumpshot] || JUMPSHOTS.classic;
    this.phase = 'pickup';
    this.t = 0;
    this.wasTriple = a.handling === Handling.TRIPLE;
    this.released = false;
    this.releaseT = 0;
    this.heldAtStart = true;
    this.buttonDown = true;
    this.keys = null;
    this.fromLocal = new THREE.Vector3();
    this.relLocal = new THREE.Vector3();
    this.landT = -1;
    this.jumped = false;
    this.meter = { active: false, t: 0, ideal: 0.5, w: 0.035, released: false, grade: null, kind: 'jumper' };
    this.fromX = a.pos.x;
    this.fromZ = a.pos.z;
    this.stepbackBonus = 0;
    this.pumpFake = false;
  }

  start() {
    const a = this.a;
    a.shotMeter = this.meter;
    if (a.handling === Handling.DRIBBLE) {
      a.dribble.requestPickup(() => this._secured());
    } else this._secured();
  }

  _secured() {
    const a = this.a;
    const ball = this.game.ball;
    ball.state = BallState.HELD;
    ball.owner = a;
    a.handling = Handling.PICKED;
    this.phase = 'gather';
    this.t = 0;
    let st = this.style;
    // right after a stepback the gather is already loaded: quicker into the shot
    if (a.stepbackT !== undefined && this.game.time - a.stepbackT < 0.8) {
      st = Object.assign({}, st, { gather: st.gather * 0.78 });
      this.style = st;
      this.afterStepback = true;
    }
    this.ideal = st.gather + st.rel;
    const dist = a.distToRim();
    // momentum entering the shot (pull-up off the dribble)
    this.entrySpeed = a.speedNow;
    const diffMul = a.isUser ? this.game.userTimingMul || 1 : 1;
    this.meter.w = perfectWindow(a, 'jumper', dist, diffMul);
    this.meter.ideal = this.ideal;
    this.meter.active = true;
    this.meter.kind = 'jumper';
    // ball path keys in body space (y absolute standing height; jump added at runtime)
    toLocalYaw(_l, ball.pos.x - a.pos.x, ball.pos.z - a.pos.z, a.yaw);
    const sh = a.shootHand;
    const g = st.gather;
    const I = this.ideal;
    this.keys = [
      { t: 0, x: _l.x, y: ball.pos.y - a.pos.y, z: _l.z },
      { t: g * 0.55, x: sh * 0.04, y: 1.0, z: 0.3 },
      { t: g, x: sh * 0.09, y: 1.22, z: 0.27 },
      { t: I - 0.1, x: sh * 0.12, y: st.setY, z: 0.14 },
      { t: I, x: sh * 0.13, y: st.relY, z: 0.3 },
      { t: I + 0.3, x: sh * 0.13, y: st.relY + 0.02, z: 0.36 },
    ];
    this.game.events.emit('shot:gather', { athlete: a });
  }

  _fake() {
    const a = this.a;
    this.pumpFake = true;
    this.meter.active = false;
    a.setAction(new PumpFakeAction(a, this.game, this.wasTriple));
    this.game.events.emit('shot:fake', { athlete: a });
  }

  update(dt) {
    const a = this.a;
    const game = this.game;
    const an = a.anim;
    const inp = a.input;
    if (!inp.shoot) this.buttonDown = false;

    if (this.phase === 'pickup') {
      // waiting for the dribble to come back to the hand; keep dribbling posture
      a.mods.speedMul = 0.6;
      if (!this.buttonDown && game.time - (this.pressT ?? (this.pressT = game.time)) < 0.4) {
        // released before gather began: treat as a quick tap -> fake once secured
        this.tapFake = true;
      }
      return true;
    }

    if (this.phase === 'gather' || this.phase === 'rise') {
      this.t += dt;
      this.meter.t = this.t;
      const st = this.style;
      // pump fake: quick tap
      if ((this.tapFake || !this.buttonDown) && this.t < 0.14 && !this.jumped) {
        this._fake();
        return true;
      }
      // square up to the rim, slow down
      a.mods.faceYaw = a.yawToRim();
      a.mods.turnMul = 4;
      a.mods.allowMove = false;
      a.mods.accelMul = 0.55;
      const gT = this.t / st.gather;
      an.crouch = lerp(0.35, 0.58, smoothstep(0, 1, gT));
      an.stanceWidth = 0.42;
      an.stagger = 0.12 * -a.shootHand;
      if (!this.jumped && this.t >= st.gather) {
        this.jumped = true;
        this.phase = 'rise';
        this.fromX = a.pos.x;
        this.fromZ = a.pos.z;
        // keep some momentum (pull-up drift), add style fade
        a.vel.x *= 0.42;
        a.vel.z *= 0.42;
        if (st.fade > 0) {
          const dx = -a.pos.x;
          const dz = -a.pos.z;
          const dl = Math.hypot(dx, dz) || 1;
          a.vel.x -= (dx / dl) * st.fade;
          a.vel.z -= (dz / dl) * st.fade;
        }
        a.jump(st.jumpV * (0.92 + a.ratings.vertical * 0.12));
      }
      if (this.jumped) {
        an.crouch = -0.05;
        an.airTuck = st.kick * smoothstep(0.1, 0.3, this.t - st.gather);
        an.airTuckFwd = st.kick * 0.15;
      }
      // release
      const autoT = this.ideal + 0.3;
      if (this.jumped && (!this.buttonDown || this.t >= autoT)) this._release();
      else if (!this.jumped && !this.buttonDown && this.t >= 0.14) {
        // released during the dip: very early, jump immediately and release
        this.jumped = true;
        this.phase = 'rise';
        this.fromX = a.pos.x;
        this.fromZ = a.pos.z;
        a.vel.x *= 0.4;
        a.vel.z *= 0.4;
        a.jump(st.jumpV * 0.7);
        this._release();
      }
      this._pose(dt);
      return true;
    }

    if (this.phase === 'follow') {
      this.t += dt;
      this.meter.t = this.t;
      a.mods.allowMove = false;
      a.mods.turnMul = 0.5;
      an.arms = 'shoot';
      an.released = true;
      an.shootSide = a.shootHand;
      an.followT = (this.t - this.releaseT) / 0.75;
      bodyToWorld(an.followPos, a, this.relLocal.x, 0, this.relLocal.z);
      an.releaseHeight = this.relLocal.y + a.pos.y;
      an.shotDir.set(-a.pos.x, 0, -a.pos.z).normalize();
      an.crouch = a.grounded ? 0.32 : -0.05;
      an.headPitch = -0.15;
      an.lookTarget.set(0, HOOP.rimY, 0);
      an.lookAt = an.lookTarget;
      if (a.grounded) {
        if (this.landT < 0) this.landT = this.t;
        if (this.t - this.landT > 0.22) {
          this.meter.active = false;
          return false;
        }
      }
      return true;
    }
    return false;
  }

  _pose(dt) {
    const a = this.a;
    const an = a.anim;
    samplePath(_v, this.keys, this.t);
    // the gather blends from the pickup spot quickly
    bodyToWorld(an.ballPos, a, _v.x, _v.y + a.pos.y, _v.z);
    an.arms = this.t < this.style.gather * 0.35 ? 'hold' : 'shoot';
    an.gripFwd.set(-a.pos.x, 0, -a.pos.z).normalize();
    an.gripUp.set(0, 1, 0);
    an.holdKinematic = true;
    an.shootSide = a.shootHand;
    an.shotDir.set(-a.pos.x, 0, -a.pos.z).normalize();
    an.released = false;
    an.lookTarget.set(0, HOOP.rimY, 0);
    an.lookAt = an.lookTarget;
    an.chestPitch = -0.08;
  }

  _release() {
    const a = this.a;
    const game = this.game;
    this._pose(0);
    // ball must be exactly at the hands' spot this tick
    game.ball.pos.copy(a.anim.ballPos);
    const delta = this.t - this.ideal;
    const grade = gradeRelease(delta, this.meter.w);
    this.meter.released = true;
    this.meter.releaseT = this.t;
    this.meter.grade = grade;
    this.meter.delta = delta;
    const contest = computeContest(game, a, game.ball.pos);
    const dist = a.distToRim();
    const arc = (this.style.arc + clamp((5 - dist) * 0.6, -3, 3)) * (Math.PI / 180);
    let typeMul = 1;
    if (this.afterStepback) typeMul *= 1.05;
    if (this.style.fade > 0) typeMul *= 1.06;
    launchShot(game, a, {
      kind: 'jumper',
      grade,
      contest,
      moveSpeed: Math.hypot(a.vel.x, a.vel.z),
      arc,
      fromX: this.fromX,
      fromZ: this.fromZ,
      typeMul,
    });
    toLocalYaw(this.relLocal, game.ball.pos.x - a.pos.x, game.ball.pos.z - a.pos.z, a.yaw);
    // hand slightly past the ball toward the rim
    const dl = Math.hypot(a.pos.x, a.pos.z) || 1;
    this.relLocal.z += 0.1;
    this.relLocal.y = game.ball.pos.y - a.pos.y + 0.06;
    this.phase = 'follow';
    this.releaseT = this.t;
    this.released = true;
    a.handling = Handling.NONE;
    a.lastShotT = game.time;
  }

  end() {
    if (!this.released && this.meter) this.meter.active = false;
  }
}

// ------------------------------------------------------------------------------------------------
export class PumpFakeAction {
  constructor(a, game, wasTriple) {
    this.a = a;
    this.game = game;
    this.type = 'fake';
    this.locks = true;
    this.t = 0;
    this.dur = 0.5;
    this.wasTriple = wasTriple;
  }
  start() {
    this.a.handling = this.wasTriple ? Handling.TRIPLE : Handling.PICKED;
    this.a.game.ball.state = BallState.HELD;
  }
  update(dt) {
    const a = this.a;
    const an = a.anim;
    this.t += dt;
    const u = this.t / this.dur;
    const up = bell(clamp01(u * 1.15));
    a.mods.allowMove = false;
    a.mods.faceYaw = a.yawToRim();
    an.crouch = lerp(0.45, 0.12, up);
    an.pelvisLift = up * 0.05;
    bodyToWorld(an.ballPos, a, a.shootHand * 0.08, lerp(1.0, 1.82, up), lerp(0.28, 0.2, up));
    an.arms = 'hold';
    an.gripFwd.set(-a.pos.x, 0, -a.pos.z).normalize();
    an.holdKinematic = false;
    an.headPitch = -0.2 * up;
    an.lookTarget.set(0, HOOP.rimY, 0);
    an.lookAt = an.lookTarget;
    // a fresh shot press during the fake goes straight into the shot
    if (a.input.shootPressed && this.t > 0.12) {
      a.setAction(new ShotAction(a, this.game));
      return true;
    }
    return this.t < this.dur;
  }
}

// ------------------------------------------------------------------------------------------------
/** Route the athlete's intent to actions. */
export function handleAthleteInput(game, a, dt) {
  const inp = a.input;
  const ball = game.ball;
  if (game.inputLocked) return;
  if (a.action && a.action.locks) {
    if (a.action.onInput) a.action.onInput(inp);
    return;
  }
  if (a.stumble > 0) return;
  if (a.hasBall()) {
    if (a.handling === Handling.TRIPLE) {
      if (inp.shootPressed) {
        startShot(game, a);
        return;
      }
      if (inp.move1 && canStartMove(a, inp.move1)) {
        startDribble(a);
        a.setAction(new MoveAction(a, game, inp.move1));
        return;
      }
      if (inp.move.lengthSq() > 0.06 && a.cooldowns.pickup <= 0) {
        startDribble(a);
        return;
      }
    } else if (a.handling === Handling.DRIBBLE) {
      if (inp.shootPressed) {
        startShot(game, a);
        return;
      }
      if (inp.move1 && canStartMove(a, inp.move1)) {
        a.setAction(new MoveAction(a, game, inp.move1));
        return;
      }
    } else if (a.handling === Handling.PICKED) {
      if (inp.shootPressed) {
        startShot(game, a);
        return;
      }
    }
    return;
  }
  // without the ball
  if (a.isDefending()) {
    if (inp.steal && a.cooldowns.steal <= 0) {
      a.setAction(new StealAction(a, game));
      return;
    }
  }
  if (inp.jump && a.grounded && a.cooldowns.jump <= 0) {
    a.setAction(new JumpAction(a, game));
  }
}

function startDribble(a) {
  a.handling = Handling.DRIBBLE;
  a.dribble.start(a.dribble.hand || -1);
}

export function startShot(game, a) {
  if (wantsLayup(game, a)) a.setAction(new LayupAction(a, game));
  else a.setAction(new ShotAction(a, game));
}

export function updateAction(game, a, dt) {
  if (a.action) {
    a.actionTime += dt;
    const keep = a.action.update(dt);
    if (!keep) {
      const done = a.action;
      if (done.end) done.end(false);
      if (a.action === done) a.action = null;
    }
  }
  // stumble overrides
  if (a.stumble > 0 && !(a.action && a.action.type === 'stumble')) {
    a.anim.crouch = 0.15;
  }
}

/** Free-ball pickups / rebounds. */
export function checkPickups(game, dt) {
  const ball = game.ball;
  if (ball.state !== BallState.FREE || !ball.live || !game.allowPickup) return null;
  let best = null;
  let bestD = Infinity;
  for (const a of game.athletes) {
    if (!a.inPlay) continue;
    if (game.pickupFilter && !game.pickupFilter(a)) continue;
    if (a.action && a.action.type === 'shot') continue;
    if (a.action && a.action.type === 'layup') continue;
    if (a.stumble > 0.15) continue;
    if (ball.noPickupFor > 0 && ball.noPickupBy === a) continue;
    if (ball.shot && !ball.touchedRim && !ball.touchedBoard && !ball.touchedFloor) {
      // in-flight shot: nobody may catch it (blocks are separate); shooter can't catch own airball
      if (game.time - ball.shot.time < 2.5) continue;
      if (ball.shot.shooter === a) continue;
    }
    if (game.rules && game.rules.kind === 'match' && !inCourtBounds(a.pos.x, a.pos.z, 0.12)) continue;
    // reach envelope: around the body up to standing reach + jump
    const dx = ball.pos.x - a.pos.x;
    const dz = ball.pos.z - a.pos.z;
    const dh = Math.hypot(dx, dz);
    const reachTop = a.pos.y + 2.5;
    if (ball.pos.y > reachTop || dh > 0.85) continue;
    // low balls need the athlete to get to it (pick-up radius smaller)
    const low = ball.pos.y < 0.5;
    if (low && dh > 0.7) continue;
    // need a hand near the ball for high balls
    let hd = Math.min(a.animator.palmWorld.L.distanceTo(ball.pos), a.animator.palmWorld.R.distanceTo(ball.pos));
    if (ball.pos.y > 1.6 && hd > 0.55) continue;
    const score = dh + (low ? 0.2 : 0);
    if (score < bestD) {
      bestD = score;
      best = a;
    }
  }
  if (best) {
    const from = ball.pos.clone();
    const prevOwnerTouch = ball.lastTouch;
    const shot = ball.shot; // capture before giveBall clears it (rebound stats)
    game.giveBall(best, Handling.TRIPLE);
    best.setAction(new CatchAction(best, from));
    best.cooldowns.pickup = 0.25;
    game.events.emit('ball:pickup', { athlete: best, from: prevOwnerTouch, shot });
    return best;
  }
  return null;
}

export { MOVES, tryBlock, StumbleAction };
