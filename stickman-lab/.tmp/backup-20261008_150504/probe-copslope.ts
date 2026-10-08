/**
 * probe-copslope —— **静止状态下 CoP 对踝 τ 的斜率**（骨骼在线，单次运行内步进）
 *
 *   预热 → 骨骼保持 2s 稳定 → 依次注入 τ∈{0,−20,−40,−60,+20,+40}（各 0.5s）
 *   每段末尾读 CoP_L 的平均（soleCop 回读）。
 *   斜率 mm/(N·m) = 理论 1/Fz(=2.9) 的对照。
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
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 8 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const DT = 1 / 120;
const env0 = (((globalThis as { process?: { env?: Record<string, string> } }).process?.env) ?? {}) as Record<string, string>;

const dAny = sim.doll as unknown as { readCoP: (side: 0 | 1, out: Float64Array) => void; soleForceProfile: (side: 0 | 1, dt: number) => { fz: number; copX: number } };
const copBuf = new Float64Array(4);
const settle = (s: number): void => { for (let k = 0; k < s * 120; k++) { ctrl.step(DT); sim.advance(2); } };
const avgCop = (s: number): { cop: number; fz: number; comx: number } => {
  let sc = 0, sf = 0, sx = 0, n = 0;
  for (let k = 0; k < s * 120; k++) {
    ctrl.step(DT); sim.advance(2);
    const F = dAny.soleForceProfile(0, DT);
    sc += (F.copX ?? 0) * 1000; sf += (F.fz ?? 0); sx += (rs.com.x ?? 0) * 1000; n++;
  }
  return { cop: sc / n, fz: sf / n, comx: sx / n };
};

settle(0.6);
console.log('══ probe-copslope（骨骼在线）══');
console.log('τ_inj(N·m)   CoP_L(mm)   Fz_L(N)   CoM.x(mm)');
let ref: { cop: number; fz: number } | null = null;
for (const tv of [0, -20, -40, -60, 20, 40]) {
  env0.V4SIGNCAL = 'foot'; env0.V4SIGTAU = String(tv);
  const r = avgCop(0.35);
  if (tv === 0) ref = r;
  const slope = ref && tv !== 0 ? ((r.cop - ref.cop) / tv).toFixed(2) : '—';
  console.log(`${String(tv).padStart(8)}   ${r.cop.toFixed(1).padStart(9)}   ${r.fz.toFixed(0).padStart(6)}   ${r.comx.toFixed(1).padStart(8)}   斜率=${slope} mm/(N·m)`);
}
// 理论：CoP 偏移 = τ/Fz ⇒ 1/Fz m/(N·m) = 1000/Fz mm/(N·m)
if (ref) console.log(`理论斜率 = 1000/Fz = ${(1000 / ref.fz).toFixed(2)} mm/(N·m)`);
