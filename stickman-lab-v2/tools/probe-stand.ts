/**
 * probe-stand.ts —— ★ v1 Ragdoll 落地/站立验收（v2 里跑 v1 原版执行层）
 *
 * 判据（关驱动 = 纯被动 + 限位 + 引擎电机）：
 *   · 胸腔 y 不应塌到 0.5 m 以下（散架标志）
 *   · Σ|相对角速度| 应趋于稳定（不爆 100 rad/s 级）
 *
 * 用法：node tools/run.mjs probe-stand [seconds] [drive=on|off]
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Ragdoll } from '../src/core/ragdoll';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SECONDS = Number(ARGS[0] ?? 3);
const DRIVE = (ARGS[1] ?? 'off') !== 'off';
const DT = 1 / 240;
const FRAMES = Math.round(SECONDS / DT);

const sk = buildSkeleton(DEFAULT_CONFIG);
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
world.numSolverIterations = 16;
world.numAdditionalFrictionIterations = 8;
const doll = new Ragdoll(world, sk, {});
doll.reset(0);

const DEG = 180 / Math.PI;
const y0 = doll.torso().translation().y;

console.log('════ 落地/站立验收（v1 Ragdoll in v2）════');
console.log(`驱动=${DRIVE ? 'on' : 'off'}  ${SECONDS}s @240Hz`);
console.log(`胸腔 y 初值 = ${y0.toFixed(4)} m`);

let peakW = 0;
const rv = new Float64Array(3);
for (let s = 0; s < FRAMES; s++) {
  if (DRIVE) doll.driveMotors(DT);
  world.step();
  doll.enforceLimits();
  doll.primeVelocities();
  if (s % 24 === 0) {
    let sumW = 0;
    for (let i = 0; i < sk.joints.length; i++) {
      doll.jointRelVel(i, rv);
      sumW += Math.abs(rv[0]!) + Math.abs(rv[1]!) + Math.abs(rv[2]!);
    }
    if (sumW > peakW) peakW = sumW;
    if (s % 240 === 0) {
      const t = doll.torso().translation();
      console.log(`  t=${(s * DT).toFixed(2)}s  胸 y=${t.y.toFixed(4)}  x=${t.x.toFixed(4)}  z=${t.z.toFixed(4)}  Σ|ω|=${sumW.toFixed(2)}`);
    }
  }
}

const t1 = doll.torso().translation();
let sumW = 0;
for (let i = 0; i < sk.joints.length; i++) {
  doll.jointRelVel(i, rv);
  sumW += Math.abs(rv[0]!) + Math.abs(rv[1]!) + Math.abs(rv[2]!);
}
console.log('');
console.log(`末态：胸 y=${t1.y.toFixed(4)}  (Δ=${((t1.y - y0) * 1000).toFixed(1)} mm)`);
console.log(`      x=${t1.x.toFixed(4)}  z=${t1.z.toFixed(4)}`);
console.log(`      Σ|ω| 峰值 = ${peakW.toFixed(2)}  末值 = ${sumW.toFixed(2)} rad/s`);
console.log(`      关节数 = ${sk.joints.length}  刚体数 = ${sk.bodies.length}  总质量 = ${sk.massTotal.toFixed(3)} kg`);
void DEG;
