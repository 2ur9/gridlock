/* =============================================================================
   world.js — everything visual that isn't game logic:
   procedural textures, sky/lighting, terrain, trackside scenery, car models,
   and the driver's cockpit. game.js imports from here.
   ========================================================================== */

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

/** Deterministic PRNG so every player sees the same scenery layout. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rb = (rng, a, b) => a + (b - a) * rng();

/* ===========================================================================
   PROCEDURAL TEXTURES
   =========================================================================== */

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/** Layered value noise drawn with canvas scaling (cheap fBm). Returns a grey canvas. */
function noiseCanvas(size, layers, rng) {
  const out = cv(size, size); const x = out.getContext('2d');
  x.fillStyle = '#808080'; x.fillRect(0, 0, size, size);
  x.imageSmoothingEnabled = true;
  for (const [cells, alpha] of layers) {
    const s = cv(cells, cells); const sx = s.getContext('2d');
    const img = sx.createImageData(cells, cells);
    for (let i = 0; i < img.data.length; i += 4) { const v = (rng() * 255) | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    sx.putImageData(img, 0, 0);
    x.globalAlpha = alpha;
    x.drawImage(s, 0, 0, size, size);
  }
  x.globalAlpha = 1;
  return out;
}

function normalFromHeight(src, strength = 2) {
  const w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = cv(w, h); const ox = out.getContext('2d');
  const img = ox.createImageData(w, h);
  const H = (x, y) => d[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255; img.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255; img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ox.putImageData(img, 0, 0);
  return out;
}

function toTex(c, { repeat = 1, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const Tex = {
  _cache: new Map(),
  get(name, fn) { if (!this._cache.has(name)) this._cache.set(name, fn()); return this._cache.get(name); },

  grass() {
    return this.get('grass', () => {
      const rng = makeRng(11); const S = 512;
      const n = noiseCanvas(S, [[4, 0.35], [16, 0.35], [64, 0.3], [256, 0.25]], rng);
      const c = cv(S, S); const x = c.getContext('2d');
      x.fillStyle = '#4a7f2f'; x.fillRect(0, 0, S, S);
      x.globalCompositeOperation = 'multiply'; x.globalAlpha = 0.9; x.drawImage(n, 0, 0);
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
      for (let i = 0; i < 26000; i++) {
        const px = rng() * S, py = rng() * S, l = 2 + rng() * 5;
        x.strokeStyle = rng() < 0.5 ? `rgba(120,190,70,${0.35 + rng() * 0.4})` : `rgba(40,80,25,${0.3 + rng() * 0.4})`;
        x.lineWidth = 1; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (rng() - 0.5) * 2, py - l); x.stroke();
      }
      return { map: toTex(c, { repeat: 1 }), normalMap: toTex(normalFromHeight(n, 1.5), { srgb: false }) };
    });
  },

  asphalt() {
    return this.get('asphalt', () => {
      const rng = makeRng(23); const S = 512;
      const n = noiseCanvas(S, [[8, 0.25], [64, 0.35], [256, 0.45], [512, 0.3]], rng);
      const c = cv(S, S); const x = c.getContext('2d');
      x.fillStyle = '#56585c'; x.fillRect(0, 0, S, S);
      x.globalCompositeOperation = 'multiply'; x.globalAlpha = 0.7; x.drawImage(n, 0, 0);
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
      for (let i = 0; i < 9000; i++) { x.fillStyle = `rgba(${150 + rng() * 60},${150 + rng() * 60},${150 + rng() * 60},${0.15 + rng() * 0.25})`; x.fillRect(rng() * S, rng() * S, 1, 1); }
      // rubbered-in racing line darkening happens per-track via vertex colour; here just tarmac
      return { map: toTex(c), normalMap: toTex(normalFromHeight(n, 1.2), { srgb: false }) };
    });
  },

  gravel() {
    return this.get('gravel', () => {
      const rng = makeRng(37); const S = 256;
      const n = noiseCanvas(S, [[8, 0.3], [32, 0.4], [128, 0.4]], rng);
      const c = cv(S, S); const x = c.getContext('2d');
      x.fillStyle = '#b8a27c'; x.fillRect(0, 0, S, S);
      x.globalCompositeOperation = 'multiply'; x.globalAlpha = 0.7; x.drawImage(n, 0, 0);
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
      for (let i = 0; i < 4000; i++) { x.fillStyle = rng() < 0.5 ? 'rgba(90,75,55,.5)' : 'rgba(230,220,200,.5)'; x.beginPath(); x.arc(rng() * S, rng() * S, 0.6 + rng() * 1.2, 0, TAU); x.fill(); }
      return { map: toTex(c), normalMap: toTex(normalFromHeight(n, 2.5), { srgb: false }) };
    });
  },

  concrete() {
    return this.get('concrete', () => {
      const rng = makeRng(41); const S = 256;
      const n = noiseCanvas(S, [[4, 0.3], [32, 0.3], [128, 0.3]], rng);
      const c = cv(S, S); const x = c.getContext('2d');
      x.fillStyle = '#a9a9a6'; x.fillRect(0, 0, S, S);
      x.globalCompositeOperation = 'multiply'; x.globalAlpha = 0.5; x.drawImage(n, 0, 0);
      return toTex(c);
    });
  },

  armco() {
    return this.get('armco', () => {
      const c = cv(256, 128); const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, '#8d9297'); g.addColorStop(0.18, '#d6dadd'); g.addColorStop(0.36, '#7f858a'); g.addColorStop(0.55, '#d3d7da'); g.addColorStop(0.75, '#80868b'); g.addColorStop(0.92, '#cfd3d6'); g.addColorStop(1, '#8a8f94');
      x.fillStyle = g; x.fillRect(0, 0, 256, 128);
      x.fillStyle = '#4b5055'; for (const px of [22, 128, 234]) for (const py of [26, 66, 104]) { x.beginPath(); x.arc(px, py, 3, 0, TAU); x.fill(); }
      return toTex(c);
    });
  },

  fence() {
    return this.get('fence', () => {
      const c = cv(128, 128); const x = c.getContext('2d');
      x.clearRect(0, 0, 128, 128);
      x.strokeStyle = 'rgba(70,74,78,0.95)'; x.lineWidth = 1.5;
      for (let i = -128; i < 256; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 128, 128); x.stroke(); x.beginPath(); x.moveTo(i + 128, 0); x.lineTo(i, 128); x.stroke(); }
      const t = toTex(c, { repeat: 1 }); return t;
    });
  },

  curb() {
    return this.get('curb', () => {
      const c = cv(128, 64); const x = c.getContext('2d');
      x.fillStyle = '#e63d3d'; x.fillRect(0, 0, 128, 64); x.fillStyle = '#f4f4f2'; x.fillRect(0, 0, 64, 64);
      const n = noiseCanvas(128, [[16, 0.2], [64, 0.2]], makeRng(5)); x.globalCompositeOperation = 'multiply'; x.globalAlpha = 0.35; x.drawImage(n, 0, 0, 128, 64);
      return toTex(c);
    });
  },

  finishLine() {
    return this.get('finish', () => {
      const c = cv(256, 64); const x = c.getContext('2d');
      for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#f3f3f3'; x.fillRect(i * 16, j * 16, 16, 16); }
      return toTex(c);
    });
  },

  ad(text, bg, fg) {
    return this.get('ad:' + text, () => {
      const c = cv(1024, 128); const x = c.getContext('2d');
      x.fillStyle = bg; x.fillRect(0, 0, 1024, 128);
      x.fillStyle = fg; x.font = 'bold 86px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(text, 512, 68);
      x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 8; x.strokeRect(4, 4, 1016, 120);
      const t = toTex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
    });
  },

  brakeBoard(n) {
    return this.get('bb:' + n, () => {
      const c = cv(256, 256); const x = c.getContext('2d');
      x.fillStyle = '#f5f5f5'; x.fillRect(0, 0, 256, 256); x.fillStyle = '#d61f1f'; x.fillRect(0, 0, 256, 42); x.fillRect(0, 214, 256, 42);
      x.fillStyle = '#111'; x.font = 'bold 150px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), 128, 130);
      const t = toTex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
    });
  },

  leaf(kind) {
    return this.get('leaf:' + kind, () => {
      const rng = makeRng(kind === 'cone' ? 77 : 78); const S = 256;
      const c = cv(S, S); const x = c.getContext('2d'); x.clearRect(0, 0, S, S);
      // trunk
      x.fillStyle = '#4a3521'; x.fillRect(S / 2 - 7, S * 0.55, 14, S * 0.45);
      const blobs = kind === 'cone' ? 900 : 700;
      for (let i = 0; i < blobs; i++) {
        let px, py, r;
        if (kind === 'cone') { py = rng() * S * 0.8; const half = (py / (S * 0.8)) * S * 0.42; px = S / 2 + (rng() * 2 - 1) * half; r = 4 + rng() * 6; }
        else { const a = rng() * TAU, d = Math.sqrt(rng()) * S * 0.36; px = S / 2 + Math.cos(a) * d; py = S * 0.36 + Math.sin(a) * d * 0.85; r = 5 + rng() * 9; }
        const g = 70 + rng() * 70, rr = 25 + rng() * 40;
        x.fillStyle = `rgba(${rr},${g},${20 + rng() * 30},${0.75 + rng() * 0.25})`;
        x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
      }
      const t = toTex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
    });
  },

  rim() {
    return this.get('rim', () => {
      const c = cv(128, 128); const x = c.getContext('2d');
      x.fillStyle = '#151515'; x.fillRect(0, 0, 128, 128);
      x.fillStyle = '#cfd2d6'; x.beginPath(); x.arc(64, 64, 58, 0, TAU); x.fill();
      x.fillStyle = '#1b1b1b';
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; x.beginPath(); x.moveTo(64, 64); x.arc(64, 64, 52, a + 0.22, a + TAU / 5 - 0.22); x.closePath(); x.fill(); }
      x.fillStyle = '#9a9ea3'; x.beginPath(); x.arc(64, 64, 12, 0, TAU); x.fill();
      const t = toTex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
    });
  },

  numberDecal(livery) {
    const c = cv(256, 256); const x = c.getContext('2d');
    x.clearRect(0, 0, 256, 256);
    x.fillStyle = '#fff'; x.beginPath(); x.arc(128, 128, 110, 0, TAU); x.fill();
    x.fillStyle = '#111'; x.font = 'bold 150px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(livery.number ?? 7), 128, 134);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  },
};

/* ===========================================================================
   SKY & LIGHTING
   =========================================================================== */

export function setupSky(scene, renderer, wet) {
  const sky = new Sky();
  sky.scale.setScalar(5000);
  const u = sky.material.uniforms;
  u.turbidity.value = wet ? 16 : 4.5;
  u.rayleigh.value = wet ? 0.5 : 1.6;
  u.mieCoefficient.value = wet ? 0.03 : 0.006;
  u.mieDirectionalG.value = 0.82;
  const elevation = wet ? 24 : 36, azimuth = 150;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
  u.sunPosition.value.copy(sunDir);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(sky);
  const rt = pmrem.fromScene(envScene);
  scene.environment = rt.texture;
  scene.add(sky);
  pmrem.dispose();

  const sun = new THREE.DirectionalLight(0xfff2e0, wet ? 0.9 : 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -110; sun.shadow.camera.right = 110;
  sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  scene.add(sun); scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(wet ? 0x8f9aa6 : 0xa8c8f0, wet ? 0x3b3f36 : 0x4b5a2c, wet ? 0.55 : 0.5);
  scene.add(hemi);

  scene.fog = new THREE.Fog(wet ? 0x9aa4ad : 0xc6d6e6, wet ? 250 : 500, wet ? 1700 : 3200);
  return { sun, sunDir, sky };
}

/* ===========================================================================
   TERRAIN — a heightfield that follows the track's elevation
   =========================================================================== */

export class Terrain {
  constructor(track, quality, rng) {
    const S = track.samples;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, sumY = 0;
    for (const s of S) { minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x); minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z); sumY += s.y; }
    const meanY = sumY / S.length;
    const margin = 340;
    const cell = quality === 'high' ? 6 : quality === 'med' ? 8 : 12;
    this.cell = cell; this.x0 = minX - margin; this.z0 = minZ - margin;
    this.nx = Math.ceil((maxX - minX + margin * 2) / cell) + 1;
    this.nz = Math.ceil((maxZ - minZ + margin * 2) / cell) + 1;
    const nx = this.nx, nz = this.nz;
    this.h = new Float32Array(nx * nz);
    this.dist = new Float32Array(nx * nz);   // distance beyond the barrier line (<0 inside)
    const col = new Float32Array(nx * nz * 3);
    const stride = Math.max(1, Math.floor(S.length / 200));
    const hills = (x, z) => 11 * (Math.sin(x * 0.0105 + 1.3) * 0.5 + Math.cos(z * 0.0122) * 0.5 + Math.sin((x + z) * 0.0064 + 0.7) * 0.6);
    const micro = (x, z) => Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.35 + Math.sin(x * 0.07 + z * 0.05) * 0.5;
    const gravelZones = track.gravel.map(([a, len]) => [a, (a + len) % 1]);
    const inZone = (sf, [a, e]) => (a < e ? (sf >= a && sf <= e) : (sf >= a || sf <= e));

    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = this.x0 + ix * cell, z = this.z0 + iz * cell;
        let best = 0, bd = Infinity;
        for (let i = 0; i < S.length; i += stride) { const dx = S[i].pos.x - x, dz = S[i].pos.z - z; const dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = i; } }
        for (let k = -stride; k <= stride; k++) { const i = (best + k + S.length) % S.length; const dx = S[i].pos.x - x, dz = S[i].pos.z - z; const dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = i; } }
        const sm = S[best]; const d = Math.sqrt(bd);
        const hw = sm.width * 0.5;
        const wall = hw + (sm.runoff ?? track.runoff);
        const dOut = d - wall;
        // follow the road's banking under and beside it, fading out by the barrier
        const lat = (x - sm.pos.x) * sm.left.x + (z - sm.pos.z) * sm.left.z;
        const bankY = Math.sin(sm.bank) * clamp(lat, -hw, hw) * (1 - smoothstep(hw + 1.6, wall, d));
        let e;
        if (d <= hw + 1.6) e = sm.y + bankY - 0.1;
        else if (dOut <= 6) e = sm.y + bankY;
        else { const w = 1 - smoothstep(6, 300, dOut); e = sm.y * w + (meanY + hills(x, z)) * (1 - w) + micro(x, z) * smoothstep(6, 40, dOut); }
        const idx = iz * nx + ix;
        this.h[idx] = e; this.dist[idx] = dOut;
        // colour: mown light grass near the track, darker further out, sandy in gravel traps
        const sf = sm.s / track.length;
        const gravel = dOut < 0 && d > sm.width * 0.5 + 1.0 && gravelZones.some((zn) => inZone(sf, zn));
        const nz1 = 0.85 + 0.3 * (Math.sin(x * 0.05) * Math.cos(z * 0.043) * 0.5 + Math.sin((x - z) * 0.013) * 0.5);
        let r, g, b;
        if (gravel) { r = 0.78 * nz1; g = 0.70 * nz1; b = 0.52 * nz1; }
        else if (d <= sm.width * 0.5 + 1.6) { r = 0.22; g = 0.24; b = 0.22; }
        else { const far = smoothstep(10, 120, dOut); r = lerp(0.62, 0.42, far) * nz1; g = lerp(0.9, 0.62, far) * nz1; b = lerp(0.4, 0.28, far) * nz1; }
        col[idx * 3] = r; col[idx * 3 + 1] = g; col[idx * 3 + 2] = b;
      }
    }

    // geometry
    const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix; const x = this.x0 + ix * cell, z = this.z0 + iz * cell;
      pos[i * 3] = x; pos[i * 3 + 1] = this.h[i]; pos[i * 3 + 2] = z;
      uv[i * 2] = x / 9; uv[i * 2 + 1] = z / 9;
    }
    const idx = [];
    for (let iz = 0; iz < nz - 1; iz++) for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const grass = Tex.grass();
    this.material = new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), vertexColors: true, roughness: 1, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
  }

  heightAt(x, z) {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell;
    const ix = clamp(Math.floor(fx), 0, this.nx - 2), iz = clamp(Math.floor(fz), 0, this.nz - 2);
    const tx = clamp(fx - ix, 0, 1), tz = clamp(fz - iz, 0, 1);
    const h = this.h, nx = this.nx;
    const a = h[iz * nx + ix], b = h[iz * nx + ix + 1], c = h[(iz + 1) * nx + ix], d = h[(iz + 1) * nx + ix + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }
  distAt(x, z) {
    const ix = clamp(Math.round((x - this.x0) / this.cell), 0, this.nx - 1), iz = clamp(Math.round((z - this.z0) / this.cell), 0, this.nz - 1);
    return this.dist[iz * this.nx + ix];
  }
}

/* ===========================================================================
   SCENERY BUILDER
   =========================================================================== */

const AD_TEXTS = [
  ['SCHOOL RACING SIM', '#0b2540', '#ffffff'], ['APEX ENERGY', '#d81f2a', '#ffffff'], ['GRIPLINE TYRES', '#111111', '#ffd400'],
  ['SPEEDWAY OILS', '#1e6f3b', '#ffffff'], ['PIT STOP CAFÉ', '#f2a900', '#1a1a1a'], ['BLUE FLAG BANK', '#1b4fd8', '#ffffff'],
  ['NORTHERN AERO', '#e9e9e9', '#0b2540'], ['LAKESIDE MOTORS', '#5b2a86', '#ffffff'],
];

function ribbon(track, fnL, fnR, { yOff = 0, uvScale = 6, closed = true } = {}) {
  // build a closed ribbon mesh geometry from two lateral-offset functions of sample
  const S = track.samples, N = S.length;
  const v = [], uv = [], idx = [];
  for (let i = 0; i < N; i++) {
    const sm = S[i];
    const L = fnL(sm, i), R = fnR(sm, i);
    const l = sm.pos.clone().addScaledVector(sm.left, L.off); l.y = (L.y ?? sm.y) + yOff;
    const r = sm.pos.clone().addScaledVector(sm.left, R.off); r.y = (R.y ?? sm.y) + yOff;
    v.push(l.x, l.y, l.z, r.x, r.y, r.z);
    const across = Math.abs(L.off - R.off);
    uv.push(0, sm.s / uvScale, across / uvScale, sm.s / uvScale);
  }
  const n = closed ? N : N - 1;
  for (let i = 0; i < n; i++) { const a = i * 2, b = ((i + 1) % N) * 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function placeInstance(mesh, k, x, y, z, yaw, sx = 1, sy = 1, sz = 1, color) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(sx, sy, sz));
  mesh.setMatrixAt(k, m);
  if (color) mesh.setColorAt(k, color);
}

export function buildWorld(track, scene, quality, weather) {
  const rng = makeRng(track.name.length * 131 + track.samples.length);
  const S = track.samples, N = S.length, step = track.length / N;
  const wet = weather === 'wet';
  const hiQ = quality === 'high', loQ = quality === 'low';
  const world = { startLights: [], drsBoards: [] };

  /* ---- terrain ---- */
  const terrain = new Terrain(track, quality, rng);
  scene.add(terrain.mesh);
  world.terrain = terrain;
  const groundY = (x, z) => terrain.heightAt(x, z);

  /* ---- road ---- */
  const asphalt = Tex.asphalt();
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphalt.map, normalMap: asphalt.normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: wet ? 0.32 : 0.88, metalness: wet ? 0.25 : 0.0, envMapIntensity: wet ? 1.2 : 0.4, color: wet ? 0x9a9da2 : 0xc4c6c9,
  });
  const roadGeo = ribbon(track, (sm) => ({ off: sm.width / 2 + 0.2, y: sm.y + Math.sin(sm.bank) * sm.width / 2 }), (sm) => ({ off: -sm.width / 2 - 0.2, y: sm.y - Math.sin(sm.bank) * sm.width / 2 }), { yOff: 0.02, uvScale: 5 });
  const road = new THREE.Mesh(roadGeo, roadMat); road.receiveShadow = true; scene.add(road);
  world.roadMesh = road;

  // white edge lines
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.8 });
  for (const s of [1, -1]) {
    const g = ribbon(track, (sm) => ({ off: s * (sm.width / 2 - 0.05), y: sm.y + s * Math.sin(sm.bank) * sm.width / 2 }), (sm) => ({ off: s * (sm.width / 2 - 0.22), y: sm.y + s * Math.sin(sm.bank) * sm.width / 2 }), { yOff: 0.035 });
    scene.add(new THREE.Mesh(g, lineMat));
  }

  // kerbs (raised, striped)
  const kerbMat = new THREE.MeshStandardMaterial({ map: Tex.curb(), roughness: 0.75 });
  kerbMat.map.repeat.set(1, 1);
  for (const s of [1, -1]) {
    const g = ribbon(track, (sm) => ({ off: s * (sm.width / 2 + 0.2), y: sm.y + s * Math.sin(sm.bank) * sm.width / 2 }), (sm) => ({ off: s * (sm.width / 2 + 1.35), y: sm.y + s * Math.sin(sm.bank) * sm.width / 2 + 0.06 }), { yOff: 0.03, uvScale: 2.4 });
    const m = new THREE.Mesh(g, kerbMat); m.receiveShadow = true; scene.add(m);
  }

  // gravel traps (outside of the corner within each gravel zone)
  const gravelTex = Tex.gravel();
  const gravelMat = new THREE.MeshStandardMaterial({ map: gravelTex.map, normalMap: gravelTex.normalMap, roughness: 1 });
  for (const [a, len] of track.gravel) {
    const i0 = Math.floor(a * N), cnt = Math.floor(len * N);
    let curvSum = 0; for (let k = 0; k < cnt; k++) curvSum += S[(i0 + k) % N].curv;
    const side = curvSum > 0 ? -1 : 1; // outside of the bend
    const v = [], uv = [], idx = [];
    for (let k = 0; k <= cnt; k++) {
      const sm = S[(i0 + k) % N];
      const fade = k < 6 ? k / 6 : (k > cnt - 6 ? (cnt - k) / 6 : 1);
      const inner = sm.width / 2 + 1.4, outer = inner + (sm.width / 2 + track.runoff - inner - 0.6) * fade;
      const p1 = sm.pos.clone().addScaledVector(sm.left, side * inner), p2 = sm.pos.clone().addScaledVector(sm.left, side * outer);
      v.push(p1.x, sm.y + 0.03, p1.z, p2.x, sm.y + 0.03, p2.z); uv.push(0, sm.s / 4, (outer - inner) / 4, sm.s / 4);
    }
    for (let k = 0; k < cnt; k++) { const A = k * 2, B = A + 2; idx.push(A, A + 1, B, B, A + 1, B + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, gravelMat));
  }

  /* ---- start / finish ---- */
  const sf = S[0];
  const fin = new THREE.Mesh(new THREE.PlaneGeometry(sf.width - 0.4, 1.6), new THREE.MeshStandardMaterial({ map: Tex.finishLine(), roughness: 0.85 }));
  fin.rotation.x = -Math.PI / 2; fin.rotation.z = -Math.atan2(sf.tan.x, sf.tan.z); fin.position.set(sf.pos.x, sf.y + 0.045, sf.pos.z); scene.add(fin);
  // grid boxes
  const gridMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.9, transparent: true, opacity: 0.85 });
  for (let k = 0; k < 16; k++) {
    const row = Math.floor(k / 2), back = 14 + row * 11;
    const gi = (N - Math.round(back / step) + N * 4) % N; const sm = S[gi];
    const lat = (k % 2 === 0 ? 1 : -1) * Math.min(sm.width * 0.28, 3.4);
    const box = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.16), gridMat); bar.rotation.x = -Math.PI / 2; bar.position.z = 1.4;
    const l1 = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 1.6), gridMat); l1.rotation.x = -Math.PI / 2; l1.position.set(-1.12, 0, 0.6);
    const l2 = l1.clone(); l2.position.x = 1.12;
    box.add(bar, l1, l2);
    box.position.copy(sm.pos).addScaledVector(sm.left, lat); box.position.y = sm.y + 0.045; box.rotation.y = Math.atan2(sm.tan.x, sm.tan.z);
    scene.add(box);
  }

  // gantry with start lights + sponsor board
  {
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.6 });
    const g = new THREE.Group();
    const span = sf.width + 8;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 1.1, 1.1), steel); beam.position.y = 7; g.add(beam);
    for (const s of [1, -1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 7.5, 0.7), steel); post.position.set(s * span / 2, 3.75, 0); g.add(post); }
    const board = new THREE.Mesh(new THREE.PlaneGeometry(span - 2, 1.5), new THREE.MeshStandardMaterial({ map: Tex.ad(AD_TEXTS[0][0], AD_TEXTS[0][1], AD_TEXTS[0][2]), roughness: 0.7 }));
    board.position.set(0, 8.4, -0.3); board.rotation.y = Math.PI; g.add(board);
    const board2 = board.clone(); board2.position.z = 0.3; board2.rotation.y = 0; g.add(board2);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.9, 0.5), new THREE.MeshStandardMaterial({ color: 0x111111 })); housing.position.set(0, 6.1, -0.5); g.add(housing);
    for (let i = 0; i < 5; i++) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0x000000, roughness: 0.3 }));
      lamp.position.set(-2.2 + i * 1.1, 6.1, -0.8); g.add(lamp); world.startLights.push(lamp);
    }
    g.position.set(sf.pos.x, sf.y, sf.pos.z); g.rotation.y = Math.atan2(sf.tan.x, sf.tan.z);
    scene.add(g);
  }

  /* ---- barriers: armco + posts ---- */
  const wallOff = (sm) => sm.width / 2 + (sm.runoff ?? track.runoff);
  const segLen = 4; const segs = Math.ceil(track.length / segLen);
  const armcoMat = new THREE.MeshStandardMaterial({ map: Tex.armco(), roughness: 0.5, metalness: 0.6 });
  const armco = new THREE.InstancedMesh(new THREE.BoxGeometry(segLen + 0.15, 0.78, 0.08), armcoMat, segs * 2);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5b6168, roughness: 0.7, metalness: 0.5 });
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.95, 0.12), postMat, segs * 4);
  let ai = 0, pi = 0;
  for (const side of [1, -1]) {
    for (let k = 0; k < segs; k++) {
      const i = Math.round(k * segLen / step) % N; const sm = S[i];
      const i2 = Math.round(((k + 0.5) * segLen) / step) % N;
      const yaw = Math.atan2(sm.tan.x, sm.tan.z);
      const p = sm.pos.clone().addScaledVector(sm.left, side * wallOff(sm));
      const p2 = S[i2].pos.clone().addScaledVector(S[i2].left, side * wallOff(S[i2]));
      placeInstance(armco, ai++, p2.x, sm.y + 0.55, p2.z, yaw + Math.PI / 2, 1, 1, 1);
      placeInstance(posts, pi++, p.x, sm.y + 0.47, p.z, yaw);
      placeInstance(posts, pi++, p2.x, sm.y + 0.47, p2.z, yaw);
    }
  }
  armco.count = ai; posts.count = pi; armco.castShadow = true; scene.add(armco); scene.add(posts);

  /* ---- catch fencing ---- */
  if (!loQ) {
    const fenceMat = new THREE.MeshStandardMaterial({ map: Tex.fence(), transparent: true, alphaTest: 0.15, side: THREE.DoubleSide, roughness: 0.9, depthWrite: false, opacity: 0.85 });
    fenceMat.map.repeat.set(1, 1);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3d4248, roughness: 0.6, metalness: 0.5 });
    const poleCount = Math.ceil(track.length / 5) * 2;
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.07, 3.6, 6), poleMat, poleCount);
    let pk = 0;
    for (const side of [1, -1]) {
      const v = [], uv = [], idx = [];
      for (let i = 0; i < N; i++) {
        const sm = S[i]; const p = sm.pos.clone().addScaledVector(sm.left, side * (wallOff(sm) + 1.1));
        v.push(p.x, sm.y + 0.2, p.z, p.x, sm.y + 3.5, p.z); uv.push(sm.s / 2, 0, sm.s / 2, 1.6);
      }
      for (let i = 0; i < N; i++) { const a = i * 2, b = ((i + 1) % N) * 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, fenceMat));
      for (let k = 0; k < poleCount / 2; k++) { const i = Math.round(k * 5 / step) % N; const sm = S[i]; const p = sm.pos.clone().addScaledVector(sm.left, side * (wallOff(sm) + 1.1)); placeInstance(poles, pk++, p.x, sm.y + 1.85, p.z, 0); }
    }
    poles.count = pk; scene.add(poles);
  }

  /* ---- tyre walls at the tight corners (outside) ---- */
  {
    const tyreGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.6, 10);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const tyres = new THREE.InstancedMesh(tyreGeo, tyreMat, 3000);
    const cols = [new THREE.Color(0x111111), new THREE.Color(0x111111), new THREE.Color(0xd81f2a), new THREE.Color(0xf2f2f2), new THREE.Color(0x1b4fd8)];
    let tk = 0;
    for (let i = 0; i < N && tk < 2990; i += 1) {
      const sm = S[i];
      if (Math.abs(sm.curv) < 0.0115) continue;
      const side = sm.curv > 0 ? -1 : 1;
      // one stack every ~1.2m along; sample spacing is `step`, so drop some
      if ((i % Math.max(1, Math.round(1.2 / step))) !== 0) continue;
      const p = sm.pos.clone().addScaledVector(sm.left, side * (wallOff(sm) - 0.75));
      placeInstance(tyres, tk++, p.x, sm.y + 0.8, p.z, 0, 1, 1, 1, cols[(i >> 1) % cols.length]);
    }
    tyres.count = tk; tyres.castShadow = true; scene.add(tyres);
  }

  /* ---- advertising boards on the straights ---- */
  {
    const boardGeo = new THREE.PlaneGeometry(8, 1.0);
    const perText = new Map();
    let n = 0;
    for (let k = 0; k < Math.floor(track.length / 9); k++) {
      const i = Math.round(k * 9 / step) % N; const sm = S[i];
      if (Math.abs(sm.curv) > 0.0038) continue;
      const side = (k % 3 === 0) ? -1 : 1;
      const t = AD_TEXTS[(k + side + 8) % AD_TEXTS.length];
      const key = t[0];
      if (!perText.has(key)) perText.set(key, []);
      const p = sm.pos.clone().addScaledVector(sm.left, side * (wallOff(sm) - 0.32));
      // face the plane's front (+z) toward the track centre so the text reads correctly from the circuit
      perText.get(key).push({ x: p.x, y: sm.y + 0.55, z: p.z, yaw: Math.atan2(-side * sm.tan.z, side * sm.tan.x) });
      n++;
    }
    for (const [key, list] of perText) {
      const t = AD_TEXTS.find((a) => a[0] === key);
      const m = new THREE.InstancedMesh(boardGeo, new THREE.MeshStandardMaterial({ map: Tex.ad(t[0], t[1], t[2]), roughness: 0.7, side: THREE.DoubleSide }), list.length);
      list.forEach((b, k) => placeInstance(m, k, b.x, b.y, b.z, b.yaw));
      scene.add(m);
    }
  }

  /* ---- brake marker boards before the tightest corners ---- */
  {
    const boardGeo = new THREE.PlaneGeometry(1.2, 1.2);
    const corners = [];
    for (let i = 0; i < N; i++) { const c = Math.abs(S[i].curv); if (c > 0.014 && c >= Math.abs(S[(i - 1 + N) % N].curv) && c > Math.abs(S[(i + 1) % N].curv)) corners.push(i); }
    for (const ci of corners.slice(0, 12)) {
      const side = S[ci].curv > 0 ? -1 : 1;
      for (const [dist, label] of [[100, 100], [50, 50]]) {
        const i = (ci - Math.round(dist / step) + N * 3) % N; const sm = S[i];
        const p = sm.pos.clone().addScaledVector(sm.left, side * (wallOff(sm) - 0.5));
        const b = new THREE.Mesh(boardGeo, new THREE.MeshStandardMaterial({ map: Tex.brakeBoard(label), side: THREE.DoubleSide, roughness: 0.7 }));
        b.position.set(p.x, sm.y + 1.0, p.z); b.rotation.y = Math.atan2(sm.tan.x, sm.tan.z) + Math.PI; scene.add(b);
      }
    }
  }

  /* ---- grandstands with crowds ---- */
  const standAt = (i, side, len = 52) => {
    const sm = S[i];
    const g = new THREE.Group();
    const conc = new THREE.MeshStandardMaterial({ map: Tex.concrete(), roughness: 0.9 });
    const tiers = 9;
    for (let t = 0; t < tiers; t++) {
      const stepM = new THREE.Mesh(new THREE.BoxGeometry(len, 0.55, 1.6), conc);
      stepM.position.set(0, 0.28 + t * 0.55, -t * 1.6 - 0.8); stepM.castShadow = true; stepM.receiveShadow = true; g.add(stepM);
      // seat rows: a coloured strip
      const seats = new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.7), new THREE.MeshStandardMaterial({ color: t % 2 ? 0x1b4fd8 : 0xd81f2a, roughness: 0.8 }));
      seats.position.set(0, 0.55 + t * 0.55 + 0.1, -t * 1.6 - 1.0); g.add(seats);
    }
    // back wall + roof
    const back = new THREE.Mesh(new THREE.BoxGeometry(len + 2, tiers * 0.55 + 1.5, 0.3), conc); back.position.set(0, (tiers * 0.55 + 1.5) / 2, -tiers * 1.6 - 0.2); g.add(back);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 3, 0.25, tiers * 1.6 + 3), new THREE.MeshStandardMaterial({ color: 0xdadde0, roughness: 0.5, metalness: 0.3 }));
    roof.position.set(0, tiers * 0.55 + 4.2, -tiers * 0.8 - 0.4); roof.rotation.x = -0.12; roof.castShadow = true; g.add(roof);
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, tiers * 0.55 + 4.2, 8), new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.6, roughness: 0.4 })); col.position.set(sx * (len / 2 + 0.8), (tiers * 0.55 + 4.2) / 2, -k * (tiers * 1.6) / 2 - 0.4); g.add(col); }
    // crowd
    const people = loQ ? 220 : hiQ ? 1500 : 800;
    const crowd = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.19, 0.55, 3, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), people);
    const col = new THREE.Color();
    for (let k = 0; k < people; k++) {
      const t = Math.floor(rng() * tiers); const x = (rng() - 0.5) * (len - 2);
      const sitting = rng() < 0.65;
      col.setHSL(rng(), 0.55 + rng() * 0.35, 0.35 + rng() * 0.35);
      placeInstance(crowd, k, x, 0.55 + t * 0.55 + (sitting ? 0.45 : 0.75), -t * 1.6 - 1.0 + (rng() - 0.5) * 0.3, rng() * 0.6 - 0.3, 1, sitting ? 0.8 : 1.15, 1, col);
    }
    crowd.castShadow = true; g.add(crowd);
    // flags on the roof
    for (let k = 0; k < 5; k++) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 5), postMat); pole.position.set(-len / 2 + 4 + k * (len - 8) / 4, tiers * 0.55 + 5.6, -tiers * 1.6 - 0.4); g.add(pole); const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7), new THREE.MeshStandardMaterial({ color: [0xd81f2a, 0x1b4fd8, 0xf2a900, 0xffffff, 0x1e6f3b][k], side: THREE.DoubleSide })); flag.position.set(pole.position.x + 0.6, pole.position.y + 1.1, pole.position.z); g.add(flag); }
    const dist = wallOff(sm) + 4.5;
    const p = sm.pos.clone().addScaledVector(sm.left, side * dist);
    g.position.set(p.x, groundY(p.x, p.z), p.z);
    g.rotation.y = Math.atan2(sm.tan.x, sm.tan.z) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);   // seats face the track
    scene.add(g);
    return i;
  };
  const standIdx = [];
  standIdx.push(standAt(Math.round(N * 0.02), -1, 70));  // main straight, opposite the pits
  // two more at the biggest corners
  const byCurv = S.map((s, i) => [Math.abs(s.curv), i]).sort((a, b) => b[0] - a[0]);
  const chosen = [];
  for (const [, i] of byCurv) { if (chosen.every((c) => Math.abs(c - i) > N * 0.12 && Math.abs(c - i) < N * 0.88) && Math.abs(i) > N * 0.08 && i < N * 0.92) chosen.push(i); if (chosen.length >= 2) break; }
  for (const i of chosen) standIdx.push(standAt(i, S[i].curv > 0 ? -1 : 1, 44));

  /* ---- pit complex along the main straight (left side) ---- */
  {
    const i0 = (N - Math.round(60 / step) + N) % N; // start ~60m before the line
    const len = 150; const cnt = Math.round(len / step);
    const conc = new THREE.MeshStandardMaterial({ map: Tex.concrete(), roughness: 0.9 });
    // pit wall
    const wallGeo = ribbon(track, (sm) => ({ off: sm.width / 2 + 2.2 }), (sm) => ({ off: sm.width / 2 + 2.6 }), { yOff: 0.0 });
    // ribbon() builds the full loop; instead build a short local wall from boxes
    void wallGeo;
    for (let k = 0; k < cnt; k += Math.max(1, Math.round(4 / step))) {
      const sm = S[(i0 + k) % N];
      const p = sm.pos.clone().addScaledVector(sm.left, sm.width / 2 + 2.4);
      const w = new THREE.Mesh(new THREE.BoxGeometry(4.1, 1.15, 0.4), conc); w.position.set(p.x, sm.y + 0.57, p.z); w.rotation.y = Math.atan2(sm.tan.x, sm.tan.z); w.castShadow = true; scene.add(w);
      if (k % Math.max(1, Math.round(16 / step)) === 0) { const gantry = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.2, 1.2), new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.6 })); gantry.position.set(p.x, sm.y + 2.3, p.z); gantry.rotation.y = w.rotation.y; scene.add(gantry); }
    }
    // pit lane surface
    const laneGeo = (() => {
      const v = [], uv = [], idx = [];
      for (let k = 0; k <= cnt; k++) { const sm = S[(i0 + k) % N]; const a = sm.pos.clone().addScaledVector(sm.left, sm.width / 2 + 3.0), b = sm.pos.clone().addScaledVector(sm.left, sm.width / 2 + 13); v.push(a.x, sm.y + 0.02, a.z, b.x, sm.y + 0.02, b.z); uv.push(0, sm.s / 5, 2, sm.s / 5); }
      for (let k = 0; k < cnt; k++) { const A = k * 2, B = A + 2; idx.push(A, A + 1, B, B, A + 1, B + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
    })();
    scene.add(new THREE.Mesh(laneGeo, roadMat));
    // building with garages
    const midI = (i0 + Math.round(cnt / 2)) % N; const sm = S[midI];
    const b = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, 9, 14), new THREE.MeshStandardMaterial({ color: 0xe4e6e9, roughness: 0.7 })); body.position.set(0, 4.5, 0); body.castShadow = true; body.receiveShadow = true; b.add(body);
    const glass = new THREE.MeshStandardMaterial({ color: 0x2b4358, roughness: 0.15, metalness: 0.7 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.8 });
    const bays = Math.floor(len / 8);
    for (let k = 0; k < bays; k++) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 3.8), doorMat); door.position.set(-len / 2 + 4 + k * 8, 2.0, 7.02); b.add(door);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.2), glass); win.position.set(-len / 2 + 4 + k * 8, 6.5, 7.02); b.add(win);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.7), new THREE.MeshStandardMaterial({ map: Tex.ad(AD_TEXTS[k % AD_TEXTS.length][0], AD_TEXTS[k % AD_TEXTS.length][1], AD_TEXTS[k % AD_TEXTS.length][2]) })); sign.position.set(door.position.x, 4.45, 7.03); b.add(sign);
    }
    const roofDeck = new THREE.Mesh(new THREE.BoxGeometry(len + 1, 0.4, 15), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6 })); roofDeck.position.y = 9.2; b.add(roofDeck);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 1.1, 0.08), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })); rail.position.set(0, 9.95, 7.4); b.add(rail);
    // rooftop crowd
    const roofPeople = loQ ? 60 : 260;
    const rc = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.19, 0.55, 3, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), roofPeople);
    const col = new THREE.Color();
    for (let k = 0; k < roofPeople; k++) { col.setHSL(rng(), 0.6, 0.5); placeInstance(rc, k, (rng() - 0.5) * (len - 4), 9.95, 4 + rng() * 3, rng() * 6, 1, 1.1, 1, col); }
    b.add(rc);
    const p = sm.pos.clone().addScaledVector(sm.left, sm.width / 2 + 21);
    b.position.set(p.x, sm.y, p.z); b.rotation.y = Math.atan2(sm.tan.x, sm.tan.z) - Math.PI / 2;   // garages face the pit lane / track
    scene.add(b);
  }

  /* ---- bridge over the back of the circuit ---- */
  {
    const i = Math.round(N * 0.5); const sm = S[i];
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.5, metalness: 0.7 });
    const g = new THREE.Group();
    const span = sm.width + track.runoff * 2 + 6;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 0.6, 4), steel); deck.position.y = 6.5; g.add(deck);
    for (const s of [1, -1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6.5, 1.2), steel); post.position.set(s * span / 2, 3.25, 0); g.add(post); }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 1.2, 0.1), new THREE.MeshStandardMaterial({ map: Tex.ad('ROUND ' + (track.name.split(' ')[0]).toUpperCase(), '#111', '#fff') })); rail.position.set(0, 7.4, -2); g.add(rail);
    const rail2 = rail.clone(); rail2.position.z = 2; rail2.rotation.y = Math.PI; g.add(rail2);
    g.position.set(sm.pos.x, sm.y, sm.pos.z); g.rotation.y = Math.atan2(sm.tan.x, sm.tan.z) + Math.PI / 2;
    scene.add(g);
  }

  /* ---- TV camera towers ---- */
  for (const cam of track.tvCams) {
    const gy = groundY(cam.x, cam.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, cam.y - gy - 0.6, 8), postMat); pole.position.set(cam.x, gy + (cam.y - gy - 0.6) / 2, cam.z); scene.add(pole);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 1.6), postMat); deck.position.set(cam.x, cam.y - 0.7, cam.z); scene.add(deck);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.0, 1.7), new THREE.MeshStandardMaterial({ color: 0xcfd3d6, transparent: true, opacity: 0.35 })); rail.position.set(cam.x, cam.y - 0.15, cam.z); scene.add(rail);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: 0x111111 })); body.position.set(cam.x, cam.y + 0.05, cam.z); scene.add(body);
  }

  /* ---- marshal posts & light towers ---- */
  {
    const hutMat = new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.8 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xff7a00, roughness: 0.7 });
    for (let k = 0; k < 8; k++) {
      const i = Math.round(k / 8 * N + N * 0.06) % N; const sm = S[i];
      const side = sm.curv > 0 ? 1 : -1; // inside of bends
      const p = sm.pos.clone().addScaledVector(sm.left, side * (wallOff(sm) + 2.4));
      const hut = new THREE.Mesh(new THREE.BoxGeometry(2, 2.2, 2), hutMat); hut.position.set(p.x, groundY(p.x, p.z) + 1.1, p.z); hut.rotation.y = Math.atan2(sm.tan.x, sm.tan.z); hut.castShadow = true; scene.add(hut);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.8, 4), roofMat); roof.position.set(p.x, hut.position.y + 1.5, p.z); roof.rotation.y = hut.rotation.y + Math.PI / 4; scene.add(roof);
    }
    for (let k = 0; k < 4; k++) {
      const i = Math.round(k / 4 * N + N * 0.11) % N; const sm = S[i];
      const p = sm.pos.clone().addScaledVector(sm.left, -(wallOff(sm) + 9));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 22, 8), postMat); pole.position.set(p.x, groundY(p.x, p.z) + 11, p.z); scene.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 1.2), new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0x222222 })); head.position.set(p.x, pole.position.y + 11, p.z); scene.add(head);
    }
  }

  /* ---- trees & bushes ---- */
  {
    const crossGeo = (() => {
      const g = new THREE.BufferGeometry();
      const v = [], uv = [], idx = [];
      const quad = (rot) => {
        const c = Math.cos(rot), s = Math.sin(rot); const base = v.length / 3;
        for (const [px, py] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) { v.push(px * c, py, px * s); }
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      quad(0); quad(Math.PI / 2);
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    })();
    const treeCount = loQ ? 500 : hiQ ? 5200 : 2600;
    const kinds = ['round', 'cone'];
    const meshes = kinds.map((k) => new THREE.InstancedMesh(crossGeo, new THREE.MeshStandardMaterial({ map: Tex.leaf(k), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }), treeCount));
    const counts = [0, 0];
    const tmpCol = new THREE.Color();
    const nearStand = (i) => standIdx.some((si) => Math.abs(((i - si + N) % N + N / 2) % N - N / 2) < N * 0.05);
    let tries = 0;
    while (counts[0] + counts[1] < treeCount && tries++ < treeCount * 6) {
      const i = Math.floor(rng() * N); const sm = S[i];
      const side = rng() < 0.5 ? 1 : -1;
      const band = rng();
      const d = wallOff(sm) + (band < 0.35 ? rb(rng, 5, 24) : band < 0.8 ? rb(rng, 24, 110) : rb(rng, 110, 260));
      if (nearStand(i) && d < 45) continue;
      if (side > 0 && i < N * 0.12 && d < 60) continue;   // pit complex area
      if (side > 0 && i > N * 0.9 && d < 60) continue;
      const p = sm.pos.clone().addScaledVector(sm.left, side * d);
      if (terrain.distAt(p.x, p.z) < 3.5) continue;         // too close to the circuit elsewhere
      const kind = rng() < 0.62 ? 0 : 1;
      const h = kind === 0 ? rb(rng, 7, 15) : rb(rng, 9, 19);
      const w = h * (kind === 0 ? rb(rng, 0.85, 1.1) : rb(rng, 0.55, 0.7));
      tmpCol.setHSL(0.24 + rng() * 0.09, 0.45 + rng() * 0.3, 0.32 + rng() * 0.22);
      placeInstance(meshes[kind], counts[kind]++, p.x, groundY(p.x, p.z) - 0.2, p.z, rng() * TAU, w, h, w, tmpCol);
    }
    meshes.forEach((m, k) => { m.count = counts[k]; m.castShadow = !loQ; scene.add(m); });

    // bushes just behind the fence
    const bushN = loQ ? 150 : 700;
    const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), bushN);
    for (let k = 0; k < bushN; k++) {
      const i = Math.floor(rng() * N); const sm = S[i]; const side = rng() < 0.5 ? 1 : -1;
      const p = sm.pos.clone().addScaledVector(sm.left, side * (wallOff(sm) + rb(rng, 2.2, 6)));
      if (side > 0 && (i < N * 0.12 || i > N * 0.9)) continue;
      tmpCol.setHSL(0.26 + rng() * 0.06, 0.5, 0.28 + rng() * 0.15);
      const s = rb(rng, 0.8, 1.8);
      placeInstance(bushes, k, p.x, groundY(p.x, p.z) + s * 0.5, p.z, rng() * TAU, s * 1.3, s, s * 1.3, tmpCol);
    }
    scene.add(bushes);
  }

  /* ---- distant hills ---- */
  {
    let cx = 0, cz = 0; for (const s of S) { cx += s.pos.x; cz += s.pos.z; } cx /= N; cz /= N;
    let maxR = 0; for (const s of S) maxR = Math.max(maxR, Math.hypot(s.pos.x - cx, s.pos.z - cz));
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 1 });
    const hillMat2 = new THREE.MeshStandardMaterial({ color: 0x53704a, roughness: 1 });
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * TAU + rng() * 0.3; const R = maxR + 620 + rng() * 500;
      const w = rb(rng, 260, 620), h = rb(rng, 45, 130);
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), k % 2 ? hillMat : hillMat2);
      m.position.set(cx + Math.cos(a) * R, -h * 0.35 + (S[0].y - 5), cz + Math.sin(a) * R); m.scale.set(w, h, w * rb(rng, 0.7, 1.2)); scene.add(m);
    }
  }

  // optional higher-res grass from CDN (only when hosted online)
  if (!loQ && location.protocol.startsWith('http')) {
    const loader = new THREE.TextureLoader();
    loader.load('https://cdn.jsdelivr.net/gh/mrdoob/three.js@r161/examples/textures/terrain/grasslight-big.jpg', (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1, 1);
      terrain.material.map = t; terrain.material.needsUpdate = true;
    }, undefined, () => {});
  }

  return world;
}

/* ===========================================================================
   CAR MODELS
   =========================================================================== */

function paint(color, opts = {}) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 1.0, ...opts });
}
const MAT = {
  carbon: () => new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.35 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0x1a222c, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.55, envMapIntensity: 1.3 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.92 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xd7dadd, roughness: 0.2, metalness: 1.0 }),
  redLight: () => new THREE.MeshStandardMaterial({ color: 0x600000, emissive: 0xff1010, emissiveIntensity: 0.9 }),
  headLight: () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffee, emissiveIntensity: 0.8 }),
};

function wheelMesh(r, w, rimTex) {
  const geo = new THREE.CylinderGeometry(r, r, w, 24);
  const rim = new THREE.MeshStandardMaterial({ map: rimTex, roughness: 0.35, metalness: 0.8 });
  const m = new THREE.Mesh(geo, [MAT.rubber(), rim, rim]);
  m.rotation.z = Math.PI / 2; m.castShadow = true;
  const pivot = new THREE.Group(); pivot.add(m);
  pivot.rotation.order = 'YXZ';
  return pivot;
}

function decal(livery, w = 0.5) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w), new THREE.MeshStandardMaterial({ map: Tex.numberDecal(livery), transparent: true, roughness: 0.6 }));
  return m;
}

/* ---- Formula car: lofted body, sculpted sidepods, multi-element wings, painted livery ---- */

/** Loft a smooth surface through cross-section stations along Z.
 *  station: { z, w | wb+wt (bottom/top width), h, y (centre), n (squareness: 2 = ellipse, 6 = boxy) } */
function loft(stations, segs = 36) {
  const S = stations; const pos = [], uv = [], idx = [];
  const z0 = S[0].z, z1 = S[S.length - 1].z;
  for (let si = 0; si < S.length; si++) {
    const st = S[si]; const n = st.n ?? 3.2;
    for (let k = 0; k <= segs; k++) {
      const t = -Math.PI / 2 + (k / segs) * TAU;
      const c = Math.sign(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), 2 / n);
      const s = Math.sign(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), 2 / n);
      const yy = (s + 1) / 2;
      const w = lerp(st.wb ?? st.w, st.wt ?? st.w, yy);
      pos.push(c * w / 2 + (st.x || 0), (st.y || 0) + s * st.h / 2, st.z);
      uv.push((st.z - z0) / (z1 - z0), k / segs);
    }
  }
  const ring = segs + 1;
  for (let si = 0; si < S.length - 1; si++) for (let k = 0; k < segs; k++) {
    const a = si * ring + k, b = a + 1, c = a + ring, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** Cambered aerofoil section in the (z, y) plane, extruded across `span` along x. Chord runs -z. */
function wingGeo(chord, thick, camber, span) {
  const sh = new THREE.Shape();
  sh.moveTo(chord * 0.5, 0);
  sh.quadraticCurveTo(0, thick * 0.9 + camber, -chord * 0.5, camber * 0.4);
  sh.quadraticCurveTo(0, -thick * 0.4 + camber, chord * 0.5, 0);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: span, bevelEnabled: false, curveSegments: 8 });
  geo.rotateY(-Math.PI / 2); geo.translate(span / 2, 0, 0);
  return geo;
}

/** Thin plate from an outline in the (z, y) plane, extruded `t` along x (centred). */
function plateGeo(pts, t) {
  const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2); geo.translate(t / 2, 0, 0);
  return geo;
}

function f1BodyLivery(livery, kind) {
  const W = 1024, H = 512; const c = cv(W, H); const x = c.getContext('2d');
  const base = livery.base || '#ff8000', acc = livery.accent || '#ffffff';
  x.fillStyle = base; x.fillRect(0, 0, W, H);
  // underside + lower flanks in black (v<0.1 and v>0.9 are the belly; the flanks fade into it)
  x.fillStyle = '#101214';
  x.fillRect(0, 0, W, H * 0.08); x.fillRect(0, H * 0.92, W, H * 0.08);
  const gL = x.createLinearGradient(0, H * 0.08, 0, H * 0.14); gL.addColorStop(0, '#101214'); gL.addColorStop(1, 'rgba(16,18,20,0)');
  x.fillStyle = gL; x.fillRect(0, H * 0.08, W, H * 0.06);
  const gR = x.createLinearGradient(0, H * 0.86, 0, H * 0.92); gR.addColorStop(0, 'rgba(16,18,20,0)'); gR.addColorStop(1, '#101214');
  x.fillStyle = gR; x.fillRect(0, H * 0.86, W, H * 0.06);
  if (kind === 'body') {
    // black engine-cover spine & accent stripes sweeping along the shoulders
    x.fillStyle = '#101214'; x.fillRect(W * 0.62, H * 0.44, W * 0.38, H * 0.12);
    x.fillStyle = acc; x.fillRect(W * 0.18, H * 0.37, W * 0.8, H * 0.018); x.fillRect(W * 0.18, H * 0.612, W * 0.8, H * 0.018);
    x.fillRect(W * 0.62, H * 0.43, W * 0.38, H * 0.01); x.fillRect(W * 0.62, H * 0.56, W * 0.38, H * 0.01);
  }
  // sponsor text on both flanks. Right flank (v .18-.38) is vertically flipped, left (v .62-.82) is mirrored.
  const label = (txt, u0, u1, vC, size, side) => {
    x.save(); x.fillStyle = side === 'r' ? acc : acc; x.font = `bold ${size}px system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    const cx = ((u0 + u1) / 2) * W, cy = vC * H;
    x.translate(cx, cy); if (side === 'r') x.scale(1, -1); else x.scale(-1, 1);
    x.fillText(txt, 0, 0); x.restore();
  };
  if (kind === 'body') {
    for (const side of ['r', 'l']) {
      const vC = side === 'r' ? 0.27 : 0.73;
      label('SCHOOL RACING', 0.56, 0.9, vC, 44, side);
      label('GRIPLINE', 0.3, 0.5, vC + (side === 'r' ? 0.02 : -0.02), 26, side);
    }
  } else {
    label('APEX ENERGY', 0.15, 0.85, 0.27, 40, 'r');
    label('APEX ENERGY', 0.15, 0.85, 0.73, 40, 'l');
    x.fillStyle = '#101214'; x.fillRect(0, 0, W * 0.06, H); // inlet lip
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 8;
  return t;
}

function f1WheelFace(compound) {
  const band = { soft: '#e11d48', medium: '#facc15', hard: '#f5f5f5' }[compound] || '#e11d48';
  const c = cv(256, 256); const x = c.getContext('2d');
  x.fillStyle = '#0d0d0e'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = band; x.lineWidth = 9; x.beginPath(); x.arc(128, 128, 116, 0, TAU); x.stroke();
  x.fillStyle = '#25282c'; x.beginPath(); x.arc(128, 128, 92, 0, TAU); x.fill();       // wheel cover
  x.fillStyle = '#1a1c1f'; for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; x.beginPath(); x.ellipse(128 + Math.cos(a) * 62, 128 + Math.sin(a) * 62, 7, 16, a, 0, TAU); x.fill(); }
  x.fillStyle = '#8a8f96'; x.beginPath(); x.arc(128, 128, 14, 0, TAU); x.fill();
  x.fillStyle = '#c9ccd0'; x.font = 'bold 15px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.save(); x.translate(128, 128); x.rotate(-0.4); x.fillText('GRIPLINE', 0, -104); x.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function f1Wheel(r, w, compound) {
  const geo = new THREE.CylinderGeometry(r, r, w, 28);
  const face = new THREE.MeshStandardMaterial({ map: f1WheelFace(compound), roughness: 0.55, metalness: 0.4 });
  const m = new THREE.Mesh(geo, [MAT.rubber(), face, face]);
  m.rotation.z = Math.PI / 2; m.castShadow = true;
  const pivot = new THREE.Group(); pivot.add(m); pivot.rotation.order = 'YXZ';
  return pivot;
}

function buildF1(livery, compound = 'soft') {
  const g = new THREE.Group();
  const paintMat = (map) => new THREE.MeshPhysicalMaterial({ map, metalness: 0.35, roughness: 0.38, clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.0 });
  const bodyMat = paintMat(f1BodyLivery(livery, 'body'));
  const podMat = paintMat(f1BodyLivery(livery, 'pod'));
  const carbon = MAT.carbon();
  const accent = paint(livery.accent || '#ffffff');
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
  const blade = (from, to, w = 0.05, t = 0.012, mat = carbon) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to); const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(t, w, len), mat); m.position.copy(a).add(b).multiplyScalar(0.5); m.lookAt(b); m.castShadow = true; g.add(m); return m;
  };

  // --- central body: nose -> tub -> airbox -> engine cover -> tail
  g.add(Object.assign(new THREE.Mesh(loft([
    { z: 3.55, wb: 0.10, wt: 0.08, h: 0.07, y: 0.29, n: 2.6 },
    { z: 3.2, wb: 0.2, wt: 0.17, h: 0.14, y: 0.33, n: 2.8 },
    { z: 2.6, wb: 0.32, wt: 0.27, h: 0.22, y: 0.40, n: 3 },
    { z: 2.0, wb: 0.44, wt: 0.38, h: 0.3, y: 0.45, n: 3.4 },
    { z: 1.45, wb: 0.6, wt: 0.5, h: 0.38, y: 0.47, n: 3.8 },
    { z: 0.95, wb: 0.72, wt: 0.58, h: 0.44, y: 0.49, n: 4.2 },
    { z: 0.55, wb: 0.74, wt: 0.6, h: 0.5, y: 0.51, n: 4.2 },
    { z: 0.1, wb: 0.72, wt: 0.5, h: 0.62, y: 0.55, n: 3.6 },
    { z: -0.3, wb: 0.66, wt: 0.24, h: 0.86, y: 0.55, n: 3 },
    { z: -0.75, wb: 0.62, wt: 0.16, h: 0.86, y: 0.54, n: 3 },
    { z: -1.3, wb: 0.54, wt: 0.12, h: 0.66, y: 0.5, n: 3 },
    { z: -1.85, wb: 0.42, wt: 0.1, h: 0.44, y: 0.45, n: 3 },
    { z: -2.3, wb: 0.28, wt: 0.08, h: 0.24, y: 0.42, n: 3 },
    { z: -2.55, wb: 0.14, wt: 0.05, h: 0.1, y: 0.42, n: 2.5 },
  ]), bodyMat), { castShadow: true }));

  // --- sidepods (undercut inlets flowing down to the coke-bottle tail)
  for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(loft([
      { z: 0.85, x: s * 0.6, wb: 0.06, wt: 0.42, h: 0.4, y: 0.42, n: 3.2 },
      { z: 0.5, x: s * 0.62, wb: 0.3, wt: 0.5, h: 0.42, y: 0.4, n: 3.4 },
      { z: -0.1, x: s * 0.62, wb: 0.36, wt: 0.44, h: 0.36, y: 0.36, n: 3.4 },
      { z: -0.7, x: s * 0.58, wb: 0.36, wt: 0.3, h: 0.28, y: 0.31, n: 3.2 },
      { z: -1.3, x: s * 0.5, wb: 0.3, wt: 0.16, h: 0.16, y: 0.25, n: 3 },
      { z: -1.8, x: s * 0.42, wb: 0.22, wt: 0.08, h: 0.06, y: 0.2, n: 2.6 },
    ]), podMat); pod.castShadow = true; g.add(pod);
    add(new RoundedBoxGeometry(0.34, 0.3, 0.16, 2, 0.05), new THREE.MeshStandardMaterial({ color: 0x050607 }), s * 0.6, 0.44, 0.84); // inlet
    // bargeboard + floor-edge wing
    add(new THREE.BoxGeometry(0.012, 0.26, 0.5), accent, s * 0.68, 0.24, 1.05, 0, s * -0.25, 0);
    add(new THREE.BoxGeometry(0.16, 0.012, 1.6), carbon, s * 0.88, 0.16, -0.2);
    // mirror on a stalk
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), carbon, s * 0.56, 0.62, 0.95, 0, 0, s * 0.8);
    add(new RoundedBoxGeometry(0.15, 0.06, 0.05, 2, 0.015), carbon, s * 0.63, 0.68, 0.95);
    add(new THREE.PlaneGeometry(0.12, 0.045), MAT.chrome(), s * 0.63, 0.68, 0.923, 0, Math.PI, 0);
  }

  // --- floor + diffuser + plank
  {
    const sh = new THREE.Shape();
    sh.moveTo(-0.5, 1.4); sh.lineTo(0.5, 1.4); sh.lineTo(0.95, 0.9); sh.lineTo(0.98, -1.0); sh.lineTo(0.8, -2.0); sh.lineTo(-0.8, -2.0); sh.lineTo(-0.98, -1.0); sh.lineTo(-0.95, 0.9); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false }); geo.rotateX(Math.PI / 2);
    const floor = new THREE.Mesh(geo, carbon); floor.position.y = 0.12; floor.castShadow = true; g.add(floor);
    add(new THREE.BoxGeometry(0.3, 0.012, 2.6), new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.9 }), 0, 0.085, 0.1);
    add(new THREE.BoxGeometry(1.5, 0.02, 0.55), carbon, 0, 0.2, -2.25, -0.35);
    for (const xx of [-0.5, -0.17, 0.17, 0.5]) add(new THREE.BoxGeometry(0.015, 0.22, 0.5), carbon, xx, 0.26, -2.25, -0.35);
  }

  // --- front wing: main plane + 3 flaps + endplates
  {
    const basePaint = paint(livery.base);
    add(wingGeo(0.36, 0.035, 0.04, 1.9), basePaint, 0, 0.15, 3.32, 0.06);
    add(wingGeo(0.2, 0.02, 0.05, 1.86), carbon, 0, 0.2, 3.13, 0.26);
    add(wingGeo(0.18, 0.018, 0.05, 1.8), basePaint, 0, 0.26, 2.99, 0.42);
    add(wingGeo(0.16, 0.016, 0.05, 1.74), accent, 0, 0.32, 2.87, 0.58);
    for (const s of [-1, 1]) {
      add(plateGeo([[3.55, 0.05], [2.75, 0.05], [2.72, 0.44], [3.05, 0.44], [3.55, 0.24]], 0.016), carbon, s * 0.95, 0, 0);
      add(new THREE.BoxGeometry(0.16, 0.012, 0.5), carbon, s * 0.9, 0.06, 3.2); // footplate
    }
  }

  // --- rear wing: endplates, main plane, DRS flap, beam wing, swan-neck
  {
    for (const s of [-1, 1]) {
      add(plateGeo([[-1.9, 0.44], [-2.58, 0.44], [-2.62, 1.0], [-2.1, 1.0], [-1.9, 0.76]], 0.02), carbon, s * 0.5, 0, 0);
      const d = decal(livery, 0.34); d.position.set(s * 0.512, 0.74, -2.28); d.rotation.y = s * Math.PI / 2; g.add(d);
    }
    add(wingGeo(0.34, 0.03, 0.05, 0.98), paint(livery.base), 0, 0.84, -2.28, -0.18);
    const flapPivot = new THREE.Group(); flapPivot.position.set(0, 0.9, -2.32); g.add(flapPivot);
    const flap = new THREE.Mesh(wingGeo(0.22, 0.02, 0.04, 0.96), accent); flap.position.set(0, 0.06, -0.14); flap.rotation.x = -0.35; flap.castShadow = true; flapPivot.add(flap);
    flapPivot.rotation.x = 0; g.userData.drsFlap = flapPivot; flapPivot.userData.drsFlap = true;
    add(wingGeo(0.2, 0.025, 0.03, 0.9), carbon, 0, 0.5, -2.3, -0.3);
    add(new THREE.BoxGeometry(0.03, 0.4, 0.34), carbon, 0, 0.66, -2.12, 0.5);
    add(new RoundedBoxGeometry(0.1, 0.1, 0.05, 2, 0.02), MAT.redLight(), 0, 0.42, -2.58);
  }

  // --- halo, cockpit, driver
  add(new RoundedBoxGeometry(0.46, 0.14, 0.7, 3, 0.06), new THREE.MeshStandardMaterial({ color: 0x0a0b0c }), 0, 0.68, 0.35);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.032, 10, 28, Math.PI), carbon); halo.position.set(0, 0.86, 0.5); halo.rotation.x = -Math.PI / 2; halo.castShadow = true; g.add(halo);
  add(new THREE.CylinderGeometry(0.02, 0.022, 0.36, 8), carbon, 0, 0.7, 0.9, 0.3, 0, 0);
  const helmet = add(new THREE.SphereGeometry(0.15, 18, 14), paint(livery.accent || '#ffffff'), 0, 0.74, 0.32); helmet.userData.hideInCockpit = true;
  const visor = add(new THREE.SphereGeometry(0.147, 16, 8, Math.PI * 0.75, Math.PI * 0.5, Math.PI * 0.35, Math.PI * 0.3), MAT.glass(), 0, 0.75, 0.32); visor.userData.hideInCockpit = true;
  const shoulders = add(new RoundedBoxGeometry(0.4, 0.12, 0.26, 2, 0.05), paint(livery.base), 0, 0.62, 0.28); shoulders.userData.hideInCockpit = true;
  // T-cam + nose cameras + antenna
  add(new THREE.BoxGeometry(0.14, 0.07, 0.18), new THREE.MeshStandardMaterial({ color: 0x111111 }), 0, 1.0, -0.5);
  add(new THREE.BoxGeometry(0.15, 0.03, 0.19), new THREE.MeshStandardMaterial({ color: 0xffd400 }), 0, 1.035, -0.5);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.03, 0.1), carbon, s * 0.09, 0.4, 2.85);
  add(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 5), carbon, 0.12, 0.62, 1.2);

  // --- suspension: wishbones + pushrods as aero blades
  for (const s of [-1, 1]) {
    // front
    blade([s * 0.3, 0.5, 1.85], [s * 0.74, 0.47, 1.66]); blade([s * 0.3, 0.5, 1.4], [s * 0.74, 0.47, 1.62]);
    blade([s * 0.3, 0.24, 1.9], [s * 0.74, 0.28, 1.68]); blade([s * 0.3, 0.24, 1.38], [s * 0.74, 0.28, 1.62]);
    blade([s * 0.72, 0.26, 1.64], [s * 0.3, 0.56, 1.5], 0.04, 0.01, accent);
    // rear
    blade([s * 0.28, 0.5, -1.3], [s * 0.76, 0.46, -1.52]); blade([s * 0.28, 0.5, -1.85], [s * 0.76, 0.46, -1.58]);
    blade([s * 0.28, 0.22, -1.25], [s * 0.76, 0.27, -1.52]); blade([s * 0.28, 0.22, -1.9], [s * 0.76, 0.27, -1.58]);
    blade([s * 0.74, 0.25, -1.55], [s * 0.28, 0.6, -1.5], 0.04, 0.01, accent);
  }

  // --- wheels (18" style: wide, low-profile look via wheel-cover face)
  const wheels = [];
  for (const [x, z, front] of [[-0.9, 1.65, true], [0.9, 1.65, true], [-0.92, -1.55, false], [0.92, -1.55, false]]) {
    const w = f1Wheel(0.36, front ? 0.32 : 0.41, compound);
    w.position.set(x, 0.36, z); g.add(w); wheels.push(w);
  }
  g.userData.wheels = wheels;

  // number on the nose
  const d1 = decal(livery, 0.3); d1.position.set(0, 0.522, 2.5); d1.rotation.x = -Math.PI / 2 + 0.12; g.add(d1);
  g.userData.eye = new THREE.Vector3(0, 0.80, 0.3);
  g.userData.kind = 'f1';
  return g;
}
function buildGTProcedural(livery) {
  const g = new THREE.Group();
  const body = paint(livery.base);
  const accent = paint(livery.accent || '#ffffff');
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
  const profile = (pts, depth, bevel = 0.1) => {
    const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
    geo.rotateY(-Math.PI / 2); geo.translate(depth / 2, 0, 0); return geo;
  };
  // lower body silhouette (z, y)
  add(profile([[-2.3, 0.3], [-2.38, 0.62], [-2.25, 0.92], [-1.0, 0.95], [1.2, 0.93], [1.95, 0.88], [2.36, 0.72], [2.4, 0.42], [2.25, 0.3]], 1.62, 0.12), body, 0, 0, 0);
  // glasshouse
  const glass = MAT.glass();
  const gh = add(profile([[-1.72, 0.92], [-1.3, 1.26], [-0.25, 1.34], [0.6, 1.31], [1.2, 1.02], [1.36, 0.92]], 1.42, 0.06), glass, 0, 0, 0);
  gh.userData.hideInCockpit = true;
  add(new RoundedBoxGeometry(1.3, 0.05, 1.5, 2, 0.02), body, 0, 1.345, -0.55); // roof panel
  // splitter, diffuser, wing
  add(new THREE.BoxGeometry(1.9, 0.05, 0.5), MAT.carbon(), 0, 0.22, 2.35);
  add(new THREE.BoxGeometry(1.7, 0.2, 0.5), MAT.carbon(), 0, 0.28, -2.25);
  add(new THREE.BoxGeometry(1.75, 0.04, 0.34), MAT.carbon(), 0, 1.22, -2.15, -0.15);
  for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.03, 0.28, 0.4), accent, s * 0.88, 1.2, -2.15); add(new THREE.BoxGeometry(0.06, 0.34, 0.12), MAT.carbon(), s * 0.6, 1.02, -2.15); }
  // lights
  for (const s of [-1, 1]) { add(new RoundedBoxGeometry(0.42, 0.14, 0.1, 2, 0.04), MAT.headLight(), s * 0.6, 0.72, 2.36); add(new RoundedBoxGeometry(0.5, 0.1, 0.06, 2, 0.03), MAT.redLight(), s * 0.55, 0.82, -2.38); add(new THREE.BoxGeometry(0.16, 0.08, 0.2), MAT.chrome(), s * 0.98, 1.0, 0.85); add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), MAT.chrome(), s * 0.35, 0.36, -2.35, Math.PI / 2, 0, 0); }
  // accent stripe
  if (livery.pattern === 'stripe') add(new THREE.BoxGeometry(0.34, 0.02, 4.7), accent, 0, 0.955, 0);
  const rimTex = Tex.rim();
  const wheels = [];
  for (const [x, z] of [[-0.86, 1.42], [0.86, 1.42], [-0.86, -1.42], [0.86, -1.42]]) { const w = wheelMesh(0.35, 0.3, rimTex); w.position.set(x, 0.35, z); g.add(w); wheels.push(w); }
  g.userData.wheels = wheels;
  const d1 = decal(livery, 0.5); d1.position.set(0.84, 0.66, 0.2); d1.rotation.y = Math.PI / 2; g.add(d1);
  const d2 = decal(livery, 0.5); d2.position.set(-0.84, 0.66, 0.2); d2.rotation.y = -Math.PI / 2; g.add(d2);
  const d3 = decal(livery, 0.55); d3.position.set(0, 0.96, 1.5); d3.rotation.x = -Math.PI / 2 + 0.05; g.add(d3);
  g.userData.eye = new THREE.Vector3(-0.36, 1.03, 0.1);
  g.userData.kind = 'gt';
  return g;
}

/* ---- road/prototype racers: lofted bodies with painted liveries ---- */

/** Cabin texture: paint on the roof (v .38-.62), dark glass on the sides/front/rear. */
function cabinTex(livery) {
  const W = 256, H = 256; const c = cv(W, H); const x = c.getContext('2d');
  x.fillStyle = '#0e1418'; x.fillRect(0, 0, W, H);
  x.fillStyle = livery.base || '#d21f3c'; x.fillRect(0, H * 0.4, W, H * 0.2);
  x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillRect(0, H * 0.2, W, H * 0.08); x.fillRect(0, H * 0.72, W, H * 0.08); // window tint highlights
  x.fillStyle = '#0b0d10'; x.fillRect(0, 0, W, H * 0.12); x.fillRect(0, H * 0.88, W, H * 0.12);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; return t;
}

function roadWheel(r, w, rimTex) {
  const geo = new THREE.CylinderGeometry(r, r, w, 28);
  const rim = new THREE.MeshStandardMaterial({ map: rimTex, roughness: 0.35, metalness: 0.8 });
  const m = new THREE.Mesh(geo, [MAT.rubber(), rim, rim]); m.rotation.z = Math.PI / 2; m.castShadow = true;
  const pivot = new THREE.Group(); pivot.add(m); pivot.rotation.order = 'YXZ';
  return pivot;
}

function commonRacerBits(g, livery, add, opts) {
  const carbon = MAT.carbon();
  const accent = paint(livery.accent || '#ffffff');
  const { wheelX, wheelZf, wheelZr, wheelR = 0.35, wheelW = 0.32, mirrorY = 0.95, mirrorZ = 0.75, decalY = 0.7, decalX = 0.99 } = opts;
  const rimTex = Tex.rim();
  const wheels = [];
  for (const [x, z] of [[-wheelX, wheelZf], [wheelX, wheelZf], [-wheelX, wheelZr], [wheelX, wheelZr]]) { const w = roadWheel(wheelR, wheelW, rimTex); w.position.set(x, wheelR, z); g.add(w); wheels.push(w); }
  g.userData.wheels = wheels;
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), carbon, s * (wheelX - 0.02), mirrorY - 0.02, mirrorZ, 0, 0, s * 1.2);
    add(new RoundedBoxGeometry(0.16, 0.07, 0.08, 2, 0.02), carbon, s * (wheelX + 0.1), mirrorY + 0.03, mirrorZ);
    const dd = decal(livery, 0.46); dd.position.set(s * decalX, decalY, 0.2); dd.rotation.y = s * Math.PI / 2; g.add(dd);
  }
  return { carbon, accent };
}

function buildGT3(livery) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ map: f1BodyLivery(livery, 'body'), metalness: 0.35, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08 });
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
  const body = new THREE.Mesh(loft([
    { z: 2.4, wb: 1.5, wt: 1.15, h: 0.28, y: 0.42, n: 4 },
    { z: 1.9, wb: 1.86, wt: 1.6, h: 0.5, y: 0.5, n: 4.5 },
    { z: 1.1, wb: 1.96, wt: 1.76, h: 0.6, y: 0.56, n: 5 },
    { z: 0.2, wb: 1.98, wt: 1.82, h: 0.66, y: 0.58, n: 5 },
    { z: -1.0, wb: 1.98, wt: 1.82, h: 0.64, y: 0.58, n: 5 },
    { z: -1.9, wb: 1.92, wt: 1.7, h: 0.58, y: 0.6, n: 4.5 },
    { z: -2.4, wb: 1.62, wt: 1.3, h: 0.42, y: 0.62, n: 4 },
  ], 36), bodyMat); body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(loft([
    { z: 1.0, wb: 1.64, wt: 1.34, h: 0.06, y: 0.9, n: 4 },
    { z: 0.45, wb: 1.6, wt: 1.24, h: 0.44, y: 1.07, n: 4 },
    { z: -0.35, wb: 1.6, wt: 1.2, h: 0.5, y: 1.11, n: 4 },
    { z: -1.05, wb: 1.54, wt: 1.14, h: 0.36, y: 1.02, n: 4 },
    { z: -1.5, wb: 1.44, wt: 1.04, h: 0.06, y: 0.9, n: 4 },
  ], 32), new THREE.MeshPhysicalMaterial({ map: cabinTex(livery), metalness: 0.3, roughness: 0.25, clearcoat: 0.8 }));
  cabin.castShadow = true; cabin.userData.hideInCockpit = true; g.add(cabin);
  const { carbon, accent } = commonRacerBits(g, livery, add, { wheelX: 0.88, wheelZf: 1.45, wheelZr: -1.45, wheelR: 0.35, wheelW: 0.33, mirrorY: 0.98, mirrorZ: 0.8, decalY: 0.68, decalX: 1.0 });
  // splitter, dive planes, side skirts, diffuser
  add(new THREE.BoxGeometry(2.05, 0.03, 0.55), carbon, 0, 0.2, 2.35);
  for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.22, 0.02, 0.16), accent, s * 0.9, 0.5, 2.3, 0, s * 0.3, 0); add(new THREE.BoxGeometry(0.12, 0.05, 2.4), carbon, s * 1.0, 0.24, 0); }
  add(new THREE.BoxGeometry(1.8, 0.26, 0.5), carbon, 0, 0.3, -2.35, -0.3);
  for (const xx of [-0.6, -0.2, 0.2, 0.6]) add(new THREE.BoxGeometry(0.015, 0.28, 0.5), carbon, xx, 0.36, -2.35, -0.3);
  // rear wing on swan necks
  add(wingGeo(0.34, 0.03, 0.05, 1.8), accent, 0, 1.18, -2.25, -0.2);
  for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.02, 0.32, 0.42), carbon, s * 0.92, 1.12, -2.25); add(new THREE.BoxGeometry(0.03, 0.4, 0.28), carbon, s * 0.5, 0.98, -2.05, 0.5); }
  // lights, roof scoop, exhaust, hood decal
  for (const s of [-1, 1]) { add(new RoundedBoxGeometry(0.4, 0.13, 0.08, 2, 0.04), MAT.headLight(), s * 0.62, 0.62, 2.42, 0, s * -0.35, 0); add(new RoundedBoxGeometry(0.55, 0.08, 0.05, 2, 0.02), MAT.redLight(), s * 0.5, 0.78, -2.62); add(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 8), MAT.chrome(), s * 0.3, 0.32, -2.6, Math.PI / 2, 0, 0); }
  add(new RoundedBoxGeometry(0.3, 0.06, 0.2, 2, 0.02), carbon, 0, 1.36, -0.6);
  const d = decal(livery, 0.55); d.position.set(0, 0.905, 1.5); d.rotation.x = -Math.PI / 2 + 0.06; g.add(d);
  g.userData.eye = new THREE.Vector3(-0.38, 1.0, 0.1);
  g.userData.kind = 'gt';
  return g;
}

function buildHyper(livery) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ map: f1BodyLivery(livery, 'pod'), metalness: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
  const body = new THREE.Mesh(loft([
    { z: 2.5, wb: 1.5, wt: 1.05, h: 0.2, y: 0.34, n: 3.5 },
    { z: 1.8, wb: 1.9, wt: 1.5, h: 0.4, y: 0.44, n: 4 },
    { z: 1.0, wb: 2.02, wt: 1.62, h: 0.5, y: 0.5, n: 4.5 },
    { z: 0.0, wb: 2.04, wt: 1.72, h: 0.56, y: 0.52, n: 4.5 },
    { z: -1.0, wb: 2.04, wt: 1.78, h: 0.6, y: 0.54, n: 4.5 },
    { z: -1.9, wb: 1.98, wt: 1.62, h: 0.56, y: 0.56, n: 4 },
    { z: -2.45, wb: 1.7, wt: 1.2, h: 0.4, y: 0.5, n: 3.5 },
  ], 36), bodyMat); body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(loft([
    { z: 1.05, wb: 1.3, wt: 1.0, h: 0.05, y: 0.78, n: 3 },
    { z: 0.45, wb: 1.36, wt: 0.92, h: 0.42, y: 0.95, n: 3.5 },
    { z: -0.3, wb: 1.3, wt: 0.8, h: 0.44, y: 0.98, n: 3.5 },
    { z: -1.0, wb: 1.1, wt: 0.5, h: 0.3, y: 0.9, n: 3 },
    { z: -1.9, wb: 0.7, wt: 0.2, h: 0.12, y: 0.78, n: 3 },
  ], 32), new THREE.MeshPhysicalMaterial({ map: cabinTex(livery), metalness: 0.3, roughness: 0.25, clearcoat: 0.8 }));
  cabin.castShadow = true; cabin.userData.hideInCockpit = true; g.add(cabin);
  const { carbon, accent } = commonRacerBits(g, livery, add, { wheelX: 0.9, wheelZf: 1.5, wheelZr: -1.5, wheelR: 0.35, wheelW: 0.34, mirrorY: 0.86, mirrorZ: 0.85, decalY: 0.6, decalX: 1.03 });
  // shark fin, rear wing on tall endplates, diffuser, splitter, roof scoop, slim lights
  add(new THREE.BoxGeometry(0.03, 0.32, 1.5), paint(livery.base), 0, 1.02, -1.55);
  add(wingGeo(0.32, 0.03, 0.05, 1.7), accent, 0, 1.12, -2.25, -0.22);
  for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.02, 0.5, 0.5), carbon, s * 0.86, 0.94, -2.25); }
  add(new THREE.BoxGeometry(1.9, 0.2, 0.55), carbon, 0, 0.28, -2.4, -0.4);
  for (const xx of [-0.7, -0.35, 0, 0.35, 0.7]) add(new THREE.BoxGeometry(0.015, 0.3, 0.55), carbon, xx, 0.34, -2.4, -0.4);
  add(new THREE.BoxGeometry(2.0, 0.03, 0.5), carbon, 0, 0.2, 2.45);
  add(new RoundedBoxGeometry(0.34, 0.1, 0.36, 2, 0.03), carbon, 0, 1.22, -0.55);
  for (const s of [-1, 1]) { add(new RoundedBoxGeometry(0.5, 0.05, 0.05, 2, 0.02), MAT.headLight(), s * 0.66, 0.5, 2.45, 0, s * -0.4, 0); add(new RoundedBoxGeometry(0.7, 0.05, 0.05, 2, 0.02), MAT.redLight(), s * 0.42, 0.74, -2.66); add(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 8), MAT.chrome(), s * 0.22, 0.44, -2.62, Math.PI / 2, 0, 0); }
  const d = decal(livery, 0.5); d.position.set(0, 0.79, 1.6); d.rotation.x = -Math.PI / 2 + 0.08; g.add(d);
  g.userData.eye = new THREE.Vector3(-0.35, 0.93, 0.05);
  g.userData.kind = 'gt';
  return g;
}

function buildLMH(livery) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ map: f1BodyLivery(livery, 'body'), metalness: 0.35, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08 });
  const podMat = new THREE.MeshPhysicalMaterial({ map: f1BodyLivery(livery, 'pod'), metalness: 0.35, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08 });
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
  const body = new THREE.Mesh(loft([
    { z: 2.7, wb: 0.34, wt: 0.24, h: 0.14, y: 0.3, n: 3 },
    { z: 2.0, wb: 0.9, wt: 0.7, h: 0.34, y: 0.4, n: 3.5 },
    { z: 1.2, wb: 1.5, wt: 1.2, h: 0.5, y: 0.46, n: 4 },
    { z: 0.2, wb: 1.7, wt: 1.4, h: 0.58, y: 0.5, n: 4.5 },
    { z: -0.8, wb: 1.7, wt: 1.4, h: 0.58, y: 0.5, n: 4.5 },
    { z: -1.8, wb: 1.6, wt: 1.2, h: 0.5, y: 0.48, n: 4 },
    { z: -2.6, wb: 1.3, wt: 0.9, h: 0.3, y: 0.46, n: 3.5 },
  ], 36), bodyMat); body.castShadow = true; g.add(body);
  for (const s of [-1, 1]) for (const [z0, z1, z2, z3] of [[2.45, 2.0, 1.2, 0.6], [-0.5, -1.0, -1.8, -2.5]]) {
    const pod = new THREE.Mesh(loft([
      { z: z0, x: s * 0.74, w: 0.5, h: 0.3, y: 0.3, n: 3 },
      { z: z1, x: s * 0.78, w: 0.76, h: 0.66, y: 0.42, n: 3.5 },
      { z: z2, x: s * 0.78, w: 0.8, h: 0.68, y: 0.44, n: 3.5 },
      { z: z3, x: s * 0.74, w: 0.66, h: 0.5, y: 0.4, n: 3 },
    ], 28), podMat); pod.castShadow = true; g.add(pod);
  }
  const cabin = new THREE.Mesh(loft([
    { z: 0.95, wb: 1.05, wt: 0.85, h: 0.05, y: 0.76, n: 3 },
    { z: 0.35, wb: 1.1, wt: 0.8, h: 0.44, y: 0.96, n: 3.5 },
    { z: -0.4, wb: 1.06, wt: 0.7, h: 0.48, y: 1.0, n: 3.5 },
    { z: -1.2, wb: 0.7, wt: 0.3, h: 0.3, y: 0.9, n: 3 },
    { z: -2.0, wb: 0.26, wt: 0.1, h: 0.1, y: 0.8, n: 3 },
  ], 32), new THREE.MeshPhysicalMaterial({ map: cabinTex(livery), metalness: 0.3, roughness: 0.25, clearcoat: 0.8 }));
  cabin.castShadow = true; cabin.userData.hideInCockpit = true; g.add(cabin);
  const { carbon, accent } = commonRacerBits(g, livery, add, { wheelX: 0.78, wheelZf: 1.55, wheelZr: -1.5, wheelR: 0.35, wheelW: 0.34, mirrorY: 0.9, mirrorZ: 0.7, decalY: 0.62, decalX: 1.19 });
  add(new THREE.BoxGeometry(0.03, 0.34, 1.3), paint(livery.base), 0, 1.06, -1.45);                        // fin
  add(wingGeo(0.36, 0.03, 0.05, 1.9), accent, 0, 1.1, -2.4, -0.2);
  for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.02, 0.5, 0.55), carbon, s * 0.96, 0.92, -2.4); add(new THREE.BoxGeometry(0.03, 0.42, 0.3), carbon, s * 0.35, 0.86, -2.2, 0.5); }
  add(new THREE.BoxGeometry(2.0, 0.03, 0.5), carbon, 0, 0.16, 2.5);
  add(new THREE.BoxGeometry(1.7, 0.22, 0.6), carbon, 0, 0.26, -2.55, -0.4);
  for (const s of [-1, 1]) { add(new RoundedBoxGeometry(0.16, 0.14, 0.06, 2, 0.03), MAT.headLight(), s * 0.78, 0.5, 2.44); add(new RoundedBoxGeometry(0.3, 0.06, 0.05, 2, 0.02), MAT.redLight(), s * 0.78, 0.6, -2.72); }
  const d = decal(livery, 0.5); d.position.set(0, 0.795, 1.2); d.rotation.x = -Math.PI / 2 + 0.06; g.add(d);
  g.userData.eye = new THREE.Vector3(0, 0.97, 0.1);
  g.userData.kind = 'gt';
  return g;
}

export const CarFactory = {
  gtTemplate: null, _ready: null,
  preload() {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      if (!location.protocol.startsWith('http')) return;
      try {
        const draco = new DRACOLoader(); draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/libs/draco/gltf/');
        const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
        const gltf = await loader.loadAsync('https://cdn.jsdelivr.net/gh/mrdoob/three.js@r161/examples/models/gltf/ferrari.glb');
        const model = gltf.scene;
        model.updateMatrixWorld(true);
        const wp = (n) => { const o = model.getObjectByName(n); if (!o) throw new Error('missing ' + n); return o.getWorldPosition(new THREE.Vector3()); };
        const fl = wp('wheel_fl'), fr = wp('wheel_fr'), rl = wp('wheel_rl'), rr = wp('wheel_rr');
        const front = fl.clone().add(fr).multiplyScalar(0.5).sub(rl.clone().add(rr).multiplyScalar(0.5));
        // bake orientation (front -> +Z) and grounding (wheels on y=0) into the model itself
        model.rotation.y = -Math.atan2(front.x, front.z);
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const c = box.getCenter(new THREE.Vector3());
        model.position.x -= c.x; model.position.z -= c.z; model.position.y -= box.min.y;
        const wrap = new THREE.Group(); wrap.add(model);
        wrap.updateMatrixWorld(true);
        this.gtBox = new THREE.Box3().setFromObject(wrap);
        model.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; } });
        this.gtTemplate = wrap;
      } catch (e) { console.warn('[cars] GLTF unavailable, using procedural GT:', e.message); }
    })();
    return this._ready;
  },

  /** carId: 'f1' | 'gt' (458 model) | 'gt3' | 'hyper' | 'lmh' */
  build(modeId, livery, opts = {}) {
    let g;
    if (modeId === 'f1') g = buildF1(livery, opts.compound);
    else if (modeId === 'gt3') g = buildGT3(livery);
    else if (modeId === 'hyper') g = buildHyper(livery);
    else if (modeId === 'lmh') g = buildLMH(livery);
    else if (this.gtTemplate) g = this._cloneGT(livery);
    else g = buildGTProcedural(livery);
    // blob shadow helper for cheap grounding on low quality
    const blob = new THREE.Mesh(new THREE.CircleGeometry(modeId === 'f1' ? 1.9 : 1.6, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; blob.scale.set(1, 1.35, 1); g.add(blob);
    g.userData.modeId = modeId;
    // Two pivots at chassis height:
    //   tilt  – follows the road (slope + banking): rotates the whole car, wheels included
    //   body  – dynamic dive / squat / lean: rotates the bodywork only, wheels stay on the road
    const outer = new THREE.Group();
    const tilt = new THREE.Group(); tilt.position.y = 0.42; outer.add(tilt);
    g.position.y -= 0.42; tilt.add(g);
    let body = null;
    const wheelSet = new Set(g.userData.wheels || []);
    const wheelsAreDirectChildren = [...wheelSet].every((w) => w.parent === g);
    if (wheelSet.size && wheelsAreDirectChildren) {
      body = new THREE.Group(); body.position.y = 0.42;
      const inner = new THREE.Group(); inner.position.y = -0.42; body.add(inner);
      for (const ch of [...g.children]) if (!wheelSet.has(ch)) inner.add(ch);
      g.add(body);
    }
    outer.userData = { ...g.userData, tilt, body, inner: g };
    return outer;
  },

  _cloneGT(livery) {
    const g = this.gtTemplate.clone(true);
    const bodyMat = paint(livery.base, { metalness: 1.0, roughness: 0.5, clearcoat: 1.0, clearcoatRoughness: 0.03 });
    const details = new THREE.MeshStandardMaterial({ color: livery.accent || '#ffffff', metalness: 1.0, roughness: 0.5 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.25, roughness: 0, transparent: true, opacity: 0.45 });
    const wheels = [];
    g.traverse((m) => {
      if (!m.isMesh) return;
      const n = m.name || '';
      if (n === 'body') m.material = bodyMat;
      else if (/^rim_/.test(n) || n === 'trim') m.material = details;
      else if (/^glass/.test(n)) { m.material = glass; m.userData.hideInCockpit = true; }
      else if (m.material) { m.material = m.material.clone(); }
    });
    for (const n of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) { const w = g.getObjectByName(n); if (w) { w.rotation.order = 'YXZ'; wheels.push(w); } }
    g.userData.wheels = wheels;
    const box = this.gtBox;
    const d = decal(livery, 0.55); d.position.set(0, box.max.y + 0.01, (box.max.z + box.min.z) / 2 - 0.3); d.rotation.x = -Math.PI / 2; g.add(d);
    for (const s of [-1, 1]) { const dd = decal(livery, 0.42); dd.position.set(s * 1.0, 0.7, 0.05); dd.rotation.y = s * Math.PI / 2; g.add(dd); }

    // the model has a real interior + steering wheel: hang the wheel meshes on a pivot so they turn with the steering
    g.updateMatrixWorld(true);
    const steerParts = [];
    g.traverse((m) => { if (m.isMesh && /^steering_/.test(m.name) && m.name !== 'steering_column') steerParts.push(m); });
    if (steerParts.length) {
      const wb = new THREE.Box3(); for (const m of steerParts) wb.expandByObject(m);
      const centre = wb.getCenter(new THREE.Vector3()); g.worldToLocal(centre);
      const pivot = new THREE.Group(); pivot.position.copy(centre); pivot.rotation.x = 0.6; g.add(pivot);
      const wheel = new THREE.Group(); pivot.add(wheel);
      g.updateMatrixWorld(true);
      for (const m of steerParts) wheel.attach(m);
      g.userData.steerWheel = wheel;
      g.userData.wheelCentre = centre;
      g.userData.eye = new THREE.Vector3(centre.x, 0.98, centre.z - 0.58);
    } else g.userData.eye = new THREE.Vector3(-0.35, 0.97, -0.2);
    g.userData.kind = 'gt';
    g.userData.gltf = true;
    return g;
  },
};

/* ===========================================================================
   COCKPIT — dash, wheel, mirror, driver's-eye
   =========================================================================== */

export function buildCockpit(carGroup, renderer) {
  const kind = carGroup.userData.kind;
  const eye = carGroup.userData.eye.clone();
  const cp = new THREE.Group(); cp.visible = false;
  const dark = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.75 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x232527, roughness: 0.85 });
  const alcan = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.95 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = cp) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m; };

  // display (canvas -> texture)
  const dc = cv(512, 256); const dx = dc.getContext('2d');
  const dtex = new THREE.CanvasTexture(dc); dtex.colorSpace = THREE.SRGBColorSpace;
  const dispMat = new THREE.MeshBasicMaterial({ map: dtex });

  // mirror render target
  const rt = new THREE.WebGLRenderTarget(384, 128, { depthBuffer: true });
  const mirrorCam = new THREE.PerspectiveCamera(38, 3, 0.5, 900);
  const mirrorMat = new THREE.MeshBasicMaterial({ map: rt.texture });
  rt.texture.repeat.x = -1; rt.texture.offset.x = 1; rt.texture.wrapS = THREE.RepeatWrapping;

  const wheelPivot = new THREE.Group(); cp.add(wheelPivot);
  const wheel = new THREE.Group(); wheelPivot.add(wheel);

  if (kind === 'gt' && carGroup.userData.gltf && carGroup.userData.steerWheel) {
    // real interior from the model: just add a race display behind the wheel and a live rear-view mirror
    const wc = carGroup.userData.wheelCentre;
    // planes face -Z (toward the driver): rotation.y = PI, tilt about X (+ = face up toward the eye)
    add(new RoundedBoxGeometry(0.22, 0.1, 0.03, 2, 0.01), dark, wc.x, wc.y + 0.1, wc.z + 0.34, 0.4);
    add(new THREE.PlaneGeometry(0.2, 0.085), dispMat, wc.x, wc.y + 0.1, wc.z + 0.32, 0.4, Math.PI, 0);
    add(new RoundedBoxGeometry(0.36, 0.12, 0.03, 2, 0.01), dark, 0, eye.y + 0.2, eye.z + 0.62, -0.12);
    const mir = add(new THREE.PlaneGeometry(0.33, 0.1), mirrorMat, 0, eye.y + 0.2, eye.z + 0.60, -0.12, Math.PI, 0);
    cp.userData.mirrorObjs = [mir];
    wheelPivot.visible = false;
    cp.userData.externalWheel = carGroup.userData.steerWheel;
  } else if (kind === 'gt') {
    // dashboard
    add(new RoundedBoxGeometry(1.7, 0.36, 0.55, 3, 0.08), leather, 0, eye.y - 0.16, eye.z + 0.78);
    add(new RoundedBoxGeometry(1.75, 0.08, 0.7, 2, 0.03), alcan, 0, eye.y + 0.02, eye.z + 0.92, -0.35);
    add(new RoundedBoxGeometry(0.48, 0.2, 0.2, 2, 0.05), dark, eye.x, eye.y - 0.03, eye.z + 0.62, 0.25);
    add(new THREE.PlaneGeometry(0.42, 0.16), dispMat, eye.x, eye.y - 0.02, eye.z + 0.515, 0.25, Math.PI, 0);
    // centre console + gear paddle-ish detail
    add(new RoundedBoxGeometry(0.34, 0.5, 0.55, 2, 0.04), dark, 0, eye.y - 0.42, eye.z + 0.5);
    // door cards
    for (const s of [-1, 1]) add(new RoundedBoxGeometry(0.08, 0.42, 1.6, 2, 0.03), leather, s * 0.86, eye.y - 0.22, eye.z + 0.1);
    // A pillars + roof header
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.09, 0.7, 0.09), dark, s * 0.8, eye.y + 0.22, eye.z + 0.95, 0.75, 0, s * 0.18);
    add(new RoundedBoxGeometry(1.75, 0.12, 0.25, 2, 0.03), dark, 0, eye.y + 0.42, eye.z + 0.6);
    // rear view mirror
    add(new RoundedBoxGeometry(0.34, 0.11, 0.03, 2, 0.01), dark, 0, eye.y + 0.3, eye.z + 0.62, -0.15);
    const mir = add(new THREE.PlaneGeometry(0.31, 0.09), mirrorMat, 0, eye.y + 0.3, eye.z + 0.60, -0.15, Math.PI, 0);
    // wheel
    wheelPivot.position.set(eye.x, eye.y - 0.14, eye.z + 0.5); wheelPivot.rotation.x = 0.32;
    add(new THREE.TorusGeometry(0.175, 0.024, 10, 36), alcan, 0, 0, 0, 0, 0, 0, wheel);
    for (const a of [0, 2.1, -2.1]) add(new THREE.BoxGeometry(0.03, 0.17, 0.02), dark, Math.sin(a) * 0.085, Math.cos(a) * 0.085, 0.005, 0, 0, -a, wheel);
    add(new RoundedBoxGeometry(0.11, 0.09, 0.04, 2, 0.02), dark, 0, 0, 0.005, 0, 0, 0, wheel);
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark, 0, 0, 0.15, Math.PI / 2, 0, 0, wheelPivot);
    cp.userData.mirrorObjs = [mir];
  } else {
    // F1 — the car body is already around us; add wheel, padding, mirrors
    wheelPivot.position.set(0, eye.y - 0.24, eye.z + 0.55); wheelPivot.rotation.x = 0.5;
    add(new RoundedBoxGeometry(0.25, 0.14, 0.04, 2, 0.02), dark, 0, 0, 0, 0, 0, 0, wheel);
    for (const s of [-1, 1]) add(new RoundedBoxGeometry(0.05, 0.13, 0.05, 2, 0.02), alcan, s * 0.15, 0.0, 0, 0, 0, 0, wheel);
    add(new THREE.PlaneGeometry(0.2, 0.09), dispMat, 0, 0.005, -0.028, 0, Math.PI, 0, wheel);
    add(new RoundedBoxGeometry(0.62, 0.06, 0.6, 2, 0.02), alcan, 0, eye.y - 0.2, eye.z + 0.05); // cockpit padding
    const mirrors = [];
    for (const s of [-1, 1]) { const m = add(new THREE.PlaneGeometry(0.15, 0.06), mirrorMat, s * 0.5, eye.y - 0.06, eye.z + 0.9, 0, Math.PI + s * 0.35, 0); mirrors.push(m); }
    cp.userData.mirrorObjs = mirrors;
  }

  cp.userData = { ...cp.userData, eye, wheel: cp.userData.externalWheel || wheel, wheelPivot, display: { canvas: dc, ctx: dx, tex: dtex }, mirror: { rt, cam: mirrorCam }, kind };
  (carGroup.userData.inner || carGroup).add(cp);   // ride on the tilting body, not the ground anchor
  carGroup.userData.cockpit = cp;
  return cp;
}

/** Redraw the in-car display. `d` = { gear, speedKmh, rpmN, lapMs, delta, pos, lap, laps, drs } */
export function drawDisplay(cp, d) {
  const { ctx: x, canvas: c, tex } = cp.userData.display;
  const W = c.width, H = c.height;
  x.fillStyle = '#05070a'; x.fillRect(0, 0, W, H);
  // rpm LEDs
  const n = 15;
  for (let i = 0; i < n; i++) {
    const on = d.rpmN * n > i + 0.5;
    const col = i < 5 ? '#22c55e' : i < 10 ? '#ef4444' : '#3b82f6';
    x.fillStyle = on ? col : '#1b1f25'; x.beginPath(); x.arc(28 + i * 32.5, 26, 11, 0, TAU); x.fill();
    if (on) { x.fillStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.arc(28 + i * 32.5 - 3, 22, 4, 0, TAU); x.fill(); }
  }
  x.fillStyle = '#e8eef5'; x.textBaseline = 'middle';
  x.font = 'bold 120px system-ui'; x.textAlign = 'center'; x.fillText(d.gear, W / 2, 130);
  x.font = 'bold 44px system-ui'; x.textAlign = 'left'; x.fillText(String(d.speedKmh), 18, 96);
  x.font = '20px system-ui'; x.fillStyle = '#9fb0c3'; x.fillText('km/h', 18, 128);
  x.textAlign = 'right'; x.fillStyle = '#e8eef5'; x.font = 'bold 34px system-ui'; x.fillText('P' + d.pos, W - 18, 90);
  x.font = '20px system-ui'; x.fillStyle = '#9fb0c3'; x.fillText(`LAP ${d.lap}/${d.laps}`, W - 18, 124);
  x.textAlign = 'center'; x.font = 'bold 30px ui-monospace, monospace'; x.fillStyle = '#e8eef5'; x.fillText(d.lapMs, W / 2, 212);
  if (d.delta != null) { x.fillStyle = d.delta < 0 ? '#34d399' : '#f87171'; x.font = 'bold 24px ui-monospace, monospace'; x.fillText((d.delta >= 0 ? '+' : '') + (d.delta / 1000).toFixed(2), W / 2, 244); }
  if (d.drs) { x.fillStyle = '#34d399'; x.font = 'bold 26px system-ui'; x.textAlign = 'left'; x.fillText('DRS', 18, 212); }
  tex.needsUpdate = true;
}
