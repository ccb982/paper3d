/**
 * probe-waistlat.ts —— **腰侧向（额状）全链逐拍**：提案 → 修正 → 借力 → 发布 → 实际
 *
 * 用户 2026-10-06：「**腰一直侧向弯曲**，平衡系统对腰的修正可能出问题了，
 *   或者迈步系统对腰弯曲的弧度也算错了」。
 *
 * 每拍打：`waist.step.roll`（迈步提案）/ `waist.bal.roll`（平衡修正）/
 *   `waist.borrow.roll`（借力）/ `waist.out.roll`（发布）/ 实际 `spine1..3/0` 角 +
 *   骨盆 roll + 躯干 roll + `upLeanK` 的输入项（`zRecv−com.z`）。
 * 用法：`node tools/run.mjs probe-waistlat [秒数=3] [间隔=0.1]`
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
const SECS = Number(ARGS[0] ?? 3);
const STEP = Number(ARGS[1] ?? 0.1);
const HZ = 120, DT = 1 / HZ, PER = 2;
const DEG = 180 / Math.PI;
const sk = buildSkeleton(DEFAULT_CONFIG);
const jn = sk.joints.map((j) => j.name);
const J = (n: string): number => jn.indexOf(n);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER, gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' } });
const d = sim.doll; const rs = ctrl.rs;
const jr = new Float64Array(3);
console.log('══ probe-waistlat：腰侧向全链（度）══');
console.log('   t(s) 状态 | 迈步提案 bal修正 borrow 发布out | spine1/0 spine2/0 spine3/0 实际τ1 | 骨盆roll 躯干roll | zRecv-com.z');
let nextT = 0;
for (let i = 0; i < SECS * HZ && !sim.finished; i++) {
  if (i % PER === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  const t = i / HZ;
  if (t + 1e-6 < nextT) continue;
  nextT += STEP;
  const w = rs.waist;
  const a = (n: string): number => { const j = J(n); if (j < 0) return Number.NaN; d.jointRot(j, jr); return jr[0]! * DEG; };
  const recv = rs.roleRecv ?? rs.frontLeg();
  const zR = recv === 'l' ? rs.soleZ.l : rs.soleZ.r;
  const f = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : '—').padStart(6);
  console.log(`   ${t.toFixed(2).padStart(5)} ${rs.state.slice(0, 4)} | ${f(w.step.roll)} ${f(w.bal.roll)} ${f(w.borrow.roll)} ${f(w.out.roll)}`
    + ` | ${f(a('spine1'))} ${f(a('spine2'))} ${f(a('spine3'))} ${f(d.tauApplied[J('spine1')! * 3 + 0] ?? 0)}`
    + ` | ${f(rs.rollDeg)} ${f(rs.tiltDeg)} | ${f((zR - rs.com.z) * 1000)}`);
}
