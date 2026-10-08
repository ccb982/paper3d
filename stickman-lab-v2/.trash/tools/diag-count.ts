/**
 * diag-count.ts —— 刚体数量敏感性：同 world 里放 N 个刚体
 * 用法：node tools/run.mjs diag-count
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);

console.log('════ 同 world 内刚体数量 ════');

function testN(label: string, keys: string[], useRealColliders: boolean, useSkeletonPos: boolean, useRestQuat: boolean) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  const rbs: RAPIER.RigidBody[] = [];
  keys.forEach((k, n) => {
    const b = sk.bodies.find((x) => x.key === k)!;
    let d = RAPIER.RigidBodyDesc.dynamic();
    if (useSkeletonPos) d = d.setTranslation(b.cx, b.cy, b.cz);
    else d = d.setTranslation(n * 0.5, 1 + n * 0.5, 0);
    if (useRestQuat) {
      const q = { x: 0, y: 0, z: 0, w: 1 };
      d = d.setRotation(q);
    }
    const rb = w.createRigidBody(d);
    if (useRealColliders) {
      b.colliders.forEach((c) => {
        const desc = c.shape === 'capsule'
          ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
          : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
        desc.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0);
        w.createCollider(desc, rb);
      });
    } else {
      w.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1), rb);
    }
    rbs.push(rb);
  });
  w.step();
  const bad = rbs.findIndex((r) => !Number.isFinite(r.translation().x));
  console.log(`${label.padEnd(40)} ${bad < 0 ? '✔ 稳定' : `✘ NaN @${keys[bad]}`}`);
}

const pairs = [
  ['spine4', 'head'],
  ['torso', 'spine2'],
  ['spine2', 'spine3'],
  ['thigh_l', 'shin_l'],
  ['foot_l', 'arch_l'],
];
pairs.forEach((p) => {
  testN(`2体 骨架位+真collider  ${p[0]}+${p[1]}`, p, true, true, true);
});
testN('2体 骨架位+固定盒       spine4+head', ['spine4', 'head'], false, true, true);
testN('2体 自定位+真collider   spine4+head', ['spine4', 'head'], true, false, true);
testN('2体 自定位+固定盒       spine4+head', ['spine4', 'head'], false, false, true);
testN('1体 骨架位+真collider   spine4', ['spine4'], true, true, true);
testN('1体 骨架位+真collider   head', ['head'], true, true, true);
testN('3体 骨架位+真collider   spine4+head+torso', ['spine4', 'head', 'torso'], true, true, true);
