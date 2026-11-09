// Shot model: release grading, contest, error model and physical launch.
// The ball is never "scripted in": we choose an aim point (rim center + errors) and solve a real
// launch velocity for it. Rim/backboard physics then decide makes and misses.
import * as THREE from 'three';
import { solveShot, BallState } from './ball.js';
import { HOOP, BALL, isBeyondArc } from './constants.js';
import { clamp, clamp01, lerp, gaussian, smoothstep } from '../core/math.js';

// Cosmetic jump-shot styles. Timing differs, difficulty is identical (window sizes are equal).
export const JUMPSHOTS = {
  classic: { name: 'Classic', gather: 0.24, jumpV: 2.85, rel: 0.27, arc: 52, setY: 1.92, relY: 2.2, kick: 0, fade: 0 },
  quick: { name: 'Quick Trigger', gather: 0.18, jumpV: 2.55, rel: 0.23, arc: 50, setY: 1.85, relY: 2.12, kick: 0, fade: 0 },
  high: { name: 'High Release', gather: 0.27, jumpV: 3.0, rel: 0.31, arc: 55, setY: 2.02, relY: 2.32, kick: 0.25, fade: 0 },
  fade: { name: 'Fade Artist', gather: 0.24, jumpV: 2.8, rel: 0.28, arc: 54, setY: 1.95, relY: 2.22, kick: 0.6, fade: 0.9 },
  sling: { name: 'Sling Shot', gather: 0.21, jumpV: 2.7, rel: 0.26, arc: 51, setY: 1.78, relY: 2.15, kick: 0.15, fade: 0 },
};

export const GRADES = {
  perfect: { id: 'perfect', label: 'GREEN', short: 'Perfect' },
  early: { id: 'early', label: 'SLIGHTLY EARLY', short: 'Early' },
  late: { id: 'late', label: 'SLIGHTLY LATE', short: 'Late' },
  veryEarly: { id: 'veryEarly', label: 'VERY EARLY', short: 'Very early' },
  veryLate: { id: 'veryLate', label: 'VERY LATE', short: 'Very late' },
};

/** Half-width (seconds) of the perfect window. */
export function perfectWindow(shooter, kind, dist, difficultyMul = 1) {
  let w = kind === 'layup' ? 0.06 : 0.036;
  w *= 0.85 + shooter.ratings.release * 0.3;
  if (kind !== 'layup') w *= lerp(1.12, 0.86, clamp01((dist - 2) / 6));
  return w / difficultyMul;
}

export function gradeRelease(delta, w) {
  const ad = Math.abs(delta);
  if (ad <= w) return GRADES.perfect;
  if (ad <= w + 0.075) return delta < 0 ? GRADES.early : GRADES.late;
  return delta < 0 ? GRADES.veryEarly : GRADES.veryLate;
}

const _hand = new THREE.Vector3();
/**
 * Contest level 0..1 from the closest defender: hand proximity to the ball, positioning between
 * shooter and rim, verticality (jumping with hands up).
 */
export function computeContest(game, shooter, ballPos) {
  const d = game.opponentOf(shooter);
  if (!d) return 0;
  const an = d.animator;
  let handDist = Infinity;
  for (const k of ['L', 'R']) {
    const dd = an.palmWorld[k].distanceTo(ballPos);
    if (dd < handDist) handDist = dd;
  }
  const bodyDist = Math.hypot(d.pos.x - shooter.pos.x, d.pos.z - shooter.pos.z);
  // in front (between shooter and rim)?
  const tx = -shooter.pos.x;
  const tz = -shooter.pos.z;
  const tl = Math.hypot(tx, tz) || 1;
  const fx = (d.pos.x - shooter.pos.x) / (bodyDist || 1);
  const fz = (d.pos.z - shooter.pos.z) / (bodyDist || 1);
  const front = clamp01((fx * tx + fz * tz) / tl * 0.8 + 0.45);
  let c = clamp01(1 - (handDist - 0.25) / 1.35) * 0.65 + clamp01(1 - (bodyDist - 0.7) / 1.8) * 0.35;
  c *= front;
  // verticality: airborne defender with high hands
  if (!d.grounded) c = Math.min(1, c * 1.25 + 0.05);
  if (d.stumble > 0 || d.offBalance > 0.2) c *= 0.4;
  return clamp01(c);
}

/** Shooting skill for a distance. */
export function skillFor(shooter, dist, kind) {
  const r = shooter.ratings;
  if (kind === 'layup' || kind === 'dunk') return r.shotClose;
  if (dist < 3.2) return lerp(r.shotClose, r.shotMid, clamp01((dist - 1.5) / 1.7));
  if (dist < 6.6) return r.shotMid;
  return lerp(r.shotMid, r.shotLong, clamp01((dist - 6.6) / 0.8));
}

/**
 * Error sigma (meters at the rim plane) and longitudinal bias for a shot.
 * info: { kind, dist, grade, contest, moveSpeed, stamina, shooter, typeMul }
 */
export function errorModel(info) {
  const { kind, dist, grade, contest, moveSpeed, stamina, shooter } = info;
  const skill = skillFor(shooter, dist, kind);
  // Calibrated against the measured physical make window of the rim (~±0.18 m long, ±0.13 m lat at
  // mid-range; see tests/shotcal.mjs). Values are 1-sigma aim errors at the rim plane.
  let sigma;
  if (kind === 'layup') sigma = 0.075 + 0.02 * Math.max(0, dist - 1);
  else sigma = 0.07 + 0.012 * dist;
  sigma *= 1.38 - 0.62 * skill;
  let bias = 0;
  let tim = 1;
  switch (grade.id) {
    case 'perfect':
      tim = 0.5;
      break;
    case 'early':
      bias = -0.06;
      break;
    case 'late':
      bias = 0.06;
      break;
    case 'veryEarly':
      tim = 1.5;
      bias = -0.17 - 0.01 * dist;
      break;
    case 'veryLate':
      tim = 1.5;
      bias = 0.17 + 0.01 * dist;
      break;
  }
  sigma *= tim;
  // contest, movement and fatigue still matter on a perfect release (less so)
  const perfect = grade.id === 'perfect';
  const k = perfect ? 0.55 : 1;
  sigma *= 1 + contest * 1.1 * k;
  sigma *= 1 + Math.min(1.2, moveSpeed * 0.09) * k;
  if (stamina < 0.5) sigma *= 1 + (0.5 - stamina) * 0.6 * k;
  sigma *= info.typeMul || 1;
  if (contest > 0.6) bias -= (contest - 0.6) * 0.1; // heavy contests tend to come up short
  return { sigma, bias };
}

const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
/**
 * Launch a shot from the ball's current position. Returns the shot record.
 */
export function launchShot(game, shooter, opts) {
  const ball = game.ball;
  const kind = opts.kind;
  const dist = Math.hypot(shooter.pos.x, shooter.pos.z);
  const err = errorModel({
    kind,
    dist,
    grade: opts.grade,
    contest: opts.contest,
    moveSpeed: opts.moveSpeed,
    stamina: shooter.stamina,
    shooter,
    typeMul: opts.typeMul,
  });
  const rng = game.rng || Math.random;
  const eLong = err.bias + gaussian(rng) * err.sigma;
  const eLat = gaussian(rng) * err.sigma * 0.8;
  // direction from ball to rim (horizontal)
  _dir.set(-ball.pos.x, 0, -ball.pos.z);
  const hd = _dir.length() || 1;
  _dir.multiplyScalar(1 / hd);
  // aim slightly past the center: best make window for an arcing ball
  let aimBack = kind === 'layup' ? 0.0 : 0.04;
  _target.set(0, HOOP.rimY, 0).addScaledVector(_dir, aimBack + eLong);
  _target.x += _dir.z * eLat;
  _target.z += -_dir.x * eLat;
  let angle = opts.arc;
  if (opts.bank) {
    // bank shot: aim at a spot on the glass above/behind the rim
    _target.copy(opts.bankTarget);
    _target.addScaledVector(_dir, eLong * 0.6);
    _target.x += _dir.z * eLat;
    _target.z += -_dir.x * eLat;
  }
  const spin = opts.spin ?? 15;
  solveShot(ball.pos, _target, angle, spin, ball.vel, ball.angVel);
  // the ball's velocity also carries a bit of the shooter's drift (already part of the error model)
  game.releaseBall();
  ball.state = BallState.FREE;
  ball.live = true;
  ball.resetFlags();
  ball.noPickupBy = shooter;
  ball.noPickupFor = 10; // can't catch own shot until it hits something
  ball.lastTouch = shooter;
  const value = opts.value ?? (isBeyondArc(opts.fromX, opts.fromZ) ? 2 : 1);
  ball.shot = {
    shooter,
    kind,
    value,
    dist,
    grade: opts.grade,
    contest: opts.contest,
    sigma: err.sigma,
    time: game.time,
    blocked: false,
    fromX: opts.fromX,
    fromZ: opts.fromZ,
    bank: !!opts.bank,
  };
  game.events.emit('shot:release', { shot: ball.shot, athlete: shooter });
  return ball.shot;
}
