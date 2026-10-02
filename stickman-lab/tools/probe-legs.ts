// ★ "只有一条腿有关节"？逐关节查：外力到底能不能推动每个关节
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER, jointIndexByName } from '../src/core/skeleton';
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
const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 2 });
sim.begin(new Float32Array(sim.params.length));

console.log('=== 逐关节：马达索引 / 力矩上限 / 单轴推动测试 ===\n');
console.log(`  JOINT_ORDER.length = ${JOINT_ORDER.length}   joints.length = ${sk.joints.length}`);
console.log(`  motorTarget 长度 = ${sim.doll.motorTarget.length} (= joints.length*3)\n`);
console.log('  关节名        JOINT_ORDER位置  实际索引  轴2限位(°)   力矩(N·m)   单轴指令→实测位移');
for (let i = 0; i < sk.joints.length; i++) {
  const j = sk.joints[i]!;
  const jo = JOINT_ORDER.indexOf(j.name);
  const lim = `${(j.minRad[2] * 180 / Math.PI).toFixed(0)}~${(j.maxRad[2] * 180 / Math.PI).toFixed(0)}`;
  // 单独测：给该关节轴2 一个中等指令，看能不能推动
  const s2 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 1.2 });
  s2.begin(new Float32Array(s2.params.length));
  const out = new Float32Array(s2.params.length);
  out[i * 3 + 2] = 0.5;                       // 轴2 正指令
  s2.doll.setMotorTargets(out);
  const a0 = s2.doll.jointAngle(i);
  for (let k = 0; k < 100; k++) { s2.doll.driveMotors(1 / 120); s2.world.step(); }
  const a1 = s2.doll.jointAngle(i);
  const moved = (a1 - a0) * 180 / Math.PI;
  console.log(`  ${j.name.padEnd(12)} ${String(jo).padStart(12)}  ${String(i).padStart(8)}  ${lim.padStart(11)}`
    + `  ${j.maxTorque[2].toFixed(0).padStart(9)}   ${moved >= 0 ? '+' : ''}${moved.toFixed(2).padStart(7)}°`
    + (Math.abs(moved) < 0.5 ? '   ✗ 推不动' : ''));
}
console.log('\n  JOINT_ORDER位置 = -1 表示该关节不在常量表里（如 spine1..3）⇒');
console.log('  teacher 旧代码用 indexOf 查它们 ⇒ 永远 -1 ⇒ 腰从未被驱动。');
