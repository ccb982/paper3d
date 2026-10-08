/**
 * diag-jointinfo.ts —— 回读 Rapier 侧关节对象的信息
 * 用法：node tools/run.mjs diag-jointinfo
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
const J = sk.joints.find((j) => j.name === 'neck')!;

const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
w.timestep = 1 / 240;
const RB: RAPIER.RigidBody[] = [];
for (const k of [J.parentKey, J.childKey]) {
  const b = sk.bodies.find((x) => x.key === k)!;
  const q = restQuatOf(b.restTiltRad, b.restYawRad);
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz)
      .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }).setCanSleep(false),
  );
  b.colliders.forEach((c) => {
    const d = c.shape === 'capsule'
      ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
      : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
    d.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0)
      .setMassProperties(c.mass, { x: 0, y: c.comY, z: 0 },
        { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 });
    w.createCollider(d, rb);
  });
  RB.push(rb);
}

const a1 = { x: J.parentLocal[0], y: J.parentLocal[1], z: J.parentLocal[2] };
const a2 = { x: J.childLocal[0], y: J.childLocal[1], z: J.childLocal[2] };
console.log(`锚点 P=(${a1.x}, ${a1.y}, ${a1.z})  C=(${a2.x}, ${a2.y}, ${a2.z})`);

const joint = w.createImpulseJoint(RAPIER.JointData.spherical(a1, a2), RB[0]!, RB[1]!, true);
console.log(`关节类型 = ${joint.constructor.name}`);
console.log(`原型方法 = ${Object.getOwnPropertyNames(Object.getPrototypeOf(joint)).join(', ')}`);

// 逐项回读（若存在）
const anyJ = joint as unknown as Record<string, () => unknown>;
for (const m of ['body1', 'body2', 'anchors', 'localAnchor1', 'localAnchor2', 'contactsEnabled', 'limitsEnabled', 'limitsMin', 'limitsMax', 'isEnabled', 'isValid']) {
  if (typeof anyJ[m] === 'function') {
    try { console.log(`  ${m}() = ${JSON.stringify(anyJ[m]!())}`); }
    catch (e) { console.log(`  ${m}() 抛异常: ${(e as Error).message}`); }
  } else {
    console.log(`  ${m}: (无此方法)`);
  }
}

console.log('');
console.log('════ 逐步：位置/速度 ════');
for (let s = 0; s < 5; s++) {
  const tp0 = RB[0]!.translation(), tp1 = RB[1]!.translation();
  const w0 = RB[0]!.angvel(), w1 = RB[1]!.angvel();
  console.log(`before s${s + 1}: p0=(${tp0.x.toFixed(4)},${tp0.y.toFixed(4)},${tp0.z.toFixed(4)}) p1=(${tp1.x.toFixed(4)},${tp1.y.toFixed(4)},${tp1.z.toFixed(4)})  ω0=(${w0.x.toFixed(3)},${w0.y.toFixed(3)},${w0.z.toFixed(3)}) ω1=(${w1.x.toFixed(3)},${w1.y.toFixed(3)},${w1.z.toFixed(3)})`);
  w.step();
  const tq0 = RB[0]!.translation(), tq1 = RB[1]!.translation();
  const v0 = RB[0]!.angvel(), v1 = RB[1]!.angvel();
  console.log(`after  s${s + 1}: p0=(${tq0.x.toFixed(4)},${tq0.y.toFixed(4)},${tq0.z.toFixed(4)}) p1=(${tq1.x.toFixed(4)},${tq1.y.toFixed(4)},${tq1.z.toFixed(4)})  ω0=(${v0.x.toFixed(3)},${v0.y.toFixed(3)},${v0.z.toFixed(3)}) ω1=(${v1.x.toFixed(3)},${v1.y.toFixed(3)},${v1.z.toFixed(3)})`);
}
