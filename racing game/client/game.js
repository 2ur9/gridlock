/* =============================================================================
   School Racing Sim — client
   One ES module. Rendering: three.js. Physics: custom deterministic vehicle model
   (raycast-style analytic ground, weight transfer, slip-curve tyres, friction
   circle, aero, surface grip). No bundler — served as a plain static file.
   ========================================================================== */

import * as THREE from 'three';
import { setupSky, buildWorld, CarFactory, buildCockpit, drawDisplay } from './world.js?v=10';

/* ---------- error surface ---------------------------------------------------- */
const errBox = document.getElementById('err');
function showErr(msg) {
  errBox.style.display = 'block';
  errBox.textContent += msg + '\n';
}
window.addEventListener('error', (e) => showErr('⚠ ' + (e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => showErr('⚠ promise: ' + (e.reason?.message || e.reason)));

/* ---------- tiny helpers -------------------------------------------------------*/
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const now = () => performance.now();
const fmtTime = (ms) => {
  if (ms == null || !isFinite(ms) || ms < 0) return '--:--.---';
  const m = Math.floor(ms / 60000); const s = Math.floor((ms % 60000) / 1000); const mm = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(mm).padStart(3, '0')}`;
};
const $ = (id) => document.getElementById(id);

/* ===========================================================================
   CONFIG — cars, disciplines, difficulty, points, seasons
   =========================================================================== */

const TYRE = {
  f1:  { peakSlip: 0.13, muPeak: 1.75, falloff: 0.55, muMin: 0.95 },
  gt:  { peakSlip: 0.16, muPeak: 1.32, falloff: 0.30, muMin: 0.90 },
};

const CARS = {
  f1: {
    label: 'Formula', mass: 795, frontBias: 0.435, cgH: 0.30,
    a: 1.70, b: 1.70, inertia: 900, rWheel: 0.33,
    maxSteer: 0.34, brakeForce: 26000, rollDrag: 9, dragCoef: 0.62,
    aeroDown: 4.9, aeroDrag: 0.30, driveEff: 0.94,
    gears: [3.30, 2.45, 1.95, 1.62, 1.38, 1.20, 1.05, 0.92], final: 3.1,
    idleRPM: 3500, redline: 13200, peakRPM: 10500, maxTorque: 560,
    tyre: TYRE.f1, topHint: 95,
  },
  gt: {
    label: 'GT', mass: 1290, frontBias: 0.47, cgH: 0.42,
    a: 1.42, b: 1.44, inertia: 2100, rWheel: 0.345,
    maxSteer: 0.40, brakeForce: 21000, rollDrag: 13, dragCoef: 1.05,
    aeroDown: 1.35, aeroDrag: 0.12, driveEff: 0.90,
    gears: [3.55, 2.42, 1.80, 1.42, 1.16, 0.98], final: 3.45,
    idleRPM: 1100, redline: 7600, peakRPM: 5600, maxTorque: 680,
    tyre: TYRE.gt, topHint: 80,
  },
  gt3: {
    label: 'GT3', mass: 1240, frontBias: 0.46, cgH: 0.40,
    a: 1.40, b: 1.42, inertia: 2000, rWheel: 0.35,
    maxSteer: 0.40, brakeForce: 24000, rollDrag: 12, dragCoef: 0.95,
    aeroDown: 2.3, aeroDrag: 0.18, driveEff: 0.91,
    gears: [3.40, 2.30, 1.72, 1.36, 1.12, 0.95], final: 3.6,
    idleRPM: 1400, redline: 8600, peakRPM: 6400, maxTorque: 700,
    tyre: { peakSlip: 0.15, muPeak: 1.42, falloff: 0.32, muMin: 0.92 }, topHint: 82,
  },
  hyper: {
    label: 'Hypercar', mass: 1650, frontBias: 0.44, cgH: 0.38,
    a: 1.50, b: 1.50, inertia: 2600, rWheel: 0.35,
    maxSteer: 0.38, brakeForce: 30000, rollDrag: 12, dragCoef: 0.88,
    aeroDown: 2.7, aeroDrag: 0.16, driveEff: 0.92,
    gears: [3.10, 2.20, 1.68, 1.32, 1.08, 0.92, 0.80, 0.70], final: 3.5,
    idleRPM: 1600, redline: 11000, peakRPM: 8200, maxTorque: 1100,
    tyre: { peakSlip: 0.15, muPeak: 1.36, falloff: 0.30, muMin: 0.9 }, topHint: 95,
  },
  lmh: {
    label: 'Le Mans Prototype', mass: 1030, frontBias: 0.45, cgH: 0.33,
    a: 1.55, b: 1.55, inertia: 1700, rWheel: 0.35,
    maxSteer: 0.36, brakeForce: 27000, rollDrag: 10, dragCoef: 0.72,
    aeroDown: 4.0, aeroDrag: 0.22, driveEff: 0.93,
    gears: [3.20, 2.30, 1.78, 1.45, 1.22, 1.05, 0.92], final: 3.4,
    idleRPM: 2000, redline: 9200, peakRPM: 7000, maxTorque: 760,
    tyre: { peakSlip: 0.14, muPeak: 1.52, falloff: 0.4, muMin: 0.92 }, topHint: 92,
  },
};

// what the menus call each car
const CAR_INFO = {
  f1: { label: 'Formula car', blurb: 'Open-wheel single seater. Massive downforce, DRS, tyre wear.' },
  gt: { label: 'GT — 458 Spider', blurb: 'Road-going supercar. Forgiving, mechanical grip.' },
  gt3: { label: 'GT3 racer', blurb: 'Wide-body race car with a big wing and splitter.' },
  hyper: { label: 'Hypercar (AMG One style)', blurb: '1000+ hp, very fast in a straight line, heavy.' },
  lmh: { label: 'Le Mans prototype', blurb: 'Enclosed-wheel endurance racer. Light, huge downforce.' },
};

const MODES = {
  f1: { id: 'f1', car: 'f1', cars: ['f1'], label: 'Formula', tyreWear: 1.0, fuel: 0.55, drs: true },
  gt: { id: 'gt', car: 'gt', cars: ['gt', 'gt3', 'hyper', 'lmh'], label: 'GT / Sports', tyreWear: 0.45, fuel: 0.30, drs: false },
};

const DIFF = {
  easy:   { label: 'Easy',   pace: 0.845, mistake: 0.55, aggr: 0.25, defend: 0.2 },
  medium: { label: 'Medium', pace: 0.925, mistake: 0.24, aggr: 0.55, defend: 0.5 },
  hard:   { label: 'Hard',   pace: 0.985, mistake: 0.09, aggr: 0.82, defend: 0.8 },
  pro:    { label: 'Pro',    pace: 1.03,  mistake: 0.03, aggr: 1.0,  defend: 1.0 },
};

const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

const AI_NAMES = [
  'Rossi', 'Nakamura', 'Kovač', 'Bianchi', 'Osei', 'Lindqvist', 'Haddad', 'Meyer',
  'Silva', 'Petrov', 'Okafor', 'Nguyen', 'Dubois', 'Kane', 'Reyes', 'Ferraro',
];
const AI_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#c026d3', '#a16207', '#dc2626', '#059669', '#9333ea'];

const SEASONS = [
  {
    id: 'rookie', name: 'Rookie Cup (3 rounds)',
    rounds: [
      { trackId: 'testoval', mode: 'gt', laps: 4 },
      { trackId: 'monza', mode: 'gt', laps: 3 },
      { trackId: 'silverstone', mode: 'gt', laps: 3 },
    ],
  },
  {
    id: 'world', name: 'World Series (5 rounds · Formula)',
    rounds: [
      { trackId: 'testoval', mode: 'f1', laps: 5 },
      { trackId: 'monza', mode: 'f1', laps: 4 },
      { trackId: 'silverstone', mode: 'f1', laps: 4 },
      { trackId: 'spa', mode: 'f1', laps: 3 },
      { trackId: 'nurburgring', mode: 'f1', laps: 4 },
    ],
  },
  {
    id: 'endurance', name: 'GT Endurance (5 rounds)',
    rounds: [
      { trackId: 'monza', mode: 'gt', laps: 5 },
      { trackId: 'silverstone', mode: 'gt', laps: 5 },
      { trackId: 'nurburgring', mode: 'gt', laps: 5 },
      { trackId: 'spa', mode: 'gt', laps: 4 },
      { trackId: 'testoval', mode: 'gt', laps: 8 },
    ],
  },
];

/* ===========================================================================
   TRACK DEFINITIONS — real-inspired layouts, ~half real-world scale.
   Each point: [x, z, width(m), banking(rad), elevation(m)].
   Built from public knowledge of corner sequences — not scanned data.
   =========================================================================== */

const TRACK_DEFS = {
  testoval: {
    name: 'Lakeside Test Circuit', country: 'Training', tint: 0x2e7d32,
    pts: [
      [0, 0, 16, 0, 0], [0, 120, 16, 0, 0], [10, 200, 15, 0.05, 0], [45, 250, 14, 0.10, 1],
      [110, 262, 14, 0.10, 1], [175, 245, 14, 0.06, 0.5], [205, 190, 15, 0, 0], [205, 60, 16, 0, 0],
      [198, -10, 15, 0.04, 0], [165, -60, 14, 0.10, 1], [100, -74, 14, 0.10, 1], [38, -58, 14, 0.06, 0.5],
      [6, -44, 15, 0.02, 0],
    ],
    runoff: 9, sectors: [0.34, 0.68],
    drs: [], gravel: [],
  },

  monza: {
    name: 'Autodromo Nazionale (inspired)', country: 'Italy', tint: 0x1b5e20,
    pts: [
      [0, 0, 15, 0, 0],            // start/finish straight
      [0, 230, 15, 0, 0],
      [0, 284, 12, 0, 0.5],        // Rettifilo chicane
      [18, 314, 11, 0, 0.5],
      [8, 350, 12, 0, 0.5],
      [10, 430, 14, 0, 0],         // Curva Grande
      [42, 500, 13, 0.06, 0],
      [95, 512, 13, 0.05, 0],
      [150, 470, 13, 0, 0],
      [174, 414, 12, 0, 0],        // della Roggia chicane
      [154, 384, 11, 0, 0],
      [176, 350, 12, 0, 0],
      [214, 300, 13, 0.05, 0],     // Lesmo 1
      [246, 250, 12, 0.08, 1],
      [250, 205, 12, 0.06, 1],     // Lesmo 2
      [226, 150, 13, 0, 0.5],
      [176, 60, 14, 0, 0],         // back straight under the bridge
      [150, -40, 13, 0, 0],
      [154, -110, 12, 0, 0],       // Ascari chicane
      [128, -142, 11, 0, 0],
      [150, -186, 12, 0, 0],
      [150, -300, 15, 0, 0],       // long run to Parabolica
      [140, -372, 13, 0.05, 0],
      [104, -410, 13, 0.12, 1],    // Parabolica
      [46, -404, 14, 0.10, 0.5],
      [8, -330, 15, 0.04, 0],
      [0, -160, 15, 0, 0],
    ],
    runoff: 14, sectors: [0.36, 0.64],
    drs: [[0.90, 0.14], [0.40, 0.52]], gravel: [[0.22, 0.27], [0.86, 0.93]],
  },

  spa: {
    name: 'Ardennes Forest (inspired)', country: 'Belgium', tint: 0x1b4332,
    pts: [
      [0, 0, 14, 0, 3],            // start/finish on the pit straight, heading down to Eau Rouge
      [-2, -42, 13, 0, -3],
      [-6, -78, 12, -0.04, -9],    // Eau Rouge (left kink, compression)
      [8, -108, 12, 0.06, -5],     // Raidillon (right, climbing)
      [24, -165, 13, 0.02, 5],
      [40, -255, 14, 0, 14],       // Kemmel straight (uphill)
      [58, -322, 13, 0.03, 20],
      [96, -356, 12, 0.08, 21],    // Les Combes (right)
      [134, -342, 11, -0.06, 20],  // (left)
      [152, -302, 12, 0.05, 18],   // Malmedy
      [148, -250, 12, 0, 14],
      [176, -200, 13, 0.10, 8],    // Rivage (right, downhill)
      [214, -178, 12, 0.06, 4],
      [228, -128, 13, 0.02, 0],
      [214, -80, 13, -0.10, -5],   // Pouhon (fast left, heading back north)
      [224, -20, 13, 0.06, -6],    // Campus
      [212, 26, 12, 0.08, -4],     // Stavelot (right)
      [176, 40, 13, -0.10, -2],    // Blanchimont (fast left)
      [130, 34, 13, -0.03, 0],
      [104, 10, 11, 0, 1],         // Bus Stop
      [84, 44, 11, 0, 1],
      [78, 90, 12, 0, 2],          // finishing straight, heading north to La Source
      [72, 118, 12, 0.06, 4],
      [50, 140, 11, 0.10, 4],      // La Source hairpin (right)
      [22, 132, 11, 0.10, 4],
      [6, 108, 12, 0.06, 4],
      [2, 60, 14, 0, 3.5],
    ],
    runoff: 12, sectors: [0.30, 0.64],
    drs: [[0.12, 0.14], [0.55, 0.08]], gravel: [[0.26, 0.04], [0.47, 0.04]],
  },

  silverstone: {
    name: 'Northants GP (inspired)', country: 'United Kingdom', tint: 0x2d6a4f,
    pts: [
      [0, 0, 15, 0, 0],            // start straight heading north
      [0, 120, 14, 0, 0],
      [26, 174, 13, 0.05, 0],      // Abbey (fast right)
      [80, 206, 13, 0.02, 0],
      [130, 232, 12, -0.04, 0],    // Maggotts (left)
      [172, 216, 12, 0.05, 0],     // Becketts (right)
      [208, 236, 12, -0.04, 0],    // Chapel (left)
      [250, 250, 12, 0.03, 0],
      [292, 236, 12, 0.08, 0],     // Village (right)
      [302, 196, 12, 0.03, 0],
      [296, 120, 13, 0, 0],        // Wellington straight heading south
      [292, 30, 13, 0, 0],
      [300, -40, 12, -0.04, 0],    // Brooklands (left kink)
      [286, -110, 12, 0.08, 0],    // Luffield (long right)
      [244, -150, 12, 0.06, 0],
      [180, -160, 13, 0.02, 0],    // Hangar straight heading west
      [80, -172, 14, 0, 0],
      [-10, -180, 13, 0.02, 0],
      [-58, -160, 12, 0.08, 0],    // Stowe (right)
      [-68, -112, 12, 0.03, 0],
      [-52, -70, 12, -0.04, 0],    // Vale (left kink)
      [-28, -44, 13, 0.05, 0],     // Club (right)
    ],
    runoff: 11, sectors: [0.33, 0.66],
    drs: [[0.42, 0.10], [0.62, 0.12]], gravel: [[0.30, 0.04], [0.56, 0.04]],
  },

  alpenring: {
    // Power circuit: three very long full-throttle straights up and over a hill, linked by
    // only six corners - fast ones, bar the tight right at the summit. Red Bull Ring in character.
    name: 'Alpenring Speedway (inspired)', country: 'Austria', tint: 0x2f6b3a,
    pts: [
      [0, 0, 15, 0, 0],            // start / finish
      [0, 100, 15, 0, 4],
      [0, 190, 15, 0, 8],          // long pit straight, climbing - flat out
      [16, 244, 14, 0.08, 11],     // T1 - medium right, uphill braking
      [70, 272, 14, 0.05, 13],
      [150, 288, 15, 0, 17],       // the long climb - flat out
      [240, 296, 15, 0, 21],
      [305, 278, 14, 0.07, 24],    // T2 - fast right
      [345, 234, 13, 0.10, 26],    // T3 - tight right at the summit
      [348, 178, 14, 0.05, 25],
      [330, 110, 15, 0, 21],       // long downhill back straight - fastest point
      [300, 20, 15, 0, 15],
      [278, -60, 15, 0, 9],
      [262, -124, 13, 0.08, 6],    // T4 - right
      [220, -168, 13, 0.05, 4],
      [160, -188, 14, -0.04, 3],   // T5 - fast left kink
      [90, -188, 14, 0.06, 2],
      [36, -160, 13, 0.08, 1],     // T6 - right, on to the pit straight
      [8, -110, 14, 0.04, 0],
      [0, -55, 15, 0, 0],
    ],
    runoff: 13, sectors: [0.34, 0.66],
    drs: [[0.84, 0.20], [0.22, 0.18], [0.50, 0.16]], gravel: [[0.13, 0.03], [0.42, 0.03]],
  },

  nurburgring: {
    name: 'Eifel GP (inspired)', country: 'Germany', tint: 0x14532d,
    pts: [
      [0, 0, 15, 0, 0],            // start straight heading north
      [0, 120, 14, 0, 0],
      [16, 168, 11, 0.10, 0],      // Turn 1 (tight right)
      [52, 190, 12, 0.06, 0],
      [104, 196, 12, 0, 0],
      [150, 216, 11, -0.06, 0],    // Mercedes Arena (left)
      [168, 256, 11, -0.06, 0],
      [204, 262, 11, 0.08, 0],     // (right)
      [228, 232, 11, 0.06, 0],
      [226, 190, 12, 0, 0],        // heading south
      [248, 150, 12, -0.06, 0],    // Ford-Kurve (left)
      [288, 138, 12, 0.08, 0],     // Dunlop hairpin (right)
      [312, 100, 12, 0.10, 0],
      [292, 62, 12, 0.08, 0],
      [250, 56, 12, 0.05, 0],
      [212, 30, 12, -0.06, 0],     // Schumacher-S (left)
      [222, -14, 12, 0.06, 0],     // (right)
      [262, -46, 12, 0.05, 0],     // Bit-Kurve
      [284, -96, 13, 0.06, 0],     // heading south
      [272, -150, 12, 0.08, 0],    // Veedol chicane
      [286, -178, 11, 0, 0],
      [266, -206, 11, 0, 0],
      [240, -230, 12, 0.10, 0],    // Coca-Cola hairpin (right)
      [192, -238, 13, 0.06, 0],
      [120, -228, 14, 0, 0],       // stadium straight heading west
      [50, -200, 13, 0.06, 0],     // (right)
      [12, -150, 13, 0.06, 0],
      [2, -80, 14, 0, 0],          // heading north to the line
    ],
    runoff: 11, sectors: [0.34, 0.67],
    drs: [[0.0, 0.08], [0.70, 0.10]], gravel: [[0.10, 0.03], [0.40, 0.04]],
  },
};

/* ===========================================================================
   TRACK — builds curve, samples, meshes, nearest-point, racing line, walls
   =========================================================================== */

class Track {
  constructor(id, scene, quality, weather = 'dry') {
    const def = TRACK_DEFS[id];
    this.id = id; this.def = def; this.name = def.name; this.country = def.country;
    this.runoff = def.runoff;

    const cps = def.pts.map((p) => new THREE.Vector3(p[0] * 1, p[4] || 0, p[1] * 1));
    this.curve = new THREE.CatmullRomCurve3(cps, true, 'catmullrom', 0.5);

    // per-control auxiliary (width, banking) interpolated by parameter
    this._auxW = def.pts.map((p) => p[2]);
    this._auxB = def.pts.map((p) => p[3]);

    const N = Math.max(360, Math.round(this.curve.getLength() / 4));
    this.N = N;
    this.samples = [];
    let dist = 0;
    let prev = null;
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const pos = this.curve.getPointAt(u);
      const tan = this.curve.getTangentAt(u).setY(0).normalize();
      const left = new THREE.Vector3(tan.z, 0, -tan.x); // +left of travel
      // interpolate width/banking around the loop
      const f = u * def.pts.length;
      const i0 = Math.floor(f) % def.pts.length;
      const i1 = (i0 + 1) % def.pts.length;
      const fr = f - Math.floor(f);
      const width = lerp(this._auxW[i0], this._auxW[i1], fr);
      const bank = lerp(this._auxB[i0], this._auxB[i1], fr);
      if (prev) dist += pos.distanceTo(prev);
      this.samples.push({ i, u, pos, tan, left, width, bank, y: pos.y, s: dist, curv: 0, tgt: 0 });
      prev = pos;
    }
    this.length = dist + this.samples[N - 1].pos.distanceTo(this.samples[0].pos);

    // per-sample runoff: shrink it where another part of the circuit comes close (chicanes, hairpins)
    // so the barrier line of one leg never crosses the other leg
    const stepLen = this.length / N;
    for (let i = 0; i < N; i++) {
      let dOther = Infinity;
      const a = this.samples[i];
      for (let j = 0; j < N; j++) {
        const dj = Math.abs(i - j); const arc = Math.min(dj, N - dj) * stepLen;
        if (arc < 24) continue;
        const b = this.samples[j];
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (arc < d * 2.5) continue;             // same stretch of road, not a fold-back
        if (d < dOther) dOther = d;
      }
      a.runoff = clamp((dOther - a.width) / 2 - 1.5, 2.5, this.runoff);
    }
    // smooth the runoff so the barrier doesn't zig-zag
    for (let pass = 0; pass < 6; pass++) {
      const src = this.samples.map((s) => s.runoff);
      for (let i = 0; i < N; i++) this.samples[i].runoff = Math.min(src[i], (src[(i - 1 + N) % N] + src[i] + src[(i + 1) % N]) / 3);
    }

    // curvature (signed, + = left) & racing line & target speed
    for (let i = 0; i < N; i++) {
      const a = this.samples[(i - 2 + N) % N].tan;
      const b = this.samples[(i + 2) % N].tan;
      const cross = a.z * b.x - a.x * b.z;            // y of a×b
      const dot = clamp(a.dot(b), -1, 1);
      const ang = Math.acos(dot) * Math.sign(cross);
      const segLen = this.length / N * 4;
      this.samples[i].curv = ang / segLen;            // rad per metre
    }
    // racing-line lateral offset: pull toward the inside of the bend, then smooth
    let off = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const maxOff = this.samples[i].width * 0.5 - 1.6;
      off[i] = clamp(this.samples[i].curv * 950, -maxOff, maxOff);
    }
    for (let pass = 0; pass < 18; pass++) {
      const src = off.slice();
      for (let i = 0; i < N; i++) {
        off[i] = (src[(i - 1 + N) % N] + src[i] * 1.4 + src[(i + 1) % N]) / 3.4;
      }
    }
    this.racing = [];
    for (let i = 0; i < N; i++) {
      const sm = this.samples[i];
      this.racing.push(sm.pos.clone().addScaledVector(sm.left, off[i]));
    }
    // target speed from curvature + backward braking pass
    const latAccel = 15.5, brakeDecel = 15.0, vMax = 105, vMin = 12;
    for (let i = 0; i < N; i++) {
      const k = Math.max(Math.abs(this.samples[i].curv), 1e-4);
      this.samples[i].tgt = clamp(Math.sqrt(latAccel / k), vMin, vMax);
    }
    for (let pass = 0; pass < 4; pass++) {
      for (let j = 0; j < N; j++) {
        const i = (N - 1 - j + N) % N;
        const nx = this.samples[(i + 1) % N];
        const segLen = this.length / N;
        const cap = Math.sqrt(nx.tgt * nx.tgt + 2 * brakeDecel * segLen);
        if (this.samples[i].tgt > cap) this.samples[i].tgt = cap;
      }
    }

    this.tvCams = [];
    for (let k = 0; k < 10; k++) {
      const sm = this.samples[Math.floor((k / 10) * N + N * 0.05) % N];
      const side = k % 3 === 0 ? 1 : -1;
      this.tvCams.push(sm.pos.clone().addScaledVector(sm.left, side * (sm.width * 0.5 + this.runoff + 2.6)).setY(sm.y + 8.5));
    }

    this.sectorS = (def.sectors || [0.33, 0.66]).map((f) => f * this.length);
    this.drs = def.drs || [];
    this.gravel = def.gravel || [];

    this.world = buildWorld(this, scene, quality, weather);
    this.roadMesh = this.world.roadMesh;
    this._hintReset();
  }

  _hintReset() { this._lastHint = 0; }

  /* nearest sample to a world XZ, using a windowed search around a hint */
  sample(x, z, hint) {
    const N = this.N; const S = this.samples;
    let best = -1, bd = Infinity;
    const h = (hint == null ? this._lastHint : hint);
    for (let d = -22; d <= 22; d++) {
      const i = (h + d + N) % N;
      const dx = S[i].pos.x - x, dz = S[i].pos.z - z;
      const dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = i; }
    }
    if (bd > (S[best].width * 3) ** 2) { // lost — full scan
      for (let i = 0; i < N; i++) {
        const dx = S[i].pos.x - x, dz = S[i].pos.z - z;
        const dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; best = i; }
      }
    }
    this._lastHint = best;
    const sm = S[best];
    const dx = x - sm.pos.x, dz = z - sm.pos.z;
    const lateral = dx * sm.left.x + dz * sm.left.z;   // + = left
    // height: interpolate along the track between neighbouring samples (matches the road mesh),
    // otherwise a car on a 10° climb would step up 30 cm every sample
    const along = dx * sm.tan.x + dz * sm.tan.z;
    const nb = along >= 0 ? S[(best + 1) % N] : S[(best - 1 + N) % N];
    const seg = Math.max(0.1, sm.pos.distanceTo(nb.pos));
    const grade = (nb.y - sm.y) / seg;
    return {
      i: best, s: sm.s, lateral, width: sm.width, curv: sm.curv, tgt: sm.tgt,
      groundY: sm.y + grade * Math.abs(along) + Math.sin(sm.bank) * clamp(lateral, -sm.width * 0.5, sm.width * 0.5),
      leftX: sm.left.x, leftZ: sm.left.z, tanYaw: Math.atan2(sm.tan.x, sm.tan.z),
      bank: sm.bank,
    };
  }

  surfaceAt(g) {
    const halfRoad = g.width * 0.5;
    const aL = Math.abs(g.lateral);
    if (aL <= halfRoad - 0.15) return { grip: 1.0, drag: 0, kind: 'tarmac' };
    if (aL <= halfRoad + 1.3) return { grip: 0.95, drag: 0.4, kind: 'curb', bump: 1 };
    // off track — grass, or gravel if this s-range is a trap
    const sf = g.s / this.length;
    for (const [a, len] of this.gravel) {
      const end = (a + len) % 1;
      const inRange = a < end ? (sf >= a && sf <= end) : (sf >= a || sf <= end);
      if (inRange) return { grip: 0.6, drag: 5.0, kind: 'gravel' };
    }
    return { grip: 0.48, drag: 2.5, kind: 'grass' };
  }

  runoffAt(g) { return this.samples[g.i].runoff ?? this.runoff; }

  inDRS(sNorm, gapAhead) {
    if (!this.drs.length) return false;
    for (const [a, len] of this.drs) {
      const end = (a + len) % 1;
      const inR = a < end ? (sNorm >= a && sNorm <= end) : (sNorm >= a || sNorm <= end);
      if (inR && gapAhead != null && gapAhead < 22) return true;
    }
    return false;
  }

  racingAhead(i, metres) {
    const step = this.length / this.N;
    const adv = Math.max(1, Math.round(metres / step));
    return this.racing[(i + adv) % this.N];
  }
  targetAhead(i, metres) {
    const step = this.length / this.N;
    const adv = Math.max(1, Math.round(metres / step));
    return this.samples[(i + adv) % this.N].tgt;
  }

  gridSlot(k) {
    // k = 0 pole. Two-wide staggered grid, rows ~11 m apart so cars never overlap.
    const row = Math.floor(k / 2);
    const back = 14 + row * 11;
    const step = this.length / this.N;
    const idx = (this.N - Math.round(back / step) + this.N * 4) % this.N;
    const sm = this.samples[idx];
    const side = (k % 2 === 0 ? 1 : -1);
    const lat = side * Math.min(sm.width * 0.28, 3.4);
    const pos = sm.pos.clone().addScaledVector(sm.left, lat);
    return { pos, yaw: Math.atan2(sm.tan.x, sm.tan.z), i: idx };
  }
}

/* ===========================================================================
   VEHICLE — the physics
   =========================================================================== */

function tyreCurve(slipAngle, t) {
  const a = Math.abs(slipAngle);
  const p = t.peakSlip;
  if (a <= p) { const x = a / p; return t.muPeak * x * (2 - x); }
  return Math.max(t.muMin, t.muPeak - (a - p) * t.muPeak * t.falloff * 3);
}
function torqueCurve(rpm, c) {
  const span = c.redline - c.idleRPM;
  const x = (rpm - c.peakRPM) / span;
  return c.maxTorque * Math.max(0.18, 1 - x * x * 0.85);
}

class Vehicle {
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.isPlayer = !!opts.isPlayer;
    this.assist = opts.assist !== false;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.vx = 0; this.vy = 0; this.yawRate = 0;
    this.gear = 0; this.rpm = cfg.idleRPM;
    this._ax = 0; this._shiftT = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.steerActual = 0; this.thrActual = 0; this.brkActual = 0; this.reversing = false;
    this.pitch = 0; this.roll = 0;
    this.slip = 0; this.wheelSpin = 0; this.lastImpact = 0;
    this.tyre = 1; this.fuel = 1; this.tyreWearRate = 0.00002; this.fuelRate = 0.00003; // ~10-25 min stints
    this.offTrack = 0; this.stopped = 0;
    this._hint = 0;
    this.dead = false;
  }

  placeAt(track, slot) {
    this.pos.copy(slot.pos); this.pos.y = track.samples[slot.i].y;
    this.yaw = slot.yaw;
    this.vx = this.vy = this.yawRate = 0; this.gear = 0; this.rpm = this.cfg.idleRPM;
    this._hint = slot.i; this._ax = 0; this.offTrack = 0; this.stopped = 0;
  }

  setInput(i) { Object.assign(this.input, i); }

  get speed() { return Math.hypot(this.vx, this.vy); }
  worldVel() {
    return new THREE.Vector3(
      Math.sin(this.yaw) * this.vx + Math.cos(this.yaw) * this.vy, 0,
      Math.cos(this.yaw) * this.vx - Math.sin(this.yaw) * this.vy);
  }

  step(dt, track, env) {
    const c = this.cfg;
    const inp = this.input;

    const speed = this.speed;

    // keyboard-friendly steering: ramp the lock in at a fixed rate, return to centre faster
    const winding = Math.abs(inp.steer) > Math.abs(this.steerActual) && (this.steerActual === 0 || Math.sign(inp.steer) === Math.sign(this.steerActual));
    const rate = (winding ? 2.6 : 7.0) * dt;
    this.steerActual += clamp(inp.steer - this.steerActual, -rate, rate);

    // progressive pedals for the keyboard player: a tap is a dab of brake / throttle, holding builds
    // to full over ~0.6 s (brake) / ~0.3 s (throttle). AI inputs are already continuous.
    let thr, brk;
    if (this.isPlayer) {
      thr = this.thrActual = clamp(this.thrActual + clamp(inp.throttle - this.thrActual, -9 * dt, 3.2 * dt), 0, 1);
      brk = this.brkActual = clamp(this.brkActual + clamp(inp.brake - this.brkActual, -9 * dt, 1.7 * dt), 0, 1);
      // reverse: holding the brake at a standstill backs the car up; the throttle then brakes you to a stop
      if (!this.reversing && env.racing && inp.brake > 0.5 && inp.throttle < 0.05 && this.vx < 0.5 && this.vx > -0.5) this.reversing = true;
      if (this.reversing && ((thr > 0.05 && Math.abs(this.vx) < 0.3) || this.vx > 1.5)) this.reversing = false;
    } else { thr = inp.throttle; brk = inp.brake; this.reversing = false; }
    const drivePedal = this.reversing ? brk : thr;
    const g = track.sample(this.pos.x, this.pos.z, this._hint);
    this._hint = g.i;
    const surf = track.surfaceAt(g);
    const wornGrip = 1 - (1 - this.tyre) * 0.16;
    const gripMul = surf.grip * env.gripMul * wornGrip;

    // curb bump
    if (surf.bump && speed > 4 && Math.random() < 0.3) { this.pitch += (Math.random() - 0.5) * 0.012; this.roll += (Math.random() - 0.5) * 0.012; }

    // weight / loads
    const aeroDown = c.aeroDown * speed * speed;
    const W = c.mass * 9.81 + aeroDown;
    const dT = clamp(c.mass * this._ax * c.cgH / (c.a + c.b), -0.42 * W, 0.42 * W);
    const Nf = Math.max(0, c.frontBias * W - dT);
    const Nr = Math.max(0, (1 - c.frontBias) * W + dT);

    // steering angle: with assist, full lock is capped near the angle the tyres can actually use at this speed
    const vv = Math.max(4, speed);
    const gripSteer = Math.atan((c.a + c.b) * 13.5 / (vv * vv)) * 1.35;
    const maxSteer = this.assist ? Math.min(c.maxSteer, gripSteer) : c.maxSteer;
    this.maxSteerNow = maxSteer;
    const steerAng = this.steerActual * maxSteer;

    // slip angles
    const vAbs = Math.max(2.5, Math.abs(this.vx));
    const dir = this.vx >= 0 ? 1 : -1;
    const saF = Math.atan2(this.vy + this.yawRate * c.a, vAbs) - steerAng * dir;
    const saR = Math.atan2(this.vy - this.yawRate * c.b, vAbs);
    this.slip = clamp((Math.abs(saF) + Math.abs(saR)) * 0.5 / c.tyre.peakSlip - 0.7, 0, 3);

    let FyF = -Math.sign(saF) * tyreCurve(saF, c.tyre) * Nf * gripMul;
    let FyR = -Math.sign(saR) * tyreCurve(saR, c.tyre) * Nr * gripMul;
    const fade = smoothstep(0.4, 3.5, speed);
    FyF *= fade; FyR *= fade;

    // powertrain
    this._shiftT -= dt;
    const wheelRPM = Math.abs(this.vx) / c.rWheel * 60 / TAU;
    let target = wheelRPM * c.final * c.gears[this.gear];
    this.rpm = clamp(lerp(this.rpm, Math.max(target, c.idleRPM), 0.3), c.idleRPM, c.redline);
    if (this._shiftT <= 0) {
      if (this.rpm > c.redline * 0.93 && this.gear < c.gears.length - 1) { this.gear++; this._shiftT = 0.18; }
      else if (this.rpm < c.redline * 0.44 && this.gear > 0) { this.gear--; this._shiftT = 0.18; }
    }
    const torque = torqueCurve(this.rpm, c) * (this.fuel > 0 ? 1 : 0);
    let driveForce = (this.reversing ? -brk * 0.45 : thr) * torque * c.gears[this.gear] * c.final * c.driveEff / c.rWheel;
    if (speed < 3 && drivePedal > 0.05) driveForce += (this.reversing ? -900 : 1500) * drivePedal * (1 - speed / 3); // launch/creep
    if (this.reversing && this.vx < -7) driveForce = Math.max(driveForce, 0);                              // reverse tops out ~25 km/h
    if (this._shiftT > 0.12) driveForce *= 0.25;                                  // shift cut

    let brakeF = (this.reversing ? thr : brk) * c.brakeForce;
    if (inp.handbrake) { FyR *= 0.35; brakeF += c.brakeForce * 0.45; }

    // longitudinal traction limit at the driven (rear) axle — excess spins the tyres
    const rearGrip = Nr * gripMul * c.tyre.muPeak;
    // traction control (always on for keyboard play): keep enough of the friction circle for cornering
    const tractionCap = rearGrip * (this.assist ? 0.70 : 0.92);
    this.wheelSlip = 0;
    if (Math.abs(driveForce) > tractionCap) { this.wheelSlip = clamp((Math.abs(driveForce) - tractionCap) / (tractionCap + 1), 0, 2); driveForce = Math.sign(driveForce) * tractionCap * (1 + Math.min(this.wheelSlip, 1) * 0.05); }
    // stability control: back off the power when the rear starts to step out
    if (this.assist && Math.abs(saR) > c.tyre.peakSlip * 1.15) driveForce *= clamp(1 - (Math.abs(saR) / c.tyre.peakSlip - 1.15) * 1.6, 0.25, 1);

    const drag = (c.dragCoef + (env.drsOpen ? 0 : c.aeroDrag)) * this.vx * Math.abs(this.vx);
    const roll = c.rollDrag * this.vx;
    // off-track surfaces really slow you down (grass ~2.5 m/s², gravel ~6 m/s²)
    const surfDecel = surf.drag * 0.8 * c.mass * Math.sign(this.vx) * smoothstep(0.5, 4, speed);
    let Fx = driveForce - Math.sign(this.vx) * brakeF - drag - roll - surfDecel;
    if (Math.abs(this.vx) < 0.4 && drivePedal < 0.05) Fx = -this.vx * c.mass / dt * 0.6; // hold still

    // friction circle — rear
    const usedR = Math.abs(driveForce - Math.sign(this.vx) * brakeF * 0.55);
    const FyRmax = Math.sqrt(Math.max(0, rearGrip * rearGrip - usedR * usedR));
    FyR = clamp(FyR, -FyRmax, FyRmax);
    const frontGrip = Nf * gripMul * c.tyre.muPeak;
    const usedF = Math.abs(brakeF * 0.45);
    const FyFmax = Math.sqrt(Math.max(0, frontGrip * frontGrip - usedF * usedF));
    FyF = clamp(FyF, -FyFmax, FyFmax);

    // banking (lateral gravity component — banked corner helps you turn)
    const bankForce = -Math.sin(g.bank) * W * 0.32;

    const Fy = FyF + FyR + bankForce;
    const ax = Fx / c.mass;
    const ay = Fy / c.mass - this.yawRate * this.vx;
    this.vx += ax * dt;
    this.vy += ay * dt;

    const Mz = FyF * c.a - FyR * c.b;
    this.yawRate += (Mz / c.inertia) * dt;
    this.yawRate *= inp.handbrake ? 0.997 : 0.991;
    if (speed < 2.2) { this.vy *= 0.82; this.yawRate *= 0.85; }
    this.yaw += this.yawRate * dt;

    // integrate world position
    const wv = this.worldVel();
    this.pos.x += wv.x * dt;
    this.pos.z += wv.z * dt;

    // wall collision
    const g2 = track.sample(this.pos.x, this.pos.z, this._hint);
    this._hint = g2.i;
    const half = g2.width * 0.5 + track.runoffAt(g2);
    const carR = 1.5;
    if (Math.abs(g2.lateral) > half - carR) {
      const sgn = Math.sign(g2.lateral);
      const fix = (half - carR) * sgn - g2.lateral;
      this.pos.x += g2.leftX * fix; this.pos.z += g2.leftZ * fix;
      const nx = g2.leftX * sgn, nz = g2.leftZ * sgn;
      const wv2 = this.worldVel();
      const vn = wv2.x * nx + wv2.z * nz;
      if (vn > 0) {
        // impact: kill the into-wall component, lose speed in proportion to how hard we hit
        const hit = clamp(vn / 20, 0, 1);
        wv2.x -= vn * nx * 1.15; wv2.z -= vn * nz * 1.15;
        const scrub = 1 - 0.4 * hit;
        wv2.x *= scrub; wv2.z *= scrub;
        this.lastImpact = Math.max(this.lastImpact, hit);
        this.yawRate *= 0.5;
      }
      // grinding along the barrier: mild friction, and ease the nose parallel so you can drive off it
      wv2.x *= 0.997; wv2.z *= 0.997;
      let dYaw = g2.tanYaw - this.yaw; dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
      if (Math.abs(dYaw) > Math.PI / 2) dYaw = dYaw - Math.PI * Math.sign(dYaw);
      this.yaw += dYaw * 0.03;
      this.vx = wv2.x * Math.sin(this.yaw) + wv2.z * Math.cos(this.yaw);
      this.vy = wv2.x * Math.cos(this.yaw) - wv2.z * Math.sin(this.yaw);
    }

    // ground height follow: road surface incl. banking, +3 cm of tarmac, kerbs a touch higher
    const g3 = track.sample(this.pos.x, this.pos.z, this._hint);
    const gY = g3.groundY + (surf.kind === 'curb' ? 0.06 : surf.kind === 'tarmac' ? 0.03 : 0);
    this.pos.y = gY;   // exact: any smoothing here lags on Spa's climbs and buries the tyres

    // road gradient & banking under the car -> the body follows the road (no more nose in the hill)
    const N = track.N, sA = track.samples[(g3.i - 2 + N) % N], sB = track.samples[(g3.i + 2) % N];
    const grade = (sB.y - sA.y) / Math.max(1, sA.pos.distanceTo(sB.pos));
    const dYaw = this.yaw - g3.tanYaw;
    const onRoad = 1 - smoothstep(g3.width * 0.5 + 1.6, g3.width * 0.5 + 6, Math.abs(g3.lateral));
    this.slopePitch = lerp(this.slopePitch || 0, -Math.atan(grade) * Math.cos(dYaw) - g3.bank * Math.sin(dYaw) * onRoad, clamp(dt * 25, 0, 1));
    // local +x is the car's LEFT (see worldVel); bank>0 raises the left edge, so roll +x up
    this.bankRoll = lerp(this.bankRoll || 0, g3.bank * Math.cos(dYaw) * onRoad, clamp(dt * 25, 0, 1));

    // dynamic attitude: gentle dive / squat / lean (rotates about the chassis pivot, see CarFactory)
    this.pitch = lerp(this.pitch, clamp(-this._ax * 0.0035, -0.03, 0.03), clamp(dt * 6, 0, 1));
    this.roll = lerp(this.roll, clamp(this.yawRate * this.vx * 0.0025, -0.06, 0.06), clamp(dt * 6, 0, 1));
    this._ax = ax;
    this.wheelSpin = (this.wheelSlip || 0) + this.slip * 0.5;

    // wear / fuel
    const wear = (this.slip * 0.5 + 0.4) * this.tyreWearRate * env.wearScale * dt * 60;
    this.tyre = clamp(this.tyre - wear, 0.2, 1);
    this.fuel = clamp(this.fuel - drivePedal * this.fuelRate * env.fuelScale * dt * 60, 0, 1);

    // off-track / stopped bookkeeping
    if (surf.kind === 'grass' || surf.kind === 'gravel') this.offTrack += dt; else this.offTrack = Math.max(0, this.offTrack - dt * 2);
    this.stopped = speed < 4 ? this.stopped + dt : 0;

    // progress along track (for standings) 0..1
    this.trackS = g2.s / track.length;

    if (!isFinite(this.pos.x) || !isFinite(this.pos.z)) this.dead = true;
  }
}

/* ===========================================================================
   AI CONTROLLER
   =========================================================================== */

class AI {
  constructor(vehicle, diffKey) {
    this.v = vehicle;
    this.d = DIFF[diffKey] || DIFF.medium;
    this.mistakeT = 0;
    this.offset = 0;
  }
  update(dt, track, cars, flags) {
    const v = this.v;
    const g = track.sample(v.pos.x, v.pos.z, v._hint);
    const speed = v.speed;

    // find a car close ahead to react to
    let carAhead = null, gapAhead = 999, carBehind = null, gapBehind = 999;
    for (const o of cars) {
      if (o === v) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const fwd = dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw);
      const side = dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw);
      const dist = Math.hypot(dx, dz);
      if (fwd > 0 && dist < 30 && Math.abs(side) < 6 && dist < gapAhead) { carAhead = o; gapAhead = dist; }
      if (fwd < 0 && dist < 16 && Math.abs(side) < 5 && dist < gapBehind) { carBehind = o; gapBehind = dist; }
    }

    // lateral offset target: racing line, plus overtake / defend nudges
    let wantOffset = 0;
    if (carAhead && carAhead.speed < speed - 1.5) {
      wantOffset = (this._passSide ||= (Math.random() < 0.5 ? -1 : 1)) * this.d.aggr * 4.2;
    } else { this._passSide = 0; }
    if (carBehind && this.d.defend > 0.3) {
      const bside = (carBehind.pos.x - v.pos.x) * Math.cos(v.yaw) - (carBehind.pos.z - v.pos.z) * Math.sin(v.yaw);
      wantOffset += (bside > 0 ? -1 : 1) * this.d.defend * 2.4;
    }
    this.offset = lerp(this.offset, wantOffset, clamp(dt * 2.5, 0, 1));

    // steering — pure pursuit to a point on the racing line ahead
    const look = 7 + speed * 0.42;
    const aim = track.racingAhead(g.i, look).clone();
    const smAim = track.samples[(g.i + Math.round(look / (track.length / track.N))) % track.N];
    aim.addScaledVector(smAim.left, this.offset);
    const dx = aim.x - v.pos.x, dz = aim.z - v.pos.z;
    const localRight = dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw);
    const localFwd = dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw);
    let steer = clamp(Math.atan2(localRight, Math.max(2, localFwd)) / (v.maxSteerNow || v.cfg.maxSteer) * 1.15, -1, 1);

    // speed control
    let tgt = track.targetAhead(g.i, 6 + speed * (2.6)) * this.d.pace;
    if (flags.yellowActive && flags.yellowNear(g.s)) tgt *= 0.72;
    if (Math.abs(g.lateral) > g.width * 0.5 + 1.2) tgt = Math.min(tgt, 14); // off track: slow down and rejoin
    if (carAhead && gapAhead < 9 && carAhead.speed < speed) tgt = Math.min(tgt, carAhead.speed + 1.5);
    if (v.fuel <= 0) tgt = 0;

    let throttle = 0, brake = 0;
    if (speed > tgt + 0.6) brake = clamp((speed - tgt) / 7, 0, 1);
    else throttle = clamp((tgt - speed) / 5 + 0.35, 0, 1);
    if (v.tyre < 0.4) throttle *= 0.9;

    // mistakes
    if (this.mistakeT <= 0 && Math.random() < this.d.mistake * dt) this.mistakeT = 0.25 + Math.random() * 0.6;
    if (this.mistakeT > 0) { this.mistakeT -= dt; steer += (Math.random() - 0.5) * 0.45; throttle *= 0.55; brake *= 0.7; }

    v.setInput({ throttle, brake, steer, handbrake: false });
  }
}

/* ===========================================================================
   AUDIO (procedural)
   =========================================================================== */

class Audio {
  // Sound is OFF unless the player explicitly turns it on (Settings, or the M key).
  constructor() {
    this.ok = false; this.master = 0.7;
    let m = true; try { m = JSON.parse(localStorage.getItem('srs.sound') || 'false') !== true; } catch {}
    this.muted = m;
  }
  _applyGain() { if (this.mGain) this.mGain.gain.value = this.muted ? 0 : this.master; }
  setMuted(v) {
    this.muted = !!v;
    try { localStorage.setItem('srs.sound', JSON.stringify(!this.muted)); } catch {}
    this._applyGain();
    if (this.muted) this.silence();
  }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }
  ensure() {
    if (this.ctx) return;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      const m = this.ctx.createGain(); m.gain.value = this.muted ? 0 : this.master; m.connect(this.ctx.destination); this.mGain = m;

      // engine
      this.eng = this.ctx.createOscillator(); this.eng.type = 'sawtooth';
      this.eng2 = this.ctx.createOscillator(); this.eng2.type = 'square';
      this.engGain = this.ctx.createGain(); this.engGain.gain.value = 0;
      this.engFilter = this.ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 1600;
      this.eng.connect(this.engFilter); this.eng2.connect(this.engFilter);
      this.engFilter.connect(this.engGain); this.engGain.connect(m);
      this.eng.start(); this.eng2.start();

      // tyre screech (noise -> bandpass)
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const dat = buf.getChannelData(0);
      for (let i = 0; i < dat.length; i++) dat[i] = Math.random() * 2 - 1;
      this.noise = this.ctx.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true;
      this.screechF = this.ctx.createBiquadFilter(); this.screechF.type = 'bandpass'; this.screechF.frequency.value = 1400; this.screechF.Q.value = 6;
      this.screechG = this.ctx.createGain(); this.screechG.gain.value = 0;
      this.noise.connect(this.screechF); this.screechF.connect(this.screechG); this.screechG.connect(m);
      // wind
      this.windF = this.ctx.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 500;
      this.windG = this.ctx.createGain(); this.windG.gain.value = 0;
      this.noise.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(m);
      this.noise.start();
      this.ok = true;
    } catch (e) { showErr('audio: ' + e.message); }
  }
  setMaster(v) { this.master = v; this._applyGain(); }
  /** Fade the continuous loops (engine / tyre / wind) to silence — call when leaving the track. */
  silence() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(0, t, 0.06);
    this.screechG.gain.setTargetAtTime(0, t, 0.06);
    this.windG.gain.setTargetAtTime(0, t, 0.06);
  }
  update(car, dt) {
    if (!this.ok) return;
    const c = car.cfg;
    const rpmN = (car.rpm - c.idleRPM) / (c.redline - c.idleRPM);
    const f = 42 + rpmN * (c.redline > 10000 ? 240 : 150);
    this.eng.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.03);
    this.eng2.frequency.setTargetAtTime(f * 0.5, this.ctx.currentTime, 0.03);
    this.engFilter.frequency.setTargetAtTime(700 + rpmN * 5200, this.ctx.currentTime, 0.05);
    const load = 0.05 + car.input.throttle * 0.22 + rpmN * 0.08;
    this.engGain.gain.setTargetAtTime(load, this.ctx.currentTime, 0.05);
    const scr = clamp((car.wheelSpin - 0.3) * 0.35, 0, 0.4);
    this.screechG.gain.setTargetAtTime(scr, this.ctx.currentTime, 0.04);
    this.windG.gain.setTargetAtTime(clamp(car.speed / 90 * 0.09, 0, 0.09), this.ctx.currentTime, 0.1);
  }
  impact(mag) {
    if (!this.ok || mag < 0.05) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 90 + Math.random() * 40;
    const g = this.ctx.createGain(); g.gain.value = clamp(mag, 0, 1) * 0.5;
    o.connect(g); g.connect(this.mGain);
    g.gain.setTargetAtTime(0, t, 0.08); o.start(t); o.stop(t + 0.25);
  }
  beep(freq, dur = 0.12, vol = 0.25) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = vol;
    o.connect(g); g.connect(this.mGain);
    g.gain.setTargetAtTime(0, t + dur * 0.5, 0.05); o.start(t); o.stop(t + dur);
  }
}


/* ===========================================================================
   CAMERA RIG
   =========================================================================== */

const CAM_MODES = ['chase', 'cockpit', 'hood', 'tv', 'free'];
class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3(0, 5, -10);
    this.tvIndex = 0; this.tvHold = 0;
    this.free = { pos: new THREE.Vector3(0, 30, 40), yaw: 0, pitch: -0.4 };
  }
  setMode(m) { this.mode = m; }
  cycle() { this.mode = CAM_MODES[(CAM_MODES.indexOf(this.mode) + 1) % CAM_MODES.length]; return this.label(); }
  label() { return { chase: 'Chase', cockpit: 'Cockpit', hood: 'Hood', tv: 'TV Broadcast', free: 'Trackside' }[this.mode]; }

  update(dt, target, track, freeInput) {
    const car = target;
    const fwd = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    const up = new THREE.Vector3(0, 1, 0);
    const speed = car.speed;

    if (this.mode === 'cockpit') {
      const eyeL = car.mesh?.userData.eye || new THREE.Vector3(0, 1.0, 0.1);
      const p = eyeL.clone(); if (car.mesh) (car.mesh.userData.inner || car.mesh).localToWorld(p); else p.add(car.pos);
      // head motion: engine vibration + speed buzz, g-force lean
      this._t = (this._t || 0) + dt;
      const rpmN = car.cfg ? (car.rpm - car.cfg.idleRPM) / (car.cfg.redline - car.cfg.idleRPM) : 0;
      const vib = 0.0025 * rpmN + 0.0015 * clamp(speed / 60, 0, 1);
      p.y += Math.sin(this._t * 91) * vib; p.x += Math.sin(this._t * 67) * vib * 0.6;
      this.cam.position.copy(p);
      const look = p.clone().addScaledVector(fwd, 40).addScaledVector(up, -0.35 - car._ax * 0.05);
      const rightv = new THREE.Vector3(Math.cos(car.yaw), 0, -Math.sin(car.yaw));
      look.addScaledVector(rightv, car.yawRate * car.vx * 0.12);
      this.cam.up.set(0, 1, 0);
      this.cam.lookAt(look);
      this.cam.rotateZ(-car.roll * 0.5);
      this.cam.fov = 70;
    } else if (this.mode === 'hood') {
      const p = car.pos.clone().addScaledVector(fwd, car.mesh?.userData.kind === 'f1' ? 1.2 : 1.9).addScaledVector(up, car.mesh?.userData.kind === 'f1' ? 0.55 : 1.0);
      this.cam.position.copy(p);
      this.cam.lookAt(car.pos.clone().addScaledVector(fwd, 40).addScaledVector(up, 0.8));
      this.cam.fov = 72;
    } else if (this.mode === 'chase') {
      const desired = car.pos.clone().addScaledVector(fwd, -7.6).addScaledVector(up, 3.1);
      this.pos.lerp(desired, clamp(dt * 6, 0, 1));
      this.cam.position.copy(this.pos);
      this.cam.lookAt(car.pos.clone().addScaledVector(fwd, 9).addScaledVector(up, 1.1));
      this.cam.fov = 66;
    } else if (this.mode === 'tv') {
      this.tvHold -= dt;
      let best = this.tvIndex, bd = Infinity;
      for (let k = 0; k < track.tvCams.length; k++) {
        const d = track.tvCams[k].distanceTo(car.pos);
        if (d < bd) { bd = d; best = k; }
      }
      const curD = track.tvCams[this.tvIndex].distanceTo(car.pos);
      if ((this.tvHold <= 0 && best !== this.tvIndex && bd < curD - 30) || curD > 240) {
        this.tvIndex = best; this.tvHold = 1.4;
      }
      this.cam.position.copy(track.tvCams[this.tvIndex]);
      this.cam.lookAt(car.pos);
      this.cam.fov = clamp(14 + track.tvCams[this.tvIndex].distanceTo(car.pos) * 0.16, 18, 55);
    } else if (this.mode === 'free') {
      const f = this.free;
      if (freeInput) {
        f.yaw -= freeInput.x * dt * 1.6; f.pitch = clamp(f.pitch - freeInput.y * dt * 1.2, -1.4, 0.6);
        const dir = new THREE.Vector3(Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), Math.cos(f.yaw) * Math.cos(f.pitch));
        f.pos.addScaledVector(dir, freeInput.fwd * dt * 40);
        const rightv = new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
        f.pos.addScaledVector(rightv, freeInput.strafe * dt * 40);
        f.pos.y += freeInput.up * dt * 30;
      }
      this.cam.position.copy(f.pos);
      const dir = new THREE.Vector3(Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), Math.cos(f.yaw) * Math.cos(f.pitch));
      this.cam.lookAt(f.pos.clone().add(dir));
      this.cam.fov = 60;
    }
    this.cam.updateProjectionMatrix();
  }
}

/* ===========================================================================
   PERSISTENCE — localStorage for guests, REST for logged-in students
   =========================================================================== */

const API_BASE = (location.protocol.startsWith('http')) ? '' : null; // null => offline (file://)

const Store = {
  profile: null,   // { classCode, name, livery, career, bestLaps }
  local: {
    get(k, d) { try { const v = localStorage.getItem('srs.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('srs.' + k, JSON.stringify(v)); } catch {} },
  },
  loggedIn() { return !!this.profile; },

  async api(path, opts) {
    if (API_BASE == null) throw new Error('offline');
    const r = await fetch(API_BASE + path, {
      headers: { 'content-type': 'application/json' }, ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  },

  async login(code, name) {
    const j = await this.api('/api/login', { method: 'POST', body: JSON.stringify({ code, name }) });
    this.profile = j.profile;
    this.local.set('session', { code, name });
    return this.profile;
  },
  logout() { this.profile = null; this.local.set('session', null); },
  async tryResume() {
    const s = this.local.get('session', null);
    if (s && API_BASE != null) { try { await this.login(s.code, s.name); } catch {} }
  },

  livery() {
    if (this.profile?.livery) return this.profile.livery;
    return this.local.get('livery', { base: '#d21f3c', accent: '#ffffff', pattern: 'stripe', number: 7 });
  },
  async saveLivery(liv) {
    this.local.set('livery', liv);
    if (this.profile) {
      try {
        const j = await this.api('/api/profile', { method: 'PUT', body: JSON.stringify({ code: this.profile.classCode, name: this.profile.name, livery: liv }) });
        this.profile = j.profile;
      } catch (e) { showErr('save livery: ' + e.message); }
    }
  },

  bestLap(track, mode) {
    if (this.profile?.bestLaps) { const v = this.profile.bestLaps[`${track}:${mode}`]; if (v) return v; }
    const l = this.local.get('bestlaps', {});
    return l[`${track}:${mode}`] || null;
  },
  async submitLap(track, mode, weather, ms) {
    const key = `${track}:${mode}`;
    const l = this.local.get('bestlaps', {});
    if (!l[key] || ms < l[key]) { l[key] = ms; this.local.set('bestlaps', l); }
    if (this.profile) {
      try {
        const j = await this.api('/api/lap', { method: 'POST', body: JSON.stringify({ code: this.profile.classCode, name: this.profile.name, track, mode, weather, ms }) });
        if (j.bestLaps) this.profile.bestLaps = j.bestLaps;
      } catch (e) { /* implausible or offline — keep local only */ }
    }
  },
  async leaderboard(track, mode) {
    try { const j = await this.api(`/api/leaderboard?track=${track}&mode=${mode}`); return j.leaderboard || []; }
    catch { return null; }
  },

  career() {
    if (this.profile?.career && Object.keys(this.profile.career).length) return this.profile.career;
    return this.local.get('career', {});
  },
  async saveCareer(car) {
    this.local.set('career', car);
    if (this.profile) {
      try { const j = await this.api('/api/profile', { method: 'PUT', body: JSON.stringify({ code: this.profile.classCode, name: this.profile.name, career: car }) }); this.profile = j.profile; }
      catch (e) {}
    }
  },

  ghost(track, mode) { return this.local.get(`ghost.${track}.${mode}`, null); },
  saveGhost(track, mode, frames) { this.local.set(`ghost.${track}.${mode}`, frames); },

  settings() {
    return this.local.get('settings', { vol: 70, cam: 'chase', units: 'kmh', qual: 'med', shadows: true, assist: true });
  },
  saveSettings(s) { this.local.set('settings', s); },
};

/* ===========================================================================
   NET — Socket.IO wrapper (lazy-loaded)
   =========================================================================== */

class Net {
  constructor() { this.socket = null; this.connected = false; this.handlers = {}; }
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  emit(...a) { this.socket?.emit(...a); }
  fire(ev, ...a) { (this.handlers[ev] || []).forEach((f) => f(...a)); }
  async connect() {
    if (this.socket) return this.connected;
    if (API_BASE == null) throw new Error('Multiplayer needs the hosted version (open the server URL, not the file).');
    const mod = await import('https://cdn.socket.io/4.7.5/socket.io.esm.min.js');
    this.socket = mod.io(location.origin, { transports: ['websocket', 'polling'] });
    this.socket.on('connect', () => { this.connected = true; this.fire('status', true); });
    this.socket.on('disconnect', () => { this.connected = false; this.fire('status', false); });
    for (const ev of ['room:state', 'room:host', 'race:countdown', 'race:green', 'race:standings', 'race:player-finished', 'race:finished', 'snap', 'flag:yellow', 'race:respawn', 'chat']) {
      this.socket.on(ev, (d) => this.fire(ev, d));
    }
    return new Promise((res) => { this.socket.on('connect', () => res(true)); setTimeout(() => res(this.connected), 4000); });
  }
}

/* ===========================================================================
   HUD
   =========================================================================== */

class HUD {
  constructor() {
    this.el = $('hud');
    this.mini = $('mini').getContext('2d');
    this.miniPath = null;
    this.toastT = 0;
  }
  show(v) { this.el.classList.toggle('hide', !v); }
  buildMini(track) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of track.samples) { minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x); minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z); }
    const w = 196, h = 132, pad = 12;
    const sx = (w - pad * 2) / Math.max(1, maxX - minX), sz = (h - pad * 2) / Math.max(1, maxZ - minZ);
    const sc = Math.min(sx, sz);
    this.miniMap = (p) => [pad + (p.x - minX) * sc, pad + (p.z - minZ) * sc];
    this.miniPath = track.samples.map((s) => this.miniMap(s.pos));
  }
  toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); this.toastT = 2.2; }
  tick(dt) { if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.remove('on'); } }

  update(g) {
    const s = g.settings, p = g.player, st = Store.settings();
    const units = st.units === 'mph' ? 2.23694 : 3.6;
    $('hudSpd').textContent = Math.round(p.speed * units);
    $('dash').querySelector('small').textContent = st.units === 'mph' ? ' mph' : ' km/h';
    $('hudGear').textContent = p.reversing ? 'R' : (p.gear === 0 && p.speed < 2 ? 'N' : (p.gear + 1));
    const rpmN = clamp((p.rpm - p.cfg.idleRPM) / (p.cfg.redline - p.cfg.idleRPM), 0, 1);
    $('hudRpm').style.width = (rpmN * 100) + '%';
    $('rpm').classList.toggle('red', rpmN > 0.93);

    $('hudLap').textContent = fmtTime(g.lapElapsed());
    $('hudLapNo').textContent = `${Math.min(p.lap + 1, s.laps)}/${s.laps}`;
    const best = g.bestLapMs;
    $('hudBest').textContent = 'Best ' + fmtTime(best);
    $('hudLast').textContent = 'Last ' + fmtTime(g.lastLapMs);
    const d = g.deltaToBest();
    const de = $('hudDelta');
    if (d == null) { de.textContent = '--'; de.className = 'delta'; }
    else { de.textContent = (d >= 0 ? '+' : '') + (d / 1000).toFixed(2); de.className = 'delta ' + (d < 0 ? 'p' : 'n'); }

    // standings
    const board = $('board');
    const ord = g.standings();
    board.innerHTML = ord.slice(0, 10).map((c, i) => {
      const gap = i === 0 ? 'Leader' : (c.gap != null ? (typeof c.gap === 'number' ? '+' + c.gap.toFixed(1) + 's' : c.gap) : '');
      return `<div class="r ${c.isPlayer ? 'me' : ''}"><span>${i + 1}</span><span class="n">${c.name}</span><span class="gap">${gap}</span></div>`;
    }).join('');
    $('hudPos').textContent = g.playerPos();
    $('hudPosOf').textContent = '/ ' + ord.length;

    // wear/fuel
    const showWear = s.mode === 'f1' || (s.mode === 'gt' && s.laps >= 5);
    $('wear').style.display = showWear ? 'block' : 'none';
    if (showWear) {
      $('hudTyre').style.width = (p.tyre * 100) + '%'; $('hudTyrePct').textContent = Math.round(p.tyre * 100) + '%';
      $('hudFuel').style.width = (p.fuel * 100) + '%'; $('hudFuelPct').textContent = Math.round(p.fuel * 100) + '%';
    }

    // flag
    const f = $('flag');
    f.className = 'panel';
    if (g.flag) { f.classList.add('on', g.flag.kind); f.textContent = g.flag.text; }
    else f.classList.remove('on');

    $('hudCam').textContent = g.rig.label();

    // minimap
    const ctx = this.mini; ctx.clearRect(0, 0, 196, 132);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.beginPath();
    this.miniPath.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]));
    ctx.closePath(); ctx.stroke();
    for (const c of g.allCars()) {
      const [x, y] = this.miniMap(c.pos);
      ctx.beginPath(); ctx.arc(x, y, c.isPlayer ? 3.5 : 2.4, 0, TAU);
      ctx.fillStyle = c.isPlayer ? '#38bdf8' : (c.retired ? '#555' : '#f59e0b'); ctx.fill();
    }
  }
}

/* ===========================================================================
   GAME — orchestration, race state, main loop
   =========================================================================== */

class Game {
  constructor() {
    this.view = $('view');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.6;
    this.view.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.15, 7000);
    CarFactory.preload();
    this.rig = new CameraRig(this.camera);
    this.audio = new Audio();
    this.hud = new HUD();
    this.net = new Net();

    this.running = false; this.paused = false;
    this.acc = 0; this.lastT = now();
    this.keys = {};
    this._bindKeys();
    addEventListener('resize', () => this._resize());
    this._resize();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  _bindKeys() {
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (this._typing()) return;
      if (k === 'c') { const l = this.rig.cycle(); this.hud.toast('Camera: ' + l); }
      if (k === 'r' && this.running) this._respawnPlayer();
      if (k === 'm') { this.audio.ensure(); const muted = this.audio.toggleMute(); this.hud.toast(muted ? 'Sound off' : 'Sound on'); }
      if ((k === 'escape' || k === 'p') && this.running) this.togglePause();
    });
    addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });
    addEventListener('blur', () => { this.keys = {}; this.audio.silence(); });
    document.addEventListener('visibilitychange', () => {
      if (!this.audio.ctx) return;
      if (document.hidden) { this.audio.silence(); this.audio.ctx.suspend?.(); }
      else if (this.running && !this.paused) this.audio.ctx.resume?.();
    });
  }
  _typing() { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA'); }

  playerInput() {
    if (!this.running || this.paused || this._typing() || UI.anyScreenOpen()) return { throttle: 0, brake: 0, steer: 0, handbrake: false };
    const K = this.keys;
    const thr = (K['arrowup'] || K['w']) ? 1 : 0;
    const brk = (K['arrowdown'] || K['s']) ? 1 : 0;
    let steer = 0;
    if (K['arrowleft'] || K['a']) steer += 1;   // + = left
    if (K['arrowright'] || K['d']) steer -= 1;
    return { throttle: thr, brake: brk, steer, handbrake: !!K[' '] };
  }
  freeCamInput() {
    const K = this.keys;
    return {
      x: (K['arrowleft'] || K['j'] ? -1 : 0) + (K['arrowright'] || K['l'] ? 1 : 0),
      y: (K['arrowup'] ? -1 : 0) + (K['arrowdown'] ? 1 : 0),
      fwd: (K['w'] ? 1 : 0) + (K['s'] ? -1 : 0),
      strafe: (K['a'] ? -1 : 0) + (K['d'] ? 1 : 0),
      up: (K['e'] || K[' '] ? 1 : 0) + (K['q'] ? -1 : 0),
    };
  }

  /* ---------- scene setup ---------- */
  _scene(trackId, weather, quality) {
    const scene = new THREE.Scene();
    const wet = weather === 'wet';
    const { sun, sunDir } = setupSky(scene, this.renderer, wet);
    sun.castShadow = quality !== 'low';
    if (quality !== 'high') sun.shadow.mapSize.set(1024, 1024);
    this.sun = sun; this.sunDir = sunDir;

    const track = new Track(trackId, scene, quality, weather);

    // rain
    this.rain = null;
    if (wet && quality !== 'low') {
      const cnt = 2600;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { pos[i * 3] = (Math.random() - 0.5) * 300; pos[i * 3 + 1] = Math.random() * 120; pos[i * 3 + 2] = (Math.random() - 0.5) * 300; }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0xaab6c2, size: 0.35, transparent: true, opacity: 0.5 });
      this.rain = new THREE.Points(geo, mat); scene.add(this.rain);
    }
    return { scene, track };
  }

  /* ---------- start a session ---------- */
  async start(sessionType, settings) {
    UI.hideAll();
    const st = Store.settings();
    const quality = st.qual === 'high' ? 'high' : st.qual === 'low' ? 'low' : 'med';
    this.renderer.shadowMap.enabled = !!st.shadows && quality !== 'low';

    this.sessionType = sessionType;
    this.settings = { laps: 3, aiCount: 0, aiDifficulty: 'medium', weather: 'dry', mode: 'gt', practice: false, ...settings };
    const modeCfg = MODES[this.settings.mode];
    const carId = modeCfg.cars.includes(this.settings.car) ? this.settings.car : modeCfg.cars[0];
    this.settings.car = carId;
    const carCfg = CARS[carId];
    $('boot').style.display = 'grid'; $('bootMsg').textContent = 'building ' + TRACK_DEFS[this.settings.trackId].name + '…';
    await Promise.race([CarFactory.preload(), new Promise((r) => setTimeout(r, 6000))]);
    await new Promise((r) => setTimeout(r, 30));
    const { scene, track } = this._scene(this.settings.trackId, this.settings.weather, quality);
    $('boot').style.display = 'none';
    this.scene = scene; this.track = track;
    this.hud.buildMini(track);
    this.env = {
      gripMul: this.settings.weather === 'wet' ? 0.74 : 1.0,
      drsOpen: false,
      wearScale: modeCfg.tyreWear * (this.settings.practice ? 0.2 : 1),
      fuelScale: modeCfg.fuel * (this.settings.practice ? 0 : 1),
    };

    // cars
    this.cars = [];
    this.player = new Vehicle(carCfg, { isPlayer: true, assist: st.assist });
    this.player.name = Store.profile?.name || 'You';
    this.player.isPlayer = true;
    this.player.livery = Store.livery();
    this.player.carId = carId;
    this.player.mesh = CarFactory.build(carId, this.player.livery, { compound: 'soft' });
    buildCockpit(this.player.mesh, this.renderer);
    scene.add(this.player.mesh);
    this.cars.push(this.player);

    const isTT = sessionType === 'tt';
    const aiN = isTT ? 0 : (this.settings.aiCount || 0);
    this.ais = [];
    for (let k = 0; k < aiN; k++) {
      // mixed grid in the sports classes so it looks like a real multi-class field
      const aiCar = modeCfg.cars.length > 1 ? modeCfg.cars[(k + 1) % modeCfg.cars.length] : carId;
      const v = new Vehicle(CARS[aiCar], { assist: true }); v.carId = aiCar;
      v.name = AI_NAMES[k % AI_NAMES.length];
      v.livery = { base: AI_COLORS[k % AI_COLORS.length], accent: '#ffffff', pattern: k % 2 ? 'stripe' : 'solid', number: k + 2 };
      v.mesh = CarFactory.build(aiCar, v.livery, { compound: ['soft', 'medium', 'hard'][k % 3] });
      scene.add(v.mesh);
      this.cars.push(v);
      this.ais.push(new AI(v, this.settings.aiDifficulty));
    }

    // grid — player starts at the back for quick race (more fun), pole in TT/career-first
    const gridCars = this.cars.slice();
    if (sessionType === 'quick') gridCars.reverse(); // player last -> starts at back
    gridCars.forEach((c, i) => c.placeAt(track, track.gridSlot(i)));

    // ghost
    this.ghost = null; this.ghostFrames = null; this.recFrames = [];
    if (isTT) {
      const gf = Store.ghost(this.settings.trackId, this.settings.mode);
      if (gf && gf.length) {
        this.ghostFrames = gf;
        this.ghost = CarFactory.build(carId, { base: '#7dd3fc', accent: '#0ea5e9', pattern: 'solid', number: 0 });
        this.ghost.traverse((m) => { if (m.isMesh && m.material) { const mats = Array.isArray(m.material) ? m.material : [m.material]; m.material = mats.map((mm) => { const c = mm.clone(); c.transparent = true; c.opacity = 0.38; c.depthWrite = false; return c; }); if (m.material.length === 1) m.material = m.material[0]; m.castShadow = false; } });
        scene.add(this.ghost);
      }
    }

    // race state
    this.raceState = 'countdown';
    this.countdown = this.settings.practice ? 1.2 : 4.2;
    this.raceClock = 0;
    this.flag = null; this.yellow = null; this._finTimer = 0; this._lastCount = null;
    this.finishOrder = [];
    for (const c of this.cars) {
      c.lap = 0; c.started = false; c.lastS = track.sample(c.pos.x, c.pos.z, c._hint).s;
      c.lapStart = 0; c.bestLap = null; c.lastLap = null; c.sector = 0; c.sectorT = [null, null, null];
      c.lapValid = true; c.offViol = 0; c.penalty = 0; c.retired = false; c.finished = false;
      c.raceProgress = -1 + c.lastS / track.length;
    }
    this.bestLapMs = Store.bestLap(this.settings.trackId, this.settings.mode);
    this.lastLapMs = null;
    this.startBest = this.bestLapMs;

    // MP
    this.mp = sessionType === 'mp' ? settings._mp : null;
    this.remoteCars = new Map(); // id -> {mesh, target, name}
    if (this.mp) this._wireMpRuntime();

    this.rig.setMode(st.cam || 'chase');
    if (sessionType === 'tt' || this.spectator) this.rig.setMode(st.cam === 'free' ? 'free' : (st.cam || 'chase'));
    this.hud.show(true);
    this.running = true; this.paused = false;
    this.acc = 0; this.lastT = now();
    this.audio.ensure(); this.audio.setMaster((st.vol ?? 70) / 100);
    UI.setEscVisible(true);
  }

  _respawnPlayer() {
    const g = this.track.sample(this.player.pos.x, this.player.pos.z, this.player._hint);
    const sm = this.track.samples[g.i];
    this.player.pos.copy(sm.pos); this.player.pos.y = sm.y + 0.02;
    this.player.yaw = Math.atan2(sm.tan.x, sm.tan.z);
    this.player.vx = 6; this.player.vy = 0; this.player.yawRate = 0; this.player.gear = 0;
    this.player.lastS = sm.s; this.player._hint = g.i;
    this.hud.toast('Recovered to track');
  }

  togglePause() {
    if (!this.running) return;
    this.paused = !this.paused;
    UI.screen(this.paused ? 'pause' : null);
    if (this.paused) this.audio.silence();
    else { this.lastT = now(); }
  }

  quit() {
    this.running = false; this.paused = false;
    this.audio.silence();
    this.hud.show(false);
    UI.setEscVisible(false);
    if (this.scene) { this._disposeScene(); }
    if (this.mp) { this.net.emit('room:leave'); this.mp = null; }
    UI.screen('main');
  }
  _disposeScene() {
    this.scene.traverse((o) => {
      if (o.isMesh) { o.geometry?.dispose?.(); if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.()); else o.material?.dispose?.(); }
    });
    this.scene = null;
  }

  /* ---------- per-frame ---------- */
  _frame() {
    const t = now();
    let dt = (t - this.lastT) / 1000;
    this.lastT = t;
    if (dt > 0.1) dt = 0.1;

    if (this.running && !this.paused) {
      this.acc += dt;
      const H = 1 / 120;
      let steps = 0;
      while (this.acc >= H && steps < 8) { this._physics(H); this.acc -= H; steps += 1; }
      this._postSim(dt);
    }
    if (this.scene) this.renderer.render(this.scene, this.camera);
  }

  _physics(h) {
    const g = this;
    if (g.raceState === 'countdown') {
      g.countdown -= h;
      if (g.countdown <= 0) { g.raceState = 'green'; g.raceClock = 0; for (const c of g.cars) c.lapStart = 0; g._greenPulse = true; }
    } else if (g.raceState === 'green' || g.raceState === 'finishing') {
      g.raceClock += h;
    }

    const racing = g.raceState === 'green' || g.raceState === 'finishing';
    g.env.racing = racing;   // reverse gear etc. only once the lights are out

    // DRS check for player (F1)
    if (MODES[g.settings.mode].drs && racing) {
      const pg = g.track.sample(g.player.pos.x, g.player.pos.z, g.player._hint);
      let gapAhead = null;
      for (const o of g.cars) { if (o === g.player) continue; const d = o.pos.distanceTo(g.player.pos); const f = (o.pos.x - g.player.pos.x) * Math.sin(g.player.yaw) + (o.pos.z - g.player.pos.z) * Math.cos(g.player.yaw); if (f > 0 && d < (gapAhead ?? 999)) gapAhead = d; }
      g.env.drsOpen = g.track.inDRS(pg.s / g.track.length, gapAhead) && g.player.input.throttle > 0.5;
    } else g.env.drsOpen = false;

    // inputs
    if (racing || g.raceState === 'countdown') {
      const canDrive = racing;
      g.player.setInput(canDrive ? g.playerInput() : { throttle: 0, brake: 1, steer: 0, handbrake: false });
      for (const ai of g.ais) { if (canDrive) ai.update(h, g.track, g.cars, { yellowActive: !!g.yellow, yellowNear: (s) => g.yellow && Math.abs(s - g.yellow.s) < 90 }); else ai.v.setInput({ throttle: 0, brake: 1, steer: 0, handbrake: false }); }
    }

    // step all cars
    for (const c of g.cars) {
      if (c.retired) { c.setInput({ throttle: 0, brake: 1, steer: 0, handbrake: true }); }
      c.step(h, g.track, g.env);
      if (c.dead) { c.dead = false; this._recover(c); }
      if (!c.isPlayer && racing && c.stopped > 5) { c.stopped = 0; this._recover(c); }
      if (c.isPlayer && racing && c.stopped > 4 && (c.stopped % 6) < h) this.hud.toast('Stuck? Press R to recover to the track');
      if (c.lastImpact > 0.03) { this.audio.impact(c === g.player ? c.lastImpact : c.lastImpact * 0.5); c.lastImpact = 0; }
    }

    // car-car collisions (circle push + momentum along normal)
    for (let i = 0; i < g.cars.length; i++) {
      for (let j = i + 1; j < g.cars.length; j++) {
        const A = g.cars[i], B = g.cars[j];
        const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z;
        const d = Math.hypot(dx, dz); const minD = 3.0;
        if (d > 0.001 && d < minD) {
          const nx = dx / d, nz = dz / d;
          const overlap = (minD - d);
          A.pos.x -= nx * overlap * 0.5; A.pos.z -= nz * overlap * 0.5;
          B.pos.x += nx * overlap * 0.5; B.pos.z += nz * overlap * 0.5;
          const av = A.worldVel(), bv = B.worldVel();
          const rel = (bv.x - av.x) * nx + (bv.z - av.z) * nz;
          if (rel < 0) {
            const imp = -rel * 0.5;
            av.x -= nx * imp; av.z -= nz * imp; bv.x += nx * imp; bv.z += nz * imp;
            const setV = (car, v) => { car.vx = v.x * Math.sin(car.yaw) + v.z * Math.cos(car.yaw); car.vy = v.x * Math.cos(car.yaw) - v.z * Math.sin(car.yaw); };
            setV(A, av); setV(B, bv);
            const mag = Math.min(1, Math.abs(rel) / 18);
            if (A === g.player || B === g.player) this.audio.impact(mag);
            A.yawRate += (Math.random() - 0.5) * mag * 0.5; B.yawRate += (Math.random() - 0.5) * mag * 0.5;
          }
        }
      }
    }

    // timing + laps
    if (racing) for (const c of g.cars) this._timing(c, h);

    // flags
    this._flags(h);

    // record ghost frames (player, TT)
    if (this.sessionType === 'tt' && racing) {
      this._recTick = (this._recTick || 0) + h;
      if (this._recTick >= 1 / 30) {
        this._recTick = 0;
        this.recFrames.push({ t: this.raceClock - this.player.lapStart, p: [this.player.pos.x, this.player.pos.y, this.player.pos.z], y: this.player.yaw });
        if (this.recFrames.length > 8000) this.recFrames.shift();
      }
    }

    // MP send
    if (this.mp && racing) {
      this._mpSendT = (this._mpSendT || 0) + h;
      if (this._mpSendT >= 1 / 20) { this._mpSendT = 0; this._mpSend(); }
    }
  }

  _recover(c) {
    const g = this.track.sample(c.pos.x, c.pos.z, c._hint);
    const sm = this.track.samples[g.i];
    c.pos.copy(sm.pos); c.pos.y = sm.y + 0.02;
    c.yaw = Math.atan2(sm.tan.x, sm.tan.z);
    c.vx = 4; c.vy = 0; c.yawRate = 0;
    c.lastS = sm.s; c._hint = g.i;   // teleporting must not register as a start-line crossing
  }

  _timing(c, h) {
    const g = this.track.sample(c.pos.x, c.pos.z, c._hint);
    const L = this.track.length;
    const prev = c.lastS, cur = g.s;
    // sector splits
    for (let k = 0; k < this.track.sectorS.length; k++) {
      const ss = this.track.sectorS[k];
      if (prev < ss && cur >= ss && cur - prev < L * 0.5) {
        c.sectorT[k] = (this.raceClock - c.lapStart);
      }
    }
    // off-track violation accumulation
    if (c === this.player && c.offTrack > 1.1 && !this.settings.practice) { c.lapValid = false; }

    // start/finish crossing (wrap from near the end of the loop to near the start)
    if (prev > L * 0.7 && cur < L * 0.25) {
      if (!c.started) {
        // leaving the grid — this begins lap 1, nothing to time yet
        c.started = true;
        c.lapStart = this.raceClock;
        c.lapValid = true; c.sectorT = [null, null, null];
        if (c === this.player && this.sessionType === 'tt') this.recFrames = [];
      } else if ((this.raceClock - c.lapStart) < 6) {
        // shoved back and forth across the line (grid contact, spins): not a lap
      } else {
        const lapMs = (this.raceClock - c.lapStart) * 1000;
        c.lastLap = lapMs;
        if (c.lapValid && lapMs > 2000 && (c.bestLap == null || lapMs < c.bestLap)) c.bestLap = lapMs;
        if (c === this.player) {
          this.lastLapMs = lapMs;
          if (c.lapValid && lapMs > 2000) {
            if (this.bestLapMs == null || lapMs < this.bestLapMs) {
              this.bestLapMs = lapMs;
              if (this.sessionType === 'tt' && this.recFrames.length > 10) {
                Store.saveGhost(this.settings.trackId, this.settings.mode, this.recFrames.slice());
              }
            }
            if (this.sessionType === 'quick' || this.sessionType === 'tt') {
              Store.submitLap(this.settings.trackId, this.settings.mode, this.settings.weather, lapMs);
            }
            if (this.mp) this.net.emit('lap:done', { lap: c.lap + 1, ms: lapMs, valid: true });
          } else if (this.mp) {
            this.hud.toast('Lap invalidated — track limits');
            this.net.emit('lap:done', { lap: c.lap + 1, ms: lapMs, valid: false });
          } else if (!c.lapValid) {
            this.hud.toast('Lap invalidated — track limits');
          }
        }
        c.lap += 1;
        c.lapStart = this.raceClock;
        c.lapValid = true; c.offViol = 0;
        c.sectorT = [null, null, null];
        if (c === this.player && this.sessionType === 'tt') this.recFrames = [];

        // chequered flag: the leader completes the distance; everyone else finishes at their next crossing
        if ((c.lap >= this.settings.laps || this.raceState === 'finishing') && !c.finished) {
          c.finished = true;
          this.finishOrder.push(c);
          if (c === this.player) { this.hud.toast('Chequered flag!'); this.audio.beep(660, 0.3, 0.3); }
          if (this.raceState === 'green') this.raceState = 'finishing';
        }
      }
    }
    c.lastS = cur;
    c.raceProgress = (c.started ? c.lap : -1) + cur / L;

    // end of race condition
    if (this.raceState === 'finishing') {
      const active = this.cars.filter((x) => !x.retired);
      this._finTimer = (this._finTimer || 0) + h;
      if (active.every((x) => x.finished) || (this.player.finished && this._finTimer > 12) || this._finTimer > 60) {
        this._endRace();
      }
    }
  }

  _flags(h) {
    // yellow: a stopped/off car
    let inc = null;
    for (const c of this.cars) {
      if (c.retired) continue;
      if ((c.stopped > 2.5 || c.offTrack > 3) && c !== this.player) { inc = this.track.sample(c.pos.x, c.pos.z, c._hint); break; }
    }
    if (inc) this.yellow = { s: inc.s, until: 4 };
    else if (this.yellow) { this.yellow.until -= h; if (this.yellow.until <= 0) this.yellow = null; }

    // decide player's flag banner
    const pg = this.track.sample(this.player.pos.x, this.player.pos.z, this.player._hint);
    let flag = null;
    if (this.raceState === 'finishing' && this.player.finished) flag = { kind: 'checd', text: 'FINISH' };
    else if (this.yellow && Math.abs(pg.s - this.yellow.s) < 110) flag = { kind: 'yellow', text: 'YELLOW' };
    else if (this.env.drsOpen) flag = { kind: 'drs', text: 'DRS' };
    else {
      // blue flag: a car a lap ahead approaching from behind
      for (const o of this.cars) {
        if (o === this.player || o.retired) continue;
        if (o.raceProgress > this.player.raceProgress + 0.92) {
          const d = o.pos.distanceTo(this.player.pos);
          const f = (o.pos.x - this.player.pos.x) * Math.sin(this.player.yaw) + (o.pos.z - this.player.pos.z) * Math.cos(this.player.yaw);
          if (d < 28 && f < 0) { flag = { kind: 'blue', text: 'BLUE FLAG' }; break; }
        }
      }
    }
    this.flag = flag;
  }

  _endRace() {
    this.raceState = 'done';
    // finalize order: finishers by finish order, then the rest by progress
    const finishers = this.finishOrder.slice();
    const rest = this.cars.filter((c) => !c.finished).sort((a, b) => b.raceProgress - a.raceProgress);
    this.result = [...finishers, ...rest].map((c, i) => ({
      pos: i + 1, name: c.name, isPlayer: c === this.player, retired: c.retired,
      best: c.bestLap, penalty: c.penalty,
    }));
    this.running = false;
    this.audio.silence();
    UI.showResults(this);
  }

  /* ---------- standings / helpers for HUD ---------- */
  lapElapsed() { return (this.raceState === 'countdown') ? 0 : (this.raceClock - this.player.lapStart) * 1000; }
  deltaToBest() {
    if (!this.startBest || this.player.lap < 1) return null;
    // crude: compare projected lap time vs personal best by fraction of lap done
    const frac = (this.track.sample(this.player.pos.x, this.player.pos.z, this.player._hint).s) / this.track.length;
    const proj = frac > 0.02 ? this.lapElapsed() / frac : 0;
    return proj - this.startBest;
  }
  standings() {
    const arr = this.cars.map((c) => ({ car: c, name: c.name, isPlayer: c === this.player, retired: c.retired, prog: c.raceProgress }));
    arr.sort((a, b) => b.prog - a.prog);
    const leadProg = arr[0]?.prog || 0;
    const refSpeed = Math.max(25, arr[0]?.car.speed || 0);
    return arr.map((e, i) => {
      let gap = i === 0 ? null : (e.retired ? 'DNF' : Math.min(999, (leadProg - e.prog) * this.track.length / refSpeed));
      return { name: e.name, isPlayer: e.isPlayer, gap, retired: e.retired };
    });
  }
  playerPos() { return this.standings().findIndex((s) => s.isPlayer) + 1; }
  allCars() { return this.cars; }

  /* ---------- post-sim: meshes, camera, audio, hud ---------- */
  _postSim(dt) {
    for (const c of this.cars) {
      if (!c.mesh) continue;
      c.mesh.position.copy(c.pos);
      c.mesh.rotation.set(0, c.yaw, 0);
      const tilt = c.mesh.userData.tilt, body = c.mesh.userData.body;
      if (body) {
        if (tilt) tilt.rotation.set(c.slopePitch || 0, 0, c.bankRoll || 0);   // road: wheels + body
        body.rotation.set(c.pitch, 0, c.roll);                                 // dive / squat / lean: body only
      } else if (tilt) {
        // single-piece model (458): fold a reduced dynamic tilt in so the tyres barely leave the road
        tilt.rotation.set((c.slopePitch || 0) + c.pitch * 0.4, 0, (c.bankRoll || 0) + c.roll * 0.4);
      }
      const ws = c.mesh.userData.wheels;
      if (ws) { const sp = c.speed / c.cfg.rWheel * dt; for (let i = 0; i < ws.length; i++) { ws[i].rotation.x += sp; if (i < 2) ws[i].rotation.y = c.steerActual * 0.42; } }
      const flap = c.mesh.userData.drsFlap;
      if (flap) flap.rotation.x = lerp(flap.rotation.x, (c === this.player && this.env.drsOpen) ? -0.85 : 0, clamp(dt * 8, 0, 1));
    }
    this.player.mesh.updateMatrixWorld(true);

    // cockpit: visibility, wheel, display, mirror
    const cp = this.player.mesh.userData.cockpit;
    const cockpitOn = this.rig.mode === 'cockpit' && !this.spectator;
    if (cp) {
      if (cp.visible !== cockpitOn) {
        cp.visible = cockpitOn;
        this.player.mesh.traverse((m) => { if (m.userData.hideInCockpit) m.visible = !cockpitOn; });
      }
      if (cockpitOn) {
        cp.userData.wheel.rotation.z = clamp(-this.player.steerActual * 1.7, -1.4, 1.4);
        this._dispT = (this._dispT || 0) + dt;
        if (this._dispT > 0.08) {
          this._dispT = 0;
          const p = this.player;
          drawDisplay(cp, {
            gear: p.reversing ? 'R' : (p.gear === 0 && p.speed < 2 ? 'N' : String(p.gear + 1)), speedKmh: Math.round(p.speed * 3.6),
            rpmN: clamp((p.rpm - p.cfg.idleRPM) / (p.cfg.redline - p.cfg.idleRPM), 0, 1), lapMs: fmtTime(this.lapElapsed()),
            delta: this.deltaToBest(), pos: this.playerPos(), lap: Math.min(p.lap + 1, this.settings.laps), laps: this.settings.laps, drs: this.env.drsOpen,
          });
        }
        this._mirT = (this._mirT || 0) + 1;
        if (this._mirT % 2 === 0 && Store.settings().qual !== 'low') {
          const m = cp.userData.mirror;
          const eye = cp.userData.eye.clone(); (this.player.mesh.userData.inner || this.player.mesh).localToWorld(eye);
          const fwd = new THREE.Vector3(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw));
          m.cam.position.copy(eye).addScaledVector(fwd, -0.4); m.cam.up.set(0, 1, 0);
          m.cam.lookAt(eye.clone().addScaledVector(fwd, -60).setY(eye.y + 0.4));
          cp.visible = false;
          this.renderer.setRenderTarget(m.rt); this.renderer.render(this.scene, m.cam); this.renderer.setRenderTarget(null);
          cp.visible = true;
        }
      }
    }

    // start lights on the gantry
    const lights = this.track.world?.startLights || [];
    if (lights.length) {
      const lit = this.raceState === 'countdown' ? clamp(Math.floor((4.2 - this.countdown) / 0.8) + 1, 0, 5) : 0;
      lights.forEach((l, i) => { const on = i < lit; l.material.emissive.setHex(on ? 0xff1a1a : 0x000000); l.material.emissiveIntensity = on ? 2.5 : 0; l.material.color.setHex(on ? 0xff4040 : 0x300000); });
    }
    // ghost playback
    if (this.ghost && this.ghostFrames) {
      const tt = this.lapElapsed() / 1000;
      const fr = this.ghostFrames;
      let k = 0; while (k < fr.length - 1 && fr[k + 1].t < tt) k++;
      const a = fr[k], b = fr[Math.min(k + 1, fr.length - 1)];
      const u = b.t > a.t ? clamp((tt - a.t) / (b.t - a.t), 0, 1) : 0;
      this.ghost.position.set(lerp(a.p[0], b.p[0], u), lerp(a.p[1], b.p[1], u), lerp(a.p[2], b.p[2], u));
      this.ghost.rotation.y = lerp(a.y, b.y, u);
      this.ghost.visible = tt < fr[fr.length - 1].t + 0.5;
    }
    // remote MP cars interpolate
    if (this.mp) this._mpInterp(dt);

    // rain follow camera
    if (this.rain) { this.rain.position.set(this.camera.position.x, 0, this.camera.position.z); }

    // sun follows
    if (this.sun) { const c = this.camera.position; this.sun.position.copy(c).addScaledVector(this.sunDir, 380); this.sun.target.position.copy(c); this.sun.target.updateMatrixWorld(); }

    // camera
    const camTarget = this.spectator ? (this.cars[0] || this.player) : this.player;
    this.rig.update(dt, camTarget, this.track, this.rig.mode === 'free' ? this.freeCamInput() : null);

    // audio: only while actually racing — never during the countdown, results screen,
    // or the trailing post-sim frame after the race ends
    if (this.raceState === 'green' || this.raceState === 'finishing') this.audio.update(this.player, dt);
    else this.audio.silence();
    this.hud.tick(dt);
    this.hud.update(this);

    // countdown / GO centre text
    const ce = $('centre');
    if (this.raceState === 'countdown') {
      const n = Math.ceil(this.countdown - 1.2);
      ce.classList.add('on');
      ce.innerHTML = n > 0 ? `${n}<small>${this.track.name.toUpperCase()} · ${this.settings.laps} LAP${this.settings.laps > 1 ? 'S' : ''}</small>` : `GO<small>&nbsp;</small>`;
      if (n !== this._lastCount) { this._lastCount = n; if (n >= 0) this.audio.beep(n === 0 ? 880 : 440, 0.15, 0.3); }
    } else if (this.raceState === 'green' && this.raceClock < 1.0) {
      ce.classList.add('on'); ce.innerHTML = `GO<small>&nbsp;</small>`;
    } else ce.classList.remove('on');
  }

  /* ---------- multiplayer runtime ---------- */
  _wireMpRuntime() {
    this.spectator = this.mp.spectator;
    this.isHost = this.mp.isHost;
    this.net.on('snap', (d) => { this._lastSnap = d; });
    this.net.on('race:standings', (s) => { this._mpStandings = s; });
    this.net.on('race:finished', (d) => { this._mpFinished = d; if (this.running) this._endRaceMp(d); });
    this.net.on('race:respawn', () => this._respawnPlayer());
    this.net.on('flag:yellow', (d) => { this.yellow = { s: 0, until: 3 }; });
    this.net.on('chat', (m) => this.hud.toast(`${m.name}: ${m.text}`));
  }
  _mpSend() {
    const p = this.player;
    const msg = {
      p: [p.pos.x, p.pos.y, p.pos.z], q: [p.pitch + (p.slopePitch || 0), p.yaw, p.roll + (p.bankRoll || 0)],
      v: [p.worldVel().x, 0, p.worldVel().z], rpm: p.rpm, gear: p.gear, steer: p.steerActual,
      progress: p.raceProgress, car: p.carId,
    };
    if (this.isHost) msg.ai = this.ais.map((a) => ({ id: 'ai' + a.v.livery.number, name: a.v.name, p: [a.v.pos.x, a.v.pos.y, a.v.pos.z], q: [a.v.pitch + (a.v.slopePitch || 0), a.v.yaw, a.v.roll + (a.v.bankRoll || 0)], livery: a.v.livery, car: a.v.carId }));
    this.net.emit('car:update', msg);
  }
  _mpInterp(dt) {
    const snap = this._lastSnap;
    if (!snap) return;
    const seen = new Set();
    const consume = (entry, isAi) => {
      const id = entry.id || entry.name;
      seen.add(id);
      let rc = this.remoteCars.get(id);
      if (!rc) {
        const mesh = CarFactory.build(entry.car || this.settings.car || MODES[this.settings.mode].id, entry.livery || { base: isAi ? '#f59e0b' : '#22d3ee', accent: '#fff', pattern: 'solid', number: 0 });
        this.scene.add(mesh);
        rc = { mesh, pos: new THREE.Vector3(...entry.p), rot: entry.q ? entry.q.slice() : [0, 0, 0], tp: new THREE.Vector3(...entry.p), tr: entry.q ? entry.q.slice() : [0, 0, 0], name: entry.name };
        this.remoteCars.set(id, rc);
      }
      rc.tp.set(...entry.p); rc.tr = entry.q || rc.tr;
    };
    for (const c of snap.cars || []) { if (this.mp && c.id === this.net.socket?.id) continue; consume(c, false); }
    for (const a of snap.ai || []) consume(a, true);
    for (const [id, rc] of this.remoteCars) {
      if (!seen.has(id)) { this.scene.remove(rc.mesh); this.remoteCars.delete(id); continue; }
      rc.pos.lerp(rc.tp, clamp(dt * 10, 0, 1));
      rc.rot[0] = lerp(rc.rot[0], rc.tr[0], .3); rc.rot[1] = lerp(rc.rot[1], rc.tr[1], .3); rc.rot[2] = lerp(rc.rot[2], rc.tr[2], .3);
      rc.mesh.position.copy(rc.pos);
      rc.mesh.rotation.set(0, rc.rot[1], 0);
      if (rc.mesh.userData.tilt) rc.mesh.userData.tilt.rotation.set(rc.rot[0], 0, rc.rot[2]);
    }
  }
  _endRaceMp(d) {
    this.raceState = 'done'; this.running = false;
    this.audio.silence();
    this.result = (d.standings || []).map((s, i) => ({ pos: i + 1, name: s.name, isPlayer: false, best: s.bestLap, penalty: s.penaltyMs }));
    UI.showResults(this);
  }
}

/* ===========================================================================
   UI — screens, wiring
   =========================================================================== */

const UI = {
  cur: 'main',
  screens: ['main', 'setup', 'career', 'mp', 'garage', 'profile', 'settings', 'results', 'pause'],
  anyScreenOpen() { return !!document.querySelector('.screen.on'); },
  hideAll() { for (const s of this.screens) $('scr-' + s).classList.remove('on'); },
  screen(name) {
    this.hideAll();
    if (name) { $('scr-' + name).classList.add('on'); this.cur = name; }
  },
  setEscVisible(v) { $('esc').style.display = v ? 'block' : 'none'; },

  init() {
    // menu tiles
    document.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => this.go(b.dataset.go));
    document.querySelectorAll('[data-back]').forEach((b) => b.onclick = () => this.screen(GAME.running ? null : 'main'));
    $('btnSettings').onclick = () => { this.loadSettings(); this.screen('settings'); };
    $('btnAbout').onclick = () => alert('School Racing Sim\n\nDrive: Arrows or WASD · Handbrake: Space · Camera: C · Reset: R · Pause: Esc\n\nQuick Race: grid of AI. Time Trial: chase your ghost. Career: a season of rounds for championship points. Multiplayer: host or join with a 4-letter room code.\n\nLog in with a class code + your name to save best laps, livery and career across devices.');

    // fill track selects
    for (const sel of ['selTrack', 'mpTrack']) {
      const el = $(sel);
      el.innerHTML = Object.entries(TRACK_DEFS).map(([id, d]) => `<option value="${id}">${d.name} — ${d.country}</option>`).join('');
    }
    $('selSeason').innerHTML = SEASONS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');

    // setup screen
    $('btnGo').onclick = () => this.startFromSetup();
    $('selMode').onchange = () => this.syncSetupMode();
    $('selCar').onchange = () => { $('setupCarBlurb').textContent = CAR_INFO[$('selCar').value]?.blurb || ''; };
    $('mpMode').onchange = () => this.syncMpCar();
    this.syncSetupMode(); this.syncMpCar();

    // career
    $('selSeason').onchange = () => this.renderCareer();
    $('selSeasonDiff').onchange = () => this.renderCareer();
    $('btnCareerNext').onclick = () => this.raceCareerRound();
    $('btnCareerReset').onclick = () => { const c = Store.career(); delete c[$('selSeason').value]; Store.saveCareer(c); this.renderCareer(); };

    // garage
    const gl = Store.livery();
    $('gBase').value = gl.base; $('gAccent').value = gl.accent; $('gPattern').value = gl.pattern; $('gNumber').value = gl.number;
    $('btnSaveLivery').onclick = async () => {
      const liv = { base: $('gBase').value, accent: $('gAccent').value, pattern: $('gPattern').value, number: clamp(+$('gNumber').value || 7, 1, 99) };
      await Store.saveLivery(liv);
      $('garageMsg').textContent = 'Saved.'; $('garageMsg').className = 'msg ok';
    };

    // profile
    $('btnLogin').onclick = () => this.doLogin();
    $('btnLogout').onclick = () => { Store.logout(); this.renderProfile(); this.renderWhoami(); };
    $('btnMakeClass').onclick = () => this.makeClass();

    // settings
    $('btnSaveSettings').onclick = () => this.saveSettings();

    // pause
    $('btnResume').onclick = () => GAME.togglePause();
    $('btnRestart').onclick = () => { const s = GAME.settings, t = GAME.sessionType; GAME.quit(); GAME.start(t, s); };
    $('btnPauseCam').onclick = () => GAME.rig.cycle();
    $('btnQuit').onclick = () => GAME.quit();
    $('esc').onclick = () => GAME.togglePause();

    // multiplayer
    $('btnHost').onclick = () => this.mpHost();
    $('btnJoin').onclick = () => this.mpJoin(false);
    $('btnSpectate').onclick = () => this.mpJoin(true);
    $('btnLeaveRoom').onclick = () => this.mpLeave();
    $('btnReady').onclick = () => { this._ready = !this._ready; GAME.net.emit('room:ready', this._ready); $('btnReady').textContent = this._ready ? 'Not ready' : 'Ready'; };
    $('btnStartRace').onclick = () => GAME.net.emit('race:start');

    this.renderWhoami();
    this.screen('main');
    $('boot').style.display = 'none';
  },

  go(where) {
    if (where === 'quick' || where === 'tt') { this.prepSetup(where); this.screen('setup'); }
    else if (where === 'career') { this.renderCareer(); this.screen('career'); }
    else if (where === 'mp') { this.openMp(); }
    else if (where === 'garage') this.screen('garage');
    else if (where === 'profile') { this.renderProfile(); this.screen('profile'); }
  },

  renderWhoami() {
    const el = $('whoami');
    if (Store.loggedIn()) el.innerHTML = `Signed in as <b>${Store.profile.name}</b> · class <b>${Store.profile.classCode}</b> <span class="tag">progress syncs</span>`;
    else if (API_BASE == null) el.innerHTML = `Running from a file — single-player only. <span class="tag">open the hosted URL for multiplayer + accounts</span>`;
    else el.innerHTML = `Playing as guest — <a href="#" id="wLogin" style="color:var(--accent)">log in</a> to save across devices.`;
    const w = $('wLogin'); if (w) w.onclick = (e) => { e.preventDefault(); this.renderProfile(); this.screen('profile'); };
  },

  _fillCars(sel, mode, preferred) {
    const cars = MODES[mode].cars;
    const cur = sel.value;
    sel.innerHTML = cars.map((c) => `<option value="${c}">${CAR_INFO[c].label}</option>`).join('');
    sel.value = cars.includes(cur) ? cur : (cars.includes(preferred) ? preferred : cars[0]);
    sel.disabled = cars.length === 1;
  },
  syncSetupMode() {
    this._fillCars($('selCar'), $('selMode').value, Store.settings().lastCar);
    $('setupCarBlurb').textContent = CAR_INFO[$('selCar').value]?.blurb || '';
  },
  syncMpCar() { this._fillCars($('mpCar'), $('mpMode').value, Store.settings().lastCar); },
  prepSetup(kind) {
    this._setupKind = kind;
    $('setupTitle').textContent = kind === 'tt' ? 'Time Trial' : 'Quick Race';
    $('setupSub').textContent = kind === 'tt'
      ? 'Empty track. Your best lap is saved as a ghost to chase next time.'
      : 'Race a full grid of AI. You start at the back — carve your way forward.';
    $('fAi').style.display = kind === 'tt' ? 'none' : 'flex';
    $('fDiff').style.display = kind === 'tt' ? 'none' : 'flex';
    $('fLaps').style.display = kind === 'tt' ? 'none' : 'flex';
    const st = Store.settings();
    $('selDiff').value = st.lastDiff || 'medium';
  },
  startFromSetup() {
    const kind = this._setupKind;
    const s = {
      trackId: $('selTrack').value,
      mode: $('selMode').value,
      weather: $('selWx').value,
      laps: clamp(+$('selLaps').value || 3, 1, 30),
      aiCount: clamp(+$('selAi').value || 0, 0, 15),
      aiDifficulty: $('selDiff').value,
      practice: $('selPractice').checked,
      car: $('selCar').value,
    };
    const st = Store.settings(); st.lastDiff = s.aiDifficulty; st.lastCar = s.car; Store.saveSettings(st);
    GAME.start(kind === 'tt' ? 'tt' : 'quick', s);
  },

  /* ----- career ----- */
  renderCareer() {
    if (!$('selCareerCar').options.length) this._fillCars($('selCareerCar'), 'gt', Store.settings().lastCar);
    const seasonId = $('selSeason').value;
    const season = SEASONS.find((s) => s.id === seasonId);
    const diff = $('selSeasonDiff').value;
    const car = Store.career();
    const prog = car[seasonId] || { round: 0, points: {}, done: [] };
    // rounds list
    $('careerRounds').innerHTML = season.rounds.map((r, i) => {
      const d = TRACK_DEFS[r.trackId];
      const status = i < prog.round ? `<span class="pill">P${(prog.done[i]?.pos) || '-'} · ${(prog.done[i]?.pts) || 0} pts</span>` : (i === prog.round ? '<span class="pill">next</span>' : '');
      return `<div class="item"><b>R${i + 1}</b><span class="g">${d.name} · ${MODES[r.mode].label} · ${r.laps} laps</span>${status}</div>`;
    }).join('');
    // standings
    const pts = { ...(prog.points || {}) };
    if (!(pts[Store.profile?.name || 'You'] >= 0)) pts[Store.profile?.name || 'You'] ||= 0;
    const rows = Object.entries(pts).sort((a, b) => b[1] - a[1]);
    $('careerStandings').innerHTML = rows.map(([n, p], i) => `<div class="item ${n === (Store.profile?.name || 'You') ? '' : ''}"><b>${i + 1}</b><span class="g">${n}</span><span>${p} pts</span></div>`).join('') || '<div class="item"><span class="g">No rounds completed yet.</span></div>';
    const finished = prog.round >= season.rounds.length;
    $('btnCareerNext').textContent = finished ? 'Season complete' : `Race round ${prog.round + 1}`;
    $('btnCareerNext').disabled = finished;
    $('careerMsg').textContent = finished ? `Champion: ${rows[0]?.[0] || '—'}` : '';
    this._careerCtx = { seasonId, season, diff, prog };
  },
  raceCareerRound() {
    const { season, diff, prog, seasonId } = this._careerCtx;
    const r = season.rounds[prog.round];
    GAME.start('career', {
      trackId: r.trackId, mode: r.mode, laps: r.laps, weather: 'dry',
      aiCount: 9, aiDifficulty: diff, practice: false,
      car: r.mode === 'f1' ? 'f1' : $('selCareerCar').value,
      _career: { seasonId, roundIndex: prog.round },
    });
  },
  finishCareerRound(game) {
    const { seasonId, roundIndex } = game.settings._career;
    const season = SEASONS.find((s) => s.id === seasonId);
    const car = Store.career();
    const prog = car[seasonId] || { round: 0, points: {}, done: [] };
    const me = Store.profile?.name || 'You';
    // points from player's finishing position
    const res = game.result;
    const myPos = res.find((x) => x.isPlayer)?.pos || res.length;
    const myPts = POINTS[myPos - 1] || 0;
    prog.points[me] = (prog.points[me] || 0) + myPts;
    // give AI championship points too (use their finishing order)
    res.forEach((x) => { if (!x.isPlayer) { prog.points[x.name] = (prog.points[x.name] || 0) + (POINTS[x.pos - 1] || 0); } });
    prog.done[roundIndex] = { pos: myPos, pts: myPts };
    prog.round = roundIndex + 1;
    car[seasonId] = prog;
    Store.saveCareer(car);
  },

  /* ----- profile ----- */
  async renderProfile() {
    $('profState').textContent = API_BASE == null
      ? 'Offline (file://). Log-in needs the hosted server.'
      : (Store.loggedIn() ? `Signed in as ${Store.profile.name} (class ${Store.profile.classCode}).` : 'Not signed in. Enter a class code and your name.');
    if (API_BASE != null) {
      try {
        const j = await Store.api('/api/classes');
        $('classList').innerHTML = (j.classes || []).map((c) => `<option value="${c.code}">${c.label}</option>`).join('');
      } catch {}
    }
    const s = Store.local.get('session', null);
    if (s) { $('pfCode').value = s.code; $('pfName').value = s.name; }
    const det = $('pfDetails');
    if (Store.loggedIn()) {
      det.classList.remove('hide');
      const bl = Store.profile.bestLaps || {};
      $('pfBest').innerHTML = Object.entries(bl).map(([k, v]) => {
        const [tid, m] = k.split(':');
        return `<div class="item"><span class="g">${TRACK_DEFS[tid]?.name || tid} · ${m.toUpperCase()}</span><span>${fmtTime(v)}</span></div>`;
      }).join('') || '<div class="item"><span class="g">No laps yet.</span></div>';
    } else det.classList.add('hide');
  },
  async doLogin() {
    const code = $('pfCode').value.trim().toUpperCase();
    const name = $('pfName').value.trim();
    const m = $('profMsg');
    if (!code || !name) { m.textContent = 'Enter both a class code and a name.'; m.className = 'msg err'; return; }
    try {
      await Store.login(code, name);
      m.textContent = 'Signed in.'; m.className = 'msg ok';
      this.renderProfile(); this.renderWhoami();
    } catch (e) { m.textContent = 'Login failed: ' + e.message; m.className = 'msg err'; }
  },
  async makeClass() {
    const code = $('tcCode').value.trim().toUpperCase();
    const label = $('tcLabel').value.trim() || code;
    const key = $('tcKey').value;
    const m = $('tcMsg');
    try {
      await Store.api('/api/class', { method: 'POST', body: JSON.stringify({ code, label, teacherKey: key }) });
      m.textContent = `Class ${code} created. Students can now log in with it.`; m.className = 'msg ok';
      this.renderProfile();
    } catch (e) { m.textContent = 'Failed: ' + e.message; m.className = 'msg err'; }
  },

  /* ----- settings ----- */
  loadSettings() {
    const s = Store.settings();
    $('stSound').checked = !GAME.audio.muted;
    $('stVol').value = s.vol; $('stCam').value = s.cam; $('stUnits').value = s.units;
    $('stQual').value = s.qual; $('stShadows').checked = s.shadows; $('stAssist').checked = s.assist;
  },
  saveSettings() {
    const s = {
      vol: +$('stVol').value, cam: $('stCam').value, units: $('stUnits').value,
      qual: $('stQual').value, shadows: $('stShadows').checked, assist: $('stAssist').checked,
      lastDiff: Store.settings().lastDiff,
    };
    Store.saveSettings(s);
    GAME.audio.setMuted(!$('stSound').checked);
    GAME.audio.setMaster(s.vol / 100);
    $('setMsg').textContent = 'Saved.'; $('setMsg').className = 'msg ok';
  },

  /* ----- results ----- */
  showResults(game) {
    if (game.settings._career) this.finishCareerRound(game);
    $('resTitle').textContent = game.sessionType === 'career' ? 'Round Result' : (game.sessionType === 'tt' ? 'Time Trial' : 'Race Result');
    const bestOverall = game.result.reduce((m, r) => (r.best && (!m || r.best < m) ? r.best : m), null);
    $('resSub').textContent = `${game.track.name} · ${MODES[game.settings.mode].label} · ${game.settings.laps} lap(s) · ${game.settings.weather}`;
    $('resTable').innerHTML = game.result.map((r) => `
      <div class="item ${r.isPlayer ? '' : ''}" style="${r.isPlayer ? 'color:var(--accent);font-weight:700' : ''}">
        <b>${r.retired ? 'DNF' : 'P' + r.pos}</b>
        <span class="g">${r.name}</span>
        <span>${fmtTime(r.best)}${r.best && r.best === bestOverall ? ' ⚡' : ''}${r.penalty ? ' (+' + (r.penalty / 1000) + 's)' : ''}</span>
      </div>`).join('');
    const btns = $('resBtns'); btns.innerHTML = '';
    const mk = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; btns.appendChild(b); };
    if (game.sessionType === 'career') {
      mk('Back to season', 'primary', () => { GAME.quit(); this.renderCareer(); this.screen('career'); });
    } else if (game.sessionType === 'mp') {
      mk('Back to lobby', 'primary', () => { GAME.hud.show(false); UI.setEscVisible(false); GAME.running = false; this.screen('mp'); this.showLobby(this._lobbyRoom); });
    } else {
      mk('Race again', 'primary', () => { const s = game.settings, t = game.sessionType; GAME.quit(); GAME.start(t, s); });
      mk('Change setup', '', () => { GAME.quit(); this.prepSetup(game.sessionType === 'tt' ? 'tt' : 'quick'); this.screen('setup'); });
    }
    mk('Menu', 'ghost', () => GAME.quit());
    // leaderboard
    Store.leaderboard(game.settings.trackId, game.settings.mode).then((lb) => {
      if (!lb || !lb.length) return;
      const m = $('resMsg');
      m.innerHTML = '<b>Class leaderboard</b><br>' + lb.slice(0, 8).map((r, i) => `${i + 1}. ${r.name} — ${fmtTime(r.ms)}`).join('<br>');
    });
    this.screen('results');
    GAME.hud.show(false);
    UI.setEscVisible(false);
  },

  /* ----- multiplayer ----- */
  async openMp() {
    this.screen('mp');
    $('mpHome').classList.remove('hide'); $('mpLobby').classList.add('hide');
    const c = $('mpConn');
    if (API_BASE == null) { c.innerHTML = 'Multiplayer needs the <b>hosted</b> version — open the server URL, not the local file.'; return; }
    c.textContent = 'Connecting…';
    try {
      await GAME.net.connect();
      c.innerHTML = GAME.net.connected ? 'Connected — <b class="ok">online</b>' : '<b class="bad">Could not connect</b>';
      GAME.net.on('status', (ok) => { c.innerHTML = ok ? 'Connected — <b class="ok">online</b>' : '<b class="bad">Disconnected</b>'; });
      this._wireLobby();
    } catch (e) { c.innerHTML = '<b class="bad">' + e.message + '</b>'; }
    const nm = $('mpName'); if (!nm.value) nm.value = Store.profile?.name || '';
    $('mpTrack').value = 'testoval';
  },
  _wireLobby() {
    if (this._lobbyWired) return; this._lobbyWired = true;
    const net = GAME.net;
    net.on('room:state', (room) => { this._lobbyRoom = room; if (!GAME.running) this.showLobby(room); });
    net.on('room:host', () => {});
    net.on('race:countdown', (d) => {
      // launch the race locally for everyone in the room
      const room = this._lobbyRoom;
      const mp = { spectator: this._spectator, isHost: room.hostId === net.socket.id, roomCode: room.code };
      // everyone drives their own pick from the "Your car" dropdown if it fits the room's discipline
      const mine = $('mpCar').value;
      const car = MODES[room.settings.mode].cars.includes(mine) ? mine : room.settings.car;
      GAME.start('mp', { ...room.settings, car, _mp: mp });
    });
    net.on('race:finished', (d) => {});
  },
  showLobby(room) {
    if (!room) return;
    this._lobbyRoom = room;
    $('mpHome').classList.add('hide'); $('mpLobby').classList.remove('hide');
    $('lobbyCode').textContent = room.code;
    const isHost = room.hostId === GAME.net.socket?.id;
    $('lobbyHostTag').classList.toggle('hide', !isHost);
    $('btnStartRace').classList.toggle('hide', !isHost);
    $('hostControls').classList.toggle('hide', !isHost);
    const s = room.settings;
    $('lobbySettings').innerHTML = `${TRACK_DEFS[s.trackId].name} · ${MODES[s.mode].label} · ${s.laps} laps · ${s.aiCount} AI (${s.aiDifficulty}) · ${s.weather}`;
    $('lobbyPlayers').innerHTML = room.players.map((p) => `<div class="item"><b>${p.spectator ? '👁' : (p.ready ? '✔' : '•')}</b><span class="g">${p.name}${p.id === room.hostId ? ' (host)' : ''}</span><span>${p.spectator ? 'spectator' : (p.ready ? 'ready' : 'not ready')}</span></div>`).join('');
    if (isHost) {
      $('hostResetRow').innerHTML = room.players.filter((p) => !p.spectator && p.id !== room.hostId).map((p) => `<button data-reset="${p.id}">Reset ${p.name}</button>`).join('') || '<span class="mpstatus">No other drivers yet.</span>';
      $('hostResetRow').querySelectorAll('[data-reset]').forEach((b) => b.onclick = () => GAME.net.emit('race:reset-player', b.dataset.reset));
    }
  },
  mpHost() {
    const name = $('mpName').value.trim() || 'Host';
    const settings = {
      trackId: $('mpTrack').value, mode: $('mpMode').value, weather: $('mpWx').value,
      laps: clamp(+$('mpLaps').value || 3, 1, 30), aiCount: clamp(+$('mpAi').value || 0, 0, 15),
      aiDifficulty: $('mpDiff').value, car: $('mpCar').value,
    };
    GAME.net.emit('room:create', { name, settings }, (res) => {
      if (res?.ok) { this._spectator = false; this.showLobby(res.room); }
      else $('mpMsg').textContent = res?.error || 'Failed to create room';
    });
  },
  mpJoin(spectator) {
    const code = $('mpCode').value.trim().toUpperCase();
    const name = $('mpName').value.trim() || 'Racer';
    if (code.length !== 4) { $('mpMsg').textContent = 'Enter the 4-letter room code.'; return; }
    GAME.net.emit('room:join', { code, name, spectator }, (res) => {
      if (res?.ok) { this._spectator = res.spectator; this.showLobby(res.room); }
      else { $('mpMsg').textContent = res?.error || 'Could not join'; $('mpMsg').className = 'msg err'; }
    });
  },
  mpLeave() {
    GAME.net.emit('room:leave');
    $('mpHome').classList.remove('hide'); $('mpLobby').classList.add('hide');
    this._lobbyRoom = null;
  },
};

// career-finish hook from Game._endRace
const _origEndRace = Game.prototype._endRace;
Game.prototype._endRace = function () { _origEndRace.call(this); };

/* ===========================================================================
   BOOT
   =========================================================================== */

let GAME;
async function boot() {
  $('bootMsg').textContent = 'starting…';
  try {
    GAME = new Game();
    window.GAME = GAME;
    await Store.tryResume();
    UI.init();
    // apply saved settings to audio/master lazily on first gesture
    document.addEventListener('pointerdown', () => { GAME.audio.ensure(); GAME.audio.setMaster((Store.settings().vol ?? 70) / 100); }, { once: true });
  } catch (e) {
    showErr('boot failed: ' + (e.stack || e.message));
    $('boot').style.display = 'none';
  }
}
boot();
