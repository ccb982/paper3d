// ============================================================
// genome —— 基因组（= 网络权重的扁平向量）的初始化 / 变异 / 杂交 / 序列化
// ============================================================
// ★ 序列化用 base64 而不是 JSON 数字数组：750 个 float32 = 3000 字节 →
//   base64 后 4 KB 左右；写成 JSON 数组会变成 ~8 KB 且解析慢。
//   内置进本体时直接当字符串常量塞进源码即可。

import { brainLayout, brainParamCount, type BrainShape } from './brain';

// ---------------------------------------------------------------- 可复现随机

/** mulberry32：小而快、可播种 —— 训练过程可复现（同一 seed 同一结果） */
export type RngState = { s: number };
export type Rng = (() => number) & {
  /** ★ 取/设内部状态（存档用：刷新页面后训练能从原来那一步继续，而不是从头） */
  getState?: () => RngState;
  setState?: (st: RngState) => void;
};

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const f = ((): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  f.getState = (): RngState => ({ s: a });
  f.setState = (st: RngState): void => { a = st.s >>> 0; };
  return f;
}

/** 标准正态（Box–Muller），缓存第二个样本避免每次算两次 log/sqrt */
export type Gauss = (() => number) & {
  /** ★ 取/设状态（含 Box–Muller 的**缓存样本**）—— 少了它存档往返就不一致 */
  getState?: () => { s: number; spare: number; hasSpare: boolean };
  setState?: (st: { s: number; spare: number; hasSpare: boolean }) => void;
};

export function makeGaussian(rng: Rng): Gauss {
  let spare = 0;
  let hasSpare = false;
  const f = ((): number => {
    if (hasSpare) { hasSpare = false; return spare; }
    let u = 0, v = 0, s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * m;
    hasSpare = true;
    return u * m;
  }) as Gauss;
  f.getState = () => ({ s: rng.getState ? rng.getState().s : 0, spare, hasSpare });
  f.setState = (st) => {
    if (rng.setState && st) rng.setState({ s: st.s });
    spare = st?.spare ?? 0;
    hasSpare = st?.hasSpare ?? false;
  };
  return f;
}

// ---------------------------------------------------------------- 初始化

/**
 * 随机初始基因组（★ 按扇入缩放，不是所有参数同一个 std）。
 *
 * 2D 时代是"所有参数同一个 std=1.2"，那是因为输入只有 27 维、勉强能用。
 * 3D 之后输入 70 维：若仍用同一个 std，第一层预激活的方差会随输入维度线性膨胀
 * （std ≈ 1.2·√70 ≈ 10），tanh 直接全部饱和到 ±1 ⇒ 一开局全种群都是"抽风"，
 * 而且变异 sigma 相对权重尺度小了 10 倍，等于在搜索空间里挪不动。
 *
 * 现在：W1 ~ N(0, scale/√inputs)，W2 ~ N(0, scale/√hidden)，偏置全 0。
 *
 * ★★ 但**不要**以为这样就得到"输出 ≈ 0"（本项目真踩过这个坑，见 evolution.seedPopulation）：
 *   预激活仍是 O(0.5)（实测 tanh 后 |out| ~ 0.4），也就是一开局全员按 40% 量程乱扯关节。
 *   想要"什么都不做"的起点，必须显式地用**全 0 基因组**（tanh(0) = 0 ⇒ θ_ref = 0 ⇒
 *   保持绑定姿态），它已经作为平凡解被放进初始种群。
 */
export function randomGenome(
  s: BrainShape, gauss: () => number, scale = 1.0,
): Float32Array {
  const g = new Float32Array(brainParamCount(s));
  const L = brainLayout(s);
  const s1 = scale / Math.sqrt(s.inputs);
  const s2 = scale / Math.sqrt(s.hidden);
  for (let h = 0; h < s.hidden; h++) {
    const row = L.w1 + h * s.inputs;
    for (let i = 0; i < s.inputs; i++) g[row + i] = gauss() * s1;
  }
  for (let o = 0; o < s.outputs; o++) {
    const row = L.w2 + o * s.hidden;
    for (let h = 0; h < s.hidden; h++) g[row + h] = gauss() * s2;
  }
  // b1 / b2 保持 0（Float32Array 本来就是 0）；显式写出来是为了说明这是有意为之
  return g;
}

// ---------------------------------------------------------------- 变异 / 杂交

/**
 * 变异：每个参数以 prob 概率加上 N(0, sigma)。
 * dst 与 src 可以是同一个数组（原地变异）。
 */
export function mutateInto(
  src: Float32Array, dst: Float32Array, sigma: number, prob: number, rng: Rng, gauss: () => number,
): void {
  for (let i = 0; i < src.length; i++) {
    dst[i] = rng() < prob ? src[i] + gauss() * sigma : src[i];
  }
}

/** 混合杂交（每个参数按随机比例混合）—— 比均匀杂交更平滑，ES 里更常用 */
export function blendInto(a: Float32Array, b: Float32Array, dst: Float32Array, rng: Rng): void {
  for (let i = 0; i < a.length; i++) {
    const t = rng();
    dst[i] = a[i] * t + b[i] * (1 - t);
  }
}

// ---------------------------------------------------------------- 序列化

/** Float32Array → base64（小端） */
export function genomeToBase64(g: Float32Array): string {
  const bytes = new Uint8Array(g.buffer, g.byteOffset, g.byteLength);
  let s = '';
  const CHUNK = 0x8000; // 分块避免 apply 参数上限
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/** base64 → Float32Array */
export function genomeFromBase64(b64: string): Float32Array {
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

/** 给本体用的存档结构（JSON.stringify 后仍很小） */
export interface GenomeFile {
  v: 1;
  shape: BrainShape;
  /** 训练元信息，纯记录 */
  meta?: { gen?: number; fitness?: number; seed?: number; note?: string };
  /** base64 的 float32 权重 */
  data: string;
}

export function packGenome(g: Float32Array, shape: BrainShape, meta?: GenomeFile['meta']): string {
  const file: GenomeFile = { v: 1, shape, meta, data: genomeToBase64(g) };
  return JSON.stringify(file);
}

export function unpackGenome(text: string): { g: Float32Array; shape: BrainShape; meta?: GenomeFile['meta'] } {
  const file = JSON.parse(text) as GenomeFile;
  if (file.v !== 1 || !file.shape || typeof file.data !== 'string') {
    throw new Error('[genome] 存档格式不对，缺少 v/shape/data');
  }
  const g = genomeFromBase64(file.data);
  const want = brainParamCount(file.shape);
  if (g.length !== want) {
    throw new Error(`[genome] 权重长度 ${g.length} ≠ 形状 ${file.shape.inputs}/${file.shape.hidden}/${file.shape.outputs} 所需 ${want}`);
  }
  return { g, shape: file.shape, meta: file.meta };
}
