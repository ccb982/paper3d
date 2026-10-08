/**
 * diag-anchor-world.ts —— 用 Rapier 自己的姿态算锚点世界坐标，看是否重合
 * 用法：node tools/run.mjs diag-anchor-world
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
w.timestep = 1 / 240;

const RB: RAPIER.RigidBody[] = [];
const IDX = new Map<string, number>();
sk.bodies.forEach((b, i) => {
  IDX.set(b.key, i);
  const q = restQuatOf(b.restTiltRad, b.restYawRad);
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz)
      .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }),
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
});

function rot(qx: number, qy: number, qz: number, qw: number, vx: number, vy: number, vz: number) {
  // q ⊗ v ⊗ q⁻¹
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

console.log('════ Rapier 姿态下的锚点世界坐标 ════');
console.log('joint         |  锚点距离(mm) | 是否重合');
let maxErr = 0;
for (const j of sk.joints) {
  const bp = RB[IDX.get(j.parentKey)!]!, bc = RB[IDX.get(j.childKey)!]!;
  const tp = bp.translation(), tc = bc.translation();
  const qp = bp.rotation(), qc = bc.rotation();
  const rp = rot(qp.x, qp.y, qp.z, qp.w, j.parentLocal[0], j.parentLocal[1], j.parentLocal[2]);
  const rc = rot(qc.x, qc.y, qc.z, qc.w, j.childLocal[0], j.childLocal[1], j.childLocal[2]);
  const pw = [tp.x + rp[0]!, tp.y + rp[1]!, tp.z + rp[2]!];
  const cw = [tc.x + rc[0]!, tc.y + rc[1]!, tc.z + rc[2]!];
  const d = Math.hypot(pw[0]! - cw[0]!, pw[1]! - cw[1]!, pw[2]! - cw[2]!);
  if (d > maxErr) maxErr = d;
  console.log(`${j.name.padEnd(13)} | ${(d * 1000).toFixed(3).padStart(13)} | ${d < 1e-6 ? '✔' : '✘'}`);
}
console.log('');
console.log(`最大锚点距离 = ${(maxErr * 1000).toFixed(3)} mm`);
