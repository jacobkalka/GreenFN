// Ball rendering: textured sphere with pebble bump, interpolated position/rotation, impact squash,
// soft contact shadow and an optional cosmetic trail.
import * as THREE from 'three';
import { BALL } from '../sim/constants.js';
import { makeBallTexture, ballBumpTexture, makeRadialSprite } from './textures.js';

export const BALL_SKINS = {
  classic: { name: 'Classic', base: [196, 86, 34], seam: [24, 18, 16] },
  midnight: { name: 'Midnight', base: [24, 28, 36], seam: [42, 212, 255] },
  tricolor: { name: 'Tricolor', base: [206, 40, 48], alt: [240, 240, 240], seam: [20, 40, 120] },
  street: { name: 'Street Worn', base: [150, 78, 40], seam: [40, 30, 26] },
  gold: { name: 'Gold Rush', base: [212, 160, 56], seam: [60, 40, 10], metal: 0.6 },
  ice: { name: 'Ice', base: [214, 236, 248], seam: [40, 120, 170] },
  volt: { name: 'Volt', base: [190, 240, 40], seam: [20, 30, 20] },
  chrome: { name: 'Chrome', base: [205, 212, 220], seam: [30, 32, 36], metal: 0.95, rough: 0.2 },
};

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

export class BallView {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.geo = new THREE.SphereGeometry(BALL.radius, 48, 32);
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, bumpMap: ballBumpTexture(), bumpScale: 0.6 });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.castShadow = true;
    this.group.add(this.mesh);
    // soft contact shadow (reads well even when the spotlight shadow is far)
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: makeRadialSprite('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false })
    );
    this.blob.renderOrder = 1;
    scene.add(this.blob);
    // trail
    this.trailN = 18;
    this.trailPts = [];
    for (let i = 0; i < this.trailN; i++) this.trailPts.push(new THREE.Vector3());
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailN * 2 * 3), 3));
    tg.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(this.trailN * 2), 1));
    const idx = [];
    for (let i = 0; i < this.trailN - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    tg.setIndex(idx);
    this.trailMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0x2ad4ff) } },
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, 1.0); }',
    });
    this.trail = new THREE.Mesh(tg, this.trailMat);
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    scene.add(this.trail);
    this.trailOn = false;
    this.trailHead = 0;
    this.trailInit = false;
    this.setSkin('classic');
    this._p = new THREE.Vector3();
  }

  setSkin(id) {
    const sk = BALL_SKINS[id] || BALL_SKINS.classic;
    if (this.mat.map) this.mat.map.dispose();
    this.mat.map = makeBallTexture(sk);
    this.mat.metalness = sk.metal || 0;
    this.mat.roughness = sk.rough || 0.62;
    this.mat.needsUpdate = true;
  }

  setTrail(color) {
    this.trailOn = !!color;
    if (color) this.trailMat.uniforms.uColor.value.set(color);
    this.trail.visible = this.trailOn;
  }

  update(ball, alpha, camera, showTrail) {
    const p = this._p.lerpVectors(ball.prevPos, ball.pos, alpha);
    this.group.position.copy(p);
    this.mesh.quaternion.slerpQuaternions(ball.prevRot, ball.rot, alpha);
    // squash along the last impact normal
    const s = ball.squash;
    if (s > 0.01) {
      _q.setFromUnitVectors(_up, ball.squashDir);
      this.group.quaternion.copy(_q);
      this.group.scale.set(1 + s * 0.07, 1 - s * 0.14, 1 + s * 0.07);
      // keep the rotation of the ball itself independent of the squash frame
      this.mesh.quaternion.premultiply(_q.invert());
    } else {
      this.group.quaternion.identity();
      this.group.scale.set(1, 1, 1);
    }
    const h = Math.max(0, p.y - BALL.radius);
    this.blob.position.set(p.x, 0.003, p.z);
    const k = Math.max(0, 1 - h / 3);
    this.blob.scale.setScalar(0.5 + h * 0.25);
    this.blob.material.opacity = k * 0.9;
    // trail
    if (this.trailOn) {
      const fast = ball.vel.lengthSq() > 9 && showTrail;
      if (!this.trailInit) {
        for (const tp of this.trailPts) tp.copy(p);
        this.trailInit = true;
      }
      for (let i = this.trailN - 1; i > 0; i--) this.trailPts[i].copy(this.trailPts[i - 1]);
      this.trailPts[0].copy(p);
      const pos = this.trail.geometry.attributes.position;
      const al = this.trail.geometry.attributes.alpha;
      const camDir = camera.position;
      for (let i = 0; i < this.trailN; i++) {
        const a = this.trailPts[i];
        const b = this.trailPts[Math.min(this.trailN - 1, i + 1)];
        // ribbon perpendicular to view
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const vx = camDir.x - a.x;
        const vy = camDir.y - a.y;
        const vz = camDir.z - a.z;
        let nx = dy * vz - dz * vy;
        let ny = dz * vx - dx * vz;
        let nz = dx * vy - dy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const w = BALL.radius * 0.8 * (1 - i / this.trailN);
        nx = (nx / nl) * w;
        ny = (ny / nl) * w;
        nz = (nz / nl) * w;
        pos.setXYZ(i * 2, a.x + nx, a.y + ny, a.z + nz);
        pos.setXYZ(i * 2 + 1, a.x - nx, a.y - ny, a.z - nz);
        const av = fast ? 0.55 * (1 - i / this.trailN) : 0;
        al.setX(i * 2, av);
        al.setX(i * 2 + 1, av);
      }
      pos.needsUpdate = true;
      al.needsUpdate = true;
    }
  }
}
