// Character mesh built on the procedural rig. Mirrors the simulation rig's joint hierarchy and
// interpolates joint transforms between the last two simulation ticks for smooth rendering.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons';
import { JOINTS, DIM, POSE_STRIDE } from '../sim/rig.js';
import { makeJerseyTexture } from './textures.js';

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/** Lathe limb along -Y. profile: [[t (0..1 along length), radius], ...] */
function limbGeo(len, profile, segs = 14, sx = 1, sz = 1) {
  const pts = profile.map(([t, r]) => new THREE.Vector2(Math.max(0.0001, r), -t * len));
  pts.reverse(); // lathe expects increasing y order for outward normals (bottom -> top)
  const g = new THREE.LatheGeometry(pts, segs, -Math.PI / 2);
  if (sx !== 1 || sz !== 1) g.scale(sx, 1, sz);
  g.computeVertexNormals();
  return g;
}

/** Lathe torso piece along +Y. */
function torsoGeo(h, profile, sx, sz, segs = 24) {
  const pts = profile.map(([t, r]) => new THREE.Vector2(Math.max(0.0001, r), t * h));
  const g = new THREE.LatheGeometry(pts, segs, -Math.PI / 2);
  g.scale(sx, 1, sz);
  g.computeVertexNormals();
  return g;
}

export const SKIN_TONES = ['#f1c7a3', '#e0ac85', '#c68863', '#a86b48', '#8a5236', '#6b3d26', '#4e2c1c'];
export const HAIR_STYLES = ['short', 'buzz', 'afro', 'bald', 'waves', 'puff'];

export const DEFAULT_LOOK = {
  skin: '#a86b48',
  hair: 'short',
  hairColor: '#17110d',
  jersey: { base: '#0f1726', trim: '#2ad4ff', number: '#ffffff', pattern: 'solid' },
  shorts: { base: '#0f1726', trim: '#2ad4ff' },
  shoes: { upper: '#f2f4f7', sole: '#e9ecef', accent: '#2ad4ff' },
  socks: '#f4f5f7',
  number: 7,
  headband: null,
  wristbands: null,
  sleeve: null, // arm sleeve color (right arm)
  legSleeve: null,
  skinFx: null, // 'halftone' | 'chrome' | 'neon' ... (special finishes)
};

export class CharacterView {
  constructor(scene, look = DEFAULT_LOOK) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.joints = [];
    this.byName = {};
    for (const [name, parent, off] of JOINTS) {
      const o = new THREE.Group();
      o.name = name;
      o.position.set(off[0], off[1], off[2]);
      this.joints.push(o);
      this.byName[name] = o;
      if (parent) this.byName[parent].add(o);
      else this.root.add(o);
    }
    this.materials = {};
    this.meshes = [];
    this.look = null;
    this.build(look);
  }

  _mat(key, params) {
    const m = new THREE.MeshStandardMaterial(params);
    this.materials[key] = m;
    return m;
  }

  _add(joint, geo, mat, pos = null, rot = null, scale = null) {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    this.byName[joint].add(m);
    this.meshes.push(m);
    return m;
  }

  clear() {
    for (const m of this.meshes) {
      m.parent.remove(m);
      m.geometry.dispose();
    }
    this.meshes.length = 0;
    for (const k in this.materials) {
      const mat = this.materials[k];
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }
    this.materials = {};
  }

  build(look) {
    this.clear();
    look = Object.assign({}, DEFAULT_LOOK, look || {});
    look.jersey = Object.assign({}, DEFAULT_LOOK.jersey, look.jersey || {});
    look.shorts = Object.assign({}, DEFAULT_LOOK.shorts, look.shorts || {});
    look.shoes = Object.assign({}, DEFAULT_LOOK.shoes, look.shoes || {});
    this.look = look;
    const fx = look.skinFx;
    const skinParams = { color: look.skin, roughness: 0.58, metalness: 0 };
    if (fx === 'chrome') Object.assign(skinParams, { color: '#c9d2dc', roughness: 0.18, metalness: 0.95 });
    if (fx === 'gold') Object.assign(skinParams, { color: '#d9a740', roughness: 0.22, metalness: 0.95 });
    if (fx === 'neon') Object.assign(skinParams, { color: '#11161f', roughness: 0.4, emissive: new THREE.Color('#2ad4ff'), emissiveIntensity: 0.35 });
    if (fx === 'halftone') Object.assign(skinParams, { color: '#e9edf2', roughness: 0.6, map: halftoneTex() });
    const skin = this._mat('skin', skinParams);
    const jerseyTex = makeJerseyTexture({
      base: look.jersey.base,
      trim: look.jersey.trim,
      number: look.number,
      numberColor: look.jersey.number,
      pattern: look.jersey.pattern,
      numberStroke: look.jersey.trim,
    });
    const jersey = this._mat('jersey', { map: jerseyTex, roughness: 0.78, metalness: 0 });
    const jerseyPlain = this._mat('jerseyPlain', { color: look.jersey.base, roughness: 0.8 });
    if (look.jersey.pattern !== 'solid') jerseyPlain.map = jerseyTex;
    const trim = this._mat('trim', { color: look.jersey.trim, roughness: 0.6 });
    const shorts = this._mat('shorts', { color: look.shorts.base, roughness: 0.72 });
    const shortsTrim = this._mat('shortsTrim', { color: look.shorts.trim, roughness: 0.6 });
    const sock = this._mat('sock', { color: look.socks, roughness: 0.85 });
    const shoeUpper = this._mat('shoeUpper', { color: look.shoes.upper, roughness: 0.42, metalness: 0.05 });
    const shoeSole = this._mat('shoeSole', { color: look.shoes.sole, roughness: 0.6 });
    const shoeAccent = this._mat('shoeAccent', { color: look.shoes.accent, roughness: 0.4 });
    const hair = this._mat('hair', { color: look.hairColor, roughness: 0.95 });
    const dark = this._mat('dark', { color: '#121212', roughness: 0.5 });
    const sleeve = look.sleeve ? this._mat('sleeve', { color: look.sleeve, roughness: 0.6 }) : null;
    const legSleeve = look.legSleeve ? this._mat('legSleeve', { color: look.legSleeve, roughness: 0.6 }) : null;

    // ---------------------------------------------------------------- torso
    // pelvis / shorts waist
    this._add('pelvis', torsoGeo(0.24, [[0, 0.13], [0.25, 0.155], [0.6, 0.16], [0.85, 0.15], [1, 0.14]], 1.15, 0.78), shorts, [0, -0.13, 0]);
    this._add('pelvis', torsoGeo(0.04, [[0, 0.142], [1, 0.142]], 1.16, 0.79), shortsTrim, [0, 0.1, 0]);
    // abdomen (spine) and chest
    this._add('spine', torsoGeo(0.3, [[0, 0.136], [0.45, 0.14], [0.8, 0.146], [1, 0.148]], 1.13, 0.74), jerseyPlain, [0, -0.05, 0]);
    this._add(
      'chest',
      torsoGeo(0.33, [[0, 0.136], [0.2, 0.15], [0.45, 0.165], [0.66, 0.17], [0.84, 0.158], [0.95, 0.12], [1, 0.07]], 1.22, 0.7),
      jersey,
      [0, -0.06, 0]
    );
    // collar trim
    this._add('chest', new THREE.TorusGeometry(0.075, 0.012, 6, 18), trim, [0, 0.255, 0.012], [Math.PI / 2 - 0.25, 0, 0], [1.15, 1, 0.75]);
    // neck + head
    this._add('neck', new THREE.CylinderGeometry(0.052, 0.06, 0.16, 12), skin, [0, 0.05, 0]);
    this._buildHead(look, skin, hair, dark, trim);

    // ---------------------------------------------------------------- arms
    for (const s of ['L', 'R']) {
      const side = s === 'L' ? 1 : -1;
      const armSleeve = sleeve && s === 'R' ? sleeve : skin;
      this._add('upperArm' + s, new THREE.SphereGeometry(0.064, 16, 12), skin, [side * 0.008, -0.02, 0], null, [1.0, 1.25, 1.05]);
      this._add('upperArm' + s, limbGeo(DIM.upperArm, [[0, 0.06], [0.12, 0.061], [0.3, 0.052], [0.5, 0.05], [0.7, 0.044], [0.88, 0.039], [1, 0.039]], 16, 0.95, 1.08), armSleeve);
      this._add('forearm' + s, new THREE.SphereGeometry(0.041, 12, 10), armSleeve);
      this._add('forearm' + s, limbGeo(DIM.forearm, [[0, 0.043], [0.22, 0.045], [0.6, 0.037], [1, 0.03]], 14, 1.12, 0.92), armSleeve);
      if (look.wristbands) {
        const wb = this._mat('wrist' + s, { color: look.wristbands, roughness: 0.8 });
        this._add('forearm' + s, new THREE.CylinderGeometry(0.037, 0.037, 0.055, 14), wb, [0, -DIM.forearm + 0.04, 0]);
      }
      this._buildHand(s, side, skin);
    }

    // ---------------------------------------------------------------- legs
    for (const s of ['L', 'R']) {
      const side = s === 'L' ? 1 : -1;
      // shorts leg (long, loose) + skin thigh below
      this._add('thigh' + s, limbGeo(DIM.thigh * 0.74, [[0, 0.112], [0.5, 0.108], [0.95, 0.102], [1, 0.1]], 16), shorts, [side * 0.005, 0.02, 0]);
      this._add('thigh' + s, limbGeo(DIM.thigh * 0.06, [[0, 0.1015], [1, 0.1015]], 16), shortsTrim, [side * 0.005, 0.02 - DIM.thigh * 0.71, 0]);
      this._add('thigh' + s, limbGeo(DIM.thigh, [[0, 0.085], [0.5, 0.075], [0.85, 0.06], [1, 0.052]], 14), skin);
      const kneeMat = legSleeve && s === 'L' ? legSleeve : skin;
      this._add('shin' + s, new THREE.SphereGeometry(0.052, 12, 10), kneeMat, [0, 0, 0.008]);
      this._add('shin' + s, limbGeo(DIM.shin, [[0, 0.05], [0.25, 0.056], [0.5, 0.047], [0.8, 0.034], [1, 0.03]], 14, 1, 1.08), kneeMat);
      // high socks
      this._add('shin' + s, limbGeo(DIM.shin * 0.42, [[0, 0.043], [0.6, 0.037], [1, 0.034]], 14), sock, [0, -DIM.shin * 0.58, 0]);
      this._buildShoe(s, shoeUpper, shoeSole, shoeAccent, sock);
    }
  }

  _buildHead(look, skin, hair, dark, trim) {
    const H = 'head';
    this._add(H, new THREE.SphereGeometry(0.108, 24, 18), skin, [0, 0.115, 0.005], null, [0.9, 1.07, 1.0]);
    // jaw
    this._add(H, new THREE.SphereGeometry(0.075, 16, 12), skin, [0, 0.06, 0.035], null, [1.0, 0.85, 1.0]);
    // nose
    this._add(H, new THREE.SphereGeometry(0.018, 8, 6), skin, [0, 0.1, 0.107], null, [0.9, 1.2, 1.1]);
    // ears
    for (const s of [-1, 1]) this._add(H, new THREE.SphereGeometry(0.022, 8, 6), skin, [s * 0.098, 0.11, -0.005], null, [0.5, 1.2, 0.9]);
    // eyes + brows
    for (const s of [-1, 1]) {
      this._add(H, new THREE.SphereGeometry(0.0115, 8, 6), dark, [s * 0.036, 0.126, 0.093]);
      const brow = this._add(H, new THREE.BoxGeometry(0.03, 0.006, 0.01), this.materials.hair, [s * 0.037, 0.145, 0.097], [0, 0, s * -0.12]);
      brow.castShadow = false;
    }
    // hair
    const style = look.hair;
    if (style === 'short' || style === 'waves') {
      this._add(H, new THREE.SphereGeometry(0.113, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.46), hair, [0, 0.125, -0.003], [-0.2, 0, 0], [0.92, 1.05, 1.03]);
    } else if (style === 'buzz') {
      this._add(H, new THREE.SphereGeometry(0.111, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), hair, [0, 0.122, -0.003], [-0.2, 0, 0], [0.91, 1.04, 1.02]);
    } else if (style === 'afro') {
      this._add(H, new THREE.SphereGeometry(0.15, 20, 14), hair, [0, 0.16, -0.025], null, [1.0, 0.92, 1.0]);
    } else if (style === 'puff') {
      this._add(H, new THREE.SphereGeometry(0.112, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.45), hair, [0, 0.125, -0.003], [-0.2, 0, 0], [0.92, 1.05, 1.03]);
      this._add(H, new THREE.SphereGeometry(0.075, 16, 12), hair, [0, 0.235, -0.04]);
    }
    if (look.headband) {
      const hb = this._mat('headband', { color: look.headband, roughness: 0.7 });
      this._add(H, new THREE.CylinderGeometry(0.106, 0.106, 0.028, 24, 1, true), hb, [0, 0.16, 0.0], [-0.2, 0, 0], [0.93, 1, 1.04]).material.side = THREE.DoubleSide;
    }
  }

  _buildHand(s, side, skin) {
    const j = 'hand' + s;
    // palm: thickness along X (palm normal), length along -Y (fingers), width along Z
    this._add(j, new RoundedBoxGeometry(0.032, 0.095, 0.082, 2, 0.012), skin, [0, -0.045, 0]);
    // fingers, slightly curled toward the palm side
    this._add(j, new RoundedBoxGeometry(0.026, 0.085, 0.076, 2, 0.011), skin, [-side * 0.006, -0.125, 0], [0, 0, side * 0.22]);
    // thumb (toward +Z = forward when hanging)
    this._add(j, new THREE.CapsuleGeometry(0.012, 0.045, 3, 6), skin, [-side * 0.008, -0.055, 0.045], [0.55, 0, side * 0.3]);
  }

  _buildShoe(s, upper, sole, accent, sock) {
    const j = 'foot' + s;
    const side = s === 'L' ? 1 : -1;
    const len = DIM.footFwd + DIM.footBack + 0.03;
    const zc = (DIM.footFwd - DIM.footBack) / 2;
    // sole
    this._add(j, new RoundedBoxGeometry(0.112, 0.03, len, 2, 0.012), sole, [0, -DIM.ankleH + 0.015, zc]);
    // upper
    this._add(j, new RoundedBoxGeometry(0.104, 0.075, len - 0.03, 3, 0.03), upper, [0, -DIM.ankleH + 0.062, zc - 0.005]);
    // toe cap
    this._add(j, new THREE.SphereGeometry(0.052, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), upper, [0, -DIM.ankleH + 0.028, zc + len / 2 - 0.06], null, [1, 0.75, 1.15]);
    // collar
    this._add(j, new THREE.CylinderGeometry(0.05, 0.056, 0.07, 14), upper, [0, -0.005, -0.012]);
    // side accent stripe
    this._add(j, new THREE.BoxGeometry(0.108, 0.018, 0.14), accent, [0, -DIM.ankleH + 0.06, zc - 0.02], [0.18, 0, 0]);
  }

  /** Apply interpolated pose: alpha in [0,1] between prevPose and pose. */
  applyPose(prev, cur, alpha) {
    const J = this.joints;
    for (let i = 0; i < J.length; i++) {
      const k = i * POSE_STRIDE;
      const o = J[i];
      o.position.set(
        prev[k] + (cur[k] - prev[k]) * alpha,
        prev[k + 1] + (cur[k + 1] - prev[k + 1]) * alpha,
        prev[k + 2] + (cur[k + 2] - prev[k + 2]) * alpha
      );
      _qa.set(prev[k + 3], prev[k + 4], prev[k + 5], prev[k + 6]);
      _qb.set(cur[k + 3], cur[k + 4], cur[k + 5], cur[k + 6]);
      o.quaternion.slerpQuaternions(_qa, _qb, alpha);
    }
  }

  setVisible(v) {
    this.root.visible = v;
  }

  dispose() {
    this.clear();
    this.root.parent && this.root.parent.remove(this.root);
  }
}

let _halftone = null;
function halftoneTex() {
  if (_halftone) return _halftone;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#eef1f4';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1a1d22';
  for (let y = 0; y < 128; y += 8) {
    for (let x = (y / 8) % 2 ? 4 : 0; x < 128; x += 8) {
      g.beginPath();
      g.arc(x, y, 1.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  _halftone = new THREE.CanvasTexture(c);
  _halftone.wrapS = _halftone.wrapT = THREE.RepeatWrapping;
  _halftone.repeat.set(3, 3);
  _halftone.colorSpace = THREE.SRGBColorSpace;
  return _halftone;
}
