// Procedural textures (no external image assets): hardwood planks, basketball skin, jersey numbers,
// LED ribbon text, soft radial sprites.
import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Tileable hardwood planks running along +V. Returns {map, roughness}. */
export function makeWoodTexture(opts = {}) {
  const size = opts.size || 1024;
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const rnd = mulberry32(opts.seed || 1337);
  const base = opts.base || [214, 172, 122];
  const planks = 32; // across the tile
  const pw = size / planks;
  g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < planks; i++) {
    // each plank column consists of boards of varying length (staggered joints)
    let y = -rnd() * size;
    while (y < size) {
      const len = size * (0.35 + rnd() * 0.5);
      const tone = (rnd() - 0.5) * (opts.variation || 26);
      const warm = (rnd() - 0.5) * 10;
      const r = base[0] + tone + warm;
      const gg = base[1] + tone * 0.9;
      const b = base[2] + tone * 0.75 - warm * 0.5;
      g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      g.fillRect(i * pw, y, pw, len);
      // grain streaks
      const streaks = 5 + ((rnd() * 6) | 0);
      for (let s = 0; s < streaks; s++) {
        const x = i * pw + rnd() * pw;
        const a = 0.05 + rnd() * 0.08;
        g.strokeStyle = rnd() < 0.5 ? `rgba(120,80,40,${a})` : `rgba(255,235,200,${a * 0.8})`;
        g.lineWidth = 0.6 + rnd() * 1.4;
        g.beginPath();
        let xx = x;
        g.moveTo(xx, y);
        const segs = 8;
        for (let k = 1; k <= segs; k++) {
          xx += (rnd() - 0.5) * 1.6;
          xx = Math.max(i * pw + 0.5, Math.min((i + 1) * pw - 0.5, xx));
          g.lineTo(xx, y + (len * k) / segs);
        }
        g.stroke();
      }
      // occasional knot
      if (rnd() < 0.05) {
        const kx = i * pw + pw * (0.3 + rnd() * 0.4);
        const ky = y + rnd() * len;
        const grd = g.createRadialGradient(kx, ky, 0, kx, ky, pw * 0.5);
        grd.addColorStop(0, 'rgba(110,70,35,0.35)');
        grd.addColorStop(1, 'rgba(110,70,35,0)');
        g.fillStyle = grd;
        g.fillRect(kx - pw, ky - pw, pw * 2, pw * 2);
      }
      // board end joint
      g.fillStyle = 'rgba(70,45,25,0.35)';
      g.fillRect(i * pw, y + len - 1, pw, 1.2);
      y += len;
    }
    // seam between plank columns
    g.fillStyle = 'rgba(60,38,20,0.32)';
    g.fillRect(i * pw, 0, 1, size);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  return { map, canvas: c };
}

/** Basketball skin: pebbled orange with black channels. */
export function makeBallTexture(skin = {}) {
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  const base = skin.base || [196, 86, 34];
  const seam = skin.seam || [24, 18, 16];
  const alt = skin.alt || null; // second panel color
  const rnd = mulberry32(99);
  const curveR = (53 * Math.PI) / 180; // curved seams: small circles around ±X
  const w = skin.seamWidth || 0.024;
  for (let py = 0; py < H; py++) {
    const th = ((py + 0.5) / H) * Math.PI;
    const st = Math.sin(th);
    const y = Math.cos(th);
    for (let px = 0; px < W; px++) {
      const ph = ((px + 0.5) / W) * Math.PI * 2;
      const x = -Math.cos(ph) * st;
      const z = Math.sin(ph) * st;
      // distances (radians) to seams
      const dA = Math.abs(Math.asin(Math.max(-1, Math.min(1, x))));
      const dB = Math.abs(Math.asin(Math.max(-1, Math.min(1, y))));
      const dC = Math.abs(Math.acos(Math.min(1, Math.abs(x))) - curveR);
      const dm = Math.min(dA, dB, dC);
      let t = 1 - Math.min(1, Math.max(0, (dm - w) / 0.006));
      // pebble noise
      const n = (rnd() - 0.5) * 18;
      let r = base[0] + n;
      let gg = base[1] + n * 0.6;
      let b = base[2] + n * 0.4;
      if (alt) {
        // alternate panel colors by octant
        const panel = (x > 0) ^ (y > 0) ^ (z > 0);
        if (panel) {
          r = alt[0] + n;
          gg = alt[1] + n * 0.6;
          b = alt[2] + n * 0.4;
        }
      }
      const k = (py * W + px) * 4;
      d[k] = r * (1 - t) + seam[0] * t;
      d[k + 1] = gg * (1 - t) + seam[1] * t;
      d[k + 2] = b * (1 - t) + seam[2] * t;
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

/** Bump map for the ball pebbling (shared). */
let _ballBump = null;
export function ballBumpTexture() {
  if (_ballBump) return _ballBump;
  const W = 512;
  const H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const rnd = mulberry32(7);
  for (let i = 0; i < W * H; i++) {
    const v = 150 + (rnd() - 0.5) * 120;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  _ballBump = new THREE.CanvasTexture(c);
  return _ballBump;
}

/** Jersey number decal texture for the torso (cylindrical UVs: back centered at u=0.5?). */
export function makeJerseyTexture(opts) {
  const W = 512;
  const H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = opts.base;
  g.fillRect(0, 0, W, H);
  if (opts.pattern === 'stripes') {
    g.fillStyle = opts.trim;
    for (let x = 0; x < W; x += 22) g.fillRect(x, 0, 4, H);
  } else if (opts.pattern === 'halftone') {
    g.fillStyle = opts.trim;
    for (let y = 0; y < H; y += 10) {
      for (let x = (y / 10) % 2 ? 5 : 0; x < W; x += 10) {
        const r = 1 + 2.6 * (y / H);
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (opts.pattern === 'fade') {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, opts.base);
    grd.addColorStop(1, opts.trim);
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  } else if (opts.pattern === 'split') {
    g.fillStyle = opts.trim;
    g.fillRect(W * 0.25, 0, W * 0.5, H);
  }
  // side panels / trim bands at the top (arm holes / neck)
  g.fillStyle = opts.trim;
  g.fillRect(0, 0, W, 10);
  // numbers: front at u≈0.0/1.0 seam? LatheGeometry u=0 at +X... draw both front and back
  const num = String(opts.number ?? 0);
  g.font = `800 ${opts.small ? 70 : 118}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const drawNum = (cx, size) => {
    g.font = `800 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.lineWidth = size * 0.09;
    g.strokeStyle = opts.numberStroke || opts.trim;
    g.strokeText(num, cx, H * 0.5);
    g.fillStyle = opts.numberColor || '#fff';
    g.fillText(num, cx, H * 0.5);
  };
  drawNum(W * 0.75, 132); // back (reads correctly from behind)
  // front: lathe UVs run right-to-left when viewed from the front, so mirror it
  g.save();
  g.translate(W * 0.25, 0);
  g.scale(-1, 1);
  drawNum(0, 74);
  g.restore();
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

/** Horizontal scrolling LED ribbon text. */
export function makeRibbonTexture(text, color = '#2ad4ff') {
  const W = 2048;
  const H = 64;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = '#020406';
  g.fillRect(0, 0, W, H);
  g.font = '700 40px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.textBaseline = 'middle';
  let x = 20;
  let i = 0;
  while (x < W) {
    const t = text[i % text.length];
    g.fillStyle = i % 2 ? '#e8f8ff' : color;
    g.fillText(t, x, H / 2 + 2);
    x += g.measureText(t).width + 60;
    g.fillStyle = color;
    g.fillRect(x - 36, H / 2 - 2, 12, 4);
    i++;
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  return map;
}

export function makeRadialSprite(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Court-side wordmark painted on the apron. */
export function makeWordmarkTexture(text = 'GREENFN', sub = '1V1 UNDER THE LIGHTS') {
  const W = 1024;
  const H = 160;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.textBaseline = 'middle';
  g.font = 'italic 800 104px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.92)';
  const tw = g.measureText(text).width;
  g.fillText(text, 20, H / 2);
  g.font = '600 30px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillText(sub, 40 + tw, H / 2 + 22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
