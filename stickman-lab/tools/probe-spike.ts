// ============================================================
// probe-spike —— 定位"速度尖峰"发生在哪一步、哪个刚体、什么状态
// ============================================================
// 背景：probe-reset 实测随机基因组下峰|线速度| ≈ 103 m/s、峰|关节角速度| ≈ 488 rad/s。
//       一个 70 kg、总高 1.8 m 的人形拿到 100 m/s 只能是数值故障，不是"动作激烈"。
//       加了"每步最多吃掉 α 比例的速度误差"上限后从 284 降到 103，说明方向对但没到位。
//
// 本探针在第一个越界量出现时停机，把那一刻能拿到的状态全 dump 出来：
//   · 哪一步、哪个刚体、它的线速度/角速度
//   · 9 个关节的当前角度 / 相对角速度 / 马达目标
//   · 该刚体与地面的接触情况（是不是被地面穿透推出来的）
//
// 跑法：node tools/run.mjs probe-spike

import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import RAPIER from '@dimforge/rapier3d';
import { DEFAULT_CONFIG, buildSkeleton, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { makeRng, makeGaussian, randomGenome } from '../src/core/genome';
import { Ragdoll } from '../src/core/ragdoll';

const require = createRequire(import.meta.url);
{
  const wasmPath: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
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

const sk = buildSkeleton(DEFAULT_CONFIG);
// ★ 网络形状跟着骨架走（脊柱分段后关节数不再是 9）
const SHAPE = shapeForJoints(sk.joints.length);
const CFG = { ...DEFAULT_SIM, mode: 'walk' as const, duration: 4 };

const V_LIMIT = 20;
const W_LIMIT = 50;

function trace(sim: Sim, label: string) {
  console.log(`\n--- ${label} ---`);
  let step = 0;
  let hit = -1;
  let hitBody = -1;
  let maxV = 0;
  while (!sim.finished && step < 4000) {
    sim.advance(1);
    step++;
    for (let i = 0; i < sim.doll.bodies.length; i++) {
      const v = sim.doll.bodies[i].linvel();
      const sp = Math.hypot(v.x, v.y);
      if (sp > maxV) maxV = sp;
      if (hit < 0 && sp > V_LIMIT) { hit = step; hitBody = i; }
    }
    if (hit < 0) {
      for (const b of sim.doll.bodies) {
        if (Math.abs(b.angvel().z) > W_LIMIT) { hit = step; hitBody = -1; break; }
      }
    }
    if (hit >= 0) break;
  }

  if (hit < 0) {
    console.log(`  ✔ 全程无越界（峰|v| = ${maxV.toFixed(2)} m/s，跑了 ${step} 步）`);
    return;
  }

  console.log(`  ★ 第 ${hit} 步（t = ${(hit / CFG.physicsHz).toFixed(3)}s）出现越界，hitBody=${hitBody}`);
  const doll = sim.doll;
  console.log('  刚体                位置(米)                  线速度       角速度z');
  for (let i = 0; i < doll.bodies.length; i++) {
    const b = doll.bodies[i];
    const t = b.translation();
    const v = b.linvel();
    const w = b.angvel().z;
    const sp = Math.hypot(v.x, v.y);
    const mark = sp > V_LIMIT || Math.abs(w) > W_LIMIT ? ' ★' : '';
    console.log(`  ${sk.bodies[i].label.padEnd(7)} (${t.x.toFixed(3).padStart(8)},${t.y.toFixed(3).padStart(8)})  ` +
      `|v|=${sp.toFixed(2).padStart(9)}  ω=${w.toFixed(1).padStart(9)}${mark}`);
  }
  console.log('  关节            角度(°)   相对ω(rad/s)   目标ω(rad/s)   限位(°)');
  for (let i = 0; i < doll.jointCount; i++) {
    const j = sk.joints[i];
    console.log(`  ${JOINT_ORDER[i].padEnd(12)} ${((doll.jointAngle(i) * 180) / Math.PI).toFixed(1).padStart(8)}  ` +
      `${doll.jointSpeed(i).toFixed(1).padStart(13)}  ` +
      `${(doll.motorTarget[i]).toFixed(1).padStart(13)}  ` +
      `[${((j.minRad * 180) / Math.PI).toFixed(0)}, ${((j.maxRad * 180) / Math.PI).toFixed(0)}]`);
  }
  // 地面穿透检查：任一刚体是否低于其半径
  console.log('  接地检查（刚体最低点 y）：');
  for (let i = 0; i < doll.bodies.length; i++) {
    const b = doll.bodies[i];
    const t = b.translation();
    const rad = sk.bodies[i].radius;
    const low = t.y - sk.bodies[i].length / 2;
    if (low < 0.02) console.log(`    ${sk.bodies[i].label} 最低点 y=${low.toFixed(4)}  半径=${rad.toFixed(3)}` +
      `${low < -rad ? '   ★低于半径 —— 被地面穿透推力弹出' : ''}`);
  }
}

const rng = makeRng(4242);
const gauss = makeGaussian(rng);
const G = randomGenome(SHAPE, gauss, 1.2);
const ZERO = new Float32Array(G.length);

console.log('\n=== 尖峰定位（|v| > 20 m/s 或 |ω| > 50 rad/s 即停机）===');

{
  const s = new Sim(sk, SHAPE, CFG);
  s.begin(ZERO);
  trace(s, '零输出（基线，应当全程安静）');
}
{
  const s = new Sim(sk, SHAPE, CFG);
  s.begin(G);
  trace(s, '随机基因组（复现爆炸）');
}

// ---- 关掉马达，只留关节约束：确认爆炸是否由马达注入 ----
console.log('\n=== 对照：关掉马达（torqueScale=0）只看关节约束 ===');
{
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / CFG.physicsHz;
  world.numSolverIterations = CFG.solverIterations;
  const doll = new Ragdoll(world, sk, { torqueScale: 0 });
  doll.reset(0);
  // 给一个初始扰动：把所有刚体丢掉 1 m 高，看落地时会不会飞
  let maxV = 0, maxW = 0;
  for (let i = 0; i < doll.bodies.length; i++) {
    const t = doll.bodies[i].translation();
    doll.bodies[i].setTranslation({ x: t.x, y: t.y + 1, z: 0 }, true);
  }
  for (let step = 0; step < 600; step++) {
    doll.driveMotors(1 / CFG.physicsHz);
    world.step();
    for (const b of doll.bodies) {
      const v = b.linvel();
      maxV = Math.max(maxV, Math.hypot(v.x, v.y));
      maxW = Math.max(maxW, Math.abs(b.angvel().z));
    }
  }
  console.log(`  自由落体 1 m + 无马达：峰|v|=${maxV.toFixed(2)}  峰|ω|=${maxW.toFixed(2)}`);
  console.log(`  ${maxV < 20 && maxW < 50 ? '✔ 接触/约束本身不产生尖峰' : '✘ 接触或约束本身就会爆 —— 与马达无关'}`);
}

// ---- 满功率应力：全关节三轴正弦满驱动（3D 球关节 + 自实现软限位）----
// ★ 2D 时代这里是一组 "Rapier 硬限位 on/off" 的对照，用来证明"硬限位兜不住马达"。
//   3D 之后球关节压根没有官方限位（SphericalImpulseJoint 是空类），
//   那一组对照已经没有对照物了，故此改成"满功率应力 + 最大超限"的体检：
//   软限位如果失效，maxOver 会明显大于 0；数值如果发散，峰|v| 会直接上千。
console.log('\n=== 满功率应力：三轴正弦马达（±0.9 rad/s）× 5 秒 ===');
{
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / CFG.physicsHz;
  world.numSolverIterations = CFG.solverIterations;
  world.numAdditionalFrictionIterations = Math.max(1, CFG.solverIterations >> 1);
  const doll = new Ragdoll(world, sk);
  doll.reset(0);
  const targets = new Float32Array(doll.jointCount * 3);
  const rv = new Float64Array(3);
  let maxV = 0, maxW = 0, maxRel = 0, maxOver = 0;
  for (let step = 0; step < 600; step++) {
    const ph = step / 60;
    for (let i = 0; i < targets.length; i++) targets[i] = Math.sin(ph * 3 + i * 0.7) * 0.9;
    doll.setMotorTargets(targets);
    doll.driveMotors(1 / CFG.physicsHz);
    world.step();
    for (const b of doll.bodies) {
      const v = b.linvel();
      const w = b.angvel();
      maxV = Math.max(maxV, Math.hypot(v.x, v.y, v.z));
      maxW = Math.max(maxW, Math.hypot(w.x, w.y, w.z));
    }
    for (let i = 0; i < doll.jointCount; i++) {
      doll.jointRelVel(i, rv);
      maxRel = Math.max(maxRel, Math.hypot(rv[0], rv[1], rv[2]));
      doll.jointRot(i, rv);
      const j = sk.joints[i];
      for (let k = 0; k < 3; k++) {
        maxOver = Math.max(maxOver, Math.max(0, j.minRad[k] - rv[k], rv[k] - j.maxRad[k]));
      }
    }
  }
  console.log(`  峰|v|=${maxV.toFixed(2).padStart(8)} m/s  峰|ω|=${maxW.toFixed(1).padStart(8)} rad/s  ` +
    `峰|关节相对ω|=${maxRel.toFixed(1).padStart(7)} rad/s  最大超限=${((maxOver * 180) / Math.PI).toFixed(1).padStart(6)}°`);
  console.log(`  ${maxV < 30 && maxW < 300 ? '✔ 满功率下没有数值爆炸' : '✘ 仍有尖峰 —— 用上面第 1 段的停机 dump 定位'}`);
}

