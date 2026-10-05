/** probe-stance.ts —— 站距扫描：找 Perry 规范 0.075~0.080 m 对应的 stance 值 */
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
const log = console.log;
const SHAPE0 = null;
log('══ 站距扫描（Winter 1998 口径：站距/髋间距，实测区间 0.5~1.5）══');
log('   stance  半站距  站距   /髋间距  进支撑面  最小X3  驻留   存活');
for (const stance of [1.0, 0.6, 0.35, 0.15, 0.0]) {
  const sk = buildSkeleton({ ...DEFAULT_CONFIG, stance });
  const SHAPE = shapeForJoints(sk.joints.length);
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk' });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER });
  let dzMin = 1e9, alive = 0, run = 0, best = 0, lz = 0, rz = 0;
  for (let i = 0; i < 120 * 6 && !sim.finished; i++) {
    if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
    sim.advance(1);
    if (i % 2) continue;
    const s = ctrl.snapshot;
    if (i < 60) { lz = s.legs.l.footZ; rz = s.legs.r.footZ; }
    const dz = Math.abs(s.com.z - s.legs[s.supportLeg].footZ);
    dzMin = Math.min(dzMin, dz);
    if (dz <= 0.05) { run++; best = Math.max(best, run); } else run = 0;
    if (s.tiltDeg >= 25) break;
    alive = s.t;
  }
  const w = Math.abs(lz - rz);
  const { stanceWidthRatio, supportEntry } = await import('../src/core/keyframe');
  log(`   ${stance.toFixed(2)}    ${(Math.abs(lz) * 1000).toFixed(0).padStart(4)}mm`
    + ` ${(w * 1000).toFixed(0).padStart(4)}mm  ${stanceWidthRatio(lz, rz).toFixed(2).padStart(6)}×`
    + ` ${(supportEntry(lz) * 1000).toFixed(0).padStart(7)}mm`
    + ` ${(dzMin * 1000).toFixed(0).padStart(6)}mm ${(best / 60).toFixed(2).padStart(5)}s`
    + ` ${alive.toFixed(2)}s`);
}
void SHAPE0;
