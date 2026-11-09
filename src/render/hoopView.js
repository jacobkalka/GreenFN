// Hoop: stanchion, glass backboard, rim and a verlet-simulated diamond-mesh net.
import * as THREE from 'three';
import { HOOP, BALL } from '../sim/constants.js';
import { BufferGeometryUtils } from 'three/addons';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();

export class NetSim {
  constructor(center, rows = 7, cols = 12) {
    this.center = center.clone();
    this.rows = rows;
    this.cols = cols;
    this.n = rows * cols;
    this.p = new Float32Array(this.n * 3);
    this.prev = new Float32Array(this.n * 3);
    this.rest = new Float32Array(this.n * 3);
    this.links = [];
    const step = (Math.PI * 2) / cols;
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1);
      // taper with a slight belly in the middle
      const r = HOOP.rimR - 0.004 + (HOOP.netBottomR - HOOP.rimR) * Math.pow(t, 0.85);
      const y = center.y - HOOP.netDepth * t;
      for (let j = 0; j < cols; j++) {
        const ang = (j + 0.5 * (i % 2)) * step;
        const k = (i * cols + j) * 3;
        this.rest[k] = center.x + Math.cos(ang) * r;
        this.rest[k + 1] = y;
        this.rest[k + 2] = center.z + Math.sin(ang) * r;
      }
    }
    this.p.set(this.rest);
    this.prev.set(this.rest);
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols; j++) {
        const a = i * cols + j;
        let b1, b2;
        if (i % 2 === 0) {
          b1 = (i + 1) * cols + ((j - 1 + cols) % cols);
          b2 = (i + 1) * cols + j;
        } else {
          b1 = (i + 1) * cols + j;
          b2 = (i + 1) * cols + ((j + 1) % cols);
        }
        for (const b of [b1, b2]) this.links.push([a, b, this._dist(this.rest, a, b)]);
      }
    }
    this.acc = 0;
    this.energy = 0;
  }

  _dist(arr, a, b) {
    const dx = arr[a * 3] - arr[b * 3];
    const dy = arr[a * 3 + 1] - arr[b * 3 + 1];
    const dz = arr[a * 3 + 2] - arr[b * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Shake the net (rim hits). */
  kick(strength) {
    for (let i = this.cols; i < this.n; i++) {
      const k = i * 3;
      this.prev[k] -= (Math.random() - 0.5) * strength * 0.01;
      this.prev[k + 1] -= (Math.random() - 0.3) * strength * 0.006;
      this.prev[k + 2] -= (Math.random() - 0.5) * strength * 0.01;
    }
  }

  update(dt, ballPos, ballVel) {
    this.acc += Math.min(dt, 0.05);
    const h = 1 / 120;
    while (this.acc >= h) {
      this.acc -= h;
      this._step(h, ballPos, ballVel);
    }
  }

  _step(h, ballPos, ballVel) {
    const p = this.p;
    const pr = this.prev;
    const rest = this.rest;
    const damping = 0.965;
    const g = -9.81 * h * h * 0.35;
    const cols = this.cols;
    for (let i = cols; i < this.n; i++) {
      const k = i * 3;
      for (let c = 0; c < 3; c++) {
        const cur = p[k + c];
        let v = (cur - pr[k + c]) * damping;
        // soft shape-keeping spring toward the hanging rest pose
        v += (rest[k + c] - cur) * 0.05;
        pr[k + c] = cur;
        p[k + c] = cur + v + (c === 1 ? g : 0);
      }
    }
    // ball pushes the strands
    const bx = ballPos.x;
    const by = ballPos.y;
    const bz = ballPos.z;
    const near = Math.abs(by - (this.center.y - HOOP.netDepth * 0.5)) < 0.5 && Math.hypot(bx - this.center.x, bz - this.center.z) < 0.6;
    for (let it = 0; it < 3; it++) {
      for (const [a, b, len] of this.links) {
        const ka = a * 3;
        const kb = b * 3;
        const dx = p[kb] - p[ka];
        const dy = p[kb + 1] - p[ka + 1];
        const dz = p[kb + 2] - p[ka + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - len) / d;
        const wa = a < cols ? 0 : 0.5;
        const wb = 0.5 + (0.5 - wa);
        const f = diff * (a < cols ? 1 : 1);
        p[ka] += dx * f * wa;
        p[ka + 1] += dy * f * wa;
        p[ka + 2] += dz * f * wa;
        p[kb] -= dx * f * (a < cols ? 1 : wb);
        p[kb + 1] -= dy * f * (a < cols ? 1 : wb);
        p[kb + 2] -= dz * f * (a < cols ? 1 : wb);
      }
      if (near) {
        const R = BALL.radius + 0.006;
        for (let i = cols; i < this.n; i++) {
          const k = i * 3;
          const dx = p[k] - bx;
          const dy = p[k + 1] - by;
          const dz = p[k + 2] - bz;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < R && d > 1e-5) {
            const push = (R - d) / d;
            p[k] += dx * push;
            p[k + 1] += dy * push;
            p[k + 2] += dz * push;
            // drag along with the ball
            pr[k] -= ballVel.x * h * 0.25;
            pr[k + 1] -= ballVel.y * h * 0.25;
            pr[k + 2] -= ballVel.z * h * 0.25;
          }
        }
      }
    }
    // pin the top row to the rim
    for (let j = 0; j < cols; j++) {
      const k = j * 3;
      p[k] = rest[k];
      p[k + 1] = rest[k + 1];
      p[k + 2] = rest[k + 2];
    }
  }

  writeInstances(mesh) {
    const p = this.p;
    let i = 0;
    for (const [a, b] of this.links) {
      _a.set(p[a * 3], p[a * 3 + 1], p[a * 3 + 2]);
      _b.set(p[b * 3], p[b * 3 + 1], p[b * 3 + 2]);
      _d.subVectors(_b, _a);
      const len = _d.length();
      _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / (len || 1)));
      _s.set(1, len, 1);
      _a.add(_b).multiplyScalar(0.5);
      _m.compose(_a, _q, _s);
      mesh.setMatrixAt(i++, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}

export class HoopView {
  constructor(parent, opts) {
    const g = new THREE.Group();
    this.group = g;
    parent.add(g);
    g.position.z = opts.z || 0;
    if (opts.flip) g.rotation.y = Math.PI;
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.55, metalness: 0.2 });
    const pad = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.85 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.35, metalness: 0.7 });
    // stanchion base + pole + arm
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.15, 1.5), pad);
    base.position.set(0, 0.575, -3.6);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.45, 0.28), dark);
    pole.position.set(0, 1.15 + 1.2, -3.17);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 2.7), dark);
    arm.position.set(0, 3.41, -1.77);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.2), metal);
    brace.position.set(0, 2.85, -2.05);
    brace.rotation.x = -0.25;
    for (const m of [base, pole, arm, brace]) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    // backboard
    const bw = HOOP.boardHalfW * 2;
    const bh = HOOP.boardTop - HOOP.boardBottom;
    const bcY = (HOOP.boardTop + HOOP.boardBottom) / 2;
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(bw, bh, 0.025),
      new THREE.MeshPhysicalMaterial({ color: 0x9fb8c8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, envMapIntensity: 1.6, depthWrite: false })
    );
    glass.position.set(0, bcY, HOOP.boardFaceZ - 0.0125);
    glass.renderOrder = 2;
    g.add(glass);
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.4 });
    const frameT = 0.05;
    const mkBar = (w, h, x, y) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.035), white);
      b.position.set(x, y, HOOP.boardFaceZ - 0.012);
      b.castShadow = true;
      g.add(b);
    };
    mkBar(bw, frameT, 0, HOOP.boardTop - frameT / 2);
    mkBar(bw, frameT, 0, HOOP.boardBottom + frameT / 2);
    mkBar(frameT, bh, -bw / 2 + frameT / 2, bcY);
    mkBar(frameT, bh, bw / 2 - frameT / 2, bcY);
    const sqW = HOOP.squareHalfW * 2;
    const sqY0 = HOOP.rimY;
    const st = 0.05;
    mkBar(sqW, st, 0, sqY0 + HOOP.squareH - st / 2);
    mkBar(sqW, st, 0, sqY0 + st / 2);
    mkBar(st, HOOP.squareH, -sqW / 2 + st / 2, sqY0 + HOOP.squareH / 2);
    mkBar(st, HOOP.squareH, sqW / 2 - st / 2, sqY0 + HOOP.squareH / 2);
    // dark rear plate behind glass edges (gives the board depth)
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.06), dark);
    back.position.set(0, HOOP.rimY + 0.2, HOOP.boardFaceZ - 0.06);
    g.add(back);
    // rim
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xe0471c, roughness: 0.32, metalness: 0.55 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(HOOP.rimR, HOOP.rimTube, 10, 48), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, HOOP.rimY, 0);
    rim.castShadow = true;
    g.add(rim);
    this.rim = rim;
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, -HOOP.boardFaceZ - HOOP.rimR), rimMat);
    bracket.position.set(0, HOOP.rimY - 0.015, (HOOP.boardFaceZ - HOOP.rimR) / 2);
    g.add(bracket);
    // net hooks (small tabs)
    for (let j = 0; j < 12; j++) {
      const ang = (j / 12) * Math.PI * 2;
      const hook = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.012), rimMat);
      hook.position.set(Math.cos(ang) * HOOP.rimR, HOOP.rimY - 0.015, Math.sin(ang) * HOOP.rimR);
      g.add(hook);
    }
    this._mergeStatic(g);
    // net
    const center = new THREE.Vector3(0, HOOP.rimY - 0.012, 0);
    this.net = new NetSim(center);
    const strand = new THREE.CylinderGeometry(0.0045, 0.0045, 1, 4, 1, true);
    const netMat = new THREE.MeshStandardMaterial({ color: 0xf4f5f7, roughness: 0.9 });
    this.netMesh = new THREE.InstancedMesh(strand, netMat, this.net.links.length);
    this.netMesh.frustumCulled = false;
    this.netMesh.castShadow = opts.quality !== 'low';
    g.add(this.netMesh);
    this.dynamicNet = !!opts.net;
    this.net.writeInstances(this.netMesh);
    this._local = new THREE.Vector3();
    this._localV = new THREE.Vector3();
    this.rimShake = 0;
  }

  /** Merge static parts sharing a material (frame bars, hooks, stanchion) into single draws. */
  _mergeStatic(g) {
    const groups = new Map();
    for (const m of g.children) {
      if (!m.isMesh || m === this.rim || m.material.transparent) continue;
      const k = m.material.uuid;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const n of Object.keys(geo.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') geo.deleteAttribute(n);
        geo.applyMatrix4(m.matrix);
        return geo;
      });
      const merged = BufferGeometryUtils.mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = list.some((m) => m.castShadow);
      mesh.receiveShadow = true;
      for (const m of list) {
        g.remove(m);
        m.geometry.dispose();
      }
      g.add(mesh);
    }
  }

  update(dt, ball) {
    if (!this.dynamicNet) return;
    // ball in hoop-local space (the active hoop is at the origin, unrotated)
    this._local.copy(ball.pos).sub(this.group.position);
    this.net.update(dt, this._local, ball.vel);
    this.net.writeInstances(this.netMesh);
    // rim vibration after hard hits
    if (this.rimShake > 0) {
      this.rimShake = Math.max(0, this.rimShake - dt * 3);
      this.rim.position.y = HOOP.rimY + Math.sin(performance.now() * 0.09) * 0.006 * this.rimShake;
    }
  }

  onRimHit(strength) {
    this.rimShake = Math.min(1, this.rimShake + strength * 0.15);
    this.net.kick(Math.min(6, strength));
  }
}
