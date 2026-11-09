// Basketball rigid-body simulation: gravity, quadratic drag, Magnus lift, spin, impulse-based
// collisions with friction against floor / rim torus / backboard / stanchion / player bodies,
// net damping and geometric "through the hoop" score detection.
import * as THREE from 'three';
import { BALL, HOOP, GRAVITY, COURT } from './constants.js';

const _n = new THREE.Vector3();
const _rc = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _jt = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _q = new THREE.Vector3();
const _rel = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export const BallState = {
  HELD: 'held', // attached to a player's hands (gather, shot set, check)
  DRIBBLE: 'dribble', // owned, controlled bounce cycle
  FREE: 'free', // simulated freely (shot, rebound, loose, dead)
};

export class Ball {
  constructor() {
    this.pos = new THREE.Vector3(0, BALL.radius, 4);
    this.prevPos = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.rot = new THREE.Quaternion();
    this.prevRot = new THREE.Quaternion();
    this.state = BallState.FREE;
    this.owner = null; // athlete holding/dribbling
    this.lastTouch = null; // last athlete to touch
    this.shot = null; // active shot record (shooter, value, etc.)
    this.live = true; // can be picked up / scored
    this.noPickupFor = 0; // seconds during which nobody may grab it
    this.noPickupBy = null; // athlete that may not grab it (e.g. own airball)
    this.enteredRim = false;
    this.scoredThisFlight = false;
    this.touchedRim = false;
    this.touchedBoard = false;
    this.touchedFloor = false;
    this.squash = 0; // visual squash amount (0..1), decays
    this.squashDir = new THREE.Vector3(0, 1, 0);
    this.dragEnabled = true;
    this.lastBounceT = 0;
    this.time = 0;
  }

  resetFlags() {
    this.enteredRim = false;
    this.scoredThisFlight = false;
    this.touchedRim = false;
    this.touchedBoard = false;
    this.touchedFloor = false;
  }

  /** Integrate rotation from angular velocity (visual + spin state). */
  integrateRotation(dt) {
    const w = this.angVel.length();
    if (w > 1e-5) {
      _tmp.copy(this.angVel).multiplyScalar(1 / w);
      _qr.setFromAxisAngle(_tmp, w * dt);
      this.rot.premultiply(_qr).normalize();
    }
  }
}
const _qr = new THREE.Quaternion();

// ---------------------------------------------------------------------------------------------
// Static collision world around the hoop.
class Box {
  constructor(minX, minY, minZ, maxX, maxY, maxZ, kind, restitution, friction) {
    this.min = new THREE.Vector3(minX, minY, minZ);
    this.max = new THREE.Vector3(maxX, maxY, maxZ);
    this.kind = kind;
    this.e = restitution;
    this.mu = friction;
  }
}

export function buildHoopColliders() {
  const r = HOOP;
  const boxes = [];
  // Backboard (glass + frame)
  boxes.push(
    new Box(-r.boardHalfW, r.boardBottom, r.boardFaceZ - r.boardThick, r.boardHalfW, r.boardTop, r.boardFaceZ, 'board', BALL.boardRestitution, BALL.boardFriction)
  );
  // Rim mounting bracket (between rim back and board)
  boxes.push(new Box(-0.07, r.rimY - 0.035, r.boardFaceZ, 0.07, r.rimY + 0.004, -r.rimR - r.rimTube, 'rim', 0.45, 0.3));
  // Support arm, pole and padded base of the stanchion (behind the baseline)
  boxes.push(new Box(-0.09, 3.3, -3.1, 0.09, 3.52, r.boardFaceZ - r.boardThick, 'support', 0.4, 0.4));
  boxes.push(new Box(-0.14, 1.0, -3.35, 0.14, 3.52, -3.0, 'support', 0.4, 0.4));
  boxes.push(new Box(-0.75, 0, -4.35, 0.75, 1.15, -2.85, 'pad', 0.25, 0.6));
  return { boxes, rimCenter: new THREE.Vector3(0, r.rimY, 0) };
}

// ---------------------------------------------------------------------------------------------

/**
 * Resolve a contact between the ball and a surface.
 * n: unit normal pointing from surface to ball center. pen: penetration depth (>0).
 * surfVel: velocity of the surface (or null). Returns impact normal speed (>=0).
 */
export function resolveContact(ball, n, pen, e, mu, surfVel = null) {
  ball.pos.addScaledVector(n, pen);
  _rc.copy(n).multiplyScalar(-BALL.radius);
  _vc.copy(ball.vel);
  if (surfVel) _vc.sub(surfVel);
  _tmp.crossVectors(ball.angVel, _rc);
  _vc.add(_tmp);
  const vn = _vc.dot(n);
  if (vn >= 0) return 0;
  const impact = -vn;
  // Softer restitution for slow contacts (prevents micro-jitter), slightly lower for very hard hits.
  let eff = e;
  if (impact < 0.35) eff = 0;
  else if (impact > 6) eff = e * (1 - Math.min(0.15, (impact - 6) * 0.02));
  const m = BALL.mass;
  const jn = (1 + eff) * impact * m;
  _vt.copy(_vc).addScaledVector(n, -vn);
  const vtLen = _vt.length();
  _jt.set(0, 0, 0);
  if (vtLen > 1e-6) {
    // Impulse that would make the contact point stick (hollow sphere: 1 + mR^2/I = 2.5)
    const stick = (vtLen * m) / 2.5;
    const jt = Math.min(stick, mu * jn);
    _jt.copy(_vt).multiplyScalar(-jt / vtLen);
  }
  ball.vel.addScaledVector(n, jn / m).addScaledVector(_jt, 1 / m);
  _tmp.crossVectors(_rc, _jt).multiplyScalar(1 / BALL.inertia);
  ball.angVel.add(_tmp);
  return impact;
}

function collideBox(ball, box) {
  const p = ball.pos;
  _q.set(
    Math.max(box.min.x, Math.min(p.x, box.max.x)),
    Math.max(box.min.y, Math.min(p.y, box.max.y)),
    Math.max(box.min.z, Math.min(p.z, box.max.z))
  );
  _n.subVectors(p, _q);
  let d2 = _n.lengthSq();
  const R = BALL.radius;
  if (d2 > R * R) return 0;
  let pen;
  if (d2 < 1e-10) {
    // Center inside the box: push out along the axis of least penetration.
    const dx1 = p.x - box.min.x, dx2 = box.max.x - p.x;
    const dy1 = p.y - box.min.y, dy2 = box.max.y - p.y;
    const dz1 = p.z - box.min.z, dz2 = box.max.z - p.z;
    let m = dx1; _n.set(-1, 0, 0);
    if (dx2 < m) { m = dx2; _n.set(1, 0, 0); }
    if (dy1 < m) { m = dy1; _n.set(0, -1, 0); }
    if (dy2 < m) { m = dy2; _n.set(0, 1, 0); }
    if (dz1 < m) { m = dz1; _n.set(0, 0, -1); }
    if (dz2 < m) { m = dz2; _n.set(0, 0, 1); }
    pen = m + R;
  } else {
    const d = Math.sqrt(d2);
    _n.multiplyScalar(1 / d);
    pen = R - d;
  }
  return resolveContact(ball, _n, pen, box.e, box.mu);
}

function collideRim(ball, c) {
  const p = ball.pos;
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  let dh = Math.sqrt(dx * dx + dz * dz);
  let ux, uz;
  if (dh < 1e-6) {
    ux = 1;
    uz = 0;
    dh = 0;
  } else {
    ux = dx / dh;
    uz = dz / dh;
  }
  // closest point on the rim centerline circle
  _q.set(c.x + ux * HOOP.rimR, c.y, c.z + uz * HOOP.rimR);
  _n.subVectors(p, _q);
  const d = _n.length();
  const minD = BALL.radius + HOOP.rimTube;
  if (d >= minD || d < 1e-8) return 0;
  _n.multiplyScalar(1 / d);
  return resolveContact(ball, _n, minD - d, BALL.rimRestitution, BALL.rimFriction);
}

/** Net region: slows the ball and keeps it centered as it falls through. */
function applyNet(ball, c, dt) {
  const p = ball.pos;
  const depth = c.y - p.y;
  if (depth < -0.02 || depth > HOOP.netDepth + 0.08) return false;
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const dh = Math.sqrt(dx * dx + dz * dz);
  const t = Math.min(1, Math.max(0, depth / HOOP.netDepth));
  const netR = HOOP.rimInnerR + (HOOP.netBottomR - HOOP.rimInnerR) * t;
  if (dh > netR + 0.02) return false;
  // Only a ball that has genuinely passed through the ring (fully below the rim plane, center well
  // inside) is slowed by the strands. The net never pulls a rim-contact ball in.
  if (depth > BALL.radius * 0.9 && dh < HOOP.rimInnerR - 0.03) {
    // The net strands grab the ball: strong damping of horizontal motion, mild vertical drag.
    const kH = 9;
    const kV = 3.2;
    ball.vel.x *= Math.exp(-kH * dt);
    ball.vel.z *= Math.exp(-kH * dt);
    if (ball.vel.y < 0) ball.vel.y *= Math.exp(-kV * dt);
    // keep inside the narrowing net
    const allowed = Math.max(0.0, netR - BALL.radius + 0.035);
    if (dh > allowed && dh > 1e-5) {
      const push = (dh - allowed) * 0.5;
      p.x -= (dx / dh) * push;
      p.z -= (dz / dh) * push;
    }
    ball.angVel.multiplyScalar(Math.exp(-4 * dt));
  }
  return true;
}

export class BallPhysics {
  constructor(events) {
    this.world = buildHoopColliders();
    this.events = events; // EventBus
    this.capsules = []; // dynamic player body colliders {a,b,r,vel,athlete}
  }

  /** Free-flight step with all collisions. */
  step(ball, dt) {
    ball.time += dt;
    const v = ball.vel;
    const p = ball.pos;
    // --- forces
    if (ball.dragEnabled) {
      const speed = v.length();
      const kd = BALL.dragK * speed;
      v.x -= v.x * kd * dt;
      v.y -= v.y * kd * dt;
      v.z -= v.z * kd * dt;
      // Magnus: a = k * (w x v)
      _tmp.crossVectors(ball.angVel, v).multiplyScalar(BALL.magnusK * dt);
      v.add(_tmp);
    }
    v.y -= GRAVITY * dt;
    const prevY = p.y;
    const prevX = p.x;
    const prevZ = p.z;
    p.addScaledVector(v, dt);
    ball.angVel.multiplyScalar(Math.exp(-0.05 * dt));

    // --- static colliders
    const rimC = this.world.rimCenter;
    // Cheap bounding test before detailed hoop collisions.
    const nearHoop = p.y > 2.4 && p.z < 1.2 && p.z > -4.5 && Math.abs(p.x) < 1.6;
    if (nearHoop || p.y < 1.4) {
      for (const box of this.world.boxes) {
        const imp = collideBox(ball, box);
        if (imp > 0) this._bounce(ball, box.kind, imp);
      }
    }
    if (nearHoop) {
      const imp = collideRim(ball, rimC);
      if (imp > 0) this._bounce(ball, 'rim', imp);
      applyNet(ball, rimC, dt);
    }

    // --- dynamic player capsules
    for (let i = 0; i < this.capsules.length; i++) this._collideCapsule(ball, this.capsules[i]);

    // --- floor
    const R = BALL.radius;
    if (p.y < R) {
      _n.set(0, 1, 0);
      const imp = resolveContact(ball, _n, R - p.y, BALL.floorRestitution, BALL.floorFriction);
      if (imp > 0.6) this._bounce(ball, 'floor', imp);
      if (Math.abs(v.y) < 0.3) {
        // resting / rolling contact
        v.y = 0;
        p.y = R;
        this._rolling(ball, dt);
      }
    }

    // --- score detection (geometric, through the ring from above)
    this._scoreCheck(ball, prevX, prevY, prevZ);

    ball.squash = Math.max(0, ball.squash - dt * 9);
  }

  _rolling(ball, dt) {
    const v = ball.vel;
    const sp = Math.sqrt(v.x * v.x + v.z * v.z);
    if (sp > 1e-4) {
      const dec = Math.min(sp, BALL.rollingDecel * dt);
      v.x -= (v.x / sp) * dec;
      v.z -= (v.z / sp) * dec;
    }
    // slip friction drives spin toward rolling: w = (up x v) / r
    _tmp.set(v.z, 0, -v.x).multiplyScalar(1 / BALL.radius);
    ball.angVel.lerp(_tmp, Math.min(1, 12 * dt));
    if (sp < 0.02) {
      v.x = 0;
      v.z = 0;
      ball.angVel.multiplyScalar(Math.exp(-3 * dt));
    }
  }

  _bounce(ball, surface, impact) {
    if (surface === 'rim') ball.touchedRim = true;
    if (surface === 'board') ball.touchedBoard = true;
    if (surface === 'floor') ball.touchedFloor = true;
    ball.squash = Math.min(1, Math.max(ball.squash, impact / 9));
    ball.squashDir.copy(_n);
    this.events.emit('ball:impact', { surface, impact, ball, x: ball.pos.x, y: ball.pos.y, z: ball.pos.z });
  }

  _collideCapsule(ball, cap) {
    // closest point on segment a-b to the ball center
    const p = ball.pos;
    const ax = cap.a.x, ay = cap.a.y, az = cap.a.z;
    const bx = cap.b.x - ax, by = cap.b.y - ay, bz = cap.b.z - az;
    const len2 = bx * bx + by * by + bz * bz;
    let t = len2 > 0 ? ((p.x - ax) * bx + (p.y - ay) * by + (p.z - az) * bz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    _q.set(ax + bx * t, ay + by * t, az + bz * t);
    _n.subVectors(p, _q);
    const d = _n.length();
    const minD = BALL.radius + cap.r;
    if (d >= minD || d < 1e-6) return;
    _n.multiplyScalar(1 / d);
    // relative motion check
    _rel.copy(ball.vel).sub(cap.vel);
    if (_rel.dot(_n) > 0 && d > minD * 0.7) {
      ball.pos.addScaledVector(_n, minD - d);
      return;
    }
    const imp = resolveContact(ball, _n, minD - d, BALL.bodyRestitution, 0.4, cap.vel);
    if (imp > 0.5) {
      ball.lastTouch = cap.athlete;
      this.events.emit('ball:impact', { surface: 'body', impact: imp, ball, athlete: cap.athlete, x: p.x, y: p.y, z: p.z });
    }
  }

  _scoreCheck(ball, px, py, pz) {
    const rimY = HOOP.rimY;
    const p = ball.pos;
    if (!ball.live) return;
    if (!ball.enteredRim) {
      if (py >= rimY && p.y < rimY && ball.vel.y < 0) {
        const t = (py - rimY) / (py - p.y);
        const cx = px + (p.x - px) * t;
        const cz = pz + (p.z - pz) * t;
        if (Math.sqrt(cx * cx + cz * cz) < HOOP.rimInnerR - 0.012) {
          ball.enteredRim = true;
          this.events.emit('ball:rimEnter', { ball });
        }
      }
    } else {
      if (p.y > rimY + 0.06) {
        ball.enteredRim = false; // popped back out
      } else if (p.y < rimY - 0.3) {
        ball.enteredRim = false;
        const dh = Math.sqrt(p.x * p.x + p.z * p.z);
        if (dh < HOOP.rimInnerR && !ball.scoredThisFlight) {
          ball.scoredThisFlight = true;
          this.events.emit('ball:score', { ball });
        }
      }
    }
  }
}

/**
 * Simulate a free trajectory (no collisions) until it descends through height targetY.
 * Returns horizontal distance traveled along the launch direction, or -1 if it never gets there.
 * Used by the shot solver; mirrors the free-flight integrator exactly.
 */
const _sp = new THREE.Vector3();
const _sv = new THREE.Vector3();
const _sw = new THREE.Vector3();
const _st = new THREE.Vector3();
export function simulateToHeight(p0, v0, w0, targetY, dt = 1 / 240, maxT = 4, out = null) {
  _sp.copy(p0);
  _sv.copy(v0);
  _sw.copy(w0);
  let t = 0;
  let apex = p0.y;
  let prevY = p0.y;
  while (t < maxT) {
    const speed = _sv.length();
    const kd = BALL.dragK * speed;
    _sv.x -= _sv.x * kd * dt;
    _sv.y -= _sv.y * kd * dt;
    _sv.z -= _sv.z * kd * dt;
    _st.crossVectors(_sw, _sv).multiplyScalar(BALL.magnusK * dt);
    _sv.add(_st);
    _sv.y -= GRAVITY * dt;
    prevY = _sp.y;
    _sp.addScaledVector(_sv, dt);
    t += dt;
    if (_sp.y > apex) apex = _sp.y;
    if (_sv.y < 0 && prevY >= targetY && _sp.y < targetY) {
      const f = (prevY - targetY) / (prevY - _sp.y);
      const x = _sp.x - _sv.x * dt * (1 - f);
      const z = _sp.z - _sv.z * dt * (1 - f);
      if (out) {
        out.x = x;
        out.y = targetY;
        out.z = z;
        out.t = t;
        out.apex = apex;
        out.vy = _sv.y;
        out.vh = Math.sqrt(_sv.x * _sv.x + _sv.z * _sv.z);
      }
      return Math.sqrt((x - p0.x) * (x - p0.x) + (z - p0.z) * (z - p0.z));
    }
    if (_sv.y < 0 && _sp.y < targetY - 0.5) return -1;
  }
  return -1;
}

/**
 * Solve launch speed so that a ball launched from p0 toward target (horizontal direction) at
 * elevation `angle` (radians) with backspin `spin` (rad/s) descends through target.y at the target.
 * Writes velocity + angular velocity. Returns flight info.
 */
const _dir = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _info = { x: 0, y: 0, z: 0, t: 0, apex: 0, vy: 0, vh: 0 };
export function solveShot(p0, target, angle, spin, outVel, outAngVel) {
  _dir.set(target.x - p0.x, 0, target.z - p0.z);
  const dist = _dir.length();
  _dir.multiplyScalar(1 / Math.max(dist, 1e-6));
  // backspin axis: perpendicular to travel, so that top of ball moves backward
  _axis.set(_dir.z, 0, -_dir.x); // = up x dir ... rotates top toward -dir => backspin
  // up x dir = (0,1,0)x(dx,0,dz) = (dz, 0, -dx); spin about it moves the top toward +dir (topspin).
  // so negate for backspin:
  outAngVel.copy(_axis).multiplyScalar(-spin);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  let lo = 2;
  let hi = 20;
  let best = 0;
  for (let i = 0; i < 40; i++) {
    const s = (lo + hi) * 0.5;
    outVel.set(_dir.x * cosA * s, sinA * s, _dir.z * cosA * s);
    const d = simulateToHeight(p0, outVel, outAngVel, target.y, 1 / 240, 4, _info);
    if (d < 0 || d < dist) lo = s;
    else hi = s;
    best = s;
    if (hi - lo < 0.0005) break;
  }
  const s = (lo + hi) * 0.5;
  outVel.set(_dir.x * cosA * s, sinA * s, _dir.z * cosA * s);
  simulateToHeight(p0, outVel, outAngVel, target.y, 1 / 240, 4, _info);
  return { speed: s, flightTime: _info.t, apex: _info.apex, entryAngle: Math.atan2(-_info.vy, _info.vh), best };
}

export const RIM_CENTER = new THREE.Vector3(0, HOOP.rimY, 0);
export { COURT };
