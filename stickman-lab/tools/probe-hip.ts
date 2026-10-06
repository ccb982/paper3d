/**
 * probe-hip.ts —— **大腿根（髋）三轴 + 大腿/骨盆的世界姿态**（用户：「大腿跟处折了」）
 * 用法：`node tools/run.mjs probe-hip [秒数=9] [间隔=0.25]`
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any; const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) { const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name); (im[i.module] ??= {})[i.name] = f; }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SECS = Number(ARGS[0] ?? 9);
const STEP = Number(ARGS[1] ?? 0.25);
const HZ = 120, DT = 1 / 120, PER = 2;
const DEG = 180 / Math.PI;
const sk = buildSkeleton(DEFAULT_CONFIG);
const jn = sk.joints.map((j) => j.name);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ABL = (ARGS[2] ?? '').trim();
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
  balance: { ...DEFAULT_CONTROLLER.balance, ablate: ABL || undefined },
});
const d = sim.doll; const rs = ctrl.rs;
const jr = new Float64Array(3);
console.log('══ probe-hip：髋三轴（0=外展 1=扭转 2=屈伸，度）+ τ + 大腿世界 pitch');
console.log('   t(s)  侧 | hip_l: 0/1/2        τ(0/1/2)      | hip_r: 0/1/2        τ(0/1/2)');
let nextT = 0;
const hi = jn.indexOf('hip_l'), hr = jn.indexOf('hip_r');
const g3 = (j: number): string => { d.jointRot(j, jr); return `${(jr[0]! * DEG).toFixed(0).padStart(4)}/${(jr[1]! * DEG).toFixed(0).padStart(4)}/${(jr[2]! * DEG).toFixed(0).padStart(4)}`; };
const t3 = (j: number): string => `τ ${(d.tauApplied[j * 3] ?? 0).toFixed(0)}/${(d.tauApplied[j * 3 + 1] ?? 0).toFixed(0)}/${(d.tauApplied[j * 3 + 2] ?? 0).toFixed(0)}`;
for (let i = 0; i < SECS * HZ && !sim.finished; i++) {
  if (i % PER === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  const t = i / HZ;
  if (t + 1e-6 < nextT) continue;
  nextT += STEP;
  console.log(`   ${t.toFixed(2).padStart(5)}  ${rs.supportLeg()} | ${g3(hi)}  ${t3(hi).padEnd(16)} | ${g3(hr)}  ${t3(hr)}`);
}
