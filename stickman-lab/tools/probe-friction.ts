/**
 * probe-friction —— **脚部受力不侧滑极限**（用户：「测脚部的受力不侧滑的极限，
 * 再看脚的承重和力矩，如果脚很容易打滑，那么站不住是必然的」）
 *
 *   每拍报：双脚 Fz / 切向力 ftMag / 摩擦利用率 / 滑移速度 / 踝 τ。
 *   末尾给统计：利用率峰值、≥0.9 占比、滑移速度峰值。
 *   用法：`node tools/run.mjs probe-friction [t0] [t1]`
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
const T0 = Number(ARGS[0] ?? 0.5);
const T1 = Number(ARGS[1] ?? 2.0);

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
const jAnkL = jointIndexByName(sk, 'foot_l') * 3 + 2;
const jAnkR = jointIndexByName(sk, 'foot_r') * 3 + 2;

const log = (s: string) => console.log(s);
log(`══ probe-friction 摩擦极限（${T0}~${T1}s @120Hz；μ_eff≈0.75 组合）══`);
log('     t   | Fz_L    ft_L  use_L  slip_L | Fz_R    ft_R  use_R  slip_R | τ踝L   τ踝R');
let maxUse = 0, nHigh = 0, nTot = 0, maxSlip = 0, maxFt = 0;
const N = Math.round(T1 * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  if (t < T0) continue;
  const L = d.soleForceProfile(0, 1 / 120);
  const R = d.soleForceProfile(1, 1 / 120);
  const tKL = d.tauApplied[jAnkL] ?? 0, tKR = d.tauApplied[jAnkR] ?? 0;
  const f = (v: number, dp = 0): string => (Number.isFinite(v) ? v.toFixed(dp) : '—');
  if (k % 2 === 0) {
    log(
      `  ${t.toFixed(3)} |${f(L.fz, 0).padStart(6)}${f(L.ftMag, 0).padStart(7)}${f(L.frictionUse, 2).padStart(7)}${f(L.slipV, 3).padStart(8)} |` +
      `${f(R.fz, 0).padStart(6)}${f(R.ftMag, 0).padStart(7)}${f(R.frictionUse, 2).padStart(7)}${f(R.slipV, 3).padStart(8)} |` +
      `${tKL.toFixed(0).padStart(6)}${tKR.toFixed(0).padStart(7)}`,
    );
  }
  for (const F of [L, R]) {
    nTot++;
    if (Number.isFinite(F.frictionUse)) {
      if (F.frictionUse > maxUse) maxUse = F.frictionUse;
      if (F.frictionUse >= 0.9) nHigh++;
    }
    if (Number.isFinite(F.slipV) && Math.abs(F.slipV) > maxSlip) maxSlip = Math.abs(F.slipV);
    if (Number.isFinite(F.ftMag) && F.ftMag > maxFt) maxFt = F.ftMag;
  }
}
log('──── 统计 ────');
log(`  摩擦利用率峰值 = ${maxUse.toFixed(2)}（≥1.0 ⇒ 已打滑）`);
log(`  利用率 ≥0.9 的样本占比 = ${((100 * nHigh) / Math.max(1, nTot)).toFixed(1)}%`);
log(`  切向力峰值 = ${maxFt.toFixed(0)} N ｜ 滑移速度峰值 = ${maxSlip.toFixed(3)} m/s`);
