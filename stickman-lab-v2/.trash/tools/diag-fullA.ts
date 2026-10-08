/**
 * diag-full.ts —— 「全 19 体 + 18 关节 + 地面」，与 diag-one 的 full case 逐字一致
 * 用法：node tools/run.mjs diag-full
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
w.timestep = 1 / 240;
w.numSolverIterations = 8;

const rbs: RAPIER.RigidBody[] = [];
const idx = new Map<string, number>();
sk.bodies.forEach((b, i) => {
  idx.set(b.key, i);
  let d = RAPIER.RigidBodyDesc.dynamic();
  d = d.setTranslation(b.cx, b.cy, b.cz);
  const q = restQuatOf(b.restTiltRad, b.restYawRad);
  d = d.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
  d = d.setCanSleep(false);
  const rb = w.createRigidBody(d);
  b.colliders.forEach((c) => {
    const desc = c.shape === 'capsule'
      ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
      : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
    desc.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0);
    desc.setMassProperties(c.mass, { x: 0, y: c.comY, z: 0 },
      { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 });
    desc.setFriction(0.5).setRestitution(0);
    w.createCollider(desc, rb);
  });
  rbs.push(rb);
});
sk.joints.forEach((j) => {
  const pi = idx.get(j.parentKey), ci = idx.get(j.childKey);
  if (pi === undefined || ci === undefined) return;
  const a1 = { x: j.parentLocal[0], y: j.parentLocal[1], z: j.parentLocal[2] };
  const a2 = { x: j.childLocal[0], y: j.childLocal[1], z: j.childLocal[2] };
  const jd = j.revoluteAxis
    ? RAPIER.JointData.revolute(a1, a2, { x: j.revoluteAxis[0], y: j.revoluteAxis[1], z: j.revoluteAxis[2] })
    : RAPIER.JointData.spherical(a1, a2);
  w.createImpulseJoint(jd, rbs[pi]!, rbs[ci]!, true);
});
const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
w.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 12).setTranslation(0, -0.5, 0).setFriction(1.0), g);

console.log('════ 全 19 体 + 18 关节 + 地面 ════');
for (let s = 0; s < 20; s++) {
  w.step();
  let bad = '';
  for (let i = 0; i < rbs.length; i++) {
    if (!Number.isFinite(rbs[i]!.translation().x)) { bad = sk.bodies[i]!.key; break; }
  }
  const h = rbs[idx.get('head')!]!.translation();
  console.log(`  step${String(s + 1).padStart(2)}: head=(${h.x.toFixed(5)}, ${h.y.toFixed(5)}, ${h.z.toFixed(5)})  ${bad ? `✘ NaN @${bad}` : ''}`);
  if (bad) break;
}

w.free();
