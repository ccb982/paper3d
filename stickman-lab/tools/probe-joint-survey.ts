/**
 * probe-joint-survey —— ★ 逐关节出力能力普查（"关节正常"的唯一可证伪判据）
 *
 * 设计（用户令 2026-10-16："重做平衡系统和执行器，验证各个关节都能正常发力"）：
 *   1. **关重力**（`world.gravity = 0`）⇒ 排除重力这个混淆变量，只看"τ → 转动"。
 *   2. **不跑 Controller**（直接 `setV4Torques` + `sim.advance`）⇒ 排除平衡系统干扰。
 *   3. 对**每一轴**（18 关节 × 3 轴 = 54 轴）：
 *        · ★★ **每轴开始前整世界重建**（`sim.begin()`，见 `sim.ts:792`）
 *        · 静止 30 拍读基准角 → 注入 +τ 250ms → 读位移 Δθ
 *        · 静止 30 拍读基准角 → 注入 −τ 250ms → 读位移 Δθ（验反向）
 *   4. 判据（每轴三问）：
 *        Q1 有响应吗？    |Δθ| > 1°（否则 = 该轴被吃掉/锁死）
 *        Q2 符号对吗？    sign(Δθ) 与 sign(τ) 一致（否则 = 轴约定不一致）
 *        Q3 力到了吗？    |applied| > τinj×0.5（护栏/通道有没有吃掉）
 *
 * ★★ 为什么用 Δθ 而不是 Δω（本项目踩过的坑，勿回退）：
 *    Δω = (ω₁−ω₀)/T 只在"匀速自由加速"时才对。一旦关节**顶到限位**或**进入准静态平衡**，
 *    ω 会回到 0，于是 Δω ≈ 0 —— 但这个关节**明明转了 83°**（实测 hip_l/2）。
 *    即 Δω 给出的是**假阴性**。位移 Δθ 是"它到底动没动"的直接证据。
 *
 * ★★ 为什么必须每轴重建世界（本项目踩过的坑，勿回退）：
 *    V4 模式（`err=0`、`kPSpring=0`）下**没有位置回位力**：
 *    `setV4Torques(0)` **不是"松手"**，只是"不再施加 τ"——关节会**永久停在被推到的地方**。
 *    实测：hip_l/2 被转到 96° 后，`clearAll()+静止250ms` 只能把它拉回 ~1°，
 *    于是**后测的轴全部建立在被污染的姿态上** ⇒ 串行测量不可独立，Δθ 全乱。
 *    唯一可靠的重置是**整世界重建**（暖启动缓存也一起清掉，见 buildWorld 注释）。
 *
 * 用法：
 *   node tools/run.mjs probe-joint-survey                 # 全 54 轴
 *   node tools/run.mjs probe-joint-survey knee_l 2        # 只测 knee_l 的 axis 2
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
const bg = bgNs as any;
const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
const c = await WebAssembly.compile(fs.readFileSync(p));
const im: any = {};
for (const i of WebAssembly.Module.imports(c)) {
  const impl = (bg as any)[i.name];
  if (typeof impl === 'function') (im[i.module] ??= {})[i.name] = impl;
}
bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const ONLY_JOINT = ARGS[0] ?? null;
const ONLY_AXIS = ARGS[1] !== undefined ? Number(ARGS[1]) : null;

const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
// ★ 让 ragdoll 走 V4（K≡0、纯力矩）路径
env.V4MODE = '1';

const sk = buildSkeleton(DEFAULT_CONFIG) as any;
// ★ 基因组长度直接用 Sim 自己算的 paramCount（构造时已有），不要手推 shape。
let PARAMS = new Float32Array(0);

let sim: any = null;
let d: any = null;

/** ★ 整世界重建 —— 唯一可靠的"干净姿态"手段 */
function freshWorld(): void {
  sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 600 });
  if (PARAMS.length !== sim.paramCount) PARAMS = new Float32Array(sim.paramCount);
  sim.begin(PARAMS);
  d = sim.doll as any;
  (sim as any).world.gravity = { x: 0, y: 0, z: 0 };   // 关重力
}

const HZ = 240;
const DT = 1 / HZ;
const SETTLE = Math.round(0.25 * HZ);
const PULSE = Math.round(0.25 * HZ);
const nj = sk.joints.length;
const tauBuf = new Float64Array(nj * 3);
const rr = new Float64Array(3);

function clearAll(): void { tauBuf.fill(0); d.setV4Torques(tauBuf); }
function runSteps(n: number): void { for (let i = 0; i < n; i++) sim.advance(1); }
function readAngle(jIdx: number, axis: number): number { d.jointRot(jIdx, rr); return rr[axis]!; }

/** 在**全新世界**上测某轴注入 tau 的位移 Δθ(rad) */
function measure(jIdx: number, axis: number, tau: number): {
  dtheta: number; applied: number; a0: number; a1: number;
} {
  freshWorld();
  clearAll();
  runSteps(SETTLE);
  const a0 = readAngle(jIdx, axis);
  tauBuf[jIdx * 3 + axis] = tau;
  d.setV4Torques(tauBuf);
  runSteps(2);
  const applied = d.tauApplied?.[jIdx * 3 + axis] ?? NaN;
  runSteps(PULSE - 2);
  const a1 = readAngle(jIdx, axis);
  return { dtheta: a1 - a0, applied, a0, a1 };
}

console.log('════════ 逐关节出力能力普查（关重力 · 绕开控制器 · 每轴重建世界）════════');
console.log(`关节 ${nj} 个 × 3 轴 = ${nj * 3} 轴；注入窗口 ${(PULSE * DT * 1000).toFixed(0)}ms；世界重建 ${nj * 3} 次`);
console.log('');
console.log('idx | joint/ax     | τmax | dir | applied |  Δθ(°)   | 1响应 2符号 3力到 | 备注');

let pass = 0, fail = 0;
const failures: string[] = [];

for (let jIdx = 0; jIdx < nj; jIdx++) {
  const j = sk.joints[jIdx];
  if (ONLY_JOINT && j.name !== ONLY_JOINT) continue;
  for (let axis = 0; axis < 3; axis++) {
    if (ONLY_AXIS !== null && axis !== ONLY_AXIS) continue;
    const tmax = j.maxTorque?.[axis] ?? 0;
    if (tmax <= 0) continue;
    const tauInj = Math.min(tmax * 0.5, 60);
    // ★ 两个方向各测一次（同一世界不可复用 ⇒ 各重建）
    const rp = measure(jIdx, axis, +tauInj);
    const rn = measure(jIdx, axis, -tauInj);
    const dp = rp.dtheta * 180 / Math.PI;
    const dn = rn.dtheta * 180 / Math.PI;
    // 取绝对值更大的一侧作为"该轴能力"，符号以正向注入为准
    const dth = dp;
    const q1 = Math.max(Math.abs(dp), Math.abs(dn)) > 1.0;
    const q2 = (Math.sign(dp) === Math.sign(dn) * -1) || Math.abs(dp) < 1e-6 || Math.abs(dn) < 1e-6;
    const app = Math.max(Math.abs(rp.applied), Math.abs(rn.applied));
    const q3 = app > tauInj * 0.5;
    const ok = q1 && q2 && q3;
    if (ok) pass++; else { fail++; failures.push(`${j.name}/${axis}`); }
    const note = !q3 ? '力没到(applied低)' : (!q1 ? '几乎不动' : (!q2 ? '双向同号!' : ''));
    console.log(
      `${String(jIdx * 3 + axis).padStart(3)} | ${(j.name + '/' + axis).padEnd(12)} | ${String(tmax).padStart(4)} | ` +
      `+${dp.toFixed(1).padStart(6)} -${dn.toFixed(1).padStart(6)} | ` +
      `${(Number.isFinite(app) ? app.toFixed(1) : 'n/a').padStart(7)} | ${dth.toFixed(2).padStart(8)} | ` +
      `${q1 ? '✔' : '✘'}${q2 ? '✔' : '✘'}${q3 ? '✔' : '✘'} | ${note}`,
    );
  }
}

console.log('');
console.log(`════ 汇总：通过 ${pass} / 失败 ${fail} ════`);
if (failures.length) console.log(`失败轴：${failures.join('  ')}`);
