/** probe-readback.ts —— 回读实际站距/脚位/髋位（确认配置真的生效） */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
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
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
log(`   DEFAULT_CONFIG.stance = ${DEFAULT_CONFIG.stance}`);
const hips = ['hip_l', 'hip_r'].map((n) => jointIndexByName(sk, n));
log(`══ 静态回读（t=0.3s）══`);
log('   量                左        右      差/合计');
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand' });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER });
const { jointIndexByName: jin } = await import('../src/core/skeleton');
for (const nm of ['hip_l', 'knee_l', 'foot_l', 'spine1']) {
  const j = jin(sk, nm); const d = sk.joints[j];
  log(`   ${nm.padEnd(8)} τmax = [${d!.maxTorque.map((v) => v.toFixed(0)).join(', ')}] N·m`
    + `   限位 ${d!.minRad.map((v) => (v * 180 / Math.PI).toFixed(0)).join('/')}°`);
}
const jw = new Float64Array(3);
for (let i = 0; i < 36; i++) {
  if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
  sim.advance(1);
}
const s = ctrl.snapshot;
sim.doll.jointWorld(hips[0]!, jw); const hl = jw[2]!;
sim.doll.jointWorld(hips[1]!, jw); const hr = jw[2]!;
const row = (nm: string, a: number, b: number, sum = false): void => {
  log(`   ${nm.padEnd(16)} ${(a * 1000).toFixed(0).padStart(6)}mm ${(b * 1000).toFixed(0).padStart(7)}mm`
    + `  ${(sum ? a + b : Math.abs(a - b)) === 0 ? '' : ((sum ? a + b : Math.abs(a - b)) * 1000).toFixed(0).padStart(6)}mm`);
};
row('髋 z', hl, hr, true);
row('踝 z', s.legs.l.footZ, s.legs.r.footZ, true);
row('CoP z', s.cop?.l?.z ?? 0, s.cop?.r?.z ?? 0, true);
row('足外八/外张', 0, 0);
log(`   com.z = ${(s.com.z * 1000).toFixed(0)}mm   站距/髋间距 = ${s.strideRatio.toFixed(2)}×`);
log(`   进支撑面需横移 = ${(s.supportEntryZ * 1000).toFixed(0)}mm`);
const BB = new Float64Array(4);
for (const [nm, i] of [['左', 0], ['右', 1]] as const) {
  sim.doll.footSoleBounds(i as 0 | 1, BB);
  log(`   ${nm}脚鞋底 z 范围 [${(BB[2]! * 1000).toFixed(0)}, ${(BB[3]! * 1000).toFixed(0)}]mm  半宽 ${((BB[3]! - BB[2]!) / 2 * 1000).toFixed(0)}mm`);
}
