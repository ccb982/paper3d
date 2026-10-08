/**
 * probe-fw —— **脚→腰发力链路**（前段逐拍；用户："初始站姿没问题，理论上不该倒"）
 *
 *   逐拍展示：足底(CoP/Fz) → 踝τ → 膝τ → 髋τ → 腰(脊柱/躯干) → CoM/速度
 *   用于检查：静态应只需 mg 支撑（小τ），若链路里出现大τ即为异常环节。
 *   用法：`node tools/run.mjs probe-fw [秒]`
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
const T = Number(ARGS[0] ?? 0.15);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
for (let w = 0; w < 6; w++) sim.advance(1);   // physics warmup
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const d = sim.doll;
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const HZ = 120, DT = 1 / HZ;
const jHipL = jointIndexByName(sk, 'hip_l') * 3 + 2;
const jKneeL = jointIndexByName(sk, 'knee_l') * 3 + 2;
const jAnkL = jointIndexByName(sk, 'foot_l') * 3 + 2;
const jSp1 = jointIndexByName(sk, 'spine1') * 3 + 2;

const log = (s: string) => console.log(s);
log(`══ probe-fw 脚→腰链路（${T}s 逐拍）══`);
log('     t   |  Fz_L  CoP_L | τ踝    τ膝    τ髋   τ腰 | CoM.x  vx(mm/s) | mg需求τ踝 对比');
const N = Math.round(T * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  const F = d.soleForceProfile(0, DT);
  const ank = d.tauApplied[jAnkL] ?? 0, knee = d.tauApplied[jKneeL] ?? 0, hip = d.tauApplied[jHipL] ?? 0;
  const sp1 = d.tauApplied[jSp1] ?? 0;
  const cx = (rs.com.x ?? 0) * 1000, vx = (rs.com.vx ?? 0) * 1000;
  // 静态理论：τ踝 = Fz×(CoP−踝)，mg 支撑只需要这一个量
  const need = (F.fz || 0) * (F.copX - (rs.soleX?.l ?? 0));
  log(
    `  ${t.toFixed(3)} |${(F.fz || 0).toFixed(0).padStart(6)}${(F.copX * 1000).toFixed(0).padStart(7)} |` +
    `${ank.toFixed(1).padStart(7)}${knee.toFixed(1).padStart(7)}${hip.toFixed(1).padStart(7)}${sp1.toFixed(1).padStart(7)} |` +
    `${cx.toFixed(1).padStart(7)}${vx.toFixed(0).padStart(8)} |${need.toFixed(1).padStart(9)}`,
  );
}
