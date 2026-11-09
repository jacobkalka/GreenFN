// WebGL renderer, post-processing chain and quality presets.
import * as THREE from 'three';
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass } from 'three/addons';

export const QUALITY = {
  low: { pixelRatio: 1, shadows: true, shadowSize: 1024, bloom: false, msaa: 0, antialias: true },
  medium: { pixelRatio: 1.25, shadows: true, shadowSize: 2048, bloom: true, msaa: 2, antialias: false },
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, bloom: true, msaa: 4, antialias: false },
};

export class Renderer {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    this.qualityId = quality;
    this.q = QUALITY[quality] || QUALITY.high;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.q.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = this.q.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 220);
    this.camera.position.set(0, 5, 13);
    this.camera.lookAt(0, 1.2, 0);
    this.composer = null;
    this._setupPost();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.info = r.info;
  }

  _setupPost() {
    const r = this.renderer;
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    if (!this.q.bloom) return;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: this.q.msaa,
    });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setQuality(id) {
    if (!QUALITY[id] || id === this.qualityId) return;
    this.qualityId = id;
    this.q = QUALITY[id];
    this.renderer.shadowMap.enabled = this.q.shadows;
    this._setupPost();
    this.resize();
  }

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep a usable horizontal view on tall/narrow screens
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
