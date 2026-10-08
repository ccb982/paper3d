/**
 * _probe-ankle.ts —— 踝：单环（现役）vs 2环链（锁定 yaw 环 + 屈伸环）
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';
import { qAxisAngle, qMul, qOf, qRel, qSignedAngle } from '../src/core/quat';

const sk = buildSkeleton(DEFAULT_CONFIG);
const DEG = Math.PI / 180;

function mkBody(w: RAPIER.World, key: string): RAPIER.RigidBody {
  const b = sk.bodies.find((x) => x.key === key)!;
  const q = restQuatOf(b.restTiltRad, b.restYawRad);
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz)
      .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }).setCanSleep(false),
  );
  for (const c of b.colliders) {
    const d = c.shape === 'capsule'
      ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
      : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
    d.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0)
      .setMassProperties(c.mass, { x: 0, y: c.comY, z: 0 },
        { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 })
      .setCollisionGroups(0);
    w.createCollider(d, rb);
  }
  return rb;
}

const J = sk.joints.find((j) => j.name === 'foot_l')!;
const qP = qOf((() => { const q = restQuatOf(sk.bodies.find((b) => b.key === J.parentKey)!.restTiltRad, sk.bodies.find((b) => b.key === J.parentKey)!.restYawRad); return { x: q[0], y: q[1], z: q[2], w: q[3] }; })());
const qCq = (() => { const b = sk.bodies.find((x) => x.key === J.childKey)!; const q = restQuatOf(b.restTiltRad, b.restYawRad); return { x: q[0], y: q[1], z: q[2], w: q[3] }; })();
const qRelPC = qRel(qP, qCq);
const phi0 = qSignedAngle(qRelPC, 0, 1, 0);
console.log(`foot_l: qrel 绕Y = ${(phi0 * 180 / Math.PI).toFixed(3)}°  轴 = ${Math.hypot(qRelPC.x, qRelPC.y, qRelPC.z).toFixed(6)}`);

function relW(a: RAPIER.RigidBody, b: RAPIER.RigidBody): number {
  const va = a.angvel(), vb = b.angvel();
  return Math.hypot(vb.x - va.x, vb.y - va.y, vb.z - va.z);
}
function relAng(a: RAPIER.RigidBody, b: RAPIER.RigidBody): number {
  const ap = a.rotation(), bp = b.rotation();
  const d = Math.abs(ap.x * bp.x + ap.y * bp.y + ap.z * bp.z + ap.w * bp.w);
  return 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI;
}

function run(label: string, build: (w: RAPIER.World, P: RAPIER.RigidBody, C: RAPIER.RigidBody) => void): void {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = 16;
  const P = mkBody(w, J.parentKey);
  const C = mkBody(w, J.childKey);
  build(w, P, C);
  const a0 = relAng(P, C);
  let peak = 0;
  for (let s = 0; s < 240; s++) { w.step(); const v = relW(P, C); if (v > peak) peak = v; }
  console.log(`${label.padEnd(34)} 峰值|ωrel|=${peak.toFixed(4).padStart(9)}  末|ωrel|=${relW(P, C).toFixed(4).padStart(9)}  Δθ=${(relAng(P, C) - a0).toFixed(3)}°`);
}

const a1 = { x: J.parentLocal[0], y: J.parentLocal[1], z: J.parentLocal[2] };
const a2 = { x: J.childLocal[0], y: J.childLocal[1], z: J.childLocal[2] };

console.log('\n════ 踝隔离（零重力/零力矩/240拍）════');
run('单环 revolute 轴Z + 限位(现役)', (w, P, C) => {
  const j = w.createImpulseJoint(RAPIER.JointData.revolute(a1, a2, { x: 0, y: 0, z: 1 }), P, C, true) as RAPIER.RevoluteImpulseJoint;
  j.setLimits(J.minRad[2]!, J.maxRad[2]!);
});
run('单环 revolute 轴Z 无限位', (w, P, C) => {
  w.createImpulseJoint(RAPIER.JointData.revolute(a1, a2, { x: 0, y: 0, z: 1 }), P, C, true);
});
run('2环链：yaw锁定+Z屈伸', (w, P, C) => {
  // mid 出生姿态 = qP·Ry(phi0)（= qC）
  const qMid = qMul(qP, qAxisAngle(0, 1, 0, phi0));
  const p = P.translation();
  const aw = new Float64Array(3);
  {
    const tx = 2 * (qP.y * a1.z - qP.z * a1.y);
    const ty = 2 * (qP.z * a1.x - qP.x * a1.z);
    const tz = 2 * (qP.x * a1.y - qP.y * a1.x);
    aw[0] = a1.x + qP.w * tx + (qP.y * tz - qP.z * ty);
    aw[1] = a1.y + qP.w * ty + (qP.z * tx - qP.x * tz);
    aw[2] = a1.z + qP.w * tz + (qP.x * ty - qP.y * tx);
  }
  const mid = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(p.x + aw[0]!, p.y + aw[1]!, p.z + aw[2]!)
    .setRotation({ x: qMid.x, y: qMid.y, z: qMid.z, w: qMid.w }).setCanSleep(false));
  mid.setAdditionalMassProperties(1e-3, { x: 0, y: 0, z: 0 }, { x: 1e-6, y: 1e-6, z: 1e-6 }, { x: 0, y: 0, z: 0, w: 1 }, true);
  const j1 = w.createImpulseJoint(RAPIER.JointData.revolute(a1, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), P, mid, true) as RAPIER.RevoluteImpulseJoint;
  j1.setLimits(phi0, phi0);
  const j2 = w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, a2, { x: 0, y: 0, z: 1 }), mid, C, true) as RAPIER.RevoluteImpulseJoint;
  j2.setLimits(J.minRad[2]!, J.maxRad[2]!);
});
run('2环链：yaw自由(±10°)+Z屈伸', (w, P, C) => {
  const qMid = qMul(qP, qAxisAngle(0, 1, 0, phi0));
  const p = P.translation();
  const mid = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(p.x + 0, p.y + 0, p.z + 0).setRotation({ x: qMid.x, y: qMid.y, z: qMid.z, w: qMid.w }).setCanSleep(false));
  mid.setAdditionalMassProperties(1e-3, { x: 0, y: 0, z: 0 }, { x: 1e-6, y: 1e-6, z: 1e-6 }, { x: 0, y: 0, z: 0, w: 1 }, true);
  const j1 = w.createImpulseJoint(RAPIER.JointData.revolute(a1, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), P, mid, true) as RAPIER.RevoluteImpulseJoint;
  j1.setLimits(phi0 - 10 * DEG, phi0 + 10 * DEG);
  const j2 = w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, a2, { x: 0, y: 0, z: 1 }), mid, C, true) as RAPIER.RevoluteImpulseJoint;
  j2.setLimits(J.minRad[2]!, J.maxRad[2]!);
});
