/**
 * probe-cmp-v2.ts —— ★ 照搬一致性对照：同一段时序分别跑 v1 / v2 的 Ragdoll
 *
 * 目的：证明 v2 的 ragdoll.ts 与 v1 **行为逐位一致**（除了被内联的两个类型）。
 *   · 若数字逐位相同 ⇒ 照搬成功，v2 站不起来 = v1 也站不起来（是原实现的性质，不是抄坏）
 *   · 若数字不同 ⇒ v2 抄错了，必须查
 *
 * 用法（在 v1 项目里跑）：
 *   node tools/run.mjs probe-cmp-v2 [seconds] [drive=on|off]
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import type { Ragdoll as RagdollT } from '../src/core/ragdoll';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SECONDS = Number(ARGS[0] ?? 2);
const DRIVE = (ARGS[1] ?? 'off') !== 'off';
const DT = 1 / 240;
const FRAMES = Math.round(SECONDS / DT);

// 动态 import 两侧的 Ragdoll（v2 用绝对路径 file://）
const V1 = (await import('../src/core/ragdoll')).Ragdoll as typeof RagdollT;
const V2 = (
  await import('file:///C:/Users/22641/Desktop/架构重置/stickman-lab-v2/src/core/ragdoll.ts')
).Ragdoll as typeof RagdollT;

function run(label: string, Doll: typeof RagdollT): string {
  const sk = buildSkeleton(DEFAULT_CONFIG);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 16;
  world.numAdditionalFrictionIterations = 8;
  const doll = new Doll(world, sk, {});
  doll.reset(0);

  const rv = new Float64Array(3);
  for (let s = 0; s < FRAMES; s++) {
    if (DRIVE) doll.driveMotors(DT);
    world.step();
    doll.enforceLimits();
    doll.primeVelocities();
  }
  let sumW = 0;
  for (let i = 0; i < sk.joints.length; i++) {
    doll.jointRelVel(i, rv);
    sumW += Math.abs(rv[0]!) + Math.abs(rv[1]!) + Math.abs(rv[2]!);
  }
  const t = doll.torso().translation();
  const lines: string[] = [];
  lines.push(`[${label}]`);
  lines.push(`  torso  y=${t.y.toFixed(12)}  x=${t.x.toFixed(12)}  z=${t.z.toFixed(12)}`);
  lines.push(`  Σ|ω|   = ${sumW.toFixed(12)}`);
  // 逐关节相对角速度（全量指纹）
  const detail: string[] = [];
  for (let i = 0; i < sk.joints.length; i++) {
    doll.jointRelVel(i, rv);
    detail.push(`${rv[0]!.toFixed(9)},${rv[1]!.toFixed(9)},${rv[2]!.toFixed(9)}`);
  }
  lines.push(`  指纹: ${detail.join('|')}`);
  return lines.join('\n');
}

console.log(`════ 照搬一致性对照  ${SECONDS}s @240Hz  驱动=${DRIVE ? 'on' : 'off'} ════`);
const a = run('v1', V1);
const b = run('v2', V2);
console.log(a);
console.log(b);

// 逐字节比指纹
const fa = a.split('指纹: ')[1]!;
const fb = b.split('指纹: ')[1]!;
console.log('');
if (fa === fb) {
  console.log('★★ 判定：指纹逐位一致 ⇒ 照搬成功（v2 = v1）');
} else {
  console.log('⚠ 判定：指纹不一致 ⇒ v2 抄错了');
  const A = fa.split('|'), B = fb.split('|');
  for (let i = 0; i < A.length; i++) {
    if (A[i] !== B[i]) console.log(`  关节 ${i}: v1=${A[i]}  v2=${B[i]}`);
  }
}
