/** probe-kf.ts —— 关键帧表 vs 旧的手调角度律（消融对照） */
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
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { DEFAULT_STEP_PARAMS } = await import('../src/core/systems/step');
const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
log('══ 摆动腿角度律消融：Perry 关键帧 vs 旧手调律 ══');
log('   配置              最小X3  驻留   vz峰  com.z末 存活  翻转  关键帧');
for (const useKF of [true, false]) {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk' });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER, step: { ...DEFAULT_STEP_PARAMS, useKeyFrame: useKF },
  });
  let dzMin = 1e9, vz = 0, zEnd = 0, alive = 0, flips = 0, prev = '', keys = '';
  let run = 0, best = 0;
  for (let i = 0; i < 120 * 8 && !sim.finished; i++) {
    if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
    sim.advance(1);
    if (i % 2) continue;
    const s = ctrl.snapshot;
    const dz = Math.abs(s.com.z - s.legs[s.supportLeg].footZ);
    dzMin = Math.min(dzMin, dz);
    if (dz <= 0.05) { run++; best = Math.max(best, run); } else run = 0;
    vz = Math.max(vz, Math.abs(s.com.vz)); zEnd = s.com.z;
    if (prev && s.supportLeg !== prev) flips++;
    prev = s.supportLeg;
    if (!keys.includes(s.gaitKey)) keys += s.gaitKey + ' ';
    if (s.tiltDeg >= 25) break;
    alive = s.t;
  }
  log(`   ${(useKF ? 'Perry 关键帧' : '旧手调律   ').padEnd(16)}`
    + ` ${(dzMin * 1000).toFixed(0).padStart(5)}mm ${(best / 60).toFixed(2).padStart(5)}s`
    + ` ${(vz * 1000).toFixed(0).padStart(5)} ${(zEnd * 1000).toFixed(0).padStart(6)}mm`
    + ` ${alive.toFixed(2)}s ${String(flips).padStart(4)}  ${keys}`);
}
