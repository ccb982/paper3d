// ============================================================
// probe-motor —— 关节驱动方式的取证与标定
// ============================================================
// 这个文件是「为什么不用 Rapier 自带关节马达」的证据档案，也是新方案（自实现
// 力矩冲量）的标定台。改动驱动方式前先跑一遍它。
//
// 跑法：node tools/run.mjs probe-motor
//
// 结论摘要（2026-10-01）
//   ① Rapier 0.14 `configureMotorVelocity(tv, factor)` 的 factor 不是线性增益：
//      factor=1 几乎零出力；往上扫 1→20 无驱动、30 直接数值爆炸。没有可用区间。
//   ② `ImpulseJoint.handle` 读回是 `0, 5e-324, 1e-323, …` —— 整数被当成 f64
//      位模式重新解释（同本体记录的 createRigidBody 坏 handle）。但双摆对照显示
//      内部派发是正确的，所以这只影响"读 handle"本身。
//   ③ 关节限位写 `JointData.limitsEnabled/limits`（建关节前）与事后 `setLimits`
//      两种方式都生效 —— 本项目采用前者，少依赖一层事后调用。
//   ④ 最终方案：自实现关节力矩（成对等大反向 Z 轴力矩冲量），上限取
//      MuJoCo humanoid.xml 的 actuator gear。力矩有界 ⇒ 不会爆炸。
//
// 附带的性能数据：单世界 solverIterations 1/2/4/8 → 32/40/54/94 µs/步。

import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import RAPIER from '@dimforge/rapier3d';
import { DEFAULT_CONFIG, JOINT_MAX_TORQUE, buildSkeleton } from '../src/core/skeleton';
import { Ragdoll } from '../src/core/ragdoll';

const require = createRequire(import.meta.url);
const wasmPath: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
{
  const compiled = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  const instance = await WebAssembly.instantiate(compiled, imports);
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(instance.exports);
}

const deg = (r: number) => (r * 180) / Math.PI;
const sk = buildSkeleton(DEFAULT_CONFIG);

function makePendulum(x: number, motor: 'none' | 'velocity', gain = 1, limits: null | [number, number] = null) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  const base = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 2, 0));
  world.createCollider(RAPIER.ColliderDesc.ball(0.02).setCollisionGroups(0), base);
  const rod = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 1.7, 0)
      .enabledTranslations(true, true, false).enabledRotations(false, false, true).setCanSleep(false),
  );
  world.createCollider(RAPIER.ColliderDesc.capsule(0.25, 0.03).setMass(3).setCollisionGroups(0), rod);
  const jd = RAPIER.JointData.revolute(
    { x: 0, y: -0.05, z: 0 }, { x: 0, y: 0.25, z: 0 }, { x: 0, y: 0, z: 1 },
  );
  if (limits) { jd.limitsEnabled = true; jd.limits = limits; }
  const joint = world.createImpulseJoint(jd, base, rod, true) as RAPIER.RevoluteImpulseJoint;
  return { world, rod, joint, setMotor: () => {
    if (motor === 'velocity') joint.configureMotorVelocity(2, gain);
  } };
}

// ------------------------------------------------------------ ① Rapier 马达的 factor 语义
console.log('\n=== ① Rapier 自带速度马达：factor 到底是什么 ===');
console.log('（杆竖直下垂 = 平衡位，只能靠马达转起来；target 固定 2 rad/s，跑 1 秒）');
for (const g of [1, 5, 20, 50, 200, 1000, 5000]) {
  const p = makePendulum(0, 'velocity', g);
  p.setMotor();
  for (let i = 0; i < 120; i++) p.world.step();
  const ang = deg(2 * Math.atan2(p.rod.rotation().z, p.rod.rotation().w));
  const ok = Number.isFinite(ang) && Math.abs(ang) < 400;
  console.log(`  factor=${String(g).padStart(5)}  转角 ${ok ? ang.toFixed(1).padStart(8) : '发散'.padStart(9)}°`);
}
{
  const p = makePendulum(0, 'none');
  for (let i = 0; i < 120; i++) p.world.step();
  console.log(`  无马达（基线）      转角 ${deg(2 * Math.atan2(p.rod.rotation().z, p.rod.rotation().w)).toFixed(1)}°`);
}

// ------------------------------------------------------------ ② handle 读回
console.log('\n=== ② ImpulseJoint.handle 读回 ===');
{
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const doll = new Ragdoll(world, sk);
  doll.joints.forEach((j, i) => {
    console.log(`  [${i}] ${sk.joints[i].name.padEnd(11)} handle=${String(j.handle)}`);
  });
  console.log('  ↑ 期望 0,1,2,…；实际是 5e-324 这类次正规 double，即整数被按 f64 位模式读取。');
  console.log('    双摆对照（下）证明：内部派发仍是正确的，此 bug 只影响"读 handle"。');
}

console.log('\n=== ③ 双摆对照：马达调用有没有打偏关节 ===');
{
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  const mk = (x: number) => {
    const base = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 2, 0));
    world.createCollider(RAPIER.ColliderDesc.ball(0.02).setCollisionGroups(0), base);
    const rod = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 1.7, 0)
        .enabledTranslations(true, true, false).enabledRotations(false, false, true).setCanSleep(false),
    );
    world.createCollider(RAPIER.ColliderDesc.capsule(0.25, 0.03).setMass(3).setCollisionGroups(0), rod);
    const jd = RAPIER.JointData.revolute(
      { x: 0, y: -0.05, z: 0 }, { x: 0, y: 0.25, z: 0 }, { x: 0, y: 0, z: 1 },
    );
    return { rod, j: world.createImpulseJoint(jd, base, rod, true) as RAPIER.RevoluteImpulseJoint };
  };
  const a = mk(0), b = mk(3);
  a.j.configureMotorVelocity(-3, 1000);
  b.j.configureMotorVelocity(+3, 1000);
  for (let i = 0; i < 72; i++) world.step();
  const angA = deg(2 * Math.atan2(a.rod.rotation().z, a.rod.rotation().w));
  const angB = deg(2 * Math.atan2(b.rod.rotation().z, b.rod.rotation().w));
  console.log(`  指令 -3 → ${angA.toFixed(2)}°   指令 +3 → ${angB.toFixed(2)}°`);
  console.log(`  符号${Math.sign(angA) !== Math.sign(angB) ? '相反 ✔ 各自收到自己的指令' : '相同 ✘ 调用打偏了'}`);
}

// ------------------------------------------------------------ ④ 限位两种写法
console.log('\n=== ④ 限位：建关节前写 JointData vs 建完 setLimits ===');
{
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  const mk = (x: number, mode: 'field' | 'setter') => {
    const base = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 2, 0));
    world.createCollider(RAPIER.ColliderDesc.ball(0.02).setCollisionGroups(0), base);
    const rod = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 1.7, 0)
        .enabledTranslations(true, true, false).enabledRotations(false, false, true).setCanSleep(false),
    );
    world.createCollider(RAPIER.ColliderDesc.capsule(0.25, 0.03).setMass(3).setCollisionGroups(0), rod);
    const jd = RAPIER.JointData.revolute(
      { x: 0, y: -0.05, z: 0 }, { x: 0, y: 0.25, z: 0 }, { x: 0, y: 0, z: 1 },
    );
    if (mode === 'field') { jd.limitsEnabled = true; jd.limits = [-0.2, 0.2]; }
    const j = world.createImpulseJoint(jd, base, rod, true) as RAPIER.RevoluteImpulseJoint;
    if (mode === 'setter') j.setLimits(-0.2, 0.2);
    rod.setAngvel({ x: 0, y: 0, z: 3 }, true);
    return { world, rod, j };
  };
  for (const mode of ['field', 'setter'] as const) {
    const p = mk(0, mode);
    for (let i = 0; i < 72; i++) p.world.step();
    const ang = deg(2 * Math.atan2(p.rod.rotation().z, p.rod.rotation().w));
    console.log(`  ${mode.padEnd(7)} 限位 ±0.2rad → 实际 ${ang.toFixed(1).padStart(6)}°  ${Math.abs(ang) <= 14 ? '✔ 挡住了' : '✘ 没挡住'}`);
  }
}

// ------------------------------------------------------------ ⑤ 新方案：自实现力矩冲量
console.log('\n=== ⑤ 自实现关节力矩：真实火柴人，全部关节 +1，跑 1.5 秒 ===');
console.log('  （摩擦/重力全开；发散判据 |位移| 或 |高度| > 50 m）');
for (const scale of [0.25, 0.5, 1.0, 2.0, 4.0]) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  world.numSolverIterations = 4;
  const doll = new Ragdoll(world, sk, { torqueScale: scale });
  const targets = new Float32Array(doll.jointCount).fill(1);
  doll.reset(0);
  const x0 = doll.torso().translation().x;
  let blewAt = -1;
  for (let i = 0; i < 180; i++) {
    doll.setMotorTargets(targets);
    doll.driveMotors(1 / 120);
    world.step();
    const p = doll.torso().translation();
    if (!Number.isFinite(p.x) || Math.abs(p.x - x0) > 50 || Math.abs(p.y) > 50) { blewAt = i; break; }
  }
  const tp = doll.torso().translation();
  let sum = 0;
  for (let i = 0; i < doll.jointCount; i++) sum += Math.abs(doll.jointAngle(i));
  console.log(
    `  torqueScale=${scale.toFixed(2)}  Δx=${(tp.x - x0).toFixed(3).padStart(7)} m  ` +
    `躯干y=${tp.y.toFixed(3)}  倾角=${deg(doll.tiltOf(doll.torso())).toFixed(0).padStart(4)}°  ` +
    `Σ|关节角|=${sum.toFixed(2).padStart(5)} rad  ` +
    `${blowAt0(blewAt)}`,
  );
}
function blowAt0(i: number): string { return i >= 0 ? `★第 ${i} 步发散` : '未发散 ✔'; }

console.log(`\n  力矩上限（MuJoCo humanoid.xml gear）：${
  Object.entries(JOINT_MAX_TORQUE).map(([k, v]) => `${k}=${v}`).join('  ')} N·m`);

// ------------------------------------------------------------ ⑥ 性能
console.log('\n=== ⑥ 性能：单世界 2000 步 ===');
for (const iters of [1, 2, 4, 8]) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  world.numSolverIterations = iters;
  const doll = new Ragdoll(world, sk);
  doll.reset(0);
  const N = 2000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) { doll.driveMotors(1 / 120); world.step(); }
  const ms = performance.now() - t0;
  console.log(`  solverIterations=${iters}  ${N} 步 ${ms.toFixed(0).padStart(4)} ms  → 每步 ${((ms / N) * 1000).toFixed(1).padStart(5)} µs`);
}
