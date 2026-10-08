/**
 * diag-anchor-2d.ts —— 二参数扫描：P.y 与 C.y 对注入幅度的影响
 * 用法：node tools/run.mjs diag-anchor-2d
 * 目的：找出"球铰注入"的触发条件，而不是继续猜。
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
const J = sk.joints.find((j) => j.name === 'neck')!;

function inject(py: number, cy: number, pz = 0, cz = 0): number {
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
  w.createImpulseJoint(
    RAPIER.JointData.spherical({ x: 0, y: py, z: pz }, { x: 0, y: cy, z: cz }),
    RB[0]!, RB[1]!, true,
  );
  w.step();
  const wc = RB[1]!.angvel(), wp = RB[0]!.angvel();
  const d = Math.hypot(wc.x - wp.x, wc.y - wp.y, wc.z - wp.z);
  w.free();
  return d;
}

console.log('════ P.y × C.y 扫描（s1 的 |Δω|） ════');
console.log('  P.y↓ / C.y→   ' + [-0.135, -0.05, 0, 0.0304, 0.05].map((c) => c.toFixed(4).padStart(10)).join(''));
for (const py of [0, 0.0304, 0.05, 0.1, 0.15]) {
  const row = [-0.135, -0.05, 0, 0.0304, 0.05].map((cy) => inject(py, cy).toFixed(3).padStart(10));
  console.log(`  ${py.toFixed(4).padStart(9)}     ${row.join('')}`);
}

console.log('');
console.log('════ 骨架真值 ════');
console.log(`P.y=${J.parentLocal[1].toFixed(4)}  C.y=${J.childLocal[1].toFixed(4)}  ⇒ |Δω| = ${inject(J.parentLocal[1], J.childLocal[1], J.parentLocal[2], J.childLocal[2]).toFixed(3)}`);
console.log('');
console.log('════ 只改 z（骨架 y 不变） ════');
for (const z of [0, -0.0061, -0.02, -0.05, -0.1]) {
  console.log(`  P.z=C.z=${z.toFixed(4)}  ⇒ |Δω| = ${inject(J.parentLocal[1], J.childLocal[1], z, z).toFixed(3)}`);
}
