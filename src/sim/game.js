// Simulation world: athletes, ball, physics and the fixed-step update order.
import * as THREE from 'three';
import { Ball, BallPhysics, BallState } from './ball.js';
import { Athlete, Handling } from './athlete.js';
import { PLAYER, BALL, SIM_DT, BALL_SUBSTEPS, HOOP } from './constants.js';
import { handleAthleteInput, updateAction } from './actions.js';
import { clamp } from '../core/math.js';

const _d = new THREE.Vector3();
const _v = new THREE.Vector3();

function makeCapsule() {
  return { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.2, vel: new THREE.Vector3(), athlete: null };
}

export class Game {
  constructor(events) {
    this.events = events;
    this.ball = new Ball();
    this.physics = new BallPhysics(events);
    this.athletes = [];
    this.controllers = [];
    this.offense = null; // athlete currently on offense (ball handler side)
    this.time = 0;
    this.tick = 0;
    this.paused = false;
    this.capsules = [makeCapsule(), makeCapsule()];
    this.rules = null; // match / practice rules object
    this.allowPickup = true;
  }

  addAthlete(opts) {
    const a = new Athlete(this, opts);
    this.athletes.push(a);
    return a;
  }

  opponentOf(a) {
    for (const x of this.athletes) if (x !== a) return x;
    return null;
  }

  setController(athlete, controller) {
    controller.athlete = athlete;
    athlete.controller = controller;
    this.controllers = this.athletes.map((x) => x.controller).filter(Boolean);
  }

  /** Give the ball to an athlete in triple threat (hands). */
  giveBall(a, handling = Handling.TRIPLE) {
    const ball = this.ball;
    ball.owner = a;
    ball.state = BallState.HELD;
    ball.lastTouch = a;
    ball.shot = null;
    ball.live = true;
    ball.dragEnabled = true;
    ball.resetFlags();
    ball.vel.set(0, 0, 0);
    ball.angVel.set(0, 0, 0);
    a.handling = handling;
    a.dribble.stop();
    for (const x of this.athletes) if (x !== a) x.handling = Handling.NONE;
    this.offense = a;
  }

  releaseBall() {
    const ball = this.ball;
    if (ball.owner) {
      ball.owner.handling = Handling.NONE;
      ball.owner.dribble.stop();
    }
    ball.owner = null;
    ball.state = BallState.FREE;
    ball.dragEnabled = true;
  }

  step(dt = SIM_DT) {
    if (this.paused) return;
    this.time += dt;
    this.tick++;
    const ball = this.ball;
    ball.prevPos.copy(ball.pos);
    ball.prevRot.copy(ball.rot);

    for (const c of this.controllers) c.update(dt);

    // --- decisions + actions + movement
    for (const a of this.athletes) {
      a.time += dt;
      a.resetIntent();
      a.basePosture();
      handleAthleteInput(this, a, dt);
      updateAction(this, a, dt);
      a.updateMovement(dt);
      a.input.clearEdges();
    }
    this._resolveBodies(dt);

    // --- ball handling (owned ball)
    for (const a of this.athletes) a.dribble.update(dt);
    // held ball follows the action's requested spot (hands are solved onto it)
    if (ball.state === BallState.HELD && ball.owner) {
      const an = ball.owner.anim;
      ball.vel.subVectors(an.ballPos, ball.pos).multiplyScalar(1 / dt);
      ball.pos.copy(an.ballPos);
      ball.angVel.multiplyScalar(Math.exp(-10 * dt));
      ball.integrateRotation(dt);
    }

    // --- animation
    for (const a of this.athletes) a.animator.update(dt);

    // --- free ball physics
    if (ball.state === BallState.FREE) {
      const caps = this.physics.capsules;
      caps.length = 0;
      for (let i = 0; i < this.athletes.length; i++) {
        const a = this.athletes[i];
        if (ball.noPickupBy === a && ball.noPickupFor > 0) continue;
        caps.push(a.capsule(this.capsules[i]));
      }
      const sub = dt / BALL_SUBSTEPS;
      for (let s = 0; s < BALL_SUBSTEPS; s++) this.physics.step(ball, sub);
      ball.integrateRotation(dt);
      ball.noPickupFor = Math.max(0, ball.noPickupFor - dt);
    }

    if (this.rules) this.rules.update(dt);
  }

  _resolveBodies(dt) {
    const A = this.athletes;
    for (let i = 0; i < A.length; i++) {
      for (let j = i + 1; j < A.length; j++) {
        const a = A[i];
        const b = A[j];
        _d.set(b.pos.x - a.pos.x, 0, b.pos.z - a.pos.z);
        const dist = _d.length();
        const minD = PLAYER.radius * 2;
        // airborne players separated vertically don't collide
        if (Math.abs(a.pos.y - b.pos.y) > 0.9) continue;
        if (dist >= minD || dist < 1e-5) continue;
        _d.multiplyScalar(1 / dist);
        const pen = minD - dist;
        // mass ratio: a set defender (stance) resists more than a moving ball handler
        const wa = this._pushWeight(a);
        const wb = this._pushWeight(b);
        const sa = wb / (wa + wb);
        const sb = wa / (wa + wb);
        a.pos.addScaledVector(_d, -pen * sa);
        b.pos.addScaledVector(_d, pen * sb);
        // remove approaching relative velocity (inelastic bump)
        const rv = (b.vel.x - a.vel.x) * _d.x + (b.vel.z - a.vel.z) * _d.z;
        if (rv < 0) {
          const imp = -rv;
          a.vel.x -= _d.x * imp * sa;
          a.vel.z -= _d.z * imp * sa;
          b.vel.x += _d.x * imp * sb;
          b.vel.z += _d.z * imp * sb;
          if (imp > 1.2) this.events.emit('athlete:bump', { a, b, impact: imp });
        }
      }
    }
  }

  _pushWeight(a) {
    let w = 1 + a.ratings.strength * 0.5;
    if (a.isDefending()) w *= 1 + a.defStance * 0.8;
    if (!a.grounded) w *= 0.6;
    return w;
  }
}
