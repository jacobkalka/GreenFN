// CPU opponent. Uses exactly the same Intent interface (and therefore the same movement physics,
// animation and shot model) as the human player. Perception runs through a delay buffer so the AI
// reacts like a person instead of reading inputs; difficulty scales reaction time, decision quality,
// shot timing and defensive discipline.
import * as THREE from 'three';
import { BallState } from './ball.js';
import { COURT, isBeyondArc } from './constants.js';
import { MOVES } from './moves.js';
import { StumbleAction } from './defense.js';
import { clamp, clamp01, lerp, gaussian, rotateYaw, toLocalYaw, yawOf } from '../core/math.js';

export const AI_LEVELS = {
  rookie: { name: 'Rookie', reaction: 0.3, iq: 0.3, steal: 0.25, contest: 0.45, timing: 0.085, shotIQ: 0.42, moveRate: 0.55, aggression: 0.45, rating: 0.62, speed: 0.62 },
  pro: { name: 'Pro', reaction: 0.23, iq: 0.5, steal: 0.45, contest: 0.62, timing: 0.06, shotIQ: 0.6, moveRate: 0.85, aggression: 0.6, rating: 0.72, speed: 0.72 },
  allstar: { name: 'All-Star', reaction: 0.17, iq: 0.68, steal: 0.62, contest: 0.78, timing: 0.043, shotIQ: 0.74, moveRate: 1.05, aggression: 0.72, rating: 0.8, speed: 0.79 },
  legend: { name: 'Legend', reaction: 0.12, iq: 0.82, steal: 0.8, contest: 0.9, timing: 0.031, shotIQ: 0.86, moveRate: 1.25, aggression: 0.85, rating: 0.88, speed: 0.86 },
};

export function aiRatings(level) {
  const L = AI_LEVELS[level] || AI_LEVELS.pro;
  const r = L.rating;
  return {
    speed: L.speed,
    accel: L.speed,
    handle: r,
    shotClose: Math.min(0.95, r + 0.06),
    shotMid: r,
    shotLong: r - 0.03,
    release: r,
    defense: r,
    steal: r,
    block: r - 0.05,
    vertical: r - 0.02,
    stamina: r,
    strength: r,
  };
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();
const _l = new THREE.Vector3();

class Snapshot {
  constructor() {
    this.t = -1;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.hasBall = false;
    this.action = null;
    this.phase = null;
    this.actT = 0;
    this.airborne = false;
    this.hand = -1;
    this.ball = new THREE.Vector3();
    this.ballState = 'free';
    this.ballVel = new THREE.Vector3();
  }
}

export class AIController {
  constructor(level = 'pro', rng = Math.random) {
    this.level = level;
    this.L = AI_LEVELS[level] || AI_LEVELS.pro;
    this.rng = rng;
    this.athlete = null;
    this.buf = Array.from({ length: 90 }, () => new Snapshot());
    this.head = 0;
    this.time = 0;
    this.nextDecision = 0;
    this.plan = 'idle';
    this.target = new THREE.Vector3();
    this.move = new THREE.Vector3();
    this.shooting = null;
    this.moveQueue = null;
    this.moveAt = 0;
    this.lastShotSeen = null;
    this.jumpPlannedFor = null;
    this.mode = 'normal'; // 'normal' | 'stationary' (practice) | 'off'
    this.bitAt = -10;
    this.listening = false;
    this.probeSide = 1;
    this.probeUntil = 0;
    this.driveUntil = 0;
  }

  _listen() {
    if (this.listening || !this.athlete) return;
    this.listening = true;
    const a = this.athlete;
    a.events.on('move:start', (e) => this._onOpponentMove(e));
    a.events.on('shot:fake', (e) => {
      if (e.athlete !== a) this.fakeSeen = this.time;
    });
  }

  _record() {
    const a = this.athlete;
    const o = a.opponent;
    if (!o) return;
    const s = this.buf[this.head];
    this.head = (this.head + 1) % this.buf.length;
    const game = a.game;
    s.t = this.time;
    s.pos.copy(o.pos);
    s.vel.copy(o.vel);
    s.yaw = o.yaw;
    s.hasBall = o.hasBall();
    s.action = o.action ? o.action.type : null;
    s.phase = o.action ? o.action.phase : null;
    s.actT = o.action ? o.action.t || 0 : 0;
    s.airborne = !o.grounded;
    s.hand = o.dribble.hand;
    s.ball.copy(game.ball.pos);
    s.ballVel.copy(game.ball.vel);
    s.ballState = game.ball.state;
  }

  /** Opponent state as perceived `delay` seconds ago. */
  perceived(delay) {
    const want = this.time - delay;
    let best = null;
    for (let i = 1; i <= this.buf.length; i++) {
      const s = this.buf[(this.head - i + this.buf.length) % this.buf.length];
      if (s.t < 0) break;
      best = s;
      if (s.t <= want) break;
    }
    return best;
  }

  update(dt) {
    const a = this.athlete;
    this._listen();
    this.time += dt;
    this._record();
    const inp = a.input;
    inp.move.set(0, 0, 0);
    inp.sprint = false;
    inp.shoot = false;
    if (this.mode === 'off') return;
    const game = a.game;
    if (game.inputLocked) {
      this.shooting = null;
      return;
    }
    if (this.mode === 'stationary') {
      // practice dummy: hold a defensive spot, hands up, no steals
      if (a.isDefending()) this._defense(dt, true);
      return;
    }
    if (a.hasBall()) this._offense(dt);
    else if (a.isDefending()) this._defense(dt, false);
    else this._looseBall(dt);
    // smooth "stick" input
    inp.move.lerp(this.move, 1);
  }

  // ----------------------------------------------------------------------------------------------
  _defense(dt, stationary) {
    const a = this.athlete;
    const L = this.L;
    const inp = a.input;
    const game = a.game;
    const P = this.perceived(L.reaction);
    if (!P) return;
    this.shooting = null;
    // predicted handler position
    const lead = 0.16 + L.iq * 0.12;
    _t.set(P.pos.x + P.vel.x * lead, 0, P.pos.z + P.vel.z * lead);
    const dist = Math.hypot(_t.x, _t.z);
    // direction from handler to rim
    _v.set(-_t.x, 0, -_t.z);
    if (_v.lengthSq() < 1e-4) _v.set(0, 0, -1);
    _v.normalize();
    const shooterRange = dist < 8.4;
    let gap = clamp(0.95 + (dist - 3) * 0.07, 0.9, 1.7);
    if (shooterRange) gap -= 0.12 * L.iq;
    gap += Math.min(0.4, Math.hypot(P.vel.x, P.vel.z) * 0.05);
    // shade toward the ball hand (force the weak hand)
    rotateYaw(_w, 1, 0, yawOf(_v.x, _v.z)); // left of the rim direction
    const shade = (P.hand || -1) * -0.18 * L.iq;
    this.target.set(_t.x + _v.x * gap + _w.x * shade, 0, _t.z + _v.z * gap + _w.z * shade);
    // am I beaten? handler closer to the rim than me along the attack line
    const myAlong = -(a.pos.x * _v.x + a.pos.z * _v.z);
    const hAlong = -(_t.x * _v.x + _t.z * _v.z);
    const beaten = myAlong > hAlong - 0.25 && Math.hypot(a.pos.x - _t.x, a.pos.z - _t.z) > 0.6;
    // handler attacking the rim: retreat along the line instead of only sliding
    const towardRim = -(P.vel.x * _t.x + P.vel.z * _t.z) / Math.max(0.5, dist);
    if (towardRim > 2.2 && !beaten) {
      this.target.set(_t.x * 0.72, 0, _t.z * 0.72);
    }
    if (beaten) {
      // recover: beat the driver to a spot between them and the rim
      const k = clamp(0.45 + (dist - 2) * 0.03, 0.35, 0.62);
      this.target.set(_t.x * k, 0, _t.z * k);
    }
    if (stationary) this.target.set(_t.x + _v.x * 1.3, 0, _t.z + _v.z * 1.3);
    // movement toward the spot + feed-forward of the handler's velocity
    _l.set(this.target.x - a.pos.x, 0, this.target.z - a.pos.z);
    const err = _l.length();
    _l.multiplyScalar(stationary ? 2 : 3.2);
    if (!stationary) _l.addScaledVector(P.vel, 0.85);
    const max = beaten || err > 1.8 ? 7 : 3.8;
    const want = _l.length();
    this.move.copy(_l).multiplyScalar(1 / Math.max(max, want, 1e-3));
    if (want > max) this.move.normalize();
    inp.sprint = !stationary && (beaten || err > 1.7);
    if (a.offBalance > 0) this.move.multiplyScalar(0.5);

    const o = a.opponent;
    // ---------------- contests & blocks
    const shooting = P.action === 'shot' || P.action === 'layup';
    if (shooting) {
      const dd = Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z);
      // close out toward the shooter
      this.move.set(o.pos.x - a.pos.x, 0, o.pos.z - a.pos.z);
      if (this.move.lengthSq() > 1e-4) this.move.normalize();
      if (dd < 0.75) this.move.multiplyScalar(0.2);
      inp.sprint = dd > 1.5;
      const key = o.action;
      if (this.jumpPlannedFor !== key && a.grounded && dd < 2.0 && !stationary) {
        // decide: bite early on the gather (fake-able) vs wait for the shooter to leave the floor
        const early = this.rng() < (1 - L.iq) * 0.55;
        if (early || P.airborne || P.action === 'layup') {
          this.jumpPlannedFor = key;
          const skill = L.contest;
          const delayJ = early ? 0.02 : Math.max(0, 0.05 + (1 - skill) * 0.14 + gaussian(this.rng) * 0.05);
          this.jumpAt = this.time + delayJ;
        }
      }
    } else if (P.action !== 'fake') {
      this.jumpPlannedFor = null;
    }
    if (this.jumpAt && this.time >= this.jumpAt) {
      this.jumpAt = 0;
      if (a.grounded) inp.jump = true;
    }
    // pump fake bite (perceived gather that turns into a fake)
    // ---------------- steals
    if (!stationary && o.hasBall() && a.cooldowns.steal <= 0 && a.grounded && game.ball.state === BallState.DRIBBLE) {
      const ball = game.ball;
      const bd = ball.pos.distanceTo(a.animator.chestWorld);
      if (bd < 1.0) {
        // only attempt when the ball looks exposed (in flight on my side)
        toLocalYaw(_l, ball.pos.x - o.pos.x, ball.pos.z - o.pos.z, o.yaw);
        toLocalYaw(_w, a.pos.x - o.pos.x, a.pos.z - o.pos.z, o.yaw);
        const sameSide = Math.sign(_l.x) === Math.sign(_w.x) || Math.abs(_w.x) < 0.3;
        const exposed = (!o.dribble.contact ? 1 : 0.35) * (sameSide ? 1 : 0.3);
        const rate = L.steal * 0.9 * exposed;
        if (this.rng() < rate * dt * 1.0) inp.steal = true;
      }
    }
  }

  _onOpponentMove(e) {
    const a = this.athlete;
    if (!a || e.athlete === a || this.mode !== 'normal' || !a.isDefending()) return;
    const L = this.L;
    if (e.defDist > 2.6) return;
    // fakes can make the defender commit the wrong way (bite)
    const pBite = clamp01(e.fake * Math.pow(1 - L.iq, 2) * 0.8 * (e.defDist < 1.6 ? 1.1 : 0.7));
    const roll = this.rng();
    if (roll < pBite) {
      const h = e.athlete;
      const def = MOVES[e.id];
      const now = this.time;
      if (def.switches) {
        // lunge toward the original ball side
        rotateYaw(_v, e.hand0, 0, h.yaw);
        _v.y = 0;
        _v.normalize();
        // chained move on an already-biting defender: ankles
        if (now - this.bitAt < 0.9 && e.chain > 0 && this.rng() < 0.5 * (1 - L.iq) + 0.1) {
          a.setAction(new StumbleAction(a, a.game, _v, 0.9));
        } else {
          a.impulse.addScaledVector(_v, 2.1 * e.power);
          a.offBalance = Math.max(a.offBalance, 0.45);
        }
      } else if (e.id === 'hesi' || e.id === 'pace') {
        a.offBalance = Math.max(a.offBalance, 0.42); // stands up / relaxes
      } else if (e.id === 'stepback') {
        _v.set(h.pos.x - a.pos.x, 0, h.pos.z - a.pos.z).normalize();
        a.impulse.addScaledVector(_v, 1.2);
        a.offBalance = Math.max(a.offBalance, 0.3);
      }
      this.bitAt = now;
      a.events.emit('ai:bite', { athlete: a, move: e.id });
    }
  }

  // ----------------------------------------------------------------------------------------------
  _offense(dt) {
    const a = this.athlete;
    const L = this.L;
    const inp = a.input;
    const game = a.game;
    const d = a.opponent;
    const rules = game.rules;
    // continue an active shot (hold, then release with human-like timing noise)
    if (this.shooting) return this._continueShot(dt);
    if (a.action && (a.action.type === 'shot' || a.action.type === 'layup')) return;
    if (a.action && a.action.type === 'catch') {
      // just secured the ball: step away from the lines
      if (Math.abs(a.pos.x) > COURT.halfWidth - 0.7 || a.pos.z < COURT.baselineZ + 0.6) this.move.set(-a.pos.x, 0, 5 - a.pos.z).normalize().multiplyScalar(0.6);
      return;
    }
    const P = this.perceived(L.reaction * 0.6) || null;
    const dpos = P ? P.pos : d.pos;
    const dist = a.distToRim();
    const defDist = Math.hypot(dpos.x - a.pos.x, dpos.z - a.pos.z);
    // defender between me and the rim?
    _v.set(-a.pos.x, 0, -a.pos.z).normalize();
    _w.set(dpos.x - a.pos.x, 0, dpos.z - a.pos.z);
    const front = defDist > 1e-3 ? (_w.x * _v.x + _w.z * _v.z) / defDist : 0;
    const needClear = rules && rules.needsClear && rules.needsClear(a);
    const clock = rules && rules.shotClockOn ? rules.shotClock : 24;
    const beyond = isBeyondArc(a.pos.x, a.pos.z);

    const sinceLive = rules && rules.kind === 'match' ? rules.stateT : 9;
    if (this.time >= this.nextDecision) {
      this.nextDecision = this.time + 0.12 + this.rng() * 0.22 * (1.2 - L.iq);
      // expected contest if I rise up now (a defender within ~2 m can close out)
      const contest = clamp01(1 - (defDist - 0.75) / 1.6) * clamp01(front * 0.8 + 0.45) * (d.offBalance > 0 || d.stumble > 0 ? 0.4 : 1);
      const skill = dist < 3.2 ? a.ratings.shotClose : dist < 6.6 ? a.ratings.shotMid : a.ratings.shotLong;
      // rough expected make (mirrors the calibrated model) -> expected points
      const base = dist < 2.2 ? 0.85 : dist < 4 ? 0.68 : dist < 6.6 ? 0.58 : 0.45;
      const q = base * (0.65 + skill * 0.5) * (1 - contest * 0.55);
      const ev = q * (beyond ? 1.8 : 1);
      const evThr = lerp(0.62, 0.48, L.shotIQ);
      const cThr = lerp(0.62, 0.48, L.shotIQ);
      // defender compromised (bit on a fake, stumbling, in the air): attack now
      const compromised = d.offBalance > 0.05 || d.stumble > 0 || !d.grounded;
      const beatenDef = front < 0.35 || defDist > 2.2 || compromised;
      if (compromised && !needClear && dist < 8.2 && this.plan !== 'drive') {
        this.plan = dist < 5 || !beyond ? 'drive' : this.rng() < 0.55 ? 'shoot' : 'drive';
        this.nextDecision = this.time + 0.45;
      }
      if (this.plan === 'drive' && this.time < this.driveUntil) {
        // keep attacking the gap
      } else if (needClear) {
        this.plan = 'clear';
      } else if (clock < 3.2) {
        this.plan = dist < 3.5 ? 'drive' : 'shoot';
      } else if (dist < 2.6 && (contest < 0.55 || this.rng() < 0.35)) {
        this.plan = 'finish';
      } else if (beatenDef && dist < 8 && this.rng() < 0.55 + L.aggression * 0.4) {
        this.plan = 'drive';
        this.driveUntil = this.time + 0.8;
      } else if (ev > evThr && dist < 8.3 && sinceLive > 0.7 && contest < cThr + (this.rng() < 0.05 ? 0.25 : 0)) {
        this.plan = 'shoot';
      } else if (this.rng() < 0.12 && clock > 8) {
        this.plan = 'reset'; // back out to the top
      } else {
        this.plan = 'create';
      }
    }

    const sprintBias = this.plan === 'drive' || this.plan === 'finish';
    switch (this.plan) {
      case 'clear': {
        // dribble out beyond the arc on the current angle
        const ang = clamp(Math.atan2(a.pos.x, a.pos.z), -1.15, 1.15);
        this.target.set(Math.sin(ang) * 8.1, 0, Math.cos(ang) * 8.1);
        this._steer(this.target, 0.9, false);
        if (beyond && this.rng() < dt * 3) this.nextDecision = 0;
        break;
      }
      case 'reset': {
        this.target.set(a.pos.x * 0.5, 0, 8.6);
        this._steer(this.target, 0.8, false);
        if (a.pos.z > 8) this.nextDecision = 0;
        break;
      }
      case 'shoot': {
        this._startShot();
        break;
      }
      case 'finish':
      case 'drive': {
        // attack the rim on the side away from the defender
        _w.set(dpos.x - a.pos.x, 0, dpos.z - a.pos.z);
        toLocalYaw(_l, _w.x, _w.z, a.yaw);
        const side = _l.x > 0 ? -1 : 1;
        rotateYaw(_t, side * 0.35, 0, a.yaw);
        this.target.set(_t.x * 1.0, 0, 0.35 + _t.z);
        this._steer(this.target, 1, true);
        inp.sprint = true;
        if (dist < 3.6 && (dist < 2.3 || this.rng() < dt * 6)) this._startShot();
        // defender cuts it off: spin / cross / stop
        if (defDist < 1.1 && front > 0.6 && this.rng() < dt * 3 * L.moveRate) this._doMove(this.rng() < 0.5 ? 'spin' : 'cross');
        break;
      }
      case 'create':
      default: {
        // probe: lateral jabs and angle changes, then a move when the defender is close
        if (this.time > this.probeUntil) {
          this.probeSide = this.rng() < 0.5 ? -1 : 1;
          this.probeUntil = this.time + 0.4 + this.rng() * 0.7;
        }
        const ang = Math.atan2(a.pos.x, Math.max(0.5, a.pos.z));
        const r = clamp(dist - 0.4, 3.5, 8.2);
        const ang2 = clamp(ang + this.probeSide * 0.35, -1.25, 1.25);
        this.target.set(Math.sin(ang2) * r, 0, Math.cos(ang2) * r);
        this._steer(this.target, 0.65, false);
        if (defDist < 1.7 && this.time > this.moveAt && this.rng() < dt * 2.6 * L.moveRate) {
          const mv = this._pickMove(dpos, defDist, dist);
          this._doMove(mv);
          this.moveAt = this.time + 0.35 + this.rng() * 0.5;
          if ((mv === 'cross' || mv === 'burst' || mv === 'spin' || mv === 'btb') && this.rng() < L.aggression * 0.6) {
            this.plan = 'drive';
            this.driveUntil = this.time + 0.9;
            this.nextDecision = this.time + 0.5;
          }
        }
        break;
      }
    }
    if (!sprintBias && this.plan !== 'clear') inp.sprint = false;
    // stay in bounds
    if (Math.abs(a.pos.x) > COURT.halfWidth - 0.6 || a.pos.z > COURT.halfCourtZ - 0.8 || a.pos.z < COURT.baselineZ + 0.5) {
      this.move.set(-a.pos.x, 0, 6 - a.pos.z).normalize();
    }
  }

  _pickMove(dpos, defDist, dist) {
    const a = this.athlete;
    toLocalYaw(_l, dpos.x - a.pos.x, dpos.z - a.pos.z, a.yaw);
    const shadeBallSide = Math.sign(_l.x) === a.dribble.hand; // defender overplays my ball side
    const r = this.rng();
    const opts = [
      ['cross', shadeBallSide ? 3 : 1.4],
      ['hesi', 1.4],
      ['btl', 1.0],
      ['btb', shadeBallSide ? 1.6 : 0.8],
      ['spin', defDist < 1.0 ? 1.4 : 0.4],
      ['stepback', dist > 5.8 && dist < 8.0 ? 1.6 : 0.3],
      ['burst', defDist > 1.2 ? 1.2 : 0.5],
      ['pace', 0.8],
    ];
    let sum = 0;
    for (const o of opts) sum += o[1];
    let x = r * sum;
    for (const o of opts) {
      x -= o[1];
      if (x <= 0) return o[0];
    }
    return 'cross';
  }

  _doMove(id) {
    const a = this.athlete;
    if (a.action && a.action.type === 'move') {
      if (a.action.u >= MOVES[a.action.id].chainFrom) a.input.move1 = id;
      return;
    }
    a.input.move1 = id;
    // after a stepback / hesi, look to shoot if it created space
    if (id === 'stepback' || id === 'hesi') this.nextDecision = this.time + 0.45;
  }

  _steer(target, speed, sprint) {
    const a = this.athlete;
    _l.set(target.x - a.pos.x, 0, target.z - a.pos.z);
    const d = _l.length();
    if (d < 0.25) {
      this.move.set(0, 0, 0);
      return;
    }
    _l.multiplyScalar(1 / d);
    const k = Math.min(1, d / 1.2) * speed;
    this.move.copy(_l).multiplyScalar(k);
    a.input.sprint = sprint;
  }

  _startShot() {
    const a = this.athlete;
    if (!a.hasBall() || this.shooting) return;
    this.shooting = { pressT: this.time, releaseAt: null };
    a.input.shoot = true;
    a.input.shootPressed = true;
    // on a drive, only sometimes go for the dunk (sprint + shoot near the rim)
    a.input.sprint = this.plan === 'drive' && this.rng() < 0.3 + this.L.aggression * 0.3;
    this.move.set(0, 0, 0);
  }

  _continueShot(dt) {
    const a = this.athlete;
    const inp = a.input;
    const act = a.action;
    if (!act || (act.type !== 'shot' && act.type !== 'layup')) {
      // shot hasn't started yet (pickup pending) or ended
      if (this.time - this.shooting.pressT > 1.6 || !a.hasBall()) this.shooting = null;
      else inp.shoot = true;
      return;
    }
    if (act.phase === 'pickup' || !act.meter) {
      inp.shoot = true;
      if (act.type === 'layup') inp.sprint = true;
      return;
    }
    const m = act.meter;
    if (act.type === 'layup' && act.kind === 'dunk') {
      inp.shoot = true;
      return;
    }
    if (this.shooting.releaseAt === null && m.ideal > 0 && (m.active || act.phase === 'air' || act.phase === 'rise' || act.phase === 'gather')) {
      // execution noise: better players release closer to the ideal moment
      this.shooting.releaseAt = m.ideal + gaussian(this.rng) * this.L.timing + 0.004;
    }
    if (this.shooting.releaseAt !== null && m.t >= this.shooting.releaseAt) {
      inp.shoot = false;
      this.shooting = null;
      return;
    }
    inp.shoot = true;
  }

  // ----------------------------------------------------------------------------------------------
  _looseBall(dt) {
    const a = this.athlete;
    const game = a.game;
    const ball = game.ball;
    const inp = a.input;
    this.shooting = null;
    if (ball.state !== BallState.FREE || !ball.live || !game.allowPickup) {
      // dead ball / check: drift to the top of the key
      this.move.set(0, 0, 0);
      return;
    }
    // predict where the ball will be reachable (descending through ~1.7 m) or its ground spot
    _t.copy(ball.pos);
    let vx = ball.vel.x;
    let vy = ball.vel.y;
    let vz = ball.vel.z;
    let y = ball.pos.y;
    const tgtY = 1.6;
    for (let i = 0; i < 90 && !(vy < 0 && y < tgtY); i++) {
      const h = 1 / 30;
      vy -= 9.81 * h;
      y += vy * h;
      _t.x += vx * h;
      _t.z += vz * h;
      if (y < 0.12) break;
    }
    // shot in the air: hold rebounding position (between opponent and rim) until it comes down
    const inFlightShot = ball.shot && !ball.touchedRim && !ball.touchedBoard && !ball.touchedFloor && game.time - ball.shot.time < 2;
    if (inFlightShot) {
      const o = a.opponent;
      _t.set(o.pos.x * 0.45, 0, o.pos.z * 0.45);
      _t.x = clamp(_t.x, -2.2, 2.2);
      _t.z = clamp(_t.z, 0.6, 3);
    }
    _t.x = clamp(_t.x, -COURT.halfWidth + 0.35, COURT.halfWidth - 0.35);
    _t.z = clamp(_t.z, COURT.baselineZ + 0.35, COURT.halfCourtZ - 0.35);
    this._steer(_t, 1, true);
    inp.sprint = true;
    // jump for high rebounds within reach
    const dh = Math.hypot(ball.pos.x - a.pos.x, ball.pos.z - a.pos.z);
    if (!inFlightShot && ball.pos.y > 2.0 && ball.pos.y < 3.4 && ball.vel.y < 1 && dh < 0.9 && a.grounded && a.cooldowns.jump <= 0) inp.jump = true;
  }
}
