/**
 * probe-cmd —— **命令归属回读**（用户："回读各个模块都发命令的，特别是平衡系统"）
 *
 *   每 0.2s 一行：对每条腿的关键轴，报"谁下的角度目标 / 谁下的力矩 / 值和分支"。
 *   用于回答"为什么踢腿"——是哪个模块、什么标签在驱动腿。
 *   用法：`node tools/run.mjs probe-cmd [秒]`
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
const T = Number(ARGS[0] ?? 3);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const d = sim.doll;
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const HZ = 120, DT = 1 / HZ;

// 关注的轴：摆动腿的髋/膝（踢腿问题的主犯候选）
const AXES: Array<[string, number]> = [
  ['hip_l', 2], ['knee_l', 2], ['foot_l', 2],
  ['hip_r', 2], ['knee_r', 2], ['foot_r', 2],
];
const IDX = AXES.map(([n, ax]) => ({ n, ax, i: jointIndexByName(sk, n) * 3 + ax }));

const log = (s: string) => console.log(s);
log(`══ probe-cmd 命令归属（${T}s）══`);
log('     t   | 轴: 角度目标(谁/值)         | 力矩(谁/值)               | 实τ/分支');
const N = Math.round(T * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  if (k % 24 !== 0) continue;
  const tgts = (rs as { targets?: () => Array<{ ownerLabel: string; value: number }> }).targets?.() ?? [];
  const parts: string[] = [];
  for (const a of IDX) {
    const tt = tgts[a.i];
    const tau = (d.tauApplied[a.i] ?? 0).toFixed(0);
    const br = d.motorBranch[a.i] ?? 0;
    parts.push(`${a.n.split('_')[0]}:${(tt?.ownerLabel ?? '—').slice(0, 8)}/${(tt?.value ?? 0).toFixed(2)} τ${tau}/b${br}`);
  }
  log(`  ${t.toFixed(2)} | ${parts.join(' | ')}`);
}
