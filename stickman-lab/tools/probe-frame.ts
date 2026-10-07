/**
 * probe-frame —— **逐控制拍回读**（用户：「再逐帧回读看情况，还是脚在抖」）
 *
 *   每拍报：双脚 Fz / 接触稳定 / 踝x / 踝y / CoM.x / CoM.vy / 支撑腿的膝/踝 τ。
 *   用法：`node tools/run.mjs probe-frame [tStart] [tEnd]`
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
const T0 = Number(ARGS[0] ?? 1.8);
const T1 = Number(ARGS[1] ?? 2.2);

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
const jKnee = jointIndexByName(sk, 'knee_l') * 3 + 2;
const jAnk = jointIndexByName(sk, 'foot_l') * 3 + 2;
const jKneeR = jointIndexByName(sk, 'knee_r') * 3 + 2;

const log = (s: string) => console.log(s);
log(`══ probe-frame 逐拍回读（${T0}~${T1}s @120Hz）══`);
log('     t   | Fz_L Fz_R  gndL gndR | 踝L.x  踝L.y  踝R.x  | CoM.x  CoM.y   vy   | τ膝L   τ踝L   τ膝R  | br膝L');
const N = Math.round(T1 * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  if (t < T0) continue;
  const fzL = rs.soleCopFz?.[0] ?? 0, fzR = rs.soleCopFz?.[1] ?? 0;
  const gL = rs.gndStable?.l ? 1 : 0, gR = rs.gndStable?.r ? 1 : 0;
  const aLx = (rs.soleX?.l ?? 0) * 1000, aLy = (rs.soleY?.l ?? 0) * 1000, aRx = (rs.soleX?.r ?? 0) * 1000;
  const cx = (rs.com?.x ?? 0) * 1000, cy = (rs.com?.y ?? 0) * 1000, vy = rs.com?.vy ?? 0;
  const tK = d.tauApplied[jKnee] ?? 0, tA = d.tauApplied[jAnk] ?? 0, tKR = d.tauApplied[jKneeR] ?? 0;
  const brK = d.motorBranch[jKnee] ?? 0;
  log(
    `  ${t.toFixed(3)} |${fzL.toFixed(0).padStart(5)}${fzR.toFixed(0).padStart(5)}   ${gL}    ${gR}   |` +
    `${aLx.toFixed(1).padStart(7)}${aLy.toFixed(1).padStart(7)}${aRx.toFixed(1).padStart(7)}  |` +
    `${cx.toFixed(1).padStart(6)}${cy.toFixed(1).padStart(7)}${vy.toFixed(2).padStart(6)}  |` +
    `${tK.toFixed(0).padStart(6)}${tA.toFixed(0).padStart(7)}${tKR.toFixed(0).padStart(7)}  |${String(brK).padStart(5)}`,
  );
}
