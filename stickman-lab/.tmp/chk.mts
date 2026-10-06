import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
const require = createRequire('file:///C:/Users/22641/Desktop/架构重置/stickman-lab/tools/x.mjs');
const { buildSkeleton, DEFAULT_CONFIG } = await import('C:/Users/22641/Desktop/架构重置/stickman-lab/src/core/skeleton.ts');
await import('C:/Users/22641/Desktop/架构重置/stickman-lab/src/core/ragdoll.ts');
{
  const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const im = {};
  for (const i of WebAssembly.Module.imports(c)) im[i.module] ??= {}, im[i.module][i.name] = bgNs[i.name];
  bgNs.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('C:/Users/22641/Desktop/架构重置/stickman-lab/src/core/sim.ts');
const { shapeForJoints } = await import('C:/Users/22641/Desktop/架构重置/stickman-lab/src/core/brain.ts');
const { Controller, DEFAULT_CONTROLLER } = await import('C:/Users/22641/Desktop/架构重置/stickman-lab/src/core/controller.ts');
const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'walk', duration: 3 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const PER = Math.round(sim.cfg.physicsHz / sim.cfg.controlHz);
for (let i = 0; i < 3 * sim.cfg.physicsHz && !sim.finished; i++) {
  if (i % PER === 0) sim.doll.setMotorTargets(ctrl.step(1 / sim.cfg.controlHz));
  sim.advance(1);
}
const jq = ctrl.rs.jq;
console.log('telemetry.jointsDeg =', ctrl.rs.telemetry.jointsDeg);
for (const n of ['l_hip', 'hip_l', 'l_knee', 'knee_l', 'l_ankle', 'foot_l']) {
  console.log(`  ${n.padEnd(8)} angleDeg(axis0) = ${jq.angleDeg(n, 0).toFixed(3)}`);
}
