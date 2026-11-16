/**
 * _probe-spherical.ts —— 临时诊断：Rapier 0.14 原生球铰在非零锚点下是否注入能量
 * 零重力 / 零初速 / 零力矩，静置 240 拍，读相对角速度与相对角。
 * 对照：revolute / spherical。
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
const J = sk.joints.find((j) => j.name === 'neck')!;
console.log(`neck: ${J.parentKey} → ${J.childKey}  anchor=(${J.wx.toFixed(3)},${J.wy.toFixed(3)},${J.wz.toFixed(3)})`);
console.log(`parentLocal=(${J.parentLocal.map((v) => (v * 1000).toFixed(1)).join(',')})mm  childLocal=(${J.childLocal.map((v) => (v * 1000).toFixed(1)).join(',')})mm`);
console.log(`restRad=(${J.restRad.map((v) => (v * 180 / Math.PI).toFixed(2)).join(',')})°`);

function makeWorld(): { w: RAPIER.World; p: RAPIER.RigidBody; c: RAPIER.RigidBody } {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = 16;
  const rb: Record<string, RAPIER.RigidBody> = {};
  for (const key of [J.parentKey, J.childKey] as const) {
    const b = sk.bodies.find((x) => x.key === key)!;
    const q = restQuatOf(b.restTiltRad, b.restYawRad);
    const body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz)
        .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }).setCanSleep(false),
    );
    for (const col of b.colliders) {
      const d = col.shape === 'capsule'
        ? RAPIER.ColliderDesc.capsule(col.halfHeight, col.radius)
        : RAPIER.ColliderDesc.cuboid(col.hx, col.hy, col.hz);
      d.setTranslation(col.offsetX ?? 0, col.offsetY, col.offsetZ ?? 0)
        .setMassProperties(col.mass, { x: 0, y: col.comY, z: 0 },
          { x: col.inertiaXY, y: col.inertiaXY, z: col.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 })
        .setCollisionGroups(0);
      w.createCollider(d, body);
    }
    rb[key] = body;
  }
  return { w, p: rb[J.parentKey]!, c: rb[J.childKey]! };
}

const a1 = { x: J.parentLocal[0], y: J.parentLocal[1], z: J.parentLocal[2] };
const a2 = { x: J.childLocal[0], y: J.childLocal[1], z: J.childLocal[2] };

function relVel(p: RAPIER.RigidBody, c: RAPIER.RigidBody): number {
  const wp = p.angvel(), wc = c.angvel();
  const d = Math.hypot(wc.x - wp.x, wc.y - wp.y, wc.z - wp.z);
  return d;
}
function relAng(p: RAPIER.RigidBody, c: RAPIER.RigidBody): number {
  const qp = p.rotation(), qc = c.rotation();
  let dot = qp.x * qc.x + qp.y * qc.y + qp.z * qc.z + qp.w * qc.w;
  if (dot < 0) dot = -dot;
  return 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
}

function run(label: string, build: (w: RAPIER.World, p: RAPIER.RigidBody, c: RAPIER.RigidBody) => void): void {
  const { w, p, c } = makeWorld();
  build(w, p, c);
  const ang0 = relAng(p, c);
  let peak = 0;
  for (let s = 0; s < 240; s++) {
    w.step();
    const v = relVel(p, c);
    if (v > peak) peak = v;
  }
  console.log(`${label.padEnd(30)} 峰值|ωrel|=${peak.toFixed(4).padStart(9)}  末|ωrel|=${relVel(p, c).toFixed(4).padStart(9)}  Δθ=${(relAng(p, c) - ang0).toFixed(3)}°`);
}

console.log('\n════ 零重力 / 零力矩 / 240 拍 ════');
run('原生球铰', (w, p, c) => {
  w.createImpulseJoint(RAPIER.JointData.spherical(a1, a2), p, c, true);
});
run('generic(锁平移/放3转)', (w, p, c) => {
  const m = RAPIER.JointAxesMask.LinX | RAPIER.JointAxesMask.LinY | RAPIER.JointAxesMask.LinZ;
  w.createImpulseJoint(RAPIER.JointData.generic(a1, a2, { x: 0, y: 0, z: 1 }, m), p, c, true);
});
run('revolute（轴=局Z）', (w, p, c) => {
  const j = w.createImpulseJoint(RAPIER.JointData.revolute(a1, a2, { x: 0, y: 0, z: 1 }), p, c, true) as RAPIER.ImpulseJoint;
  (j as unknown as { setLimits(l: number, h: number): void }).setLimits(-Math.PI * 2, Math.PI * 2);
});
run('3×revolute 链(同姿态mid)', (w, p, c) => {
  // mid 与父刚体同姿态放在锚点；只测第 1/2 环是否干净 + 第 3 环的 q_rel 失配注入
  const qp = p.rotation();
  const quat = { x: qp.x, y: qp.y, z: qp.z, w: qp.w };
  const tx = 2 * (qp.y * a1.z - qp.z * a1.y);
  const ty = 2 * (qp.z * a1.x - qp.x * a1.z);
  const tz = 2 * (qp.x * a1.y - qp.y * a1.x);
  const ax = a1.x + qp.w * tx + (qp.y * tz - qp.z * ty);
  const ay = a1.y + qp.w * ty + (qp.z * tx - qp.x * tz);
  const az = a1.z + qp.w * tz + (qp.x * ty - qp.y * tx);
  const pw = p.translation();
  const aw = { x: pw.x + ax, y: pw.y + ay, z: pw.z + az };
  const m1 = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(aw.x, aw.y, aw.z).setRotation(quat).setCanSleep(false));
  const m2 = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(aw.x, aw.y, aw.z).setRotation(quat).setCanSleep(false));
  for (const m of [m1, m2]) m.setAdditionalMassProperties(0.01, { x: 0, y: 0, z: 0 }, { x: 1e-5, y: 1e-5, z: 1e-5 }, { x: 0, y: 0, z: 0, w: 1 }, true);
  w.createImpulseJoint(RAPIER.JointData.revolute(a1, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), p, m1, true);
  w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), m1, m2, true);
  w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, a2, { x: 0, y: 0, z: 1 }), m2, c, true);
});
