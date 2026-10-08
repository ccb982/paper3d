/**
 * probe-lift-waist —— **"强制脚部发力，能不能把弯下去的腰挺起来"**（用户 2026-10-08 的核心前提）
 *
 *   用户原话：「我先要求脚部强制发力，能把弯下去的腰挺起来。这是谈控制算法的前提。
 *     各个关节都不能用，后续真的无从谈起了。」
 *
 *   实验设计（**纯物理可行性**，不涉及任何控制器/学习）：
 *     1. 先让身体自然"弯腰"（关掉所有段，自由落体到被地面撑住的前倾姿态）；
 *     2. 然后**只对腿部（踝/膝/髋）注入恒定 τ**（走 V4SIGCAL 直通通道，绕过 torqueCmd）；
 *     3. 量「腰高」（spine3/torso 的世界 y）与「躯干 pitch」随时间的变化。
 *
 *   判据：
 *     · 腰高**上升**且躯干 pitch **减小**（往直立走）⇒ 力链能挺腰，可以谈控制算法；
 *     · 腰高不动或继续下降 ⇒ 力链不够/方向不对，先修物理。
 *
 *   用法：`node tools/run.mjs probe-lift-waist [踝τ] [膝τ] [髋τ] [秒]`
 *         `node tools/run.mjs probe-lift-waist 0 0 0 3`      只看弯腰基线
 *         `node tools/run.mjs probe-lift-waist 120 150 200 3`  踝膝髋全开
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
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const TAU_A = Number(ARGS[0] ?? 0);
const TAU_K = Number(ARGS[1] ?? 0);
const TAU_H = Number(ARGS[2] ?? 0);
const T = Number(ARGS[3] ?? 3);

const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
env.V4NOSTEP = '1';        // 迈步系统全旁路
env.V4C1 = '0'; env.V4C2 = '0'; env.V4C3 = '0';   // 三个控制段全关（只看纯注入）

// 用 V4SIGCAL 注入：它按 leg 分别写 hip/knee/foot，直接进 v4Tau（绕过 torqueCmd 覆盖坑）
// 但 V4SIGCAL 只支持单一 tau 值，这里用"分段构造"不支持 → 改走 controller 的 AUTH 钩子不行（被覆盖）
// ⇒ 用多次探针：一次只测一个关节组。见 main
// ★ 注入通道名 = `V4SIGNCAL`（代码里是这个名字；`架构_final.md §592` 记过
//   "V4SIGNCAL（代码）vs V4SIGCAL（命令）——一个字母之差"这个坑）。
//   它按 leg 分别写 hip/knee/foot，直接进 v4Tau（绕过 torqueCmd 被覆盖的坑）。
const mode = String(ARGS[4] ?? 'all');
if (mode === 'ankle') { env.V4SIGNCAL = 'foot'; env.V4SIGTAU = String(TAU_A); }
else if (mode === 'knee') { env.V4SIGNCAL = 'knee'; env.V4SIGTAU = String(TAU_K); }
else if (mode === 'hip') { env.V4SIGNCAL = 'hip'; env.V4SIGTAU = String(TAU_H); }
else if (mode === 'all') { env.V4SIGNCAL = 'all'; env.V4SIGTAU = String(TAU_A); }

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 1e9 });
sim.begin(new Float32Array(sim.paramCount));
const d = sim.doll as any;
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const HZ = 120, DT = 1 / HZ;
const log = (s: string) => console.log(s);

const keyIdx = new Map<string, number>();
for (let i = 0; i < sk.bodies.length; i++) keyIdx.set((sk.bodies[i] as any).key, i);
const chest = keyIdx.get('spine4') ?? keyIdx.get('spine3') ?? keyIdx.get('torso') ?? 3;
const pelvis = keyIdx.get('torso') ?? 0;
const yOf = (bi: number): number => d.bodies[bi].translation().y;
const pitchOf = (bi: number): number => {
  const rq = d.bodies[bi].rotation();
  return Math.atan2(2 * (rq.w * rq.x + rq.y * rq.z), 1 - 2 * (rq.x * rq.x + rq.y * rq.y)) * 57.2958;
};

log(`══ probe-lift-waist  模式=${mode} 踝τ=${TAU_A} 膝τ=${TAU_K} 髋τ=${TAU_H}  ══`);
log(`   体重=${sk.massTotal}kg  胸腔刚体=${sk.bodies[chest]?.key}  骨盆刚体=${sk.bodies[pelvis]?.key}`);
log('  t   | 腰高(spine)  骨盆高 | 躯干pitch | 骨盆pitch | CoM.y | 脚L fz 脚R fz | 髋τ实 膝τ实 踝τ实');
const jIdx = (nm: string): number => sk.joints.findIndex((j) => j.name === nm);
const hipL = jIdx('hip_l'), kneeL = jIdx('knee_l'), footL = jIdx('foot_l');
let y0 = -1, p0 = -1;
const N = Math.round(T * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  const y = yOf(chest), py = yOf(pelvis), pit = pitchOf(chest), ppit = pitchOf(pelvis);
  if (y0 < 0 && t > 0.02) { y0 = y; p0 = pit; }
  if (k % 12 !== 0) continue;
  const F = d.soleForceProfile(0, DT), Fr = d.soleForceProfile(1, DT);
  const tauOf = (ji: number): number => (d.v4Tau && d.v4Tau.length > 0 ? (d.v4Tau[ji * 3 + 2] ?? 0) : 0);
  const com = ctrl.rs.com as any;
  log(` ${t.toFixed(2)} |${(y * 1000).toFixed(0).padStart(11)}${(py * 1000).toFixed(0).padStart(8)} |${pit.toFixed(1).padStart(9)} |${ppit.toFixed(1).padStart(9)} |${((com?.y ?? 0) * 1000).toFixed(0).padStart(6)} |${F.fz.toFixed(0).padStart(6)}${Fr.fz.toFixed(0).padStart(7)} |${tauOf(hipL).toFixed(0).padStart(6)}${tauOf(kneeL).toFixed(0).padStart(6)}${tauOf(footL).toFixed(0).padStart(6)}`);
}
if (y0 > 0) {
  const yEnd = yOf(chest), pEnd = pitchOf(chest);
  log(`\n★ 腰高 ${(y0 * 1000).toFixed(0)} → ${(yEnd * 1000).toFixed(0)} mm  (Δ=${((yEnd - y0) * 1000).toFixed(0)} mm)`);
  log(`★ 躯干pitch ${p0.toFixed(1)} → ${pEnd.toFixed(1)}°  (Δ=${(pEnd - p0).toFixed(1)}°)`);
  log(`  ⇒ ${(yEnd - y0) > 0.02 && pEnd < p0 ? '腰被挺起来了 ✔ 力链通' : (yEnd - y0) > 0.005 ? '轻微上升（不足以判定）' : '腰没挺起来 ✘ 力链不成立'}`);
}
