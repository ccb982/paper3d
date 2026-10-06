/**
 * probe-sustain.ts —— **"多机制持续发力"的验收探针**（用户定调的新判据）
 *
 * 用户 2026-10-06：「**就要都开**，你别在乎这几秒的时间。
 *   我要的是**多种机制持续发力**，这样才能长久持续」
 *
 * ⇒ 判据从"倒得晚"改为：
 *   · **各通道的发力占空比**（|τ| > 3 N·m 的拍占比）
 *   · **同号连续段**（拍数；越长的"持续蹬"越好）
 *   · 各机制是否在**同时**活动（承重腿 / 踝 CoP / 溢出剪力 / 侧向 / 腰回直）
 *
 * 用法：`node tools/run.mjs probe-sustain [秒数=6]`
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
const SECS = Number(ARGS[0] ?? 6);
const HZ = 120, DT = 1 / 120, PER = 2;
const sk = buildSkeleton(DEFAULT_CONFIG);
const jn = sk.joints.map((j) => j.name);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER, gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' } });
const d = sim.doll; const rs = ctrl.rs;

type Acc = { n: number; on: number; sign: number; streak: number; best: number; sum: number };
const mk = (): Acc => ({ n: 0, on: 0, sign: 0, streak: 0, best: 0, sum: 0 });
const chans: Record<string, Acc> = {
  '踝(矢状)': mk(), '髋(矢状)': mk(), '膝(矢状)': mk(),
  '髋(外展)': mk(), '腰(矢状)': mk(), '溢出剪力': mk(),
};
const feed = (a: Acc, tau: number): void => {
  a.n++; a.sum += Math.abs(tau);
  if (Math.abs(tau) > 3) {
    a.on++;
    const s = Math.sign(tau);
    if (s === a.sign) a.streak++; else { a.sign = s; a.streak = 1; }
    if (a.streak > a.best) a.best = a.streak;
  }
};
for (let i = 0; i < SECS * HZ && !sim.finished; i++) {
  if (i % PER === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  if (i % PER !== 0) continue;
  const sup = rs.supportLeg();
  const g = (nm: string, ax: number): number => { const j = jn.indexOf(nm); return j < 0 ? 0 : (d.tauApplied[j * 3 + ax] ?? 0); };
  feed(chans['踝(矢状)']!, g(`foot_${sup}`, 2));
  feed(chans['髋(矢状)']!, g(`hip_${sup}`, 2));
  feed(chans['膝(矢状)']!, g(`knee_${sup}`, 2));
  feed(chans['髋(外展)']!, g(`hip_${sup}`, 0));
  feed(chans['腰(矢状)']!, g('spine1', 2) + g('spine2', 2) + g('spine3', 2));
  feed(chans['溢出剪力']!, rs.spillFx);
}
console.log('══ probe-sustain：多机制"持续发力"验收（每 33ms 一拍）══');
console.log('   通道         占空比   |τ|均值   最长同号段  平均同号段');
for (const [nm, a] of Object.entries(chans)) {
  const duty = a.n ? (a.on / a.n) * 100 : 0;
  const avg = a.on ? (a.n / a.on).toFixed(1) : '—';
  console.log(`   ${nm.padEnd(12)} ${duty.toFixed(0).padStart(4)}%   ${(a.sum / Math.max(1, a.n)).toFixed(0).padStart(5)}   ${String(a.best).padStart(8)}  ${String(avg).padStart(8)}`);
}
console.log('   读法：占空比 = 在"蹬"的时间比例；最长同号段 = 连续蹬了多少拍（33ms/拍）');
