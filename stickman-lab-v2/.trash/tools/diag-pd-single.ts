/**
 * diag-pd-single.ts —— 单关节 PD 符号/收敛验证（最干净的判据）
 * 用法：node tools/run.mjs diag-pd-single
 *
 * 场景：只建「spine4 + head」+ neck 关节。
 *   ① 重力关、初始就给 head 一个 +0.2 rad 的相对角 ⇒ PD 应把它拉回 0。
 *   ② 打印每步的 θ 与 ω，看是收敛还是发散。
 * 若这个最小情形收敛，说明符号约定正确、问题在多关节耦合。
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';
import { Executor, freeAxisOf, quatRotate } from '../src/core/executor';

const sk = buildSkeleton(DEFAULT_CONFIG);
const JI = sk.joints.findIndex((j) => j.name === 'neck');
const J = sk.joints[JI]!;
console.log(`关节 ${J.name}: ${J.parentKey} → ${J.childKey}  spherical=${!J.revoluteAxis}`);

const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
w.timestep = 1 / 240;
const RB: Record<string, RAPIER.RigidBody> = {};
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
  RB[k] = rb;
}
const a1 = { x: J.parentLocal[0], y: J.parentLocal[1], z: J.parentLocal[2] };
const a2 = { x: J.childLocal[0], y: J.childLocal[1], z: J.childLocal[2] };
w.createImpulseJoint(RAPIER.JointData.spherical(a1, a2), RB[J.parentKey]!, RB[J.childKey]!, true);

const p = RB[J.parentKey]!, c = RB[J.childKey]!;

// 读关节相对角/角速度（与 Body 相同的算法，内联避免依赖）
function jointRot(out: Float64Array) {
  const qp = p.rotation(), qc = c.rotation();
  const ix = -qp.x, iy = -qp.y, iz = -qp.z, iw = qp.w;
  const rx = iw * qc.x + ix * qc.w + iy * qc.z - iz * qc.y;
  const ry = iw * qc.y - ix * qc.z + iy * qc.w + iz * qc.x;
  const rz = iw * qc.z + ix * qc.y - iy * qc.x + iz * qc.w;
  const rw = iw * qc.w - ix * qc.x - iy * qc.y - iz * qc.z;
  const vl = Math.hypot(rx, ry, rz);
  if (vl < 1e-12) { out[0] = out[1] = out[2] = 0; return; }
  let ang = 2 * Math.atan2(vl, rw);
  if (ang > Math.PI) ang -= 2 * Math.PI;
  const s = ang / vl;
  out[0] = rx * s; out[1] = ry * s; out[2] = rz * s;
}
function jointRelVel(out: Float64Array) {
  const qp = p.rotation(); const wp = p.angvel(), wc = c.angvel();
  const wx = wc.x - wp.x, wy = wc.y - wp.y, wz = wc.z - wp.z;
  const ix = -qp.x, iy = -qp.y, iz = -qp.z, iw = qp.w;
  out[0] = iw * wx + iy * wz - iz * wy;
  out[1] = iw * wy - ix * wz + iz * wx;
  out[2] = iw * wz + ix * wy - iy * wx;
}

// 给 head 一个初始相对角速度（绕父体本地 X）
c.setAngvel({ x: 2.0, y: 0, z: 0 }, true);

const rot = new Float64Array(3), rel = new Float64Array(3), ax = new Float64Array(3);
const iv = { x: 0, y: 0, z: 0 };
const KPi = Number(process.env.KPI ?? 48), KDi = Number(process.env.KDI ?? 1.0), WMAX = 9.0;
const TAUMAX = [60, 60, 60];

console.log(`\nkP=${KPi} kD=${KDi}  初始 ω=2.0 rad/s 绕本地X`);
console.log('step |    θ_x(°) |    ω_x  |    τ_x');
for (let s = 0; s < 60; s++) {
  jointRot(rot); jointRelVel(rel);
  // PD：目标 0
  const tau = (KPi * (0 - rot[0]!) * TAUMAX[0]!) / WMAX - (KDi * rel[0]! * TAUMAX[0]!) / WMAX;
  // 写冲量（父体本地 X → 世界）
  const q = p.rotation();
  quatRotate(q.x, q.y, q.z, q.w, 1, 0, 0, ax);
  const imp = tau * (1 / 240);
  iv.x = ax[0]! * imp; iv.y = ax[1]! * imp; iv.z = ax[2]! * imp;
  c.applyTorqueImpulse(iv, true);
  iv.x = -iv.x; iv.y = -iv.y; iv.z = -iv.z;
  p.applyTorqueImpulse(iv, true);

  w.step();
  if (s % 4 === 0 || s < 8) {
    console.log(`${String(s + 1).padStart(4)} | ${(rot[0]! * 180 / Math.PI).toFixed(4).padStart(9)} | ${rel[0]!.toFixed(5).padStart(8)} | ${tau.toFixed(3).padStart(8)}`);
  }
}
