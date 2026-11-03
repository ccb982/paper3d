// ============================================================
// gerstner —— ★ 解析 Gerstner 波场（2026-11-03 渲染重做 · GPU Gems 1 Ch.1）
// ============================================================
// 依据：NVIDIA《Effective Water Simulation from Physical Models》(GPU Gems 1, Ch.1)
//   「一个用于**表面网格的几何波动**，一个用于**法线图**的扰动」
//   「用简单的周期波叠加表示水面高度」
//   「在约束内**随机产生波参数**；随时间**把某个波淡出，再以一组不同参数淡入**」
//
// ★ 为什么换掉「贴图采样的 FFT 波」：
//   贴图采样必然有接缝（fract 边界 / mipmap 串色）⇒ 每个波长一条白线、互相交叉、过于均匀。
//   解析波（sin/cos）**没有任何采样** ⇒ 接缝从根上不存在。
//
// ★ 物理：
//   k = 2π / L（角频率）      深水色散：相速度 c = √(g/k) ⇒ 相位常数 ω = c·k = √(g·k)
//   f = k·dot(D, p) − ω·t      D = 水平传播方向（单位向量）
//   位移：Px += Q·A·Dx·cos(f)   Pz += Q·A·Dz·cos(f)   Py += A·sin(f)
//   法线（解析，GPU Gems Eq.6b）：N = (−Dx·k·A·cos f, 1 − Q·k·A·sin f, −Dz·k·A·cos f)
//   陡度有界：Q·A·k ≤ 1 ⇒ 波峰变尖但**不自交**。
// ============================================================

/** 重力加速度（m/s²） */
const G = 9.81;

export interface GerstnerWave {
  /** 波长（m） */
  wavelength: number;
  /** 振幅（m） */
  amplitude: number;
  /** 传播方向（水平单位向量） */
  dirX: number;
  dirZ: number;
  /** 陡度（0~1；有界 Q·A·k ≤ 1） */
  steepness: number;
  /** 当前权重（0~1：淡出/淡入用） */
  weight: number;
  /** 目标权重（1 = 完全在用） */
  targetWeight: number;
  /** ★ 距下次开始淡出的秒数（每波独立计时 ⇒ 不会每帧都触发） */
  swapTimer: number;
}

/** 波参数生成约束：波长区间（m）与振幅区间（m） */
export interface WaveGenOpts {
  /** 波长范围 [min, max]（m） */
  wavelength: [number, number];
  /** 振幅相对波长的比例上限（振幅 = ratio × L） */
  ampRatio: number;
  /** 陡度上限 */
  steepness: number;
}

/** 确定性 RNG（mulberry32） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 单波的相速度（深水色散）：c = √(g/k) */
export function phaseSpeed(wavelength: number): number {
  const k = (2 * Math.PI) / wavelength;
  return Math.sqrt(G / k);
}

/** 单波的角频率：ω = √(g·k) */
export function angularFreq(wavelength: number): number {
  const k = (2 * Math.PI) / wavelength;
  return Math.sqrt(G * k);
}

/** 有界陡度：保证 Q·A·k ≤ 1（波峰不自交） */
export function boundSteepness(amplitude: number, wavelength: number, wanted: number): number {
  const k = (2 * Math.PI) / wavelength;
  const maxQ = 1 / Math.max(1e-4, amplitude * k);
  return Math.min(wanted, maxQ);
}

/** 生成一组随机波（约束内） */
/** 每波的首次淡出计时（错开 ⇒ 不会同时淡出） */
function swapIntervalFor(count: number, i: number, rng: () => number): number {
  return 2.5 + rng() * 6 + i * 0.9;
}

export function makeWaveSet(seed: number, count: number, opts: WaveGenOpts): GerstnerWave[] {
  const rng = mulberry32(seed);
  const out: GerstnerWave[] = [];
  for (let i = 0; i < count; i++) {
    // 波长：按几何级数分布（长波少、短波多）
    const t = (i + 0.5) / count;
    const wl = opts.wavelength[0] * Math.pow(opts.wavelength[1] / opts.wavelength[0], t);
    // ★ 起伏高度**随机**（用户 2026-11-03：「起伏高度改为随机的就行」）：
    //   振幅只**弱相关**于波长（√λ 而非 λ）⇒ 大浪不必最大、小浪也可有起伏
    //   ⇒ 高度参差、无规律感（随机因子 0.3~2.5）。
    const amp = Math.sqrt(wl) * opts.ampRatio * 3 * (0.3 + rng() * 2.2);
    // 方向：以主风向为中心 ±60° 随机
    const ang = (rng() - 0.5) * (Math.PI * 2 / 3);
    const dirX = Math.cos(ang), dirZ = Math.sin(ang);
    out.push({
      wavelength: wl,
      amplitude: amp,
      dirX, dirZ,
      steepness: boundSteepness(amp, wl, opts.steepness * (0.5 + rng())),
      weight: 1,
      targetWeight: 1,
      swapTimer: swapIntervalFor(count, i, rng),
    });
  }
  return out;
}

/**
 * ★ 淡出 / 淡入（GPU Gems 原话）：
 *   「随时间的变化，我们会不断将某个波淡出，然后再以一组不同的参数将其淡入」
 *
 * 做法：每 `swapInterval` 秒选一个波开始淡出（weight → 0），
 *   淡出完成后用**新的随机参数**替换它并淡入（weight → 1）。
 */
export function updateWaveSet(
  waves: GerstnerWave[],
  dt: number,
  time: number,
  seed: number,
  opts: WaveGenOpts,
  swapInterval: number = 6,
  fadeRate: number = 0.45,
): void {
  const rng = mulberry32((seed ^ Math.floor(time * 997)) >>> 0);
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    // ★ 每波**独立计时**（2026-11-03 修正）：旧实现用全局 phase 判命中 ⇒ 每帧都可能触发淡出
    //   ⇒ 权重在 0↔1 振荡 ⇒ 「只有部分位置有水纹理」。
    w.swapTimer -= dt;
    if (w.swapTimer <= 0 && w.targetWeight === 1) {
      // 选中这个波淡出（淡出期间不重复触发）
      w.targetWeight = 0;
      w.swapTimer = swapInterval * (0.6 + rng() * 0.8);
    }
    if (w.targetWeight === 0 && w.weight <= 0.001) {
      // 淡出完成 ⇒ 用新参数替换并淡入
      const wl = opts.wavelength[0] * Math.pow(
        opts.wavelength[1] / opts.wavelength[0],
        rng(),
      );
      const amp = Math.sqrt(wl) * opts.ampRatio * 3 * (0.3 + rng() * 2.2);
      const ang = (rng() - 0.5) * (Math.PI * 2 / 3);
      w.wavelength = wl;
      w.amplitude = amp;
      w.dirX = Math.cos(ang);
      w.dirZ = Math.sin(ang);
      w.steepness = boundSteepness(amp, wl, opts.steepness * (0.5 + rng()));
      w.targetWeight = 1;
    }
    // 权重渐变
    const step = fadeRate * dt;
    if (w.weight < w.targetWeight) w.weight = Math.min(w.targetWeight, w.weight + step);
    else if (w.weight > w.targetWeight) w.weight = Math.max(w.targetWeight, w.weight - step);
  }
}

/**
 * 打包成 shader uniform（每波 2 个 vec4）：
 *   A = (dirX, dirZ, amplitude, steepness)
 *   B = (omega, weight, 0, 0)
 * ⇒ GPU Gems 的 P.x/P.y 位移与解析法线都能直接用。
 */
export function packWaves(waves: GerstnerWave[]): { a: Float32Array; b: Float32Array } {
  const n = waves.length;
  const a = new Float32Array(n * 4);
  const b = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const w = waves[i];
    const k = (2 * Math.PI) / w.wavelength;
    a[i * 4] = w.dirX;
    a[i * 4 + 1] = w.dirZ;
    a[i * 4 + 2] = k;              // ★ 波数（预计算 ⇒ shader 不用再除）
    a[i * 4 + 3] = w.amplitude * w.weight;
    b[i * 4] = w.steepness;
    b[i * 4 + 1] = angularFreq(w.wavelength);
    b[i * 4 + 2] = w.weight;
    b[i * 4 + 3] = 0;
  }
  return { a, b };
}

/**
 * ★ CPU 侧参考实现（与 shader 公式一致）—— 供探针对账 / 需要水面高度时用
 *   （如角色浮沉、物体漂浮）。
 */
export function sampleGerstner(
  waves: GerstnerWave[],
  x: number,
  z: number,
  time: number,
): { y: number; nx: number; ny: number; nz: number } {
  let py = 0;
  let nx = 0, ny = 1, nz = 0;
  for (const w of waves) {
    if (w.weight <= 0) continue;
    const k = (2 * Math.PI) / w.wavelength;
    const om = angularFreq(w.wavelength);
    const A = w.amplitude * w.weight;
    const Q = w.steepness;
    const f = k * (w.dirX * x + w.dirZ * z) - om * time;
    const cf = Math.cos(f), sf = Math.sin(f);
    py += A * sf;
    // 解析法线（GPU Gems Eq.6b）
    nx += -w.dirX * k * A * cf;
    ny += -Q * k * A * sf;
    nz += -w.dirZ * k * A * cf;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return { y: py, nx: nx / len, ny: ny / len, nz: nz / len };
}
