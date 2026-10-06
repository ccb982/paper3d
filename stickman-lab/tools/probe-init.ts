/**
 * probe-init.ts —— **第 0 拍的不对称从哪来**（用户：「回读前0.1s」发现的 +2.9mm）
 * 用法：`node tools/run.mjs probe-init`
 */
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
  for (const i of WebAssembly.Module.imports(c)) { const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name); (im[i.module] ??= {})[i.name] = f; }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 1 });
sim.begin(new Float32Array(sim.paramCount));
const d = sim.doll;
console.log('══ 第 0 拍（sim.begin 后、未跑任何控制）══');
let m = 0, cx = 0, cy = 0, cz = 0;
for (const rb of d.bodies) {
  const t = rb.translation(); const mm = rb.mass();
  console.log(`  ${String((rb as unknown as { userData?: string }).userData ?? '?').padEnd(12)} m=${mm.toFixed(2).padStart(6)}  pos=(${t.x.toFixed(3)},${t.y.toFixed(3)},${t.z.toFixed(3)})`);
  m += mm; cx += mm * t.x; cy += mm * t.y; cz += mm * t.z;
}
console.log(`\n  CoM 初始 = (${(cx / m).toFixed(4)}, ${(cy / m).toFixed(4)}, ${(cz / m).toFixed(4)}) m   总质量 ${m.toFixed(1)} kg`);
console.log(`  ⇒ z 偏移 = ${((cz / m) * 1000).toFixed(2)} mm（用户观察到的 +2.9mm 的真身）`);
