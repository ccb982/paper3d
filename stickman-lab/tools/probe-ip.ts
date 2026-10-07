/**
 * probe-frame —— **逐控制拍回读**（用户：「再逐帧回读看情况，还是脚在抖」）
 *
 *   每拍报：双脚 Fz / 接触稳定 / 踝x / 踝y / CoM.x / CoM.vy / 支撑腿的膝/踝 τ。
 *   用法：`node tools/run.mjs probe-frame [tStart] [tEnd]`
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
const T0 = Number(ARGS[0] ?? 1.8);
const T1 = Number(ARGS[1] ?? 2.2);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 0.1 });
const ip = sim.world.integrationParameters;
const keys = Object.keys(ip).filter(k => /contact|damp|freq|erp/i.test(k));
console.log('IP keys:', keys.join(', ') || '(none)');
console.log('natural_frequency =', (ip as any).contact_natural_frequency);
console.log('damping_ratio in ip =', 'contact_damping_ratio' in ip);
console.log('erp =', (ip as any).erp);
