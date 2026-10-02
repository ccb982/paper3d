// probe-clone —— ★ 把会走的手写 teacher **行为克隆**进神经网络基因组。
//
// 背景（见 架构设计.md §12.10~§12.13）：
// · 手写捕获点控制器会走：0.625 m / 4 步 / 4.32 s；
// · 但它是"状态机 + IK"，塞不进几千个权重；线性化之后只能踩 2 步还倒退。
// 线性化失败的原因是抬腿/换脚是**不连续**决策，而观测到输出是线性组合。
//
// 这里的做法不是"再想一个线性近似"，而是**直接把 teacher 蒸馏进网络**：
//   1. teacher 用 clockDriven 模式跑（换脚由时钟触发 ⇒ 摆动相位完全在观测里，
//      teacher 成为观测的纯函数，不需要任何隐藏记忆）；
//   2. 记下每帧的 (观测, 归一化目标)；
//   3. 用 Adam 把网络训到能复现 teacher 的输出；
//   4. **关掉 teacher**，只用网络跑一遍，看它能不能自己走。
// 第 4 步是唯一的验收标准：克隆得准不准不是重点，自己会不会走才是。

import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints, brainLayout } from '../src/core/brain';
import { CAPTURE_GAIT } from '../src/core/phaseSeed';
import { runCaptureTeacher, type CaptureParams } from '../src/core/teacher';

const require = createRequire(import.meta.url);
{
  const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const f = bg[imp.name];
    if (typeof f === 'function') (imports[imp.module] ??= {})[imp.name] = f;
  }
  const r = (await WebAssembly.instantiate(compiled, imports)) as unknown as
    { instance?: { exports: unknown }; exports: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    r.instance ? r.instance.exports : r.exports,
  );
}

let FAILS = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) FAILS++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

const sk = buildSkeleton(DEFAULT_CONFIG);
const shape = shapeForJoints(sk.joints.length);
const L = brainLayout(shape);
const DUR = 8;

const FB: CaptureParams = {
  T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
  kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
  absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau,
  // ⚠ CAPTURE_GAIT 里**没有** kLat/kLatV/kLatSwing 三个字段（探针里显式给 0）。
  //   这里如果直接引用就会是 undefined ⇒ 一路 NaN（实测位移 NaN、观测 σ NaN）。
  kLat: 0, kLatV: 0, kLatSwing: 0,
};

// ★ 时钟驱动时，步态周期 T 必须正好等于时钟周期 1/gaitHz，
//   否则"抬到第几步"在观测里对不上（sin/cos 解不出 t/T）。
const GAIT_HZ = 1 / FB.T;
const simCfg = { ...DEFAULT_SIM, mode: 'walk' as const, duration: DUR, gaitHz: GAIT_HZ };

console.log('=== 行为克隆：把 teacher 蒸馏进网络 ===\n');

// ── 1. teacher 自己（时钟驱动）还能不能走？──
// 克隆的数据来自时钟驱动模式，所以先确认它在那个模式下也会走（否则克隆的是一坨垃圾）
const teacherRun = (clockDriven: boolean): { x: number; t: number; steps: number; alive: boolean; data?: { X: number[][]; A: number[][] } } => {
  const sim = new Sim(sk, shape, simCfg);
  sim.begin(new Float32Array(sim.params.length));
  const data = { X: [] as number[][], A: [] as number[][] };
  const r = runCaptureTeacher(sk, sim, FB, { dur: DUR, clockDriven, record: true, data });
  return { x: r.x, t: r.t, steps: r.steps, alive: r.alive, data };
};

const ev = teacherRun(false);
const cd = teacherRun(true);
console.log(`  teacher（状态触发换脚）  位移 ${ev.x.toFixed(3)}m 存活 ${ev.t.toFixed(2)}s 换脚 ${ev.steps}`);
console.log(`  teacher（时钟驱动换脚）  位移 ${cd.x.toFixed(3)}m 存活 ${cd.t.toFixed(2)}s 换脚 ${cd.steps}`
  + `   样本 ${cd.data?.X.length ?? 0} 帧`);
check('teacher 时钟驱动模式也会迈步（否则别克隆）', cd.steps >= 1, `换脚 ${cd.steps}`);
if (cd.steps < 1) {
  console.log('\n★ clone 有 1 条 FAIL（teacher 时钟驱动不会走，无从克隆）');
  process.exit(1);
}

// ── 2. 采多条轨迹（不同初始扰动 ⇒ 数据集有覆盖）──
const X: number[] = [], A: number[] = [];
{
  const data = { X: [] as number[][], A: [] as number[][] };
  // ★ 数据集要有覆盖：跑一个**参数族**（目标速度 ±10%、周期 ±5%、抬腿 ±20%），
  //   而不是同一条轨迹复制 6 遍 —— 否则网络会把 teacher 拟合成记忆而不是规则。
  let vi = 0;
  for (const dv of [-0.1, -0.05, 0, 0.05, 0.1]) {
    for (const dT of [-0.05, 0, 0.05]) {
      const p: CaptureParams = { ...FB, vDes: FB.vDes * (1 + dv), T: FB.T * (1 + dT), lift: FB.lift * (1 + vi++ % 3 * 0.2) };
      const sim = new Sim(sk, shape, { ...simCfg, gaitHz: 1 / p.T });
      sim.begin(new Float32Array(sim.params.length));
      runCaptureTeacher(sk, sim, p, { dur: DUR, clockDriven: true, record: true, data });
    }
  }
  for (let i = 0; i < data.X.length; i++) { X.push(...data.X[i]!); A.push(...data.A[i]!); }
}
const N = X.length / shape.inputs, M = shape.outputs;
console.log(`  数据集：${N} 帧 × ${shape.inputs} 维观测 → ${M} 维目标`);

// ── 3. 标准化 + Adam ──
// ★ 必须标准化：观测里混着 ±3 的归一化量和 1e-3 的脚位置，不标准化的话
//   小量级的维度梯度几乎为 0，克隆会只学会"什么都不做"。
const xm = new Float64Array(shape.inputs), xs = new Float64Array(shape.inputs);
for (let n = 0; n < N; n++) {
  for (let i = 0; i < shape.inputs; i++) xm[i]! += X[n * shape.inputs + i]!;
}
for (let i = 0; i < shape.inputs; i++) xm[i]! /= N;
for (let n = 0; n < N; n++) {
  for (let i = 0; i < shape.inputs; i++) {
    const d = X[n * shape.inputs + i]! - xm[i]!;
    xs[i]! += d * d;
  }
}
for (let i = 0; i < shape.inputs; i++) xs[i] = Math.max(1e-3, Math.sqrt(xs[i]! / N));
console.log('  观测范围：'
  + `sin ±${Math.max(...Array.from(xs, (v, i) => Math.abs(xm[i]!) / v)).toFixed(1)}σ`
  + ` · 常数维 ${Array.from(xs).filter((v) => v <= 1e-3 + 1e-12).length} 个`);

const am = new Float64Array(M), as = new Float64Array(M);
for (let n = 0; n < N; n++) for (let o = 0; o < M; o++) am[o]! += A[n * M + o]!;
for (let o = 0; o < M; o++) am[o]! /= N;
for (let n = 0; n < N; n++) {
  for (let o = 0; o < M; o++) { const d = A[n * M + o]! - am[o]!; as[o]! += d * d; }
}
for (let o = 0; o < M; o++) as[o] = Math.max(1e-3, Math.sqrt(as[o]! / N));

const TOT = L.total;
const w = new Float64Array(TOT);
for (let h = 0; h < shape.hidden; h++) for (let i = 0; i < shape.inputs; i++) {
  w[L.w1 + h * shape.inputs + i] = (Math.sin(h * 12.9898 + i * 78.233) * 43758.5453 % 1) * 0.1;
}
for (let o = 0; o < M; o++) for (let h = 0; h < shape.hidden; h++) {
  w[L.w2 + o * shape.hidden + h] = (Math.sin(o * 39.3468 + h * 11.135) * 24634.6345 % 1) * 0.1;
}

const gW = new Float64Array(TOT), vW = new Float64Array(TOT);
const gw = new Float64Array(TOT), gh = new Float64Array(shape.hidden), go = new Float64Array(M);
const nb = new Float64Array(shape.inputs);
const BATCH = Math.min(256, N);
const lr = 3e-3, b1 = 0.9, b2 = 0.999, eps = 1e-8;
let adamT = 0;

const forward = (n: number): { loss: number } => {
  for (let i = 0; i < shape.inputs; i++) nb[i] = (X[n * shape.inputs + i]! - xm[i]!) / xs[i]!;
  let loss = 0;
  for (let h = 0; h < shape.hidden; h++) {
    let acc = w[L.b1 + h]!;
    const row = L.w1 + h * shape.inputs;
    for (let i = 0; i < shape.inputs; i++) acc += w[row + i]! * nb[i]!;
    gh[h] = Math.tanh(acc);
  }
  for (let o = 0; o < M; o++) {
    let acc = w[L.b2 + o]!;
    const row = L.w2 + o * shape.hidden;
    for (let h = 0; h < shape.hidden; h++) acc += w[row + h]! * gh[h]!;
    go[o] = Math.tanh(acc);
    const d = go[o]! - (A[n * M + o]! - am[o]!) / as[o]!;
    loss += d * d;
  }
  return { loss: loss / M };
};

const ITERS = 4000;
let lastLoss = 0;
for (let it = 0; it < ITERS; it++) {
  gW.fill(0);
  let loss = 0;
  for (let b = 0; b < BATCH; b++) loss += forward((it * BATCH + b) % N).loss;
  loss /= BATCH;
  lastLoss = loss;
  // 反向传播（在这个 batch 上累加梯度）
  for (let b = 0; b < BATCH; b++) {
    const n = (it * BATCH + b) % N;
    for (let i = 0; i < shape.inputs; i++) nb[i] = (X[n * shape.inputs + i]! - xm[i]!) / xs[i]!;
    for (let h = 0; h < shape.hidden; h++) {
      let acc = w[L.b1 + h]!;
      const row = L.w1 + h * shape.inputs;
      for (let i = 0; i < shape.inputs; i++) acc += w[row + i]! * nb[i]!;
      gh[h] = Math.tanh(acc);
    }
    for (let o = 0; o < M; o++) {
      let acc = w[L.b2 + o]!;
      const row = L.w2 + o * shape.hidden;
      for (let h = 0; h < shape.hidden; h++) acc += w[row + h]! * gh[h]!;
      go[o] = Math.tanh(acc);
      const e = (go[o]! - (A[n * M + o]! - am[o]!) / as[o]!) * (2 / (M * BATCH));
      for (let h = 0; h < shape.hidden; h++) gw[L.w2 + o * shape.hidden + h]! += e * gh[h]!;
      gw[L.b2 + o]! += e;
    }
    // 隐层梯度（用输出层权重一次性算完）
    const dh = new Float64Array(shape.hidden);
    for (let o = 0; o < M; o++) {
      const e = (go[o]! - (A[n * M + o]! - am[o]!) / as[o]!) * (2 / (M * BATCH));
      const row = L.w2 + o * shape.hidden;
      for (let h = 0; h < shape.hidden; h++) dh[h]! += e * w[row + h]!;
    }
    for (let h = 0; h < shape.hidden; h++) {
      const d = dh[h]! * (1 - gh[h]! * gh[h]!);
      gw[L.b1 + h]! += d;
      const row = L.w1 + h * shape.inputs;
      for (let i = 0; i < shape.inputs; i++) gw[row + i]! += d * nb[i]!;
    }
  }
  adamT++;
  for (let k = 0; k < TOT; k++) {
    gW[k] = Math.max(-5, Math.min(5, gW[k]!));
    vW[k] = b1 * vW[k]! + (1 - b1) * gW[k]!;
    gW[k] = b2 * gW[k]! + (1 - b2) * gW[k]! * gW[k]!;
    w[k] = w[k]! - lr * (vW[k]! / (1 - Math.pow(b1, adamT))) / (Math.sqrt(gW[k]!) + eps);
  }
  if (it % 500 === 0 || it === ITERS - 1) {
    console.log(`    iter ${String(it).padStart(4)}  MSE ${lastLoss.toFixed(4)}`);
  }
}
console.log(`  训练完成：MSE ${lastLoss.toFixed(4)}（标准化后，1.0 = 完全没学到）`);

// ── 4. 验收：关掉 teacher，只用网络跑 ──
const genome = new Float32Array(TOT);
for (let k = 0; k < TOT; k++) genome[k] = w[k]!;

const solo = (): { x: number; t: number; steps: number; alive: boolean } => {
  const sim = new Sim(sk, shape, simCfg);
  sim.begin(genome);
  let n = 0;
  while (!sim.finished) { sim.advance(1); n++; }
  return { x: sim.distance, t: n / 120, steps: sim.terms.altCount ?? 0, alive: !sim.fallen };
};
const s0 = solo();
const zero = ((): number => {
  const sim = new Sim(sk, shape, simCfg);
  sim.begin(new Float32Array(TOT));
  let n = 0;
  while (!sim.finished) { sim.advance(1); n++; }
  return sim.distance;
})();

console.log('');
console.log(`  ★ 克隆网络单独跑: 位移 ${s0.x.toFixed(3)}m 存活 ${s0.t.toFixed(2)}s 换脚 ${s0.steps} 活满=${s0.t >= DUR}`);
console.log(`  ℹ 零输出基线位移 ${zero.toFixed(3)}m · teacher(时钟驱动) 位移 ${cd.x.toFixed(3)}m / 换脚 ${cd.steps}`);
check('克隆网络踩出单腿支撑（换脚 ≥ 2）', s0.steps >= 2, `换脚 ${s0.steps}`);
check('克隆网络方向为正', s0.x > 0.05, `${s0.x.toFixed(3)} m`);
check('克隆网络活满 6 s', s0.t >= 6, `${s0.t.toFixed(2)}s`);

fs.mkdirSync('.tmp', { recursive: true });
fs.writeFileSync('.tmp/cloned-genome.json', JSON.stringify(Array.from(genome)));
console.log('');
console.log(FAILS === 0 ? '★ clone 全部通过（基因组已存 .tmp/cloned-genome.json）' : `★ clone 有 ${FAILS} 条 FAIL`);
