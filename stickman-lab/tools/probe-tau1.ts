/**
 * probe-tau1 —— 静态时刻的**逐关节力矩分解**（用户：「先把静态下的力矩发力情况弄对」）
 *
 *   对每条腿的 hip/knee/foot（三轴）+ spine1..3，报：
 *     - `errP`（位置弹簧项 `kp·ts·(thRef−a)`，已 ×57.3 便于读作"角度当量"）
 *     - `errD`（阻尼项 `−kd·ts·relL`）
 *     - `tauFF`（力矩通道：τ=JᵀF / CoP / 吊索…）
 *     - `tauApplied`（本拍实际落地的马达 τ）
 *     - `branch`（1=正常伺服 2=让位 3/4=限位回程）
 *   用法：`node tools/run.mjs probe-tau1 [tDump]`
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
const { jointIndexByName } = await import('../src/core/skeleton');

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const TDUMP = Number(ARGS[0] ?? 1.5);
const log = (s: string) => console.log(s);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: TDUMP + 0.2 });
sim.begin(new Float32Array(sim.paramCount));
const ABL = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).ABL ?? '');
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  balance: { ...DEFAULT_CONTROLLER.balance, ...(ABL ? { ablate: ABL } : {}) },
});
const d = sim.doll;
const HZ = 60, DT = 1 / HZ;

const KEYS = [
  ['hip_l', 0], ['hip_l', 1], ['hip_l', 2], ['knee_l', 0], ['knee_l', 1], ['knee_l', 2],
  ['foot_l', 0], ['foot_l', 1], ['foot_l', 2],
  ['hip_r', 2], ['knee_r', 2], ['foot_r', 2],
  ['spine1', 2], ['spine2', 2], ['spine3', 2],
] as const;
const AI = KEYS.map(([n, ax]) => ({ n, ax, i: jointIndexByName(sk, n) * 3 + ax }));

log(`══ probe-tau1：静态力矩分解（t=${TDUMP}s）══`);
log('  关节/轴        errP(≈°)   errD(≈°)   tauFF      tauApplied  branch');
const N = Math.round(TDUMP * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(4);
}
for (const a of AI) {
  if (a.i < 0) continue;
  const eP = (d.motorErrP[a.i] ?? 0) * 57.2958;
  const eD = (d.motorErrD[a.i] ?? 0) * 57.2958;
  const ff = d.motorTauFF[a.i] ?? 0;
  const ta = d.tauApplied[a.i] ?? 0;
  const br = d.motorBranch[a.i] ?? 0;
  log(`  ${a.n}/${a.ax}`.padEnd(14) +
    `${eP.toFixed(1).padStart(10)} ${eD.toFixed(1).padStart(10)} ${ff.toFixed(1).padStart(10)} ${ta.toFixed(1).padStart(11)} ${String(br).padStart(6)}`);
}
