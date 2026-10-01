import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs'; import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints, brainLayout } from '../src/core/brain';
const require = createRequire(import.meta.url);
{ const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const imp = {}; for (const i of WebAssembly.Module.imports(c)) { const f = (bgNs as never as Record<string,unknown>)[i.name]; if (typeof f === 'function') (imp[i.module] ??= {})[i.name] = f; }
  const r = await WebAssembly.instantiate(c, imp);
  (bgNs as never as {__wbg_set_wasm:(v:unknown)=>void}).__wbg_set_wasm((r as {instance?:{exports:unknown}}).instance ? (r as {instance:{exports:unknown}}).instance.exports : (r as {exports:unknown}).exports); }
const sk = buildSkeleton(DEFAULT_CONFIG);
const SH = shapeForJoints(sk.joints.length);
const L = brainLayout(SH);
/** 给一组关节的屈伸轴(axis2)加常数偏置 */
function g(bias: Record<string, number>, extra: Record<string, number> = {}) {
  const p = new Float32Array(4228);
  p[L.w1 + 0*SH.inputs + 0] = 5;                    // h0 ← sin(φ)≈0 起步，稳态≈0
  for (const [k,v] of Object.entries({...bias, ...extra})) {
    const o = JOINT_ORDER.indexOf(k)*3 + (extra[k] !== undefined ? 0 : 2);
    if (o < 0) continue;
    if (extra[k] !== undefined) p[L.b2 + o] = extra[k];
    else p[L.b2 + o] = v;
  }
  return p;
}
console.log('  偏置(度)                     3s 倾角  6s 倾角  6s CoM.x  存活  倒地');
const cases: [string, Float32Array][] = [
  ['零输出', new Float32Array(4228)],
  ['髋 −1°（后仰）', g({ hip_l: -0.017, hip_r: -0.017 })],
  ['髋 −2°', g({ hip_l: -0.035, hip_r: -0.035 })],
  ['髋 −3°', g({ hip_l: -0.052, hip_r: -0.052 })],
  ['髋 −1° + 膝 +1°', g({ hip_l: -0.017, hip_r: -0.017, knee_l: 0.017, knee_r: 0.017 })],
  ['髋 −2° + 膝 +2°', g({ hip_l: -0.035, hip_r: -0.035, knee_l: 0.035, knee_r: 0.035 })],
  ['踝(无) + 髋 −2° + 膝 +3°', g({ hip_l: -0.035, hip_r: -0.035, knee_l: 0.052, knee_r: 0.052 })],
];
for (const [name, gg] of cases) {
  const sim = new Sim(sk, SH, { ...DEFAULT_SIM, mode:'walk', duration:6 });
  sim.begin(gg);
  let t3 = 0, i = 0;
  while (!sim.finished && i < 6*120) {
    sim.advance(1); i++;
    if (i === 360) t3 = sim.doll.tiltOf(sim.doll.torso())*57.3;
  }
  console.log(`  ${name.padEnd(26)} ${t3.toFixed(1).padStart(5)}°  ${(sim.endTilt*57.3).toFixed(1).padStart(5)}°  ${sim.distance.toFixed(3).padStart(7)}  ${(i/120).toFixed(1)}s  ${sim.fallen?'倒':'站'}`);
}
