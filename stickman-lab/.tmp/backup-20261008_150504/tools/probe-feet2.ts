/**
 * probe-feet2 —— **左右脚差动发力测试**（用户："两个脚用不同的发力，都能正常控制吗"）
 *
 *   骨骼关（V4NOBONE=1 由命令行给）——注入即物理，干净测差动响应。
 *   四段：(+30,+30) / (+30,0) / (+30,−30) / (0,+30)，各 0.4s，段末读：
 *     CoP_L / CoP_R（soleForceProfile）× Fz_L/Fz_R / CoM_x / 躯干pitch
 *   通过判据：① 每脚 CoP 按自己 τ 独立移动；② 差动产生**纯力偶**（CoM 不动、pitch 变）
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

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 12 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const d = sim.doll as unknown as {
  soleForceProfile: (side: 0 | 1, dt: number) => { fz: number; copX: number };
};
const DT = 1 / 120;
const env0 = (((globalThis as { process?: { env?: Record<string, string> } }).process?.env) ?? {}) as Record<string, string>;

const run = (s: number): void => { for (let k = 0; k < s * 120; k++) { ctrl.step(DT); sim.advance(2); } };
const meas = (s: number): { cl: number; cr: number; fl: number; fr: number; comx: number } => {
  let cl = 0, cr = 0, fl = 0, fr = 0, cx = 0, n = 0;
  for (let k = 0; k < s * 120; k++) {
    ctrl.step(DT); sim.advance(2);
    const FL = d.soleForceProfile(0, DT), FR = d.soleForceProfile(1, DT);
    cl += FL.copX * 1000; cr += FR.copX * 1000; fl += FL.fz; fr += FR.fz;
    cx += (rs.com.x ?? 0) * 1000; n++;
  }
  return { cl: cl / n, cr: cr / n, fl: fl / n, fr: fr / n, comx: cx / n };
};

run(0.6);
console.log('══ probe-feet2 差动测试（τ_L,τ_R 各 0.4s）══');
console.log(' (τL,τR)    CoP_L    CoP_R   |  Fz_L  Fz_R |  CoM.x');
env0.V4SIGNCAL = 'foot';
for (const [tl, tr] of [[0, 0], [30, 30], [30, 0], [30, -30], [0, 30], [-30, 30]] as const) {
  env0.V4SIGTAU_L = String(tl); env0.V4SIGTAU_R = String(tr);
  const r = meas(0.4);
  console.log(` (${String(tl).padStart(3)},${String(tr).padStart(3)})  ${r.cl.toFixed(0).padStart(8)} ${r.cr.toFixed(0).padStart(8)}  | ${r.fl.toFixed(0).padStart(5)} ${r.fr.toFixed(0).padStart(5)} | ${r.comx.toFixed(1).padStart(7)}`);
}
