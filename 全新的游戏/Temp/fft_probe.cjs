"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/services/map/WaterFFT.ts
var WaterFFT_exports = {};
__export(WaterFFT_exports, {
  DEFAULT_OCEAN_LAYERS: () => DEFAULT_OCEAN_LAYERS,
  OCEAN_WIND: () => OCEAN_WIND,
  bakeOceanField: () => bakeOceanField,
  defaultOceanParams: () => defaultOceanParams
});
module.exports = __toCommonJS(WaterFFT_exports);
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
function makeGauss(rng) {
  const base = () => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
  return base;
}
function complexFFT(re, im, N, sign) {
  for (let i = 0, j = 0; i < N - 1; i++) {
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
    let m = N >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = sign * (2 * Math.PI / len);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k + half], ai = im[i + k + half];
        const tr = cr * ar - ci * ai;
        const ti = cr * ai + ci * ar;
        re[i + k + half] = re[i + k] - tr;
        im[i + k + half] = im[i + k] - ti;
        re[i + k] += tr;
        im[i + k] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}
var OCEAN_WIND = { x: 0.35, z: 0.94 };
var DEFAULT_OCEAN_LAYERS = [
  { tileSize: 96, N: 64, amp: 0.07, chop: 0.05 },
  // L0 涌浪：长波 96m，面的大起伏
  { tileSize: 40, N: 128, amp: 0.045, chop: 0.09 },
  // L1 主波：中波，起伏+波峰
  { tileSize: 14, N: 128, amp: 8e-3, chop: 0.04 }
  // L2 细节：弱化（防抖动，仅片元微扰）
];
function defaultOceanParams(seed) {
  return {
    seed,
    windX: OCEAN_WIND.x,
    windZ: OCEAN_WIND.z,
    windSpeed: 9,
    layers: DEFAULT_OCEAN_LAYERS,
    variants: 2
  };
}
function bakeLayer(N, tileSize, windX, windZ, L, seed, amp, chop) {
  const invG = 1 / 9.81;
  const wLen = Math.hypot(windX, windZ) || 1;
  const wx = windX / wLen, wz = windZ / wLen;
  const n2 = N * N;
  const SpR = new Float32Array(n2);
  const SpI = new Float32Array(n2);
  const gauss = makeGauss(mulberry32(seed & 4294967295));
  const k0 = 2 * Math.PI / tileSize;
  const filled = new Uint8Array(n2);
  for (let fx = 0; fx < N; fx++) {
    const kx = (fx < N / 2 ? fx : fx - N) * k0;
    for (let fy = 0; fy < N; fy++) {
      const idx = fy * N + fx;
      if (filled[idx]) continue;
      const ky = (fy < N / 2 ? fy : fy - N) * k0;
      const k = Math.hypot(kx, ky);
      let A = 0;
      if (k > 1e-6) {
        const kL = k * L;
        const dir = wx * (kx / k) + wz * (ky / k);
        const d22 = Math.max(dir, 0);
        A = Math.sqrt(Math.exp(-1 / (kL * kL)) / (k * k * k * k) * d22 * d22);
      }
      SpR[idx] = A * gauss();
      SpI[idx] = A * gauss();
      filled[idx] = 1;
      const mx = (N - fx) % N, my = (N - fy) % N;
      const mid = my * N + mx;
      if (mid !== idx) {
        SpR[mid] = SpR[idx];
        SpI[mid] = -SpI[idx];
        filled[mid] = 1;
      }
    }
  }
  const scale = 1 / (N * N);
  const ifftInt = (srcR, srcI) => {
    const r = new Float32Array(srcR);
    const c = new Float32Array(srcI);
    for (let fy = 0; fy < N; fy++) {
      complexFFT(r.subarray(fy * N, fy * N + N), c.subarray(fy * N, fy * N + N), N, -1);
    }
    const cr = new Float32Array(N * N), ci = new Float32Array(N * N);
    for (let fy = 0; fy < N; fy++) {
      for (let fx = 0; fx < N; fx++) {
        cr[fy * N + fx] = r[fx * N + fy];
        ci[fy * N + fx] = c[fx * N + fy];
      }
    }
    for (let fx = 0; fx < N; fx++) {
      const segR = cr.subarray(fx * N, fx * N + N);
      const segI = ci.subarray(fx * N, fx * N + N);
      complexFFT(segR, segI, N, -1);
      for (let fy = 0; fy < N; fy++) cr[fy * N + fx] = segR[fy] * scale;
    }
    return cr;
  };
  const hRaw = ifftInt(SpR, SpI);
  const dxR = new Float32Array(n2), dxI = new Float32Array(n2);
  const dzR = new Float32Array(n2), dzI = new Float32Array(n2);
  for (let fx = 0; fx < N; fx++) {
    const kx = (fx < N / 2 ? fx : fx - N) * k0;
    for (let fy = 0; fy < N; fy++) {
      const idx = fy * N + fx;
      const ky = (fy < N / 2 ? fy : fy - N) * k0;
      const k = Math.hypot(kx, ky);
      if (k > 1e-6) {
        const s = SpI[idx], c_ = SpR[idx];
        dxR[idx] = kx / k * s;
        dxI[idx] = -(kx / k) * c_;
        dzR[idx] = ky / k * s;
        dzI[idx] = -(ky / k) * c_;
      }
    }
  }
  const d1 = ifftInt(dxR, dxI);
  const d2 = ifftInt(dzR, dzI);
  const rmsH = (() => {
    let s = 0;
    for (let i = 0; i < n2; i++) s += hRaw[i] * hRaw[i];
    return Math.sqrt(s / n2 + 1e-12);
  })();
  const h = new Float32Array(n2);
  const hGain = amp / rmsH;
  for (let i = 0; i < n2; i++) h[i] = hRaw[i] * hGain;
  const dArr = new Float32Array(n2 * 2);
  {
    let s = 0;
    for (let i = 0; i < n2; i++) s += d1[i] * d1[i] + d2[i] * d2[i];
    const rmsD = Math.sqrt(s / (n2 * 2) + 1e-12);
    const dGain = chop * (tileSize / N) * 4 / rmsD;
    for (let i = 0; i < n2; i++) {
      dArr[i] = d1[i] * dGain;
      dArr[n2 + i] = d2[i] * dGain;
    }
  }
  const dx = tileSize / N;
  const n = new Float32Array(n2 * 3);
  const slopeK = 1 / dx;
  for (let y = 0; y < N; y++) {
    const ym = (y - 1 + N) % N, yp = (y + 1) % N;
    for (let x = 0; x < N; x++) {
      const xm = (x - 1 + N) % N, xp = (x + 1) % N;
      const sx = (h[y * N + xp] - h[y * N + xm]) * slopeK * 0.5;
      const sz = (h[yp * N + x] - h[ym * N + x]) * slopeK * 0.5;
      const inv = 1 / Math.sqrt(sx * sx + sz * sz + 1);
      n[(y * N + x) * 3] = -sx * inv;
      n[(y * N + x) * 3 + 1] = inv;
      n[(y * N + x) * 3 + 2] = -sz * inv;
    }
  }
  return { h, d: dArr, n };
}
function bakeOceanField(p) {
  const L = p.windSpeed * p.windSpeed / 9.81;
  const tiles = [];
  for (const lc of p.layers) {
    const vs = [];
    for (let v = 0; v < p.variants; v++) {
      const seed = (p.seed ^ 2654435769) + v * 2654435761 + lc.N * 31;
      vs.push(bakeLayer(lc.N, lc.tileSize, p.windX, p.windZ, L, seed >>> 0, lc.amp, lc.chop));
    }
    tiles.push(vs);
  }
  return tiles;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_OCEAN_LAYERS,
  OCEAN_WIND,
  bakeOceanField,
  defaultOceanParams
});
