// Lightweight pooled particle effects (bursts, sparks, confetti) and floor shockwave rings.
import * as THREE from 'three';
import { makeRadialSprite } from './textures.js';

const MAX = 600;

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.baseSize = new Float32Array(MAX);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const tex = makeRadialSprite('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTex: { value: tex }, uScale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC;
        uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC * t.a, 1.0); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.rings = [];
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x2ad4ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 64).rotateX(-Math.PI / 2), ringMat.clone());
      m.visible = false;
      scene.add(m);
      this.rings.push({ m, t: 0, life: 0, max: 3 });
    }
    this._c = new THREE.Color();
  }

  burst(x, y, z, color, count = 40, speed = 3, life = 0.8, size = 0.12, gravity = 4, spread = 1) {
    const c = this._c.set(color);
    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1) * spread;
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.pos[k * 3] = x;
      this.pos[k * 3 + 1] = y;
      this.pos[k * 3 + 2] = z;
      this.vel[k * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this.vel[k * 3 + 1] = Math.cos(ph) * sp * 0.8 + speed * 0.25;
      this.vel[k * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      const v = 0.75 + Math.random() * 0.5;
      this.col[k * 3] = c.r * v;
      this.col[k * 3 + 1] = c.g * v;
      this.col[k * 3 + 2] = c.b * v;
      this.life[k] = this.maxLife[k] = life * (0.6 + Math.random() * 0.6);
      this.baseSize[k] = size * (0.6 + Math.random() * 0.8);
      this.drag[k] = 1.5;
      this.grav[k] = gravity;
    }
  }

  confetti(x, y, z, colors, count = 160) {
    for (let i = 0; i < count; i++) {
      this.burst(x + (Math.random() - 0.5) * 6, y, z + (Math.random() - 0.5) * 6, colors[i % colors.length], 1, 2.5, 2.4, 0.07, 1.6);
    }
  }

  shockwave(x, z, color = 0x2ad4ff, max = 3) {
    const r = this.rings.find((q) => q.life <= 0) || this.rings[0];
    r.m.material.color.set(color);
    r.m.position.set(x, 0.01, z);
    r.t = 0;
    r.life = 0.55;
    r.max = max;
    r.m.visible = true;
  }

  update(dt) {
    for (let k = 0; k < MAX; k++) {
      if (this.life[k] <= 0) {
        this.size[k] = 0;
        continue;
      }
      this.life[k] -= dt;
      const d = Math.exp(-this.drag[k] * dt);
      this.vel[k * 3] *= d;
      this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * d - this.grav[k] * dt;
      this.vel[k * 3 + 2] *= d;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      if (this.pos[k * 3 + 1] < 0.02) {
        this.pos[k * 3 + 1] = 0.02;
        this.vel[k * 3 + 1] *= -0.3;
      }
      const t = Math.max(0, this.life[k] / this.maxLife[k]);
      this.size[k] = this.baseSize[k] * Math.sqrt(t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.t += dt;
      const u = r.t / r.life;
      const s = 0.3 + u * r.max;
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = (1 - u) * 0.8;
      if (u >= 1) {
        r.life = 0;
        r.m.visible = false;
      }
    }
  }
}
