// Procedural humanoid skeleton. Limb bones point along local -Y. Character faces local +Z,
// its left side is local +X. The rig lives in the simulation (no meshes); views mirror it.
import * as THREE from 'three';

export const DIM = {
  pelvisH: 1.05, // pelvis joint height when standing straight
  hipX: 0.1,
  hipY: -0.06,
  thigh: 0.46,
  shin: 0.45,
  ankleH: 0.085,
  footFwd: 0.19, // ankle -> toe tip (forward)
  footBack: 0.07, // ankle -> heel
  spine: 0.1,
  chest: 0.22,
  neck: 0.27,
  head: 0.1,
  clavX: 0.03,
  clavY: 0.21,
  shoulderX: 0.175,
  upperArm: 0.335,
  forearm: 0.285,
  hand: 0.19,
  palm: 0.085, // wrist -> palm center
};

// name, parent, offset
export const JOINTS = [
  ['root', null, [0, 0, 0]],
  ['pelvis', 'root', [0, DIM.pelvisH, 0]],
  ['spine', 'pelvis', [0, DIM.spine, 0]],
  ['chest', 'spine', [0, DIM.chest, 0]],
  ['neck', 'chest', [0, DIM.neck, 0]],
  ['head', 'neck', [0, DIM.head, 0]],
  ['clavL', 'chest', [DIM.clavX, DIM.clavY, 0]],
  ['upperArmL', 'clavL', [DIM.shoulderX, 0, 0]],
  ['forearmL', 'upperArmL', [0, -DIM.upperArm, 0]],
  ['handL', 'forearmL', [0, -DIM.forearm, 0]],
  ['clavR', 'chest', [-DIM.clavX, DIM.clavY, 0]],
  ['upperArmR', 'clavR', [-DIM.shoulderX, 0, 0]],
  ['forearmR', 'upperArmR', [0, -DIM.upperArm, 0]],
  ['handR', 'forearmR', [0, -DIM.forearm, 0]],
  ['thighL', 'pelvis', [DIM.hipX, DIM.hipY, 0]],
  ['shinL', 'thighL', [0, -DIM.thigh, 0]],
  ['footL', 'shinL', [0, -DIM.shin, 0]],
  ['thighR', 'pelvis', [-DIM.hipX, DIM.hipY, 0]],
  ['shinR', 'thighR', [0, -DIM.thigh, 0]],
  ['footR', 'shinR', [0, -DIM.shin, 0]],
];

export const JOINT_INDEX = Object.fromEntries(JOINTS.map((j, i) => [j[0], i]));
export const JOINT_COUNT = JOINTS.length;
export const POSE_STRIDE = 7; // px py pz qx qy qz qw

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _e = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _t = new THREE.Vector3();

export class Rig {
  constructor() {
    this.joints = [];
    this.byName = {};
    for (const [name, parent, off] of JOINTS) {
      const o = new THREE.Object3D();
      o.name = name;
      o.position.set(off[0], off[1], off[2]);
      o.userData.rest = o.position.clone();
      this.joints.push(o);
      this.byName[name] = o;
      if (parent) this.byName[parent].add(o);
    }
    this.root = this.byName.root;
    this.pose = new Float32Array(JOINT_COUNT * POSE_STRIDE);
    this.prevPose = new Float32Array(JOINT_COUNT * POSE_STRIDE);
    this.writePose(this.pose);
    this.prevPose.set(this.pose);
  }

  j(name) {
    return this.byName[name];
  }

  resetLocalRotations() {
    for (const o of this.joints) {
      o.quaternion.identity();
      o.position.copy(o.userData.rest);
    }
  }

  update() {
    this.root.updateMatrixWorld(true);
  }

  writePose(arr) {
    for (let i = 0; i < this.joints.length; i++) {
      const o = this.joints[i];
      const k = i * POSE_STRIDE;
      arr[k] = o.position.x;
      arr[k + 1] = o.position.y;
      arr[k + 2] = o.position.z;
      arr[k + 3] = o.quaternion.x;
      arr[k + 4] = o.quaternion.y;
      arr[k + 5] = o.quaternion.z;
      arr[k + 6] = o.quaternion.w;
    }
  }

  /** Store last pose and capture the current one (call once per sim tick, after solving). */
  commitPose() {
    this.prevPose.set(this.pose);
    this.writePose(this.pose);
  }

  /** Teleport: previous pose = current (no interpolation smear). */
  snapPose() {
    this.writePose(this.pose);
    this.prevPose.set(this.pose);
  }

  /** Set a joint's world-space orientation (parent world matrices must be current). */
  setWorldQuat(joint, qWorld) {
    joint.parent.getWorldQuaternion(_q2);
    joint.quaternion.copy(_q2.invert().multiply(qWorld));
  }

  /**
   * Analytic two-bone IK.
   * upper/lower: joints at chain start and middle. target: world pos for the chain end.
   * pole: world direction the middle joint should bulge toward.
   * bendSign: +1 => local +Z faces pole (knees), -1 => local -Z faces pole (elbows).
   * Returns the achieved end position in `outEnd` (if given).
   */
  solveTwoBone(upper, lower, l1, l2, target, pole, bendSign, outEnd = null) {
    upper.parent.updateWorldMatrix(true, false);
    upper.getWorldPosition(_a);
    _u.subVectors(target, _a);
    let d = _u.length();
    const maxD = (l1 + l2) * 0.9995;
    const minD = Math.abs(l1 - l2) + 0.02;
    if (d < 1e-6) {
      _u.set(0, -1, 0);
      d = minD;
    } else _u.multiplyScalar(1 / d);
    if (d > maxD) d = maxD;
    if (d < minD) d = minD;
    // perpendicular pole component
    _p.copy(pole).addScaledVector(_u, -pole.dot(_u));
    if (_p.lengthSq() < 1e-8) {
      // degenerate: pick any perpendicular
      _p.set(0, 0, 1).addScaledVector(_u, -_u.z);
      if (_p.lengthSq() < 1e-8) _p.set(1, 0, 0).addScaledVector(_u, -_u.x);
    }
    _p.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    _e.copy(_a).addScaledVector(_u, a).addScaledVector(_p, h); // middle joint
    _t.copy(_a).addScaledVector(_u, d); // achieved end

    // upper bone basis: y = -(E - A)/|E-A|, z = +/- pole perpendicular, x = y × z
    _y.subVectors(_a, _e).normalize();
    _z.copy(_p).multiplyScalar(bendSign);
    _z.addScaledVector(_y, -_z.dot(_y)).normalize();
    _x.crossVectors(_y, _z).normalize();
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    this.setWorldQuat(upper, _q);
    upper.updateWorldMatrix(false, false);

    // lower bone: shares hinge axis x
    _y.subVectors(_e, _t).normalize();
    _z.crossVectors(_x, _y).normalize();
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    this.setWorldQuat(lower, _q);
    lower.updateWorldMatrix(false, false);
    if (outEnd) outEnd.copy(_t);
    return d;
  }
}

/** Build a world quaternion from a "down the bone" direction and a forward hint. */
const _bm = new THREE.Matrix4();
export function quatFromAxes(out, xAxis, yAxis, zAxis) {
  _bm.makeBasis(xAxis, yAxis, zAxis);
  return out.setFromRotationMatrix(_bm);
}

const _hx = new THREE.Vector3();
const _hy = new THREE.Vector3();
const _hz = new THREE.Vector3();
/**
 * Hand world orientation: fingers along `fingerDir`, palm facing `palmDir`.
 * Left hand palm normal = local -X, right hand palm normal = local +X.
 */
export function handQuat(out, fingerDir, palmDir, side) {
  _hy.copy(fingerDir).normalize().negate(); // local +Y points back to the wrist
  _hx.copy(palmDir).addScaledVector(_hy, -palmDir.dot(_hy));
  if (_hx.lengthSq() < 1e-8) _hx.set(1, 0, 0);
  _hx.normalize();
  if (side > 0) _hx.negate(); // left: palm = -X
  _hz.crossVectors(_hx, _hy).normalize();
  _bm.makeBasis(_hx, _hy, _hz);
  return out.setFromRotationMatrix(_bm);
}
