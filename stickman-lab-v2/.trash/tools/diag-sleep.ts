/**
 * diag-sleep.ts —— 单变量：只有 setCanSleep(false) 的差别
 * 用法：node tools/run.mjs diag-sleep
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);

function test(label: string, canSleep: boolean, nBody = 19, ground = true, joints = true) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = 8;

  const rbs: RAPIER.RigidBody[] = [];
  const idx = new Map<string, number>();
  const use = nBody >= 19 ? sk.bodies : sk.bodies.slice(0, nBody);
  use.forEach((b, i) => {
    idx.set(b.key, i);
    let d = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(b.cx, b.cy, b.cz)
      .setRotation(restQuatOf(b.restTiltRad, b.restYawRad));
    if (!canSleep) d = d.setCanSleep(false);
    const rb = w.createRigidBody(d);
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
  if (joints) {
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
  }
  if (ground) {
    const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    w.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 12).setTranslation(0, -0.5, 0).setFriction(1.0), g);
  }

  let badAt = -1, badKey = '';
  for (let s = 0; s < 20; s++) {
    w.step();
    for (let i = 0; i < rbs.length; i++) {
      if (!Number.isFinite(rbs[i]!.translation().x)) { badAt = s + 1; badKey = use[i]!.key; break; }
    }
    if (badAt > 0) break;
  }
  console.log(`${label.padEnd(46)} ${badAt > 0 ? `✘ step${badAt} NaN @${badKey}` : '✔ 20 步稳定'}`);
  w.free();
}

console.log('════ 单变量：setCanSleep ════');
test('canSleep=默认(true)   19体+关节+地面', true);
test('canSleep=false        19体+关节+地面', false);
test('canSleep=默认(true)   19体+关节 无地面', true, 19, false);
test('canSleep=默认(true)   2体+关节  无地面', true, 2, false);
