/**
 * probe-joints —— **关节角轨迹回读**（用户："回读一下关节变化，在爆炸"）
 *
 *   每 1/60s 报关键关节的角度（度）；找出爆炸源与起爆时刻。
 *   用法：`node tools/run.mjs probe-joints [秒]`
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
const T = Number(ARGS[0] ?? 2);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const d = sim.doll;
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const HZ = 120, DT = 1 / HZ;

const NAMES: Array<[string, number]> = [
  ['hip_l', 2], ['knee_l', 2], ['foot_l', 2],
  ['hip_r', 2], ['knee_r', 2], ['foot_r', 2],
  ['spine1', 2], ['spine3', 2], ['hip_l', 0], ['foot_l', 0],
];
const IDX = NAMES.map(([n, k]) => ({ n, k, i: jointIndexByName(sk, n) }));

const buf = new Float64Array(3);
const log = (s: string) => console.log(s);
log(`══ probe-joints（${T}s；角度°）══`);
log('     t   | ' + NAMES.map(([n, k]) => `${n}/${k}`.padStart(9)).join(''));
const N = Math.round(T * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  if (k % 6 !== 0) continue;   // 每 50ms 一行
  const cells = IDX.map(({ i, k: ax }) => {
    if (i < 0) return '—'.padStart(9);
    d.jointRot(i, buf);
    return (buf[ax]! * 57.2958).toFixed(1).padStart(9);
  });
  log(`  ${t.toFixed(2)} | ${cells.join('')}`);
}
