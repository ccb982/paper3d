/**
 * probe-deadchan —— 验证 `torqueCmd` 通道是否真的活了（2026-10-08 修复后）
 *
 * 目的：区分三种"注入无效"：
 *   (a) 注入没写进 rs.treq      → tauOut 恒 0
 *   (b) 写进了 tauOut 但被 v4 覆盖 → 本次修的 bug
 *   (c) 两通道都对，但脚不接地/法向不成立 → CoP 读不到（不是通道问题）
 *
 * 观测：逐拍打印 tauOut[jAnk*3+2] / torqueCmd 分量 / v4Tau 分量 / tauApplied /
 *       踝接触法向力 / copValid。
 *
 * 用法：node tools/run.mjs probe-deadchan [tau]
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
const TAU = Number(ARGS[0] ?? 40);
const TSTEP = Number(ARGS[1] ?? 0.6);
const TDUR = Number(ARGS[2] ?? 0.4);
const JOINT = String(ARGS[3] ?? 'foot_l');
const AX = Number(ARGS[4] ?? 2);

const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
env.AUTH_TAU = String(TAU);
env.AUTH_T0 = String(TSTEP);
env.AUTH_T1 = String(TSTEP + TDUR);
env.AUTH_AX = String(AX);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: TSTEP + TDUR + 0.2 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const d = sim.doll as any;
const rs = (ctrl as any).rs;
const HZ = 120, DT = 1 / HZ;
const jA = jointIndexByName(sk, JOINT);
const idx = jA * 3 + AX;
env.AUTH_J = String(jA);

console.log(`══ probe-deadchan：${JOINT} axis${AX} 阶跃 τ=${TAU} N·m @ t=${TSTEP}~${TSTEP + TDUR}s ══`);
console.log('     t   | tauOut |  tqCmd |   v4Tau | applied |  fzL    fzR  | copL copR | contactL contactR');

const N = Math.round((TSTEP + TDUR) * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  if (t < TSTEP - 0.05) continue;
  if (!(k % 4 === 0)) continue;
  const tauOut = rs.tauOut?.[idx] ?? 0;
  const tqCmd = d.torqueCmd?.[idx] ?? NaN;     // private，运行时可见
  const v4Tau = d.v4Tau?.[idx] ?? NaN;
  const applied = d.tauApplied?.[idx] ?? NaN;
  const FL = d.soleForceProfile(0, DT), FR = d.soleForceProfile(1, DT);
  console.log(
    `  ${t.toFixed(3)} |` +
    `${tauOut.toFixed(1).padStart(7)} |` +
    `${(Number.isFinite(tqCmd) ? tqCmd : 0).toFixed(1).padStart(7)} |` +
    `${(Number.isFinite(v4Tau) ? v4Tau : 0).toFixed(1).padStart(8)} |` +
    `${(Number.isFinite(applied) ? applied : 0).toFixed(1).padStart(7)} |` +
    `${FL.fz.toFixed(0).padStart(6)}${FR.fz.toFixed(0).padStart(7)}  |` +
    `${(FL.copX * 1000).toFixed(0).padStart(5)}${(FR.copX * 1000).toFixed(0).padStart(5)} |` +
    `${String(FL.contactN).padStart(8)}${String(FR.contactN).padStart(9)}`,
  );
}
