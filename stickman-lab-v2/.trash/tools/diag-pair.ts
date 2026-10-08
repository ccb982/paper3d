/**
 * diag-pair.ts —— 最小复现：任意一对刚体 + 1 个关节，单独 step
 * 用法：node tools/run.mjs diag-pair [parentKey] [childKey] [jointName]
 * 缺省 = torso → head（用 spine? 链）…… 默认跑「spine4 + head + neck」
 *
 * 目的：确认 NaN 是否由「单关节 + 两刚体」就能复现，
 *       还是必须凑齐整条链（闭链）。
 */
import './_boot';
import * as RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
const args = (globalThis as unknown as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const parentKey = args[0] ?? 'spine4';
const childKey = args[1] ?? 'head';
const jointName = args[2] ?? 'neck';

console.log(`════ 最小复现：${parentKey} → ${childKey}  关节=${jointName} ════`);

const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
w.timestep = 1 / 240;
w.numSolverIterations = 8;

const map = new Map<string, RAPIER.RigidBody>();
for (const k of [parentKey, childKey]) {
  const b = sk.bodies.find((x) => x.key === k);
  if (!b) { console.log(`✘ 刚体 ${k} 不存在`); process.exit(1); }
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(b.cx, b.cy, b.cz)
      .setRotation(restQuatOf(b.restTiltRad, b.restYawRad))
      .setCanSleep(false),
  );
  b.colliders.forEach((c, ci) => {
    const desc = c.shape === 'capsule'
      ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
      : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
    desc.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0)
      .setMassProperties(c.mass, { x: 0, y: c.comY, z: 0 },
        { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(0.5)
      .setRestitution(0);
    w.createCollider(desc, rb);
    console.log(`   collider[${ci}] 形状=${c.shape} 质量=${c.mass.toFixed(5)} 偏移=(${(c.offsetX ?? 0).toFixed(4)}, ${c.offsetY.toFixed(4)}, ${(c.offsetZ ?? 0).toFixed(4)})`);
  });
  const I = rb.principalInertia();
  console.log(`   Rapier ${k}: mass=${rb.mass().toFixed(5)}  I=(${I.x.toExponential(3)}, ${I.y.toExponential(3)}, ${I.z.toExponential(3)})`);
  map.set(k, rb);
}

const j = sk.joints.find((x) => x.name === jointName);
if (!j) { console.log(`✘ 关节 ${jointName} 不存在`); process.exit(1); }
const a1 = { x: j.parentLocal[0], y: j.parentLocal[1], z: j.parentLocal[2] };
const a2 = { x: j.childLocal[0], y: j.childLocal[1], z: j.childLocal[2] };
console.log(`   关节类型 = ${j.revoluteAxis ? 'revolute ' + JSON.stringify(j.revoluteAxis) : 'spherical'}`);
console.log(`   parentLocal=(${j.parentLocal.join(', ')})  childLocal=(${j.childLocal.join(', ')})`);

const jd = j.revoluteAxis
  ? RAPIER.JointData.revolute(a1, a2, { x: j.revoluteAxis[0], y: j.revoluteAxis[1], z: j.revoluteAxis[2] })
  : RAPIER.JointData.spherical(a1, a2);
w.createImpulseJoint(jd, map.get(parentKey)!, map.get(childKey)!, true);

for (let s = 0; s < 5; s++) {
  w.step();
  const p = map.get(childKey)!.translation();
  const v = map.get(childKey)!.linvel();
  const aw = map.get(childKey)!.angvel();
  const ok = Number.isFinite(p.x) && Number.isFinite(v.x) && Number.isFinite(aw.x);
  console.log(`  step${s + 1}: ${childKey} pos=(${p.x.toExponential(3)}, ${p.y.toExponential(3)}, ${p.z.toExponential(3)}) linvel=(${v.x.toExponential(3)}) angvel=(${aw.x.toExponential(3)})  ${ok ? '✔' : '✘ NaN'}`);
  if (!ok) break;
}
