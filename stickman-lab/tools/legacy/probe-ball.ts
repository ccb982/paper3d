// ============================================================
// probe-ball —— 球关节（3D）能否作为"只有约束、马达自己写"的地基
// ============================================================
// 背景：要改成真 3D 骨架，关节必须从 revolute（1 轴）换成 spherical（3 轴）。
//       Rapier 0.14 的 SphericalImpulseJoint 马达 API 被整段注释掉了
//       （"Unsupported by this alpha release"），所以马达仍然只能自己实现。
//       那么**唯一**的关键问题就是：球关节的锚点约束扛不扛得住我们施加的三轴力矩？
//       扛不住的话（和之前硬限位一样被顶穿），整套方案就得换地基。
//
// 四组检查：
//   A. 纯重力：锚点漂移应当 ≈ 0，且杆能绕锚自由摆（3 个转动自由度真的存在）
//   B. 三轴力矩冲量扫描：找到"锚点开始被撕裂"的冲量量级
//   C. 自由度验证：绕 Y 轴给力矩 → 杆必须绕 Y 转（不是被锁死在某平面）
//   D. 相对旋转读数：q_rel = q_p⁻¹·q_c 的旋转向量，验证与施加的力矩方向一致
//
// 跑法：node tools/run.mjs probe-ball

import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import RAPIER from '@dimforge/rapier3d';

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

const DT = 1 / 120;

/** 造一个：固定基座 + 一根球关节吊着的杆。anchorLocalY 是锚点在杆上的本地偏移 */
function rig(rodMass = 3, anchorLocalY = 0.2, rodHalf = 0.25) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 4;

  const base = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 2, 0));
  world.createCollider(RAPIER.ColliderDesc.ball(0.02), base);

  const rod = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2 - anchorLocalY, 0).setCanSleep(false),
  );
  world.createCollider(RAPIER.ColliderDesc.capsule(rodHalf, 0.04).setMass(rodMass), rod);

  const jd = RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: anchorLocalY, z: 0 });
  const joint = world.createImpulseJoint(jd, base, rod, true);

  return { world, base, rod, joint, anchorLocalY };
}

/** 世界系锚点位置：基点 + 旋转后的本地偏移 */
function anchorWorld(body: RAPIER.RigidBody, local: { x: number; y: number; z: number }) {
  const t = body.translation();
  const q = body.rotation();
  const { x, y, z, w } = q;
  const tx = 2 * (y * local.z - z * local.y);
  const ty = 2 * (z * local.x - x * local.z);
  const tz = 2 * (x * local.y - y * local.x);
  const cx = y * tz - z * ty, cy = z * tx - x * tz, cz = x * ty - y * tx;
  return {
    x: t.x + local.x + w * tx + cx,
    y: t.y + local.y + w * ty + cy,
    z: t.z + local.z + w * tz + cz,
  };
}

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

console.log('\n=== A. 纯重力：锚点漂移 + 是否能绕锚自由摆（3 转动自由度）===');
{
  const r = rig(3, 0.2);
  // 给一个侧向初速度，看它能不能摆出平面（真 3D 才能摆出 YZ/XZ 之外的姿态）
  r.rod.setLinvel({ x: 1.2, y: 0, z: 0.9 }, true);
  let maxDrift = 0;
  // ★ 判据用"过程中的最大 |z|"，不是"3 秒那一刻的 z" —— 摆锤一直在荡，
  //   末刻的 z 是相位决定的（之前用末刻值 + 0.05 阈值，被误判成"没有 Z 位移"）。
  let maxZ = 0;
  for (let i = 0; i < 360; i++) {
    r.world.step();
    const a1 = anchorWorld(r.base, { x: 0, y: 0, z: 0 });
    const a2 = anchorWorld(r.rod, { x: 0, y: r.anchorLocalY, z: 0 });
    maxDrift = Math.max(maxDrift, dist(a1, a2));
    maxZ = Math.max(maxZ, Math.abs(r.rod.translation().z));
  }
  const t = r.rod.translation();
  console.log(`  3 秒后：杆位置 (${t.x.toFixed(3)}, ${t.y.toFixed(3)}, ${t.z.toFixed(3)})`);
  console.log(`  锚点最大漂移 = ${(maxDrift * 1000).toFixed(3)} mm  ${maxDrift < 0.01 ? '✔ 约束牢靠' : '✘ 约束软'}`);
  console.log(`  过程最大 |z| = ${(maxZ * 1000).toFixed(1)} mm  ` +
    `${maxZ > 0.05 ? '✔ 摆出了 Z 方向位移 —— 确实是 3 转动自由度，不是被锁平面' : '✘ 没有 Z 位移，可能被限制在平面内'}`);
}

console.log('\n=== B. 三轴力矩冲量扫描：锚点从哪个量级开始被撕裂 ===');
console.log('  （每物理步施加 (tx,ty,tz) 三轴力矩冲量，跑 2 秒，记录锚点最大漂移）');
for (const mag of [0.01, 0.05, 0.1, 0.5, 1.0, 2.0, 5.0, 20.0]) {
  const r = rig(3, 0.2);
  let maxDrift = 0;
  let blew = '';
  for (let i = 0; i < 240; i++) {
    // 只对子刚体施加（父是 fixed，反作用被地面吃掉）—— 这是最恶劣的情形
    r.rod.applyTorqueImpulse({ x: mag * 0.3, y: mag, z: mag * 0.7 }, true);
    r.world.step();
    const a1 = anchorWorld(r.base, { x: 0, y: 0, z: 0 });
    const a2 = anchorWorld(r.rod, { x: 0, y: r.anchorLocalY, z: 0 });
    maxDrift = Math.max(maxDrift, dist(a1, a2));
    const t = r.rod.translation();
    if (!Number.isFinite(t.x) || Math.hypot(t.x, t.y, t.z) > 100) { blew = `★第 ${i} 步发散`; break; }
  }
  const jit = (mag * mag) / 3;
  console.log(`  |τ|=${String(mag).padStart(5)} N·m·s  锚点最大漂移 ${(maxDrift * 1000).toFixed(2).padStart(10)} mm  ` +
    `${maxDrift < 0.02 ? '✔' : maxDrift < 0.1 ? '△ 偏软' : '✘ 撕裂'}  ${blew}`);
}

console.log('\n=== C. 自由度方向验证：绕单轴给力矩，看是否只绕该轴转 ===');
for (const axis of ['x', 'y', 'z'] as const) {
  const r = rig(3, 0.2);
  const imp = { x: 0, y: 0, z: 0 };
  imp[axis] = 0.4;
  for (let i = 0; i < 120; i++) {
    r.rod.applyTorqueImpulse(imp, true);
    r.world.step();
  }
  const q = r.rod.rotation();
  // 相对初始（单位四元数）的旋转向量
  const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
  const s = Math.hypot(q.x, q.y, q.z);
  const rx = s > 1e-9 ? (q.x / s) * ang : 0;
  const ry = s > 1e-9 ? (q.y / s) * ang : 0;
  const rz = s > 1e-9 ? (q.z / s) * ang : 0;
  console.log(`  绕 ${axis} 施加 → 旋转向量 = (${rx.toFixed(3)}, ${ry.toFixed(3)}, ${rz.toFixed(3)}) rad  ` +
    `转角 ${((ang * 180) / Math.PI).toFixed(1)}°`);
}

console.log('\n=== E. 刚度来源：求解器迭代数能不能把"可承受力矩"抬上去 ===');
console.log('  （同样是最恶劣情形：固定基座 + 持续最大三轴力矩；单位 mm）');
console.log('  iters\\|τ|     0.1     0.5     1.0     2.0     5.0');
for (const iters of [4, 8, 16, 32]) {
  const cells: string[] = [];
  for (const mag of [0.1, 0.5, 1.0, 2.0, 5.0]) {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = DT;
    world.numSolverIterations = iters;
    const base = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 2, 0));
    world.createCollider(RAPIER.ColliderDesc.ball(0.02), base);
    const rod = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.8, 0).setCanSleep(false),
    );
    world.createCollider(RAPIER.ColliderDesc.capsule(0.25, 0.04).setMass(3), rod);
    const jd = RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: 0.2, z: 0 });
    world.createImpulseJoint(jd, base, rod, true);
    let maxDrift = 0;
    for (let i = 0; i < 240; i++) {
      rod.applyTorqueImpulse({ x: mag * 0.3, y: mag, z: mag * 0.7 }, true);
      world.step();
      const a1 = anchorWorld(base, { x: 0, y: 0, z: 0 });
      const a2 = anchorWorld(rod, { x: 0, y: 0.2, z: 0 });
      maxDrift = Math.max(maxDrift, dist(a1, a2));
    }
    cells.push((maxDrift * 1000).toFixed(1).padStart(7));
  }
  console.log(`  ${String(iters).padStart(5)}      ${cells.join(' ')}`);
}

console.log('\n=== F. 迭代数的代价：单世界 2000 步耗时 ===');
for (const iters of [4, 8, 16, 32]) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = iters;
  const base = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 2, 0));
  world.createCollider(RAPIER.ColliderDesc.ball(0.02), base);
  const rod = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.8, 0).setCanSleep(false));
  world.createCollider(RAPIER.ColliderDesc.capsule(0.25, 0.04).setMass(3), rod);
  world.createImpulseJoint(
    RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: 0.2, z: 0 }), base, rod, true,
  );
  const N = 2000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) world.step();
  const ms = performance.now() - t0;
  console.log(`  solverIterations=${String(iters).padStart(2)}  每步 ${((ms / N) * 1000).toFixed(1).padStart(6)} µs`);
}

console.log('\n=== D. 相对旋转读数（网络输入要用它）===');
{
  const r = rig(3, 0.2);
  let maxDrift = 0;
  for (let i = 0; i < 240; i++) {
    r.rod.applyTorqueImpulse({ x: 0.05, y: 0.12, z: -0.08 }, true);
    r.world.step();
    const a1 = anchorWorld(r.base, { x: 0, y: 0, z: 0 });
    const a2 = anchorWorld(r.rod, { x: 0, y: r.anchorLocalY, z: 0 });
    maxDrift = Math.max(maxDrift, dist(a1, a2));
  }
  const qp = r.base.rotation(), qc = r.rod.rotation();
  // q_rel = q_p⁻¹ · q_c
  const iw = qp.w, ix = -qp.x, iy = -qp.y, iz = -qp.z;
  const rw = iw * qc.w - ix * qc.x - iy * qc.y - iz * qc.z;
  const rx = iw * qc.x + ix * qc.w + iy * qc.z - iz * qc.y;
  const ry = iw * qc.y - ix * qc.z + iy * qc.w + iz * qc.x;
  const rz = iw * qc.z + ix * qc.y - iy * qc.x + iz * qc.w;
  const ang = 2 * Math.acos(Math.min(1, Math.abs(rw)));
  const s = Math.hypot(rx, ry, rz);
  console.log(`  q_rel 旋转向量 = (${((s > 1e-9 ? rx / s : 0) * ang).toFixed(4)}, ` +
    `${((s > 1e-9 ? ry / s : 0) * ang).toFixed(4)}, ${((s > 1e-9 ? rz / s : 0) * ang).toFixed(4)}) rad`);
  console.log(`  锚点最大漂移 ${(maxDrift * 1000).toFixed(2)} mm`);
  console.log('  ↑ 这条读数就是"3 轴关节角"，可直接喂给网络；漂移小说明读数可信');
}
