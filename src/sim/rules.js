// Game rules: 1v1 half-court (first to N, 1s and 2s, make-it-take-it, clear the ball, shot clock)
// and practice mode (free shooting with a rebounder and an optional defender).
import * as THREE from 'three';
import { BallState } from './ball.js';
import { Handling } from './athlete.js';
import { COURT, HOOP, BALL, isBeyondArc, inCourtBounds } from './constants.js';
import { clamp, yawOf } from '../core/math.js';

export function newStats() {
  return {
    pts: 0,
    fgm: 0,
    fga: 0,
    twoM: 0,
    twoA: 0,
    oneM: 0,
    oneA: 0,
    perfect: 0,
    perfectMade: 0,
    releases: 0,
    steals: 0,
    blocks: 0,
    rebounds: 0,
    offReb: 0,
    turnovers: 0,
    dunks: 0,
    layups: 0,
    layupsMade: 0,
    swishes: 0,
    moves: {},
    movesTotal: 0,
    ankles: 0,
    longestRun: 0,
    timeline: [],
  };
}

const CHECK_TIME = 1.35;

export class MatchRules {
  constructor(game, opts = {}) {
    this.game = game;
    this.events = game.events;
    this.kind = 'match';
    this.target = opts.target || 11;
    this.winBy2 = !!opts.winBy2;
    this.shotClockOn = opts.shotClock !== false;
    this.shotClockLen = opts.shotClockLen || 24;
    this.makeItTakeIt = opts.makeItTakeIt !== false;
    this.timeLimit = opts.timeLimit || 0;
    this.players = game.athletes.slice(0, 2);
    this.score = new Map(this.players.map((p) => [p, 0]));
    this.stats = new Map(this.players.map((p) => [p, newStats()]));
    this.state = 'pregame';
    this.stateT = 0;
    this.offense = null;
    this.clearNeeded = false;
    this.shotClock = this.shotClockLen;
    this.gameTime = 0;
    this.suddenDeath = false;
    this.winner = null;
    this.lastEvent = null;
    this.run = { who: null, pts: 0 };
    this.pendingPossession = null;
    this.deadReason = '';
    this._subs = [];
    this.lastWarn = 99;
    this.shotTouchedRim = false;
    this._bind();
  }

  _on(type, fn) {
    this._subs.push(this.events.on(type, fn));
  }

  dispose() {
    for (const off of this._subs) off();
    this._subs.length = 0;
  }

  _bind() {
    this._on('shot:release', (e) => this._onShot(e));
    this._on('ball:score', () => this._onScore());
    this._on('ball:impact', (e) => {
      // a loose ball bouncing outside the lines (or on the stanchion pad) is out of bounds
      if (this.state === 'live' && !e.dribble && (e.surface === 'floor' || e.surface === 'pad') && !inCourtBounds(e.x, e.z, 0.05)) {
        this._oobBall = true;
      }
      if (e.surface === 'rim' && this.game.ball.shot) {
        this.shotTouchedRim = true;
        // shot clock resets when the shot hits the rim
        this.shotClock = this.shotClockLen;
      }
    });
    this._on('ball:pickup', (e) => this._onPickup(e));
    this._on('steal', (e) => {
      if (this.state !== 'live') return;
      this.stats.get(e.athlete).steals++;
      this.stats.get(e.victim).turnovers++;
      this._event('steal', e.athlete);
    });
    this._on('block', (e) => {
      if (this.state !== 'live') return;
      this.stats.get(e.athlete).blocks++;
      this._event('block', e.athlete);
    });
    this._on('goaltend', (e) => {
      if (this.state !== 'live' || !e.shot) return;
      this._award(e.shot.shooter, e.shot.value, e.shot, 'goaltend');
    });
    this._on('move:start', (e) => {
      if (this.state !== 'live') return;
      const s = this.stats.get(e.athlete);
      if (!s) return;
      s.moves[e.id] = (s.moves[e.id] || 0) + 1;
      s.movesTotal++;
    });
    this._on('ankles', (e) => {
      const o = this.game.opponentOf(e.athlete);
      if (o && this.stats.get(o)) this.stats.get(o).ankles++;
    });
    this._on('dribble:fumble', (e) => {
      if (this.state === 'live') this.stats.get(e.athlete).turnovers += 0; // loose ball, possession decided by recovery
    });
  }

  _event(type, who, extra = {}) {
    this.lastEvent = { type, who, t: this.gameTime, ...extra };
    this.events.emit('rules:event', this.lastEvent);
  }

  needsClear(a) {
    return this.clearNeeded && this.offense === a;
  }

  getScore(a) {
    return this.score.get(a) || 0;
  }

  start(first) {
    this.offense = first;
    this.gameTime = 0;
    this._toCheck(first);
    this.events.emit('rules:start', { rules: this });
  }

  _toCheck(offense) {
    this._oobBall = false;
    this.offense = offense;
    this.clearNeeded = false;
    this.shotClock = this.shotClockLen;
    this.state = 'check';
    this.stateT = 0;
    this.lastWarn = 99;
    const game = this.game;
    game.inputLocked = true;
    game.allowPickup = false;
    const def = game.opponentOf(offense);
    // reset positions at the top of the key
    const ox = (Math.random() - 0.5) * 0.6;
    offense.place(ox, 8.25, yawOf(-ox, -8.25));
    if (def) def.place(ox * 0.8, 6.55, yawOf(offense.pos.x - ox * 0.8, offense.pos.z - 6.55));
    for (const a of game.athletes) {
      a.setAction(null);
      a.stamina = Math.min(1, a.stamina + 0.12);
      a.offBalance = 0;
      a.stumble = 0;
    }
    game.giveBall(offense);
    game.ball.pos.set(offense.pos.x, 1.0, offense.pos.z - 0.3);
    game.ball.prevPos.copy(game.ball.pos);
    this.shotTouchedRim = false;
    this.events.emit('rules:state', { state: 'check', offense });
  }

  _toLive() {
    this.state = 'live';
    this.stateT = 0;
    this.game.inputLocked = false;
    this.game.allowPickup = true;
    this.events.emit('rules:state', { state: 'live', offense: this.offense });
  }

  _toDead(nextOffense, reason, delay = 1.6) {
    this.state = 'dead';
    this.stateT = 0;
    this.deadDelay = delay;
    this.pendingPossession = nextOffense;
    this.deadReason = reason;
    this.game.allowPickup = false;
    this.events.emit('rules:state', { state: 'dead', reason, next: nextOffense });
  }

  _onShot(e) {
    if (this.state !== 'live') return;
    const shot = e.shot;
    const s = this.stats.get(shot.shooter);
    if (!s) return;
    this.shotTouchedRim = false;
    s.fga++;
    if (shot.value === 2) s.twoA++;
    else s.oneA++;
    if (shot.kind === 'layup') s.layups++;
    if (shot.grade && shot.kind !== 'dunk') {
      s.releases++;
      if (shot.grade.id === 'perfect') s.perfect++;
    }
    if (shot.kind === 'dunk') s.dunks++;
    // shot clock stops while the shot is in the air
    this.shotInAir = true;
  }

  _onScore() {
    if (this.state !== 'live') return;
    const ball = this.game.ball;
    const shot = ball.shot;
    if (!shot || shot.goaltend) return;
    const shooter = shot.shooter;
    if (this.clearNeeded && this.offense === shooter) {
      // didn't clear the ball: basket doesn't count, possession goes over
      this._event('noclear', shooter);
      this.stats.get(shooter).turnovers++;
      this._toDead(this.game.opponentOf(shooter), 'Ball not cleared');
      return;
    }
    if (this.offense !== shooter) {
      // a "shot" by the non-offense player can only happen after a steal/rebound without clearing
      this._event('noclear', shooter);
      this._toDead(this.game.opponentOf(shooter), 'Ball not cleared');
      return;
    }
    this._award(shooter, shot.value, shot, 'make');
  }

  _award(shooter, value, shot, how) {
    const s = this.stats.get(shooter);
    s.pts += value;
    s.fgm++;
    if (value === 2) s.twoM++;
    else s.oneM++;
    if (shot.kind === 'layup') s.layupsMade++;
    if (shot.grade && shot.grade.id === 'perfect' && shot.kind !== 'dunk') s.perfectMade++;
    const swish = !this.game.ball.touchedRim && !this.game.ball.touchedBoard;
    if (swish && shot.kind !== 'dunk') s.swishes++;
    this.score.set(shooter, this.score.get(shooter) + value);
    if (this.run.who === shooter) this.run.pts += value;
    else this.run = { who: shooter, pts: value };
    s.longestRun = Math.max(s.longestRun, this.run.pts);
    s.timeline.push({ t: this.gameTime, pts: this.score.get(shooter) });
    this.events.emit('rules:score', { athlete: shooter, value, shot, how, swish, score: this.score.get(shooter), opp: this.score.get(this.game.opponentOf(shooter)) });
    if (this._checkWin(shooter)) return;
    const next = this.makeItTakeIt ? shooter : this.game.opponentOf(shooter);
    this._toDead(next, how === 'goaltend' ? 'Goaltending' : 'Score', 1.9);
  }

  _checkWin(scorer) {
    const sc = this.score.get(scorer);
    const op = this.score.get(this.game.opponentOf(scorer));
    const reached = sc >= this.target && (!this.winBy2 || sc - op >= 2);
    if (reached || this.suddenDeath) {
      this.winner = scorer;
      this.state = 'over';
      this.stateT = 0;
      this.game.allowPickup = false;
      this.events.emit('rules:over', { winner: scorer, rules: this });
      return true;
    }
    return false;
  }

  _onPickup(e) {
    if (this.state !== 'live') return;
    const a = e.athlete;
    const ball = this.game.ball;
    const fromShot = e.shot && !e.shot.blocked ? true : !!e.shot;
    if (fromShot) {
      const s = this.stats.get(a);
      s.rebounds++;
      if (a === this.offense) s.offReb++;
      this._event(a === this.offense ? 'oreb' : 'dreb', a);
    }
    ball.shot = null;
    this.shotInAir = false;
    if (a !== this.offense) {
      // change of possession: the new offense must clear the ball beyond the arc
      this.offense = a;
      this.game.offense = a;
      this.clearNeeded = !isBeyondArc(a.pos.x, a.pos.z);
      this.shotClock = this.shotClockLen;
      this.lastWarn = 99;
      this.events.emit('rules:possession', { offense: a, clear: this.clearNeeded });
    } else {
      this.shotClock = this.shotClockLen;
      this.lastWarn = 99;
    }
  }

  update(dt) {
    const game = this.game;
    const ball = game.ball;
    this.stateT += dt;
    if (this.state === 'check') {
      if (this.stateT >= CHECK_TIME) this._toLive();
      return;
    }
    if (this.state === 'dead') {
      if (this.stateT >= this.deadDelay) this._toCheck(this.pendingPossession);
      return;
    }
    if (this.state !== 'live') return;
    this.gameTime += dt;
    const off = this.offense;
    // clear the ball
    if (this.clearNeeded && off.hasBall() && isBeyondArc(off.pos.x, off.pos.z)) {
      this.clearNeeded = false;
      this.events.emit('rules:cleared', { athlete: off });
    }
    // shot clock (runs while someone has possession / ball is live and not a shot in the air)
    const inAir = ball.state === BallState.FREE && ball.shot && !ball.touchedRim && !ball.touchedBoard;
    if (this.shotClockOn && !inAir) {
      this.shotClock -= dt;
      const sec = Math.ceil(this.shotClock);
      if (sec <= 5 && sec < this.lastWarn && sec > 0) {
        this.lastWarn = sec;
        this.events.emit('rules:shotclockWarn', { sec });
      }
      if (this.shotClock <= 0) {
        this.shotClock = 0;
        if (off) this.stats.get(off).turnovers++;
        this._event('shotclock', off);
        game.releaseBall();
        ball.vel.set(0, 0, 0);
        this._toDead(game.opponentOf(off), 'Shot clock violation', 1.4);
        return;
      }
    }
    // out of bounds: ball handler stepping out, or a loose ball leaving the floor area
    const h = ball.owner;
    if (h && h.hasBall() && h.grounded && !inCourtBounds(h.pos.x, h.pos.z, 0.12)) {
      this.stats.get(h).turnovers++;
      this._event('oob', h);
      game.releaseBall();
      ball.vel.set(0, 0, 0);
      this._toDead(game.opponentOf(h), 'Out of bounds', 1.3);
      return;
    }
    if (ball.state === BallState.FREE && (this._oobBall || (ball.pos.y < 0.6 && !inCourtBounds(ball.pos.x, ball.pos.z, 0.1)))) {
      this._oobBall = false;
      const last = ball.lastTouch;
      const next = last ? game.opponentOf(last) : off;
      this._event('oob', last);
      this._toDead(next, 'Out of bounds', 1.3);
      return;
    }
    // time limit
    if (this.timeLimit > 0 && this.gameTime >= this.timeLimit && !this.suddenDeath) {
      const [a, b] = this.players;
      const sa = this.score.get(a);
      const sb = this.score.get(b);
      if (sa !== sb) {
        this.winner = sa > sb ? a : b;
        this.state = 'over';
        this.events.emit('rules:over', { winner: this.winner, rules: this, time: true });
      } else {
        this.suddenDeath = true;
        this.events.emit('rules:suddenDeath', {});
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------
export class PracticeRules {
  constructor(game, user, cpu, opts = {}) {
    this.game = game;
    this.events = game.events;
    this.kind = 'practice';
    this.user = user;
    this.cpu = cpu;
    this.state = 'live';
    this.stateT = 0;
    this.shotClockOn = !!opts.shotClock;
    this.shotClockLen = 24;
    this.shotClock = 24;
    this.rebounder = opts.rebounder !== false;
    this.offense = user;
    this.clearNeeded = false;
    this.stats = new Map([[user, newStats()]]);
    this.session = { makes: 0, attempts: 0, streak: 0, best: 0, byZone: {} };
    this.returnT = -1;
    this._subs = [];
    this.lastWarn = 99;
    this._subs.push(this.events.on('shot:release', (e) => this._onShot(e)));
    this._subs.push(this.events.on('ball:score', () => this._onScore()));
    this._subs.push(
      this.events.on('move:start', (e) => {
        if (e.athlete !== user) return;
        const s = this.stats.get(user);
        s.moves[e.id] = (s.moves[e.id] || 0) + 1;
        s.movesTotal++;
      })
    );
    this.pendingShot = null;
    this.score = new Map([[user, 0]]);
  }

  dispose() {
    for (const off of this._subs) off();
  }
  needsClear() {
    return false;
  }
  getScore(a) {
    return this.score.get(a) || 0;
  }

  start() {
    this.reset();
  }

  reset(x = 0, z = 7.6) {
    const game = this.game;
    const u = this.user;
    u.setAction(null);
    u.place(x, z, yawOf(-x, -z));
    if (this.cpu && this.cpu.inPlay) {
      this.cpu.setAction(null);
      this.cpu.place(x * 0.8, z - 1.6, yawOf(x - x * 0.8, 1.6));
    }
    game.giveBall(u);
    game.ball.pos.set(u.pos.x, 1.0, u.pos.z - 0.3);
    game.ball.prevPos.copy(game.ball.pos);
    game.inputLocked = false;
    game.allowPickup = true;
    this.shotClock = this.shotClockLen;
    this.returnT = -1;
    this.events.emit('rules:state', { state: 'live', offense: u });
  }

  _onShot(e) {
    if (e.athlete !== this.user) return;
    const s = this.stats.get(this.user);
    s.fga++;
    if (e.shot.value === 2) s.twoA++;
    if (e.shot.grade && e.shot.kind !== 'dunk') {
      s.releases++;
      if (e.shot.grade.id === 'perfect') s.perfect++;
    }
    this.session.attempts++;
    this.pendingShot = e.shot;
    this.returnT = 0;
  }

  _onScore() {
    const shot = this.game.ball.shot;
    if (!shot || shot.shooter !== this.user) return;
    const s = this.stats.get(this.user);
    s.fgm++;
    s.pts += shot.value;
    if (shot.value === 2) s.twoM++;
    if (shot.grade && shot.grade.id === 'perfect' && shot.kind !== 'dunk') s.perfectMade++;
    const swish = !this.game.ball.touchedRim && !this.game.ball.touchedBoard;
    if (swish) s.swishes++;
    this.session.makes++;
    this.session.streak++;
    this.session.best = Math.max(this.session.best, this.session.streak);
    this.score.set(this.user, this.score.get(this.user) + shot.value);
    this.events.emit('rules:score', { athlete: this.user, value: shot.value, shot, how: 'make', swish, practice: true, score: this.score.get(this.user) });
    shot.counted = true;
  }

  update(dt) {
    const game = this.game;
    const ball = game.ball;
    const u = this.user;
    this.stateT += dt;
    // the CPU never keeps the ball in practice: if it grabs a rebound, it passes it back
    if (this.cpu && ball.owner === this.cpu && this.cpu.hasBall()) this._passTo(u, this.cpu.animator.chestWorld);
    if (ball.state === BallState.FREE && this.pendingShot) {
      this.returnT += dt;
      const settled = ball.touchedFloor || ball.touchedRim || ball.touchedBoard;
      if (this.returnT > 1.0 && settled && this.rebounder) {
        if (this.pendingShot && !this.pendingShot.counted && !game.ball.scoredThisFlight) {
          this.session.streak = 0;
          this.events.emit('practice:miss', {});
        }
        this.pendingShot = null;
        // rebounder passes from under the rim
        this._passTo(u, new THREE.Vector3(Math.sign(ball.pos.x || 1) * 0.4, 1.2, 0.6));
      }
    }
    if (ball.state === BallState.FREE && !this.pendingShot && this.returnT >= 0) {
      this.returnT += dt;
      if (this.returnT > 6 && this.rebounder) this._passTo(u, new THREE.Vector3(0, 1.2, 0.6));
    }
    if (u.hasBall()) this.pendingShot = null;
    if (this.shotClockOn && u.hasBall()) {
      this.shotClock -= dt;
      const sec = Math.ceil(this.shotClock);
      if (sec <= 5 && sec < this.lastWarn && sec > 0) {
        this.lastWarn = sec;
        this.events.emit('rules:shotclockWarn', { sec });
      }
      if (this.shotClock <= 0) {
        this.events.emit('rules:event', { type: 'shotclock', who: u });
        this.shotClock = this.shotClockLen;
        this.lastWarn = 99;
      }
    } else if (!u.hasBall() && ball.state !== BallState.FREE) {
      this.shotClock = this.shotClockLen;
    }
    if (u.hasBall()) {
      this.shotClock = this.shotClockOn ? this.shotClock : this.shotClockLen;
    }
  }

  /** Physical chest pass to the user (from a rebounder spot). */
  _passTo(a, from) {
    const game = this.game;
    const ball = game.ball;
    game.releaseBall();
    ball.state = BallState.FREE;
    ball.live = true;
    ball.shot = null;
    ball.resetFlags();
    ball.touchedFloor = true;
    ball.pos.copy(from);
    ball.prevPos.copy(from);
    // aim at the receiver's chest where they'll be in ~0.6 s
    const T = 0.62;
    const tx = a.pos.x + a.vel.x * T * 0.5;
    const tz = a.pos.z + a.vel.z * T * 0.5;
    const ty = 1.25;
    ball.vel.set((tx - from.x) / T, (ty - from.y + 0.5 * 9.81 * T * T) / T, (tz - from.z) / T);
    ball.angVel.set(0, 0, 0);
    ball.noPickupBy = this.cpu || null;
    ball.noPickupFor = 1.2;
    this.returnT = -1;
    this.events.emit('practice:pass', {});
  }
}
