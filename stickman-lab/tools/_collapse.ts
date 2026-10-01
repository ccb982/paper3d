import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs'; import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { readCom, newCom, newSupport, readSupport } from '../src/core/posture';
const require = createRequire(import.meta.url);
{ const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const imp = {}; for (const i of WebAssembly.Module.imports(c)) { const f = (bgNs as never as Record<string,unknown>)[i.name]; if (typeof f === 'function') (imp[i.module] ??= {})[i.name] = f; }
  const r = await WebAssembly.instantiate(c, imp);
  (bgNs as never as {__wbg_set_wasm:(v:unknown)=>void}).__wbg_set_wasm((r as {instance?:{exports:unknown}}).instance ? (r as {instance:{exports:unknown}}).instance.exports : (r as {exports:unknown}).exports); }
const sk = buildSkeleton(DEFAULT_CONFIG);
const SH = shapeForJoints(sk.joints.length);
const sim = new Sim(sk, SH, { ...DEFAULT_SIM, mode:'walk', duration:4 });
sim.begin(new Float32Array(sim.params.length));
const com = newCom(), sup = newSupport();
const names = ['hip_l','knee_l','hip_r','knee_r','shoulder_l','elbow_l'];
const idx = names.map(n => JOINT_ORDER.indexOf(n));
const lim = (n: string) => { const j = sk.joints.find(x=>x.name===n)!; return { flex: [j.minRad[2]*57.3, j.maxRad[2]*57.3], xy: j.minRad[0]*57.3 }; };
console.log('限位(度):');
for (const n of names) { const l = lim(n); console.log(`  ${n.padEnd(10)} 屈伸 [${l.flex[0].toFixed(0)}, ${l.flex[1].toFixed(0)}]  X下限 ${l.xy.toFixed(0)}`); }
console.log(`\n  t     躯干高  倾角   CoM.x  CoM.z  脚着地   hip_l  knee_l  hip_r  knee_r  倒地`);
let i = 0;
while (!sim.finished && i < 3*120) {
  sim.advance(1); i++;
  if (i % 12 === 0) {
    readCom(sim.doll, com); readSupport(sim.doll, sup);
    const t = sim.doll.torso();
    const a = idx.map(k => sim.doll.jointAngle(k) * 57.3);
    console.log(`  ${(i/120).toFixed(2)}  ${t.translation().y.toFixed(3)}  ${(sim.doll.tiltOf(t)*57.3).toFixed(1)}°  ${com.x.toFixed(3)}  ${com.z.toFixed(3)}   ${sim.doll.footGrounded(0)?'L':'-'}${sim.doll.footGrounded(1)?'R':'-'}   `
      + a.map(v=>v.toFixed(1).padStart(6)).join(' ') + (sim.fallen?'  倒':''));
  }
}
console.log(`\n  躯干初始高 ${sim.initTorsoY.toFixed(3)} m ⇒ 结束时剩 ${(sim.endTorsoY/sim.initTorsoY*100).toFixed(0)}%`);
console.log(`  摔倒判据 fallHeightRatio=${DEFAULT_SIM.fallHeightRatio} fallAngle=${DEFAULT_SIM.fallAngle}`);
