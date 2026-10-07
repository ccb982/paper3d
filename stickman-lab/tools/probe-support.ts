/**
 * probe-support —— **支撑脚的力矩与受力**逐拍回读
 *   （用户：「网页上脚还在打滑，回读支撑脚的力矩和受力」）
 *
 *   每拍报：支撑侧 / 支撑脚 Fz / CoP.x / 踝世界x（漂移）/ 支撑腿 hip·knee·ankle τ。
 *   用法：`node tools/run.mjs probe-support [t0] [t1]`
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
const T0 = Number(ARGS[0] ?? 1.0);
const T1 = Number(ARGS[1] ?? 1.5);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T1 + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
const ABL = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).ABL ?? '');
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  balance: { ...DEFAULT_CONTROLLER.balance, ...(ABL ? { ablate: ABL } : {}) },
});
const d = sim.doll;
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const HZ = 120, DT = 1 / HZ;
const idx: Record<string, number> = {};
for (const nm of ['hip_l', 'knee_l', 'foot_l', 'hip_r', 'knee_r', 'foot_r']) {
  idx[nm] = jointIndexByName(sk, nm) * 3 + 2;
}

const log = (s: string) => console.log(s);
log(`══ probe-support 支撑脚回读（${T0}~${T1}s @120Hz）══`);
log('     t   | 支撑 |  Fz_sup  CoP.x  踝x_sup  drift | τ髋     τ膝     τ踝   | 净髋    净踝   | CoM.x  vx  Δvx');
// ★ 权威性检验：支撑腿 τ 的 0.2s 滑动均值（净拉力）与 vx 的响应
const NDN = 24;   // 0.2s @120Hz
const ringH: number[] = [], ringA: number[] = [];
let vxPrev = 0;
const N = Math.round(T1 * HZ);
let x0: number | null = null;
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  if (t < T0) continue;
  const sup: 'l' | 'r' = rs.supportLeg();
  const sIdx = sup === 'l' ? 0 : 1;
  const F = d.soleForceProfile(sIdx as 0 | 1, DT);
  const ax = (rs.soleX?.[sup] ?? 0) * 1000;
  if (x0 === null) x0 = ax;
  const tH = d.tauApplied[idx[`hip_${sup}`]!] ?? 0;
  const tK = d.tauApplied[idx[`knee_${sup}`]!] ?? 0;
  const tA = d.tauApplied[idx[`foot_${sup}`]!] ?? 0;
  ringH.push(tH); ringA.push(tA);
  if (ringH.length > NDN) { ringH.shift(); ringA.shift(); }
  const mH = ringH.reduce((a, b) => a + b, 0) / ringH.length;
  const mA = ringA.reduce((a, b) => a + b, 0) / ringA.length;
  const vx = (rs.com?.vx ?? 0) * 1000;
  const dvx = vx - vxPrev; vxPrev = vx;
  log(
    `  ${t.toFixed(3)} |  ${sup}   |${(F.fz || 0).toFixed(0).padStart(6)}${(F.copX * 1000).toFixed(0).padStart(8)}${ax.toFixed(1).padStart(9)}${(ax - x0).toFixed(1).padStart(7)} |` +
    `${tH.toFixed(0).padStart(6)}${tK.toFixed(0).padStart(8)}${tA.toFixed(0).padStart(8)}   |` +
    `${mH.toFixed(0).padStart(7)}${mA.toFixed(0).padStart(8)}   |` +
    `${((rs.com?.x ?? 0) * 1000).toFixed(1).padStart(7)}${vx.toFixed(0).padStart(6)}${dvx.toFixed(1).padStart(7)}`,
  );
}
