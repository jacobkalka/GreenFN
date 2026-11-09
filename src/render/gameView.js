// Binds the simulation to visuals: characters, ball, hoop/net, camera and effects.
import * as THREE from 'three';
import { Arena } from './arena.js';
import { BallView } from './ballView.js';
import { CharacterView } from './characterView.js';
import { CameraRig } from './cameraRig.js';
import { Effects } from './effects.js';
import { makeRadialSprite } from './textures.js';

export class GameView {
  constructor(renderer, game, events, opts = {}) {
    this.r = renderer;
    this.scene = renderer.scene;
    this.game = game;
    this.events = events;
    this.arena = new Arena(renderer.renderer, this.scene, opts.quality || 'high');
    this.ballView = new BallView(this.scene);
    this.cameraRig = new CameraRig(renderer.camera);
    this.effects = new Effects(this.scene, renderer.camera);
    this.chars = new Map();
    this.rings = new Map();
    this.hype = 0;
    this.user = null;
    events.on('ball:impact', (e) => {
      if (e.surface === 'rim') {
        this.arena.hoop.onRimHit(e.impact);
        this.cameraRig.addShake(Math.min(0.25, e.impact * 0.03));
      }
    });
    events.on('ball:score', () => {
      this.hype = 1;
      this.arena.hoop.net.kick(1.5);
    });
  }

  addAthlete(a, look) {
    const cv = new CharacterView(this.scene, look);
    this.chars.set(a, cv);
    // floor indicator ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: a.isUser ? 0x2ad4ff : 0xff6b3d, transparent: true, opacity: a.isUser ? 0.75 : 0.25, depthWrite: false, toneMapped: false })
    );
    ring.renderOrder = 1;
    this.scene.add(ring);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: makeRadialSprite(a.isUser ? 'rgba(42,212,255,0.35)' : 'rgba(255,107,61,0.12)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    glow.renderOrder = 1;
    this.scene.add(glow);
    this.rings.set(a, { ring, glow });
    if (a.isUser) this.user = a;
    return cv;
  }

  setLook(a, look) {
    const cv = this.chars.get(a);
    if (cv) cv.build(look);
  }

  removeAll() {
    for (const cv of this.chars.values()) cv.dispose();
    for (const r of this.rings.values()) {
      this.scene.remove(r.ring, r.glow);
    }
    this.chars.clear();
    this.rings.clear();
  }

  setRingsVisible(v) {
    for (const r of this.rings.values()) {
      r.ring.visible = v;
      r.glow.visible = v;
    }
  }

  render(alpha, dt) {
    this.update(alpha, dt);
    this.r.render();
  }

  /** Non-drawing per-frame update (poses, camera, effects). */
  update(alpha, dt) {
    const game = this.game;
    for (const [a, cv] of this.chars) {
      cv.applyPose(a.rig.prevPose, a.rig.pose, alpha);
      const r = this.rings.get(a);
      if (r) {
        const px = cv.joints[0].position.x;
        const pz = cv.joints[0].position.z;
        r.ring.position.set(px, 0.004, pz);
        r.glow.position.set(px, 0.003, pz);
        const has = a.hasBall();
        r.ring.material.opacity = a.isUser ? (has ? 0.85 : 0.6) : has ? 0.45 : 0.22;
      }
    }
    this.ballView.update(game.ball, alpha, this.r.camera, true);
    this.arena.hoop.update(dt, game.ball);
    if (this.user) this.cameraRig.update(dt, game, this.user, alpha);
    this.hype = Math.max(0, this.hype - dt * 0.35);
    this.arena.update(dt, this.hype);
    this.effects.update(dt);
  }
}
