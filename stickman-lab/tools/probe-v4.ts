/**
 * probe-v4 —— **V4 架构验收**（架构_v4.md §9 + §3.5 三证明）
 *
 *   每拍报：
 *     · l1Leak  —— 证明③（N₁ 投影泄漏；应 ≈0）
 *     · clampFx —— 证明①（力层摩擦截断计数）
 *     · stepReq —— 裂缝①（CoP 饱和 → 迈步请求量）
 *     · τ 向量（唯一解）+ CoM/足位/躯干姿态
 *   用法：`node tools/run.mjs probe-v4 [秒]`
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
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
const T = Number(ARGS[0] ?? 2);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const d = sim.doll;
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const HZ = 120, DT = 1 / HZ;
const jHipL = jointIndexByName(sk, 'hip_l') * 3 + 2;
const jKneeL = jointIndexByName(sk, 'knee_l') * 3 + 2;
const jAnkL = jointIndexByName(sk, 'foot_l') * 3 + 2;

const log = (s: string) => console.log(s);
log(`══ probe-v4（${T}s @120Hz）══`);
log('     t   | l1Leak  clampFx stepReq | τ髋L    τ膝L    τ踝L  | CoM.x   躯干pitch | 踝L.x  踝R.x');
let leakMax = 0, clamped = 0, reqMax = 0;
const N = Math.round(T * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  const diag = (ctrl as unknown as { v4Diag: { l1Leak: number; clampFx: number; stepReqX: number } | null }).v4Diag;
  if (diag) {
    if (diag.l1Leak > leakMax) leakMax = diag.l1Leak;
    clamped = diag.clampFx;
    if (Math.abs(diag.stepReqX) > Math.abs(reqMax)) reqMax = diag.stepReqX;
  }
  if (k % 12 === 0) {
    let trunk = 0;
    const buf = new Float64Array(4);
    const bi = sk.bodies.findIndex((b) => b.key === 'spine3');
    if (bi >= 0) {
      const r = d['bodyWorldAxis'](bi, 1, buf as unknown as Float64Array);
      trunk = Math.atan2(r![0]!, r![1]!) * 57.2958;
    }
    log(
      `  ${t.toFixed(3)} |${(diag?.l1Leak ?? 0).toFixed(3).padStart(8)}${(diag?.clampFx ?? 0).toString().padStart(6)}${(diag?.stepReqX ?? 0).toFixed(3).padStart(9)} |` +
      `${(d.tauApplied[jHipL] ?? 0).toFixed(0).padStart(6)}${(d.tauApplied[jKneeL] ?? 0).toFixed(0).padStart(8)}${(d.tauApplied[jAnkL] ?? 0).toFixed(0).padStart(8)} |` +
      `${((rs.com?.x ?? 0) * 1000).toFixed(1).padStart(7)}${trunk.toFixed(1).padStart(9)} |` +
      `${((rs.soleX?.l ?? 0) * 1000).toFixed(1).padStart(7)}${((rs.soleX?.r ?? 0) * 1000).toFixed(1).padStart(8)}`,
    );
  }
}
log('──── 汇总 ────');
log(`  证明③ l1Leak 峰值 = ${leakMax.toFixed(4)}（应 <0.01：零空间投影有效）`);
log(`  证明① 摩擦截断累计 = ${clamped} 次`);
log(`  裂缝① 迈步请求峰值 = ${(reqMax * 1000).toFixed(1)} mm（CoP 饱和量）`);
