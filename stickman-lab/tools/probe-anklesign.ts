// ★ 踝方向对不对？给 foot_l 一个已知正指令，看脚尖是上勾还是下压
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
const require = createRequire(import.meta.url);
{ const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const imp: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(c)) { const f = (bgNs as unknown as Record<string, unknown>)[i.name]; if (typeof f === 'function') (imp[i.module] ??= {})[i.name] = f; }
  const r = (await WebAssembly.instantiate(c, imp)) as unknown as { instance?: { exports: unknown }; exports: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(r.instance ? r.instance.exports : r.exports); }

const sk = buildSkeleton({ ...DEFAULT_CONFIG, ankleEnabled: true } as never);
const shape = shapeForJoints(sk.joints.length);
const fi = JOINT_ORDER.indexOf('foot_l');
const j = sk.joints[fi]!;
console.log(`踝关节 foot_l：limitDeg = [${(j.minRad[2] * 180 / Math.PI).toFixed(1)}°, ${(j.maxRad[2] * 180 / Math.PI).toFixed(1)}°]`);
console.log('partsMeta 注释：limitDeg = [低头(plantarflex), 勾脚(dorsiflex)]\n');

console.log('  指令(rad)   实测踝角(°)   脚尖高度变化(mm)   判定');
for (const cmd of [-0.30, -0.15, 0, 0.15, 0.30]) {
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 3 });
  sim.begin(new Float32Array(sim.params.length));
  // 直接下电机指令：cmd 经 0.9*maxRad 归一化
  const out = new Float32Array(sim.params.length);
  out[fi * 3 + 2] = cmd / (0.9 * j.maxRad[2]);
  sim.doll.setMotorTargets(out);
  const h0 = sim.doll.soleY('l');
  for (let i = 0; i < 240; i++) { sim.doll.driveMotors(1 / 120); sim.world.step(); }
  const a = sim.doll.jointAngle(fi);
  const h1 = sim.doll.soleY('l');
  const up = (h1 - h0) * 1000;
  const verdict = up > 2 ? '脚尖上勾（背屈）' : up < -2 ? '脚尖下压（跖屈）' : '几乎不动';
  console.log(`  ${cmd.toFixed(2).padStart(8)}   ${(a * 180 / Math.PI).toFixed(1).padStart(9)}   ${up.toFixed(1).padStart(15)}   ${verdict}`);
}
console.log('\n  结论：若"正指令 → 脚尖上勾"，则约定为 正=背屈；若"正指令 → 脚尖下压"，则 正=跖屈。');
console.log('  teacher 里的约定：摆动前半 背屈 我写了 **负**值（−aSwing），支撑起立 跖屈 写了 **正**值（+aPush）。');
