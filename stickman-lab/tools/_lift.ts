import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs'; import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { BEST_PHASE, phaseGenomeFor } from '../src/core/phaseSeed';
const require = createRequire(import.meta.url);
{ const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const imp = {}; for (const i of WebAssembly.Module.imports(c)) { const f = (bgNs as never as Record<string,unknown>)[i.name]; if (typeof f === 'function') (imp[i.module] ??= {})[i.name] = f; }
  const r = await WebAssembly.instantiate(c, imp);
  (bgNs as never as {__wbg_set_wasm:(v:unknown)=>void}).__wbg_set_wasm((r as {instance?:{exports:unknown}}).instance ? (r as {instance:{exports:unknown}}).instance.exports : (r as {exports:unknown}).exports); }
const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode:'walk', duration:6 });
sim.begin(phaseGenomeFor(sk.joints.length, { ...BEST_PHASE, scale:0.15, legPhase:1 }));
const wl = sk.bodies.findIndex(b=>b.key==='shin_l'), wr = sk.bodies.findIndex(b=>b.key==='shin_r');
let airL=0, airR=0, both=0, ticks=0, minL=9, maxL=0;
while (!sim.finished && ticks < 6*120) {
  sim.advance(2); ticks++;
  const yl = sim.doll.soleY('l'), yr = sim.doll.soleY('r');
  minL = Math.min(minL, yl); maxL = Math.max(maxL, yl);
  if (yl > 0.02) airL++; if (yr > 0.02) airR++; if (yl>0.02 && yr>0.02) both++;
}
console.log(`soleY 左脚: min=${minL.toFixed(3)} max=${maxL.toFixed(3)} m；腾空占比 L=${(airL/ticks*100).toFixed(1)}% R=${(airR/ticks*100).toFixed(1)}% 双=${(both/ticks*100).toFixed(1)}%`);
console.log(`索引 shin_l=${wl} shin_r=${wr}（接触检测应改用 foot_l/foot_r 或鞋底 cuboid）`);
