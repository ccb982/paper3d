/**
 * diag-friciter.ts —— 验证 numAdditionalFrictionIterations 是否是 NaN 源
 * 用法：node tools/run.mjs diag-friciter
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);

function test(label: string, opts: { iter: number; fric: number; contactHz?: number; contactDamp?: number }) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = opts.iter;
  w.numAdditionalFrictionIterations = Math.max(1, opts.iter >> 1);
  w.numAdditionalFrictionIterations = opts.fric;
  if (opts.contactHz !== undefined) {
    const ip = w.integrationParameters as unknown as Record<string, number>;
    ip.contact_natural_frequency = opts.contactHz;
    ip.contact_damping_ratio = opts.contactDamp!;
  }
  const rbs: RAPIER.RigidBody[] = [];
  const idx = new Map<string, number>();
  sk.bodies.forEach((b, i) => {
    idx.set(b.key, i);
    const rb = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz)
        .setRotation(restQuatOf(b.restTiltRad, b.restYawRad)),
    );
    b.colliders.forEach((c) => {
      const desc = c.shape === 'capsule'
        ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
        : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
      desc.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0)
        .setMassProperties(c.mass, { x: 0, y: c.comY, z: 0 },
          { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.5).setRestitution(0);
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
  // 地面
  const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  w.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 12).setTranslation(0, -0.5, 0).setFriction(1.0), g);

  let badAt = -1, badKey = '';
  for (let s = 0; s < 20; s++) {
    w.step();
    for (let i = 0; i < rbs.length; i++) {
      if (!Number.isFinite(rbs[i]!.translation().x)) { badAt = s + 1; badKey = sk.bodies[i]!.key; break; }
    }
    if (badAt > 0) break;
  }
  console.log(`${label.padEnd(52)} ${badAt > 0 ? `✘ step${badAt} NaN @${badKey}` : '✔ 20 步稳定'}`);
  w.free();
}

console.log('════ numAdditionalFrictionIterations 敏感性 ════');
test('iter=8  fric=0 (不设)', { iter: 8, fric: 0 });
test('iter=8  fric=8 (Rapier 默认)', { iter: 8, fric: 8 });
test('iter=8  fric=4 (v2 当前 = iter>>1)', { iter: 8, fric: 4 });
test('iter=8  fric=1', { iter: 8, fric: 1 });
test('iter=8  fric=4 + contactHz=30', { iter: 8, fric: 4, contactHz: 30, contactDamp: 0.7 });
