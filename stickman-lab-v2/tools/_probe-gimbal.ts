/**
 * _probe-gimbal.ts —— 临时诊断：球铰 → 3×revolute 串联（Euler 分解起姿态）
 * 零重力 / 零力矩，测是否注入能量。以 elbow_l（rest≈30°绕X）为最严苛的普通情形。
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
for (const J of sk.joints.filter((j) => ['neck', 'elbow_l', 'hip_l'].includes(j.name))) {
  const r = J.restRad.map((v) => (v * 180 / Math.PI).toFixed(2));
  console.log(`${J.name.padEnd(9)} restRad=(${r.join(',')})°  anchor=(${J.wx.toFixed(3)},${J.wy.toFixed(3)},${J.wz.toFixed(3)})`);
}

type Q = { x: number; y: number; z: number; w: number };
const qmul = (a: Q, b: Q): Q => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
const rq = (ax: number, ay: number, az: number, ang: number): Q => {
  const s = Math.sin(ang / 2);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(ang / 2) };
};
const qconj = (q: Q): Q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const qrot = (q: Q, v: number[]): number[] => {
  const tx = 2 * (q.y * v[2]! - q.z * v[1]!);
  const ty = 2 * (q.z * v[0]! - q.x * v[2]!);
  const tz = 2 * (q.x * v[1]! - q.y * v[0]!);
  return [
    v[0]! + q.w * tx + (q.y * tz - q.z * ty),
    v[1]! + q.w * ty + (q.z * tx - q.x * tz),
    v[2]! + q.w * tz + (q.x * ty - q.y * tx),
  ];
};

function eulerXYZ(q: Q): [number, number, number] {
  const { x, y, z, w } = q;
  const R00 = 1 - 2 * (y * y + z * z), R01 = 2 * (x * y - z * w), R02 = 2 * (x * z + y * w);
  const R12 = 2 * (y * z - x * w), R22 = 1 - 2 * (x * x + y * y);
  const p2 = Math.asin(Math.max(-1, Math.min(1, R02)));
  const p1 = Math.atan2(-R12, R22);
  const p3 = Math.atan2(-R01, R00);
  return [p1, p2, p3];
}

function run(label: string, midMass = 1e-3, midI = 1e-6, noContact = false, iters = 16): void {
  const name = label.split(' ')[0]!;
  const J = sk.joints.find((j) => j.name === name)!;
  const bp = sk.bodies.find((b) => b.key === J.parentKey)!;
  const bc = sk.bodies.find((b) => b.key === J.childKey)!;
  const qp = restQuatOf(bp.restTiltRad, bp.restYawRad) as unknown as [number, number, number, number];
  const qc = restQuatOf(bc.restTiltRad, bc.restYawRad) as unknown as [number, number, number, number];
  const QP: Q = { x: qp[0], y: qp[1], z: qp[2], w: qp[3] };
  const QC: Q = { x: qc[0], y: qc[1], z: qc[2], w: qc[3] };
  const qRel = qmul(qconj(QP), QC);
  const [p1, p2, p3] = eulerXYZ(qRel);
  const R1 = qmul(QP, rq(1, 0, 0, p1));
  const R2 = qmul(R1, rq(0, 1, 0, p2));
  // 校验：R2·Rz(p3) 应等于 QC
  const chk = qmul(R2, rq(0, 0, 1, p3));
  const dot = Math.abs(chk.x * QC.x + chk.y * QC.y + chk.z * QC.z + chk.w * QC.w);
  console.log(`${name}: Euler=(${(p1 * 180 / Math.PI).toFixed(2)},${(p2 * 180 / Math.PI).toFixed(2)},${(p3 * 180 / Math.PI).toFixed(2)})° chk=${(2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI).toExponential(2)}°`);

  const awp = qrot(QP, [J.parentLocal[0], J.parentLocal[1], J.parentLocal[2]]);
  const awc = qrot(QC, [J.childLocal[0], J.childLocal[1], J.childLocal[2]]);
  const axErr = Math.hypot(bp.cx + awp[0]! - (bc.cx + awc[0]!), bp.cy + awp[1]! - (bc.cy + awc[1]!), bp.cz + awp[2]! - (bc.cz + awc[2]!));
  console.log(`  anchor 世界点差 = ${(axErr * 1000).toFixed(4)}mm`);

  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = iters;
  const mk = (b: typeof bp, q: Q, pos: { x: number; y: number; z: number }): RAPIER.RigidBody => {
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCanSleep(false));
    for (const col of b.colliders) {
      const d = col.shape === 'capsule'
        ? RAPIER.ColliderDesc.capsule(col.halfHeight, col.radius)
        : RAPIER.ColliderDesc.cuboid(col.hx, col.hy, col.hz);
      d.setTranslation(col.offsetX ?? 0, col.offsetY, col.offsetZ ?? 0)
        .setMassProperties(col.mass, { x: 0, y: col.comY, z: 0 },
          { x: col.inertiaXY, y: col.inertiaXY, z: col.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 });
      if (noContact) d.setCollisionGroups(0);
      w.createCollider(d, rb);
    }
    return rb;
  };
  const P = mk(bp, QP, { x: bp.cx, y: bp.cy, z: bp.cz });
  const C = mk(bc, QC, { x: bc.cx, y: bc.cy, z: bc.cz });
  // 锚点世界位置（用父体静姿态）
  const aw0 = qrot(QP, [J.parentLocal[0], J.parentLocal[1], J.parentLocal[2]]);
  const aw = { x: bp.cx + aw0[0]!, y: bp.cy + aw0[1]!, z: bp.cz + aw0[2]! };
  const mid = (q: Q, mass: number): RAPIER.RigidBody => {
    const m = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(aw.x, aw.y, aw.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCanSleep(false));
    m.setAdditionalMassProperties(mass, { x: 0, y: 0, z: 0 }, { x: midI, y: midI, z: midI }, { x: 0, y: 0, z: 0, w: 1 }, true);
    return m;
  };
  const M1 = mid(R1, midMass);
  const M2 = mid(R2, midMass);
  const a1 = { x: J.parentLocal[0], y: J.parentLocal[1], z: J.parentLocal[2] };
  const a2 = { x: J.childLocal[0], y: J.childLocal[1], z: J.childLocal[2] };
  w.createImpulseJoint(RAPIER.JointData.revolute(a1, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), P, M1, true);
  w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), M1, M2, true);
  w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, a2, { x: 0, y: 0, z: 1 }), M2, C, true);

  const relW = (): number => {
    const vp = P.angvel(), vc = C.angvel();
    return Math.hypot(vc.x - vp.x, vc.y - vp.y, vc.z - vp.z);
  };
  const relA = (): number => {
    const ap = P.rotation(), ac = C.rotation();
    const d = Math.abs(ap.x * ac.x + ap.y * ac.y + ap.z * ac.z + ap.w * ac.w);
    return 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI;
  };
  let peak = 0;
  const a0 = relA();
  for (let s = 0; s < 480; s++) {
    w.step();
    const v = relW();
    if (v > peak) peak = v;
  }
  console.log(`  → 峰值|ωrel|=${peak.toFixed(4)}  末|ωrel|=${relW().toFixed(4)}  Δθ=${(relA() - a0).toFixed(3)}°`);
}

console.log('\n════ 3×revolute 串联（Euler 分解）/ 零重力 / 零力矩 / 480 拍 ════');
run('neck 碰撞ON it16');
run('neck 碰撞OFF it16', 1e-3, 1e-6, true);
run('neck 碰撞OFF it1', 1e-3, 1e-6, true, 1);
run('neck 碰撞OFF it64', 1e-3, 1e-6, true, 64);
run('elbow_l 碰撞OFF', 1e-3, 1e-6, true);
run('hip_l 碰撞OFF', 1e-3, 1e-6, true);
