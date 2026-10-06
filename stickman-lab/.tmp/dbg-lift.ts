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
const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode:'stand', duration:1 });
sim.begin(new Float32Array(sim.paramCount));
const z = new Float32Array(sk.joints.length*3);
const PH=DEFAULT_SIM.physicsHz;
console.log('零输出（不经 Controller）逐拍：t  CoM.y  Fz总(N)  触地L/R  躯干y');
for (let i=0;i<Math.round(0.6*PH);i++){
  sim.doll.setMotorTargets(z);
  sim.advance(1);
  if (i % 12 === 0) {
    let fz=0; const C=new Float64Array(4);
    for (const s of [0,1] as const){ sim.doll.readCoP(s,C); fz += C[3]*PH; }
    let m=0,my=0;
    for(const b of sim.doll.bodies){const w=b.worldCom();const mm=b.mass();m+=mm;my+=mm*w.y;}
    console.log(`${(i/PH).toFixed(3)}  ${(my/m).toFixed(4)}  ${fz.toFixed(1).padStart(8)}   `
      +`${sim.doll.footGrounded(0)?'L':'-'}${sim.doll.footGrounded(1)?'R':'-'}      ${sim.doll.torso().translation().y.toFixed(4)}`);
  }
}
console.log('finished=',sim.finished,'fallen=',sim.fallen,'ticks=',sim.ticksDone, 'sec=', (sim.ticksDone/DEFAULT_SIM.controlHz).toFixed(2));
