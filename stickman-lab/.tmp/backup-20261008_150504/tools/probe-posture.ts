/**
 * probe-posture —— **站姿几何回读**（验证主根：CoM 相对踝/脚的位置）
 *
 *   每 0.2s 报：CoM.x/z、踝L/R.x、脚心、CoM 相对踝的偏移、躯干倾角。
 *   "CoM 前 14cm" 若成立，此处一眼可见。
 *   用法：`node tools/run.mjs probe-posture [秒]`
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
const T = Number(ARGS[0] ?? 2);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
// physics warmup —— 去掉（怀疑注入 vx 种子）：FREE_WARMUP=1 才做
if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.FREE_WARMUP ?? '') === '1') {
  for (let w = 0; w < 6; w++) sim.advance(1);
}
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const d = sim.doll;
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const HZ = 120, DT = 1 / HZ;

const log = (s: string) => console.log(s);
log(`══ probe-posture（${T}s；长度单位 mm/°）══`);
log('     t   | CoM.x  踝L.x  踝R.x | CoM−踝L  CoM−踝R | CoP_L.x | 躯干pitch');
const N = Math.round(T * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  if (k % 24 !== 0) continue;
  const cx = (rs.com.x ?? 0) * 1000;
  const aL = (rs.soleX?.l ?? 0) * 1000, aR = (rs.soleX?.r ?? 0) * 1000;
  const F = d.soleForceProfile(0, DT);
  const buf = new Float64Array(4);
  let trunk = 0;
  const bi = sk.bodies.findIndex((b) => b.key === 'spine3');
  if (bi >= 0) {
    const r = d.bodyWorldAxis(bi, 1, buf as unknown as Float64Array);
    trunk = Math.atan2(r![0]!, r![1]!) * 57.2958;
  }
  log(
    `  ${t.toFixed(2)} |${cx.toFixed(0).padStart(7)}${aL.toFixed(0).padStart(7)}${aR.toFixed(0).padStart(7)} |` +
    `${(cx - aL).toFixed(0).padStart(8)}${(cx - aR).toFixed(0).padStart(9)} |` +
    `${(F.copX * 1000).toFixed(0).padStart(8)} |${trunk.toFixed(1).padStart(9)}`,
  );
}
