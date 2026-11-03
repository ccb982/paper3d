"use strict";

// src/services/map/water/gerstner.ts
var G = 9.81;
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function phaseSpeed(wavelength) {
  const k = 2 * Math.PI / wavelength;
  return Math.sqrt(G / k);
}
function angularFreq(wavelength) {
  const k = 2 * Math.PI / wavelength;
  return Math.sqrt(G * k);
}
function boundSteepness(amplitude, wavelength, wanted) {
  const k = 2 * Math.PI / wavelength;
  const maxQ = 1 / Math.max(1e-4, amplitude * k);
  return Math.min(wanted, maxQ);
}
function swapIntervalFor(count, i, rng) {
  return 2.5 + rng() * 6 + i * 0.9;
}
function makeWaveSet(seed, count, opts) {
  const rng = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const wl = opts.wavelength[0] * Math.pow(opts.wavelength[1] / opts.wavelength[0], t);
    const amp = wl * opts.ampRatio * (0.6 + rng() * 0.8);
    const ang = (rng() - 0.5) * (Math.PI * 2 / 3);
    const dirX = Math.cos(ang), dirZ = Math.sin(ang);
    out.push({
      wavelength: wl,
      amplitude: amp,
      dirX,
      dirZ,
      steepness: boundSteepness(amp, wl, opts.steepness * (0.5 + rng())),
      weight: 1,
      targetWeight: 1,
      swapTimer: swapIntervalFor(count, i, rng)
    });
  }
  return out;
}
function updateWaveSet(waves, dt, time, seed, opts, swapInterval = 6, fadeRate = 0.45) {
  const rng = mulberry32((seed ^ Math.floor(time * 997)) >>> 0);
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    w.swapTimer -= dt;
    if (w.swapTimer <= 0 && w.targetWeight === 1) {
      w.targetWeight = 0;
      w.swapTimer = swapInterval * (0.6 + rng() * 0.8);
    }
    if (w.targetWeight === 0 && w.weight <= 1e-3) {
      const wl = opts.wavelength[0] * Math.pow(
        opts.wavelength[1] / opts.wavelength[0],
        rng()
      );
      const amp = wl * opts.ampRatio * (0.6 + rng() * 0.8);
      const ang = (rng() - 0.5) * (Math.PI * 2 / 3);
      w.wavelength = wl;
      w.amplitude = amp;
      w.dirX = Math.cos(ang);
      w.dirZ = Math.sin(ang);
      w.steepness = boundSteepness(amp, wl, opts.steepness * (0.5 + rng()));
      w.targetWeight = 1;
    }
    const step = fadeRate * dt;
    if (w.weight < w.targetWeight) w.weight = Math.min(w.targetWeight, w.weight + step);
    else if (w.weight > w.targetWeight) w.weight = Math.max(w.targetWeight, w.weight - step);
  }
}
function packWaves(waves) {
  const n = waves.length;
  const a = new Float32Array(n * 4);
  const b = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const w = waves[i];
    const k = 2 * Math.PI / w.wavelength;
    a[i * 4] = w.dirX;
    a[i * 4 + 1] = w.dirZ;
    a[i * 4 + 2] = k;
    a[i * 4 + 3] = w.amplitude * w.weight;
    b[i * 4] = w.steepness;
    b[i * 4 + 1] = angularFreq(w.wavelength);
    b[i * 4 + 2] = w.weight;
    b[i * 4 + 3] = 0;
  }
  return { a, b };
}
function sampleGerstner(waves, x, z, time) {
  let py = 0;
  let nx = 0, ny = 1, nz = 0;
  for (const w of waves) {
    if (w.weight <= 0) continue;
    const k = 2 * Math.PI / w.wavelength;
    const om = angularFreq(w.wavelength);
    const A = w.amplitude * w.weight;
    const Q = w.steepness;
    const f = k * (w.dirX * x + w.dirZ * z) - om * time;
    const cf = Math.cos(f), sf = Math.sin(f);
    py += A * sf;
    nx += -w.dirX * k * A * cf;
    ny += -Q * k * A * sf;
    nz += -w.dirZ * k * A * cf;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return { y: py, nx: nx / len, ny: ny / len, nz: nz / len };
}

// __probe_gerstner.ts
var fails = 0;
function assert(cond, msg) {
  if (!cond) {
    fails++;
    console.log("  FAIL  " + msg);
  } else console.log("  PASS  " + msg);
}
var OPTS = {
  wavelength: [0.6, 14],
  ampRatio: 0.035,
  steepness: 0.85
};
console.log("=== \u2460 \u6DF1\u6C34\u8272\u6563\uFF1A\u957F\u6CE2\u8DD1\u5F97\u5FEB\uFF08c = \u221A(g/k)\uFF09===");
{
  const cLong = phaseSpeed(14), cShort = phaseSpeed(0.6);
  console.log(`  \u03BB=14m \u21D2 c=${cLong.toFixed(2)} m/s\uFF1B\u03BB=0.6m \u21D2 c=${cShort.toFixed(2)} m/s`);
  assert(cLong > cShort, "\u957F\u6CE2\u76F8\u901F\u5EA6 > \u77ED\u6CE2\uFF08\u771F\u5B9E\u6D77\u6D6A\u73B0\u8C61\uFF09");
  const w1 = angularFreq(14), w2 = angularFreq(0.6);
  console.log(`  \u03C9\uFF1A\u03BB=14m \u21D2 ${w1.toFixed(3)}\uFF1B\u03BB=0.6m \u21D2 ${w2.toFixed(3)} rad/s`);
}
console.log("=== \u2461 \u9661\u5EA6\u6709\u754C\uFF08Q\xB7A\xB7k \u2264 1 \u21D2 \u6CE2\u5CF0\u4E0D\u81EA\u4EA4\uFF09===");
{
  let worst = 0;
  for (const amp of [0.02, 0.1, 0.5, 2]) {
    for (const wl of [0.6, 3, 14]) {
      const q = boundSteepness(amp, wl, 0.9);
      const k = 2 * Math.PI / wl;
      worst = Math.max(worst, q * amp * k);
    }
  }
  console.log(`  \u6240\u6709\u7EC4\u5408\u7684 Q\xB7A\xB7k \u6700\u5927\u503C = ${worst.toFixed(4)}\uFF08\u5E94 \u2264 1\uFF09`);
  assert(worst <= 1.0001, "\u9661\u5EA6\u6709\u754C\uFF08\u6CE2\u5CF0\u4E0D\u81EA\u4EA4\uFF09");
}
console.log("=== \u2462 \u6CE2\u96C6\u751F\u6210\uFF1A\u6CE2\u957F\u51E0\u4F55\u7EA7\u6570 + \u65B9\u5411\u96C6\u4E2D ===");
{
  const waves = makeWaveSet(12345, 8, OPTS);
  console.log("  " + waves.map((w) => `\u03BB${w.wavelength.toFixed(1)}/A${w.amplitude.toFixed(3)}`).join(" "));
  assert(waves.length === 8, "8 \u4E2A\u6CE2");
  const wls = waves.map((w) => w.wavelength);
  assert(wls[0] < wls[wls.length - 1], "\u6CE2\u957F\u9012\u589E\uFF08\u957F\u6CE2\u2192\u77ED\u6CE2\uFF09");
  const dirs = waves.map((w) => Math.hypot(w.dirX, w.dirZ));
  assert(dirs.every((d) => Math.abs(d - 1) < 1e-5), "\u65B9\u5411\u5411\u91CF\u5F52\u4E00\uFF08hypot = 1\uFF09");
}
console.log("=== \u2463 \u91C7\u6837\uFF1A\u9AD8\u5EA6\u8303\u56F4\u5408\u7406 + \u6CD5\u7EBF\u662F\u5355\u4F4D\u5411\u91CF ===");
{
  const waves = makeWaveSet(999, 8, OPTS);
  let minY = Infinity, maxY = -Infinity;
  let worstLen = 0;
  for (let i = 0; i < 400; i++) {
    const x = i % 20 * 1.7, z = Math.floor(i / 20) * 2.3;
    const s = sampleGerstner(waves, x, z, 3.5);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
    worstLen = Math.max(worstLen, Math.abs(Math.hypot(s.nx, s.ny, s.nz) - 1));
  }
  console.log(`  \u9AD8\u5EA6\u8303\u56F4 = [${minY.toFixed(3)}, ${maxY.toFixed(3)}] m`);
  console.log(`  \u6CD5\u7EBF |n| \u4E0E 1 \u7684\u6700\u5927\u504F\u5DEE = ${worstLen.toFixed(6)}`);
  assert(worstLen < 1e-5, "\u6CD5\u7EBF\u662F\u5355\u4F4D\u5411\u91CF \u2713");
  assert(maxY - minY > 0.05 && maxY - minY < 3, `\u603B\u8D77\u4F0F ${(maxY - minY).toFixed(2)}m \u5728\u5408\u7406\u8303\u56F4`);
  assert(maxY > 0 && minY < 0, "\u6709\u6B63\u6709\u8D1F\uFF08\u6CE2\u5CF0\u6CE2\u8C37\uFF09");
}
console.log("=== \u2464 \u6DE1\u51FA/\u6DE1\u5165\uFF1A\u67D0\u4E2A\u6CE2\u4F1A\u88AB\u66FF\u6362\u4E3A\u65B0\u53C2\u6570 ===");
{
  const waves = makeWaveSet(42, 8, OPTS);
  const before = waves.map((w) => w.wavelength);
  let replaced = false;
  for (let step = 0; step < 600; step++) {
    updateWaveSet(waves, 1 / 60, step / 60, 42, OPTS, 4, 0.5);
    const after = waves.map((w) => w.wavelength);
    for (let i = 0; i < waves.length; i++) {
      if (Math.abs(after[i] - before[i]) > 1e-6) {
        replaced = true;
        break;
      }
    }
    if (replaced) break;
  }
  console.log(`  10 \u79D2\u5185\u662F\u5426\u6709\u6CE2\u88AB\u66FF\u6362: ${replaced}`);
  assert(replaced, "\u2605 \u6DE1\u51FA/\u6DE1\u5165\u673A\u5236\u5DE5\u4F5C\uFF08\u6CE2\u4F1A\u88AB\u65B0\u53C2\u6570\u66FF\u6362\uFF09");
  assert(waves.every((w) => w.weight >= 0 && w.weight <= 1), "\u6743\u91CD\u5728 [0,1]");
}
console.log("=== \u2465 \u6253\u5305 uniform ===");
{
  const waves = makeWaveSet(7, 6, OPTS);
  const { a, b } = packWaves(waves);
  assert(a.length === 24 && b.length === 24, "6 \u6CE2 \xD7 2 \xD7 vec4");
  assert(Math.abs(a[3] - waves[0].amplitude) < 1e-6, "A.w = \u632F\u5E45\uFF08\u542B\u6743\u91CD\uFF0Cfloat32 \u7CBE\u5EA6\uFF09");
  assert(a[2] > 0, "A.z = \u6CE2\u6570 k\uFF08\u9884\u8BA1\u7B97\uFF09");
  assert(Math.abs(b[1] - angularFreq(waves[0].wavelength)) < 1e-5, "B.y = \u03C9\uFF08float32 \u7CBE\u5EA6\uFF09");
  assert(Math.abs(b[0] - waves[0].steepness) < 1e-5, "B.x = \u9661\u5EA6");
  console.log("  \u2713 uniform \u5E03\u5C40\uFF1Aa=(dirX,dirZ,k,amp) b=(steep,omega,weight,0)");
}
console.log(fails === 0 ? "\n\u5168\u90E8 PASS" : `
${fails} \u9879 FAIL`);
process.exit(fails === 0 ? 0 : 1);
