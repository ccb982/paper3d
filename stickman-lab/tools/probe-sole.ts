/**
 * probe-sole —— **踝 τ → 鞋底逐块载荷传导测试**（用户："力都传不上去"）
 *
 *   站立（骨骼层保持），双踝注入恒定 τ（由 V4SIGCAL/V4SIGTAU 环境给出，
 *   经 chainV1 直通），每 0.1s 回读：
 *     · 每侧鞋底 6 块的 Σ|λ|（soleBlockLoad）
 *     · 脚刚体的世界 pitch（判断脚是否被 τ 扳动）
 *     · CoP（soleCop）
 *   用法：`V4SIGCAL=foot V4SIGTAU=30 node tools/run.mjs probe-sole 0.6`
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
const T = Number(ARGS[0] ?? 0.6);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
for (let w = 0; w < 6; w++) sim.advance(1);
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const d = sim.doll as unknown as {
  soleBlockLoad: (side: 0 | 1, out: Float64Array) => void;
  soleCols: unknown[][];
  soleCop: (side: 0 | 1, out: Float64Array) => void;
  bodies: Array<{ key?: string }>;
};
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const HZ = 120, DT = 1 / HZ;
const loads = [new Float64Array(12), new Float64Array(12)];
const cop = new Float64Array(4);
const buf = new Float64Array(3);

console.log(`══ probe-sole（τ模式 ${(globalThis as any).process?.env?.V4SIGCAL ?? 'off'}=${(globalThis as any).process?.env?.V4SIGTAU ?? ''}）══`);
const N = Math.round(T * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  if (k % 12 !== 0) continue;
  d.soleBlockLoad(0, loads[0]!);
  d.soleBlockLoad(1, loads[1]!);
  const sk2 = d as unknown as { sk: { joints: Array<{ name: string }>; bodies: Array<{ key: string }> } };
  const iFoot = sk2.sk.joints.findIndex((j) => j.name === 'foot_l');
  const ib = (d as unknown as { jointBodies: number[] }).jointBodies[iFoot * 2 + 1]!;
  const footBody = (d as unknown as { bodies: Array<{ rotation: () => { x: number; y: number; z: number; w: number } }> }).bodies[ib]!;
  const rq = footBody.rotation();
  const pitch = Math.atan2(2 * (rq.w * rq.x + rq.y * rq.z), 1 - 2 * (rq.x * rq.x + rq.y * rq.y)) * 57.2958;
  const L = Array.from(loads[0]!).map((v) => v.toFixed(0).padStart(5)).join('');
  const Lr = Array.from(loads[1]!).map((v) => v.toFixed(0).padStart(5)).join('');
  console.log(`t=${((k + 1) * DT).toFixed(2)} 左[${L}] 右[${Lr}] footL_pitch=${pitch.toFixed(2)}° 踝τ=${(rs.v4Diag?.Wt ? '' : '')}`);
  void cop; void buf;
}
