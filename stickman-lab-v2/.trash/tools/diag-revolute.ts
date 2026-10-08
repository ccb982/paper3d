/**
 * diag-revolute.ts —— 隔离 revolute 关节：是不是它导致第一步 NaN？
 * 用法：node tools/run.mjs diag-revolute [all-spherical|asis]
 */
import './_boot';
import * as RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Body, DEFAULT_BODY_OPTIONS } from '../src/core/body';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const MODE = ARGS[0] ?? 'asis';

const sk = buildSkeleton(DEFAULT_CONFIG);

// 造一个"全是球铰"的骨架副本
const sk2 = MODE === 'all-spherical'
  ? { ...sk, joints: sk.joints.map((j) => ({ ...j, revoluteAxis: undefined })) }
  : sk;

const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
w.timestep = 1 / 240;
w.numSolverIterations = 8;
const body = new Body(w, sk2 as never, DEFAULT_BODY_OPTIONS);

console.log(`════ revolute 隔离（模式=${MODE}）════`);
console.log(`revolute 关节数 = ${sk2.joints.filter((j) => j.revoluteAxis).length}`);
console.log('');

function anyNaN(): string | null {
  for (let i = 0; i < body.bodies.length; i++) {
    const t = body.bodies[i]!.translation();
    if (!Number.isFinite(t.x)) return sk2.bodies[i]!.key;
  }
  return null;
}

console.log('step 0（步进前）：', anyNaN() ?? 'OK');
for (let s = 1; s <= 5; s++) {
  body.executor.beginStep();
  w.step();
  const bad = anyNaN();
  console.log(`step ${s}：`, bad ? `NaN @ ${bad}` : 'OK');
  if (bad) break;
}

// 打印 revolute 关节的 axis 与父子静姿态
console.log('');
console.log('revolute 关节的 axis vs 父子静姿态：');
for (const j of sk.joints) {
  if (!j.revoluteAxis) continue;
  const p = sk.bodies.find((b) => b.key === j.parentKey)!;
  const c = sk.bodies.find((b) => b.key === j.childKey)!;
  console.log(
    `  ${j.name.padEnd(11)} axis=[${j.revoluteAxis.join(',')}]  ` +
    `parent=${p.key}(tilt=${(p.restTiltRad * 180 / Math.PI).toFixed(1)}°,yaw=${(p.restYawRad * 180 / Math.PI).toFixed(1)}°)  ` +
    `child=${c.key}(tilt=${(c.restTiltRad * 180 / Math.PI).toFixed(1)}°,yaw=${(c.restYawRad * 180 / Math.PI).toFixed(1)}°)`,
  );
}
