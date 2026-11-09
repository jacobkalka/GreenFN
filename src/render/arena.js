// Arena: hardwood court with analytic markings, lighting, environment reflections, stands, crowd,
// LED ribbons, light beams and both hoops.
import * as THREE from 'three';
import { COURT } from '../sim/constants.js';
import { makeWoodTexture, makeRibbonTexture, makeWordmarkTexture, makeRadialSprite } from './textures.js';
import { HoopView } from './hoopView.js';
import { mulberry32 } from '../core/math.js';

export const COURT_THEMES = {
  classic: {
    name: 'Classic Maple',
    wood: [214, 172, 122],
    tint: '#ffffff',
    paint: '#566b8a',
    paintAlpha: 0.9,
    line: '#f5f2ea',
    apron: '#20283a',
    apronMix: 0.82,
    accent: '#2ad4ff',
    roughness: 0.42,
    clearcoat: 0.55,
  },
  midnight: {
    name: 'Midnight',
    wood: [120, 86, 58],
    tint: '#b8b2ac',
    paint: '#0d2533',
    paintAlpha: 0.94,
    line: '#2ad4ff',
    apron: '#07090d',
    apronMix: 0.92,
    accent: '#2ad4ff',
    roughness: 0.35,
    clearcoat: 0.75,
  },
  blacktop: {
    name: 'Blacktop',
    wood: [70, 70, 72],
    tint: '#7a7a7e',
    paint: '#283848',
    paintAlpha: 0.7,
    line: '#e9e9e2',
    apron: '#18191c',
    apronMix: 0.6,
    accent: '#ffb02e',
    roughness: 0.85,
    clearcoat: 0.0,
    flat: true,
  },
  ice: {
    name: 'Ice Arena',
    wood: [236, 232, 226],
    tint: '#f2f6fa',
    paint: '#8fc3e6',
    paintAlpha: 0.85,
    line: '#1b2c40',
    apron: '#c9d8e6',
    apronMix: 0.75,
    accent: '#7fe3ff',
    roughness: 0.3,
    clearcoat: 0.8,
  },
  retro: {
    name: 'Retro Hardwood',
    wood: [226, 168, 102],
    tint: '#fff2e0',
    paint: '#b9462a',
    paintAlpha: 0.9,
    line: '#fff8ee',
    apron: '#6b2412',
    apronMix: 0.85,
    accent: '#ff8a3d',
    roughness: 0.5,
    clearcoat: 0.45,
  },
  neon: {
    name: 'Neon Night',
    wood: [52, 50, 60],
    tint: '#8d88a0',
    paint: '#1b0830',
    paintAlpha: 0.9,
    line: '#ff4fd8',
    apron: '#07040c',
    apronMix: 0.9,
    accent: '#ff4fd8',
    roughness: 0.3,
    clearcoat: 0.85,
  },
};

const COURT_GLSL = /* glsl */ `
uniform vec3 uPaint;
uniform float uPaintAlpha;
uniform vec3 uLine;
uniform vec3 uApron;
uniform float uApronMix;
uniform vec3 uTint;
uniform vec3 uAccent;
varying vec2 vCourt;

float segD(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a; vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
// distance to the nearest painted line (centerline) in half-court coordinates
float courtLineDist(vec2 p, out float dashed) {
  const float HW = ${COURT.halfWidth.toFixed(4)};
  const float BZ = ${COURT.baselineZ.toFixed(4)};
  const float HZ = ${COURT.halfCourtZ.toFixed(4)};
  const float LW = ${(COURT.lineWidth * 0.5).toFixed(4)};
  const float LANE = ${(COURT.laneWidth * 0.5).toFixed(4)};
  const float FTZ = ${COURT.ftLineZ.toFixed(4)};
  const float FTR = ${COURT.ftCircleR.toFixed(4)};
  const float TR = ${COURT.threeR.toFixed(4)};
  const float TCX = ${COURT.threeCornerX.toFixed(4)};
  const float TCZ = ${COURT.threeCornerZ.toFixed(4)};
  const float RR = ${COURT.restrictedR.toFixed(4)};
  dashed = 1.0;
  float d = 1e3;
  // boundary (inside edge) + half court line
  d = min(d, segD(p, vec2(HW - LW, BZ), vec2(HW - LW, HZ)));
  d = min(d, segD(p, vec2(-HW + LW, BZ), vec2(-HW + LW, HZ)));
  d = min(d, segD(p, vec2(-HW, BZ + LW), vec2(HW, BZ + LW)));
  d = min(d, abs(p.y - HZ) + max(0.0, abs(p.x) - HW));
  // lane
  d = min(d, segD(p, vec2(LANE - LW, BZ), vec2(LANE - LW, FTZ)));
  d = min(d, segD(p, vec2(-LANE + LW, BZ), vec2(-LANE + LW, FTZ)));
  d = min(d, segD(p, vec2(-LANE, FTZ), vec2(LANE, FTZ)));
  // lane space marks
  for (int i = 0; i < 4; i++) {
    float z = BZ + (i == 0 ? 2.13 : (i == 1 ? 3.05 : (i == 2 ? 3.96 : 4.88)));
    if (z > FTZ) continue;
    float ext = i == 0 ? 0.2 : 0.15;
    d = min(d, segD(p, vec2(LANE, z), vec2(LANE + ext, z)));
    d = min(d, segD(p, vec2(-LANE, z), vec2(-LANE - ext, z)));
  }
  // free-throw circle: solid outer half here; dashed inner half handled by ftDash()
  if (p.y >= FTZ) d = min(d, abs(length(p - vec2(0.0, FTZ)) - FTR));
  // three point line
  d = min(d, segD(p, vec2(TCX, BZ), vec2(TCX, TCZ)));
  d = min(d, segD(p, vec2(-TCX, BZ), vec2(-TCX, TCZ)));
  if (p.y >= TCZ) d = min(d, abs(length(p) - TR));
  // restricted area
  if (p.y >= 0.0) d = min(d, abs(length(p) - RR));
  d = min(d, segD(p, vec2(RR, 0.0), vec2(RR, -0.38)));
  d = min(d, segD(p, vec2(-RR, 0.0), vec2(-RR, -0.38)));
  // center circle
  d = min(d, abs(length(p - vec2(0.0, HZ)) - 1.83));
  d = min(d, abs(length(p - vec2(0.0, HZ)) - 0.61));
  return d;
}
// dashed lower half of the free-throw circle (separate mask: keeps derivatives continuous)
float ftDash(vec2 p, float lw) {
  const float FTZ = ${COURT.ftLineZ.toFixed(4)};
  const float FTR = ${COURT.ftCircleR.toFixed(4)};
  if (p.y >= FTZ) return 0.0;
  float cd = abs(length(p - vec2(0.0, FTZ)) - FTR);
  float aa = fwidth(cd) + 0.0008;
  float m = 1.0 - smoothstep(lw - aa, lw + aa, cd);
  float ang = atan(p.x, -(p.y - FTZ)) / 3.14159; // -1..1 along the lower half
  float u = fract(ang * 6.5 + 0.25);
  float daa = fwidth(ang * 6.5) + 0.001;
  float dash = smoothstep(0.0, daa, u) * (1.0 - smoothstep(0.55 - daa, 0.55, u));
  return m * dash;
}
`;

export class Arena {
  constructor(renderer, scene, quality = 'high') {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.theme = 'classic';
    this._buildEnvironment();
    this._buildLights();
    this._buildCourt();
    this._buildSurroundings();
    this.hoop = new HoopView(this.group, { z: 0, flip: false, net: true, quality });
    this.hoopFar = new HoopView(this.group, { z: COURT.halfCourtZ * 2, flip: true, net: false, quality });
    this.setTheme('classic');
  }

  _buildEnvironment() {
    // A small "arena" used only to bake reflections: dark bowl with bright light rigs above.
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x05070a);
    const room = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.MeshBasicMaterial({ color: 0x07090d, side: THREE.BackSide }));
    env.add(room);
    const panel = new THREE.MeshBasicMaterial({ color: 0xffffff });
    panel.color.setScalar(6);
    for (let i = -2; i <= 2; i++) {
      for (let j = -1; j <= 1; j++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 1.4), panel);
        m.position.set(j * 5.5, 18, i * 6 + 6);
        env.add(m);
      }
    }
    const strip = new THREE.MeshBasicMaterial({ color: 0x2ad4ff });
    strip.color.multiplyScalar(2.5);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 60), strip);
      m.position.set(s * 16, 3, 6);
      env.add(m);
    }
    const warm = new THREE.MeshBasicMaterial({ color: 0xffd8a8 });
    warm.color.multiplyScalar(1.5);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(26, 0.6, 6, 48), warm);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 12;
    env.add(ring);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(env, 0.02).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color(0x020305);
    this.scene.fog = new THREE.Fog(0x020305, 32, 75);
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0x9fb4d6, 0x22180f, 0.32);
    this.group.add(hemi);
    this.hemi = hemi;
    // main court spotlight (casts the player shadows)
    const key = new THREE.SpotLight(0xfff3e3, 860, 0, 0.62, 0.55, 2);
    key.position.set(1.5, 17, 7.5);
    key.target.position.set(0, 0, 5);
    key.castShadow = true;
    const sm = this.quality === 'low' ? 1024 : 2048;
    key.shadow.mapSize.set(sm, sm);
    key.shadow.camera.near = 6;
    key.shadow.camera.far = 32;
    key.shadow.bias = -0.00015;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3;
    this.group.add(key, key.target);
    this.key = key;
    // fill for the far half and a basket backlight
    const far = new THREE.SpotLight(0xe8eeff, 480, 0, 0.7, 0.8, 2);
    far.position.set(0, 18, 21);
    far.target.position.set(0, 0, 21);
    this.group.add(far, far.target);
    const rimLight = new THREE.SpotLight(0xdde8ff, 160, 0, 0.45, 0.6, 2);
    rimLight.position.set(0, 14, -6);
    rimLight.target.position.set(0, 2, 2);
    this.group.add(rimLight, rimLight.target);
    // gentle side fills so characters read well
    const fillA = new THREE.DirectionalLight(0x9ec9ff, 0.35);
    fillA.position.set(-8, 5, 10);
    const fillB = new THREE.DirectionalLight(0xffe2c0, 0.25);
    fillB.position.set(9, 6, -4);
    this.group.add(fillA, fillB);
  }

  _buildCourt() {
    const wood = makeWoodTexture({ base: [214, 172, 122] });
    this.woodCanvasTex = wood.map;
    const w = (COURT.halfWidth + 2.4) * 2;
    const zMin = COURT.baselineZ - 2.6;
    const zMax = COURT.halfCourtZ * 2 - COURT.baselineZ + 2.6;
    const geo = new THREE.PlaneGeometry(w, zMax - zMin, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, (zMin + zMax) / 2);
    // uvs in meters / 4 (one tile = 4 m)
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4);
    const mat = new THREE.MeshPhysicalMaterial({
      map: wood.map,
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.45,
      clearcoatRoughness: 0.24,
      envMapIntensity: 0.9,
    });
    const uniforms = {
      uPaint: { value: new THREE.Color() },
      uPaintAlpha: { value: 0.9 },
      uLine: { value: new THREE.Color() },
      uApron: { value: new THREE.Color() },
      uApronMix: { value: 0.8 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uAccent: { value: new THREE.Color() },
    };
    this.courtUniforms = uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCourt;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCourt = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + COURT_GLSL)
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec2 p = vCourt;
            const float HZ = ${COURT.halfCourtZ.toFixed(4)};
            if (p.y > HZ) p.y = 2.0 * HZ - p.y;
            diffuseColor.rgb *= uTint;
            float LANE = ${(COURT.laneWidth * 0.5).toFixed(4)};
            // paint (key)
            if (abs(p.x) < LANE && p.y > ${COURT.baselineZ.toFixed(4)} && p.y < ${COURT.ftLineZ.toFixed(4)}) {
              diffuseColor.rgb = mix(diffuseColor.rgb, uPaint * (0.92 + 0.16 * dot(diffuseColor.rgb, vec3(0.33))), uPaintAlpha);
            }
            // apron outside the boundary
            float outX = abs(vCourt.x) - ${COURT.halfWidth.toFixed(4)};
            float outZ = max(${COURT.baselineZ.toFixed(4)} - vCourt.y, vCourt.y - (2.0 * HZ - ${COURT.baselineZ.toFixed(4)}));
            float outside = max(outX, outZ);
            if (outside > 0.0) {
              diffuseColor.rgb = mix(diffuseColor.rgb, uApron, uApronMix);
              // thin accent pinstripe around the court
              float pin = abs(outside - 0.55);
              float aaP = fwidth(outside) * 1.2;
              diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, (1.0 - smoothstep(0.012 - aaP, 0.012 + aaP, pin)) * 0.75);
            }
            float dashed;
            float ld = courtLineDist(p, dashed);
            float aa = fwidth(ld) * 1.0 + 0.0008;
            float lw = ${(COURT.lineWidth * 0.5).toFixed(4)};
            float lineMask = max(1.0 - smoothstep(lw - aa, lw + aa, ld), ftDash(p, lw));
            diffuseColor.rgb = mix(diffuseColor.rgb, uLine, lineMask * 0.96);
          }`
        );
    };
    mat.customProgramCacheKey = () => 'court-v1';
    const court = new THREE.Mesh(geo, mat);
    court.receiveShadow = true;
    this.group.add(court);
    this.court = court;
    this.courtMat = mat;

    // dark arena floor beyond the apron
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 140).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 0.6, metalness: 0.0 })
    );
    floor.position.set(0, -0.01, 13);
    floor.receiveShadow = true;
    this.group.add(floor);

    // wordmarks painted on the apron along both sidelines + center logo
    const wm = makeWordmarkTexture('GREENFN', '1V1 · UNDER THE LIGHTS');
    const wmMat = new THREE.MeshStandardMaterial({ map: wm, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.0), wmMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      m.position.set(s * (COURT.halfWidth + 1.25), 0.002, 4.2);
      m.receiveShadow = true;
      this.group.add(m);
    }
    const base = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.1), wmMat);
    base.rotation.x = -Math.PI / 2;
    base.position.set(0, 0.002, COURT.baselineZ - 1.1);
    base.receiveShadow = true;
    this.group.add(base);
    this.centerLogo = this._centerLogo();
  }

  _centerLogo() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.translate(256, 256);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(0, 0, 200, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 10;
    g.beginPath();
    g.arc(-260, 0, 230, -0.62, 0.62);
    g.stroke();
    g.beginPath();
    g.arc(260, 0, 230, Math.PI - 0.62, Math.PI + 0.62);
    g.stroke();
    g.font = 'italic 800 150px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.fillText('GFN', 0, 8);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 3.0),
      new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.002, COURT.halfCourtZ);
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  _buildSurroundings() {
    const rnd = mulberry32(42);
    // seating bowl: tiers on all sides
    const seatGeo = new THREE.BoxGeometry(0.5, 0.42, 0.5);
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.8 });
    const crowdGeo = new THREE.CapsuleGeometry(0.2, 0.42, 3, 8);
    crowdGeo.translate(0, 0.55, 0);
    const head = new THREE.SphereGeometry(0.13, 8, 6);
    head.translate(0, 1.08, 0);
    const crowdBody = mergeGeos([crowdGeo, head]);
    const crowdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const seats = [];
    const crowd = [];
    const W = COURT.halfWidth;
    const zA = COURT.baselineZ;
    const zB = COURT.halfCourtZ * 2 - COURT.baselineZ;
    const rows = this.quality === 'low' ? 7 : 11;
    const addTier = (side) => {
      for (let r = 0; r < rows; r++) {
        const back = 5.2 + r * 0.95;
        const h = 0.55 + r * 0.48;
        if (side === 'L' || side === 'R') {
          const s = side === 'L' ? -1 : 1;
          for (let z = zA - 2; z <= zB + 2; z += 0.62) {
            seats.push([s * (W + back), h, z, side === 'L' ? Math.PI / 2 : -Math.PI / 2]);
          }
        } else {
          const s = side === 'B' ? -1 : 1;
          const zz = side === 'B' ? zA - back - 1.2 : zB + back + 1.2;
          for (let x = -W - 4; x <= W + 4; x += 0.62) {
            // leave a tunnel behind the near basket stanchion
            seats.push([x, h, zz, side === 'B' ? 0 : Math.PI]);
          }
        }
      }
    };
    addTier('L');
    addTier('R');
    addTier('B');
    addTier('F');
    const seatMesh = new THREE.InstancedMesh(seatGeo, seatMat, seats.length);
    const crowdMesh = new THREE.InstancedMesh(crowdBody, crowdMat, seats.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    const palette = [0x1d2533, 0x2b2f38, 0x3a3f4a, 0x232831, 0x593a2c, 0x1f3a4f, 0x2b1f33, 0x3d4a3a, 0x6b6b70, 0x4a2a2a, 0x2a3a5a];
    let ci = 0;
    for (let i = 0; i < seats.length; i++) {
      const [x, y, z, ry] = seats[i];
      e.set(0, ry, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
      seatMesh.setMatrixAt(i, m);
      if (rnd() < 0.72) {
        const sc = 0.92 + rnd() * 0.18;
        m.compose(new THREE.Vector3(x + (rnd() - 0.5) * 0.08, y - 0.05, z), q, new THREE.Vector3(sc, sc, sc));
        crowdMesh.setMatrixAt(ci, m);
        col.setHex(palette[(rnd() * palette.length) | 0]).multiplyScalar(0.55);
        if (rnd() < 0.025) col.setHex(0x2ad4ff).multiplyScalar(0.3);
        crowdMesh.setColorAt(ci, col);
        ci++;
      }
    }
    crowdMesh.count = ci;
    seatMesh.instanceMatrix.needsUpdate = true;
    crowdMesh.instanceMatrix.needsUpdate = true;
    if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;
    // subtle crowd motion in the vertex shader
    const crowdUniforms = { uTime: { value: 0 }, uHype: { value: 0 } };
    this.crowdUniforms = crowdUniforms;
    crowdMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, crowdUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uHype;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float idf = float(gl_InstanceID);
          float ph = fract(sin(idf * 12.9898) * 43758.5453) * 6.2831;
          float bob = sin(uTime * (1.3 + fract(idf * 0.137) * 1.6) + ph) * 0.025;
          float jump = uHype * max(0.0, sin(uTime * 7.0 + ph)) * 0.22 * step(0.35, fract(idf * 0.31));
          transformed.y += (bob + jump) * smoothstep(0.2, 1.0, position.y);`
        );
    };
    crowdMat.customProgramCacheKey = () => 'crowd-v1';
    this.group.add(seatMesh, crowdMesh);
    this.crowdMesh = crowdMesh;

    // LED ribbon boards along the front row
    const rib = makeRibbonTexture(['GREENFN', 'FIRST TO 11', 'MAKE IT TAKE IT', '1V1 UNDER THE LIGHTS', 'GET BUCKETS']);
    rib.repeat.set(3, 1);
    this.ribbonTex = rib;
    const ribMat = new THREE.MeshBasicMaterial({ map: rib, toneMapped: false });
    ribMat.color.setScalar(1.6);
    this.ribbonMat = ribMat;
    const ribH = 0.42;
    const mkRib = (len, x, z, ry) => {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(len, ribH), ribMat);
      r.position.set(x, 0.62, z);
      r.rotation.y = ry;
      this.group.add(r);
      const backing = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 0.2), new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.7 }));
      backing.position.set(x, 0.45, z);
      backing.rotation.y = ry;
      backing.translateZ(-0.12);
      this.group.add(backing);
    };
    mkRib(zB - zA + 4, -(W + 4.6), (zA + zB) / 2, Math.PI / 2);
    mkRib(zB - zA + 4, W + 4.6, (zA + zB) / 2, -Math.PI / 2);
    mkRib(2 * W + 9, 0, zA - 4.6 - 1.2, 0);
    mkRib(2 * W + 9, 0, zB + 4.6 + 1.2, Math.PI);

    // overhead light rigs + soft beams ("under the lights")
    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0xbfdfff) }, uOpacity: { value: 0.085 } },
      vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ vY = uv.y; vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float edge = pow(abs(dot(vN, vV)), 1.6); float fade = smoothstep(0.0, 0.9, vY) * smoothstep(1.0, 0.82, vY);
        gl_FragColor = vec4(uColor * uOpacity * edge * fade, 1.0); }`,
    });
    this.beamMat = beamMat;
    const addBeam = (x, z, topY, botY, rTop, rBot) => {
      const g = new THREE.CylinderGeometry(rTop, rBot, topY - botY, 24, 1, true);
      const b = new THREE.Mesh(g, beamMat);
      b.position.set(x, (topY + botY) / 2, z);
      this.group.add(b);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(rTop * 1.4, rTop * 1.4, 0.25, 16), new THREE.MeshBasicMaterial({ color: 0xfff6e8 }));
      lamp.position.set(x, topY, z);
      this.group.add(lamp);
    };
    addBeam(0, -0.6, 16.5, 4.0, 0.35, 1.5); // above the backboard (signature look)
    addBeam(-4.5, 7, 17, 0.0, 0.3, 3.4);
    addBeam(4.5, 7, 17, 0.0, 0.3, 3.4);
    addBeam(0, 13.5, 17.5, 0.0, 0.3, 3.0);

    // camera flash sprites in the crowd
    const flashTex = makeRadialSprite('rgba(255,255,255,1)', 'rgba(200,230,255,0)');
    this.flashes = [];
    for (let i = 0; i < 18; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
      s.scale.setScalar(0.5);
      s.visible = false;
      this.group.add(s);
      this.flashes.push({ s, t: 0, life: 0 });
    }
    this.seatList = seats;
    this.rnd = rnd;
  }

  setTheme(id) {
    const th = COURT_THEMES[id] || COURT_THEMES.classic;
    this.theme = id;
    const u = this.courtUniforms;
    u.uPaint.value.set(th.paint);
    u.uPaintAlpha.value = th.paintAlpha;
    u.uLine.value.set(th.line);
    u.uApron.value.set(th.apron);
    u.uApronMix.value = th.apronMix;
    u.uTint.value.set(th.tint);
    u.uAccent.value.set(th.accent);
    this.courtMat.roughness = th.roughness;
    this.courtMat.clearcoat = th.clearcoat;
    this.ribbonMat.color.set(th.accent).lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(1.5);
    if (th.wood && th.wood.join(',') !== this._woodKey) {
      this._woodKey = th.wood.join(',');
      // re-tint wood by regenerating (cheap, once per theme switch)
      const wood = makeWoodTexture({ base: th.wood, variation: th.flat ? 8 : 26 });
      this.courtMat.map.dispose();
      wood.map.repeat.copy(this.courtMat.map.repeat);
      this.courtMat.map = wood.map; // same program (map -> map): no recompile needed
    }
  }

  update(dt, hype = 0) {
    this.time += dt;
    this.crowdUniforms.uTime.value = this.time;
    this.crowdUniforms.uHype.value += (hype - this.crowdUniforms.uHype.value) * Math.min(1, dt * 3);
    this.ribbonTex.offset.x = (this.ribbonTex.offset.x + dt * 0.035) % 1;
    // random camera flashes (more when hyped)
    for (const f of this.flashes) {
      if (f.life > 0) {
        f.t += dt;
        const k = 1 - f.t / f.life;
        f.s.material.opacity = Math.max(0, k * k);
        if (f.t >= f.life) {
          f.life = 0;
          f.s.visible = false;
        }
      } else if (Math.random() < dt * (0.08 + hype * 1.5)) {
        const seat = this.seatList[(Math.random() * this.seatList.length) | 0];
        f.s.position.set(seat[0], seat[1] + 1.0, seat[2]);
        f.t = 0;
        f.life = 0.12 + Math.random() * 0.1;
        f.s.visible = true;
      }
    }
  }
}

function mergeGeos(geos) {
  // tiny merge helper for non-indexed/indexed position+normal geometries
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const idx = [];
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + o);
    else for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + o);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}
