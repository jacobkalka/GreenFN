// Small, allocation-free math helpers shared by simulation, animation and rendering.
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp01(invLerp(a, b, v)));
export const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (t) => {
  t = clamp01(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const easeInOut = (t) => {
  t = clamp01(t);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
};
export const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeIn = (t) => clamp01(t) * clamp01(t);
export const bell = (t) => Math.sin(Math.PI * clamp01(t)); // 0 -> 1 -> 0
/** Smooth "window" that rises over [a,b], holds, falls over [c,d]. */
export const windowFn = (t, a, b, c, d) => smoothstep(a, b, t) * (1 - smoothstep(c, d, t));

/** Frame-rate independent exponential approach. k = responsiveness (1/s). */
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const angleDiff = (from, to) => wrapAngle(to - from);
export const dampAngle = (a, b, k, dt) => a + angleDiff(a, b) * (1 - Math.exp(-k * dt));
/** Yaw of a horizontal direction; yaw 0 faces +Z. */
export const yawOf = (x, z) => Math.atan2(x, z);

/** Critically damped / under-damped scalar spring (semi-implicit Euler). */
export class Spring {
  constructor(freq = 4, zeta = 1, value = 0) {
    this.freq = freq;
    this.zeta = zeta;
    this.x = value;
    this.v = 0;
    this.target = value;
  }
  set(v) {
    this.x = v;
    this.target = v;
    this.v = 0;
    return this;
  }
  update(dt, target = this.target) {
    this.target = target;
    const w = TAU * this.freq;
    const a = w * w * (target - this.x) - 2 * this.zeta * w * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

/** Angle spring that always takes the shortest path. */
export class AngleSpring extends Spring {
  update(dt, target = this.target) {
    this.target = target;
    const w = TAU * this.freq;
    const a = w * w * angleDiff(this.x, target) - 2 * this.zeta * w * this.v;
    this.v += a * dt;
    this.x = wrapAngle(this.x + this.v * dt);
    return this.x;
  }
}

/** Vector3 spring (critically damped by default). */
export class Spring3 {
  constructor(freq = 6, zeta = 1) {
    this.freq = freq;
    this.zeta = zeta;
    this.x = new THREE.Vector3();
    this.v = new THREE.Vector3();
  }
  set(p) {
    this.x.copy(p);
    this.v.set(0, 0, 0);
    return this;
  }
  update(dt, target) {
    const w = TAU * this.freq;
    const k = w * w;
    const c = 2 * this.zeta * w;
    this.v.x += (k * (target.x - this.x.x) - c * this.v.x) * dt;
    this.v.y += (k * (target.y - this.x.y) - c * this.v.y) * dt;
    this.v.z += (k * (target.z - this.x.z) - c * this.v.z) * dt;
    this.x.addScaledVector(this.v, dt);
    return this.x;
  }
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

let _spare = null;
/** Standard normal sample (Box–Muller). */
export function gaussian(rng = Math.random) {
  if (_spare !== null) {
    const s = _spare;
    _spare = null;
    return s;
  }
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const mag = Math.sqrt(-2 * Math.log(u));
  _spare = mag * Math.sin(TAU * v);
  return mag * Math.cos(TAU * v);
}

export const randRange = (a, b, rng = Math.random) => a + (b - a) * rng();
export const pick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length) % arr.length];

/** Rotate (x,z) by yaw (yaw 0 = +Z forward). Writes into out (Vector3, y untouched). */
export function rotateYaw(out, x, z, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // local +X is the character's left, local +Z is forward
  out.x = x * c + z * s;
  out.z = -x * s + z * c;
  return out;
}

/** Express a world-space horizontal vector in a yawed frame: returns local x (left) / z (fwd). */
export function toLocalYaw(out, x, z, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out.x = x * c - z * s;
  out.z = x * s + z * c;
  return out;
}

export function horizontalDist(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function horizontalLen(v) {
  return Math.sqrt(v.x * v.x + v.z * v.z);
}

/** Cubic Hermite interpolation of a position (p0,v0)->(p1,v1) over duration T at time t. */
export function hermite(out, p0, v0, p1, v1, T, t) {
  const s = clamp01(t / T);
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  out.x = h00 * p0.x + h10 * T * v0.x + h01 * p1.x + h11 * T * v1.x;
  out.y = h00 * p0.y + h10 * T * v0.y + h01 * p1.y + h11 * T * v1.y;
  out.z = h00 * p0.z + h10 * T * v0.z + h01 * p1.z + h11 * T * v1.z;
  return out;
}

export function hermiteVel(out, p0, v0, p1, v1, T, t) {
  const s = clamp01(t / T);
  const s2 = s * s;
  const d00 = (6 * s2 - 6 * s) / T;
  const d10 = 3 * s2 - 4 * s + 1;
  const d01 = (-6 * s2 + 6 * s) / T;
  const d11 = 3 * s2 - 2 * s;
  out.x = d00 * p0.x + d10 * v0.x + d01 * p1.x + d11 * v1.x;
  out.y = d00 * p0.y + d10 * v0.y + d01 * p1.y + d11 * v1.y;
  out.z = d00 * p0.z + d10 * v0.z + d01 * p1.z + d11 * v1.z;
  return out;
}
