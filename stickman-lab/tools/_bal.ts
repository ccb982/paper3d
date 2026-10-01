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
// 观测下标：0/1=时钟 2..5=四元数(x,y,z,w) 6..8=线速度 9..11=角速度 12=高 13=侧向 14/15=CoM偏移 16/17=CoM速度 18/19=DCM 20+=关节
const QX = 2, WX = 9, CMX = 14, CVX = 16;
/** 手写镇定器基因组：6 个自由参数（左右对称） */
function bal(k: number[]): Float32Array {
  const p = new Float32Array(4228);
  const h = (u: number, src: number, w: number) => { p[L.w1 + u*SH.inputs + src] = w; };
  h(0, QX, 1); h(1, WX, 1); h(2, CMX, 1); h(3, CVX, 1);
  const out = (j: string, a0: number, a1: number, a2: number, a3: number, b: number) => {
    const o = JOINT_ORDER.indexOf(j)*3 + 2;
    p[L.w2 + o*SH.hidden + 0] = a0; p[L.w2 + o*SH.hidden + 1] = a1;
    p[L.w2 + o*SH.hidden + 2] = a2; p[L.w2 + o*SH.hidden + 3] = a3; p[L.b2 + o] = b;
  };
  for (const [j, s] of [['hip_l',1],['hip_r',1]] as [string,number][]) {
    out(j, s*k[0], s*k[1], s*k[2], s*k[3], k[4]);
  }
  out('knee_l', 0, 0, 0, 0, k[5]); out('knee_r', 0, 0, 0, 0, k[5]);
  return p;
}
function score(k: number[]): { surv: number; tilt: number; x: number } {
  const sim = new Sim(sk, SH, { ...DEFAULT_SIM, mode:'walk', duration:6 });
  sim.begin(bal(k));
  let sum = 0, n = 0;
  while (!sim.finished) {
    sim.advance(1);
    sum += Math.abs(sim.doll.tiltOf(sim.doll.torso())); n++;
  }
  return { surv: n/120, tilt: (sum/Math.max(1,n))*57.3, x: sim.distance };
}
let best = [0,0,0,0,0,0], bs = score(best);
console.log(`  起点(全零): 存活 ${bs.surv.toFixed(2)}s 平均倾角 ${bs.tilt.toFixed(1)}° 位移 ${bs.x.toFixed(3)}m`);
// 坐标下降（每个参数试 ±，保留更好的）
let scale = 1.0;
for (let iter = 0; iter < 60; iter++) {
  let improved = false;
  for (let i = 0; i < 6; i++) {
    for (const d of [scale, -scale]) {
      const k2 = best.slice(); k2[i] += d;
      const s2 = score(k2);
      if (s2.surv > bs.surv + 1e-6 || (Math.abs(s2.surv-bs.surv)<1e-6 && s2.tilt < bs.tilt)) {
        best = k2; bs = s2; improved = true;
      }
    }
  }
  if (!improved) scale *= 0.6;
  if (scale < 1e-3) break;
}
console.log(`\n  ★ 手写镇定器: 存活 ${bs.surv.toFixed(2)}s 平均倾角 ${bs.tilt.toFixed(2)}° 位移 ${bs.x.toFixed(3)}m`);
console.log(`    参数 [k_pitch, k_rate, k_comx, k_comvx, bias, knee] = ${best.map(v=>v.toFixed(3)).join(', ')}`);
