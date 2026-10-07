/**
 * probe-slip —— **标准①：脚不打滑**（架构_v4.md §9.1）
 *
 *   判据 = 踝的**宏观漂移**与**逐拍微抖动**（不是 slipV——求解器蠕变假象，§8.9.4v）。
 *   每 0.1s 报：双踝 x/漂移量 / Fz / CoP.x。
 *   用法：`node tools/run.mjs probe-slip [秒]`
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
const T = Number(ARGS[0] ?? 3);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const d = sim.doll;
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const HZ = 120, DT = 1 / HZ;

const log = (s: string) => console.log(s);
log(`══ probe-slip：标准①（脚不打滑）${T}s ══`);
log('     t   | 踝L.x  漂移  Fz_L | 踝R.x  漂移  Fz_R | CoM.x  CoP_L.x');
let xL0: number | null = null, xR0: number | null = null;
let jitL = 0, jitR = 0, prevL = 0, prevR = 0;
const N = Math.round(T * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  const xL = (rs.soleX?.l ?? 0) * 1000, xR = (rs.soleX?.r ?? 0) * 1000;
  if (xL0 === null) { xL0 = xL; xR0 = xR; prevL = xL; prevR = xR; }
  // 逐拍微抖动（相邻拍位移量；"打滑"的直接体征）
  jitL = Math.max(jitL, Math.abs(xL - prevL));
  jitR = Math.max(jitR, Math.abs(xR - prevR));
  prevL = xL; prevR = xR;
  if (k % 12 === 0) {
    const L = d.soleForceProfile(0, DT), R = d.soleForceProfile(1, DT);
    log(
      `  ${t.toFixed(2)} |${xL.toFixed(1).padStart(7)}${(xL - xL0).toFixed(1).padStart(7)}${(L.fz || 0).toFixed(0).padStart(6)} |` +
      `${xR.toFixed(1).padStart(7)}${(xR - xR0).toFixed(1).padStart(7)}${(R.fz || 0).toFixed(0).padStart(6)} |` +
      `${((rs.com?.x ?? 0) * 1000).toFixed(1).padStart(7)}${(L.copX * 1000).toFixed(0).padStart(8)}`,
    );
  }
}
log('──── 标准① 汇总 ────');
log(`  最大逐拍窜动：左 ${jitL.toFixed(2)} mm/拍 右 ${jitR.toFixed(2)} mm/拍（通过线：≤1mm 量级）`);
log(`  宏观漂移：左 ${((rs.soleX?.l ?? 0) * 1000 - (xL0 ?? 0)).toFixed(1)} mm ｜ 右 ${((rs.soleX?.r ?? 0) * 1000 - (xR0 ?? 0)).toFixed(1)} mm`);
