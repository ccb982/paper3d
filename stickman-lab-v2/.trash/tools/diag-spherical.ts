/**
 * diag-spherical.ts —— 隔离球铰 NaN：逐项排除
 * 用法：node tools/run.mjs diag-spherical
 *
 * 测试矩阵（都只建 spine4 + head 两个刚体）：
 *   A. 无关节                    → 会不会 NaN
 *   B. 球铰，锚点 = 原点          → 会不会 NaN
 *   C. 球铰，锚点 = skeleton 值   → 会不会 NaN
 *   D. revolute(0,0,1)，锚点 = skeleton 值
 *   E. GenericJoint 手动建（Rapier 底层 API）
 *   F. 球铰 + 显式 solverIterations=1
 *   G. 球铰 + 只建 1 个 collider（spine4 一个、head 一个）
 */
import './_boot';
import * as RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
const keys = ['spine4', 'head'];

function makeRbs(w: RAPIER.World, useColliders: boolean) {
  const map = new Map<string, RAPIER.RigidBody>();
  for (const k of keys) {
    const b = sk.bodies.find((x) => x.key === k)!;
    const rb = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(b.cx, b.cy, b.cz)
        .setRotation(restQuatOf(b.restTiltRad, b.restYawRad))
        .setCanSleep(false),
    );
    if (useColliders) {
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
    } else {
      // 只给质量，不给形状
      rb.setAdditionalMass(b.mass, true);
    }
    map.set(k, rb);
  }
  return map;
}

function run(label: string, fn: (w: RAPIER.World, map: Map<string, RAPIER.RigidBody>) => void, useColliders = true, iters = 8) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = iters;
  const map = makeRbs(w, useColliders);
  try {
    fn(w, map);
  } catch (e) {
    console.log(`${label.padEnd(34)} 建关节时抛异常: ${(e as Error).message}`);
    return;
  }
  let badAt = -1;
  for (let s = 0; s < 5; s++) {
    w.step();
    const p = map.get('head')!.translation();
    if (!Number.isFinite(p.x)) { badAt = s + 1; break; }
  }
  const p = map.get('head')!.translation();
  console.log(`${label.padEnd(34)} ${badAt > 0 ? `✘ step${badAt} NaN` : `✔ 稳定  headY=${p.y.toFixed(5)}`}`);
}

const NE = sk.joints.find((x) => x.name === 'neck')!;
const A1 = { x: NE.parentLocal[0], y: NE.parentLocal[1], z: NE.parentLocal[2] };
const A2 = { x: NE.childLocal[0], y: NE.childLocal[1], z: NE.childLocal[2] };
const ORIGIN = { x: 0, y: 0, z: 0 };

console.log('════ 隔离球铰 NaN ════');
run('A 无关节', () => {});
run('B 球铰 锚点=原点', (w, m) => {
  w.createImpulseJoint(RAPIER.JointData.spherical(ORIGIN, ORIGIN), m.get('spine4')!, m.get('head')!, true);
});
run('C 球铰 锚点=skeleton', (w, m) => {
  w.createImpulseJoint(RAPIER.JointData.spherical(A1, A2), m.get('spine4')!, m.get('head')!, true);
});
run('D revolute Z 锚点=skeleton', (w, m) => {
  w.createImpulseJoint(RAPIER.JointData.revolute(A1, A2, { x: 0, y: 0, z: 1 }), m.get('spine4')!, m.get('head')!, true);
});
run('E 手动 GenericJoint 球', (w, m) => {
  const gj = new RAPIER.GenericJointData();
  gj.setContactsEnabled(false);
  const p = gj.spherical(0);
  p.setLocalAnchor1(A1).setLocalAnchor2(A2);
  w.createImpulseJoint(gj, m.get('spine4')!, m.get('head')!, true);
});
run('F 球铰 + solverIter=1', (w, m) => {
  w.createImpulseJoint(RAPIER.JointData.spherical(A1, A2), m.get('spine4')!, m.get('head')!, true);
}, true, 1);
run('G 球铰 + 无 collider(仅质量)', (w, m) => {
  w.createImpulseJoint(RAPIER.JointData.spherical(A1, A2), m.get('spine4')!, m.get('head')!, true);
}, false);
run('H 球铰 + 无 damping 设置', (w, m) => {
  w.createImpulseJoint(RAPIER.JointData.spherical(A1, A2), m.get('spine4')!, m.get('head')!, true);
});
