/**
 * probe-joint-isolated —— ★ 隔离普查：证明"响应小"是被限位/邻关节阻尼吸收，还是真锁死
 *
 * probe-joint-survey 显示大量腿/脊柱轴"注力却几乎不动"。本探针分三档隔离：
 *   A 档 默认（与 survey 同）
 *   B 档 关闭**所有关节的阻尼**（`kd=0`）——若 Δω 变大 ⇒ 是阻尼吸收
 *   C 档 把**其它关节全部设为刚性锁定**（大 kP 到当前角）——若 Δω 变大 ⇒ 是邻关节串动
 *   D 档 直接看**限位是否已顶住**：读 jointRot 与 limits 的距离
 *
 * 用法：node tools/run.mjs probe-joint-isolated hip_l 2
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
const JNAME = ARGS[0] ?? 'hip_l';
const AXIS = Number(ARGS[1] ?? 2);

const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
env.V4MODE = '1';

const sk = buildSkeleton(DEFAULT_CONFIG) as any;
const jIdx = sk.joints.findIndex((j: any) => j.name === JNAME);
if (jIdx < 0) { console.log(`找不到关节 ${JNAME}`); process.exit(1); }
const j = sk.joints[jIdx];

const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 60 });
sim.begin(new Float32Array(sim.paramCount));
const d = sim.doll as any;
(sim as any).world.gravity = { x: 0, y: 0, z: 0 };

const HZ = 240, DT = 1 / HZ;
const SETTLE = 60, PULSE = 60;
const nj = sk.joints.length;
const tauBuf = new Float64Array(nj * 3);
const rv = new Float64Array(3);
const rr = new Float64Array(3);

function clearAll() { tauBuf.fill(0); d.setV4Torques(tauBuf); }
function run(n: number) { for (let i = 0; i < n; i++) sim.advance(1); }

/** 读该轴相对角（已减静姿态） */
function readAngle() { d.jointRot(jIdx, rr); return rr[AXIS]!; }
/** 读该轴到限位的余量（rad；正=还在界内） */
function limMargin(): { lo: number; hi: number; dist: number } {
  const a = readAngle();
  const L = j.limits?.[AXIS];
  if (!L) return { lo: -Infinity, hi: Infinity, dist: Infinity };
  return { lo: L[0], hi: L[1], dist: Math.min(a - L[0], L[1] - a) };
}

console.log(`════ 隔离测试：${JNAME}/${AXIS}  τmax=${j.maxTorque[AXIS]} ════`);
console.log('');

// ── D 档：先看限位余量（是不是一开始就顶住了）
clearAll(); run(SETTLE);
const m0 = limMargin();
console.log(`初始：角=${(readAngle() * 180 / Math.PI).toFixed(2)}°  限位=[${(m0.lo * 180 / Math.PI).toFixed(1)}, ${(m0.hi * 180 / Math.PI).toFixed(1)}]  距最近界=${((m0.dist === Infinity ? NaN : m0.dist) * 180 / Math.PI).toFixed(2)}°`);
console.log('');

const tauInj = Math.min(j.maxTorque[AXIS] * 0.5, 60);

function trial(label: string, prep?: () => void): void {
  clearAll(); run(SETTLE);
  prep?.();
  const a0 = readAngle();
  d.jointRelVel(jIdx, rv); const w0 = rv[AXIS]!;
  tauBuf[jIdx * 3 + AXIS] = tauInj;
  d.setV4Torques(tauBuf);
  run(PULSE);
  const a1 = readAngle();
  d.jointRelVel(jIdx, rv); const w1 = rv[AXIS]!;
  const applied = d.tauApplied?.[jIdx * 3 + AXIS] ?? NaN;
  const mm = limMargin();
  // 位移（deg）比 加速度 更稳（不受限位反弹影响）
  console.log(
    `${label.padEnd(22)} | applied=${(Number.isFinite(applied) ? applied.toFixed(1) : 'n/a').padStart(6)} | ` +
    `Δθ=${((a1 - a0) * 180 / Math.PI).toFixed(2).padStart(7)}° | Δω=${((w1 - w0) / (PULSE * DT)).toFixed(1).padStart(8)} rad/s² | ` +
    `末距界=${((mm.dist === Infinity ? NaN : mm.dist) * 180 / Math.PI).toFixed(2)}°`,
  );
  clearAll(); run(SETTLE);
}

trial('A 默认');
trial('B 关阻尼(KD→0)', () => { env.KD = '0'; });   // ★ 变量名是 KD，不是 JOINTKD（ragdoll.ts:2969）

console.log('');
console.log('注：B 档若显著变大 ⇒ 阻尼吸收；若仍小 ⇒ 看"末距界"是否≈0（顶限位）。');
