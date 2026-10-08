/**
 * diag-bare.ts —— 极端最小：不碰 skeleton，纯手搓两个盒子
 * 用法：node tools/run.mjs diag-bare
 * 目的：判断是「Rapier wasm 环境本身坏了」还是「skeleton 数据带毒」
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

console.log('Rapier 版本 =', (RAPIER as unknown as { version?: () => string }).version?.() ?? '(无 version())');
console.log('World 构造器 =', typeof RAPIER.World);

// ① 纯手搓：两个 1kg 盒子，一上一下，无关节
{
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  const a = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0));
  w.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1), a);
  const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 2, 0));
  w.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1), b);
  w.step();
  const p = a.translation();
  console.log(`① 纯手搓 2 盒子         : a=(${p.x}, ${p.y.toFixed(6)}, ${p.z})  ${Number.isFinite(p.y) ? '✔' : '✘ NaN'}`);
}

// ② 用 skeleton 的位置，但 collider 用固定 0.1 盒子（不用 setMassProperties）
{
  const sk = buildSkeleton(DEFAULT_CONFIG);
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  for (const k of ['spine4', 'head']) {
    const b = sk.bodies.find((x) => x.key === k)!;
    const rb = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz)
        .setRotation(restQuatOf(b.restTiltRad, b.restYawRad)),
    );
    w.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1), rb);
  }
  w.step();
  const rb0 = w.getRigidBody(0)!;
  const p = rb0.translation();
  console.log(`② skeleton 位置+固定盒  : rb0=(${p.x}, ${p.y.toFixed(6)}, ${p.z})  ${Number.isFinite(p.y) ? '✔' : '✘ NaN'}`);
}

// ③ 用 skeleton 的位置 + 真实 collider 形状，但**不用 setMassProperties**（用默认密度）
{
  const sk = buildSkeleton(DEFAULT_CONFIG);
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  for (const k of ['spine4', 'head']) {
    const b = sk.bodies.find((x) => x.key === k)!;
    const rb = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz)
        .setRotation(restQuatOf(b.restTiltRad, b.restYawRad)),
    );
    b.colliders.forEach((c) => {
      const desc = c.shape === 'capsule'
        ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
        : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
      desc.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0);
      w.createCollider(desc, rb);
    });
  }
  w.step();
  const rb0 = w.getRigidBody(0)!;
  const p = rb0.translation();
  console.log(`③ skeleton 位置+真形状  : rb0=(${p.x}, ${p.y.toFixed(6)}, ${p.z})  ${Number.isFinite(p.y) ? '✔' : '✘ NaN'}`);
  console.log(`     质量 = spine4 ${rb0.mass().toFixed(5)}  head ${w.getRigidBody(1)!.mass().toFixed(5)}`);
}

// ④ 用 skeleton 位置 + 真形状 + setMassProperties  ← 已知会 NaN
{
  const sk = buildSkeleton(DEFAULT_CONFIG);
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  for (const k of ['spine4', 'head']) {
    const b = sk.bodies.find((x) => x.key === k)!;
    const rb = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz)
        .setRotation(restQuatOf(b.restTiltRad, b.restYawRad)),
    );
    b.colliders.forEach((c) => {
      const desc = c.shape === 'capsule'
        ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
        : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
      desc.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0)
        .setMassProperties(c.mass, { x: 0, y: c.comY, z: 0 },
          { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ }, { x: 0, y: 0, z: 0, w: 1 });
      w.createCollider(desc, rb);
    });
    // 打回读
    const rbi = rb.principalInertia();
    console.log(`     建完 ${k}: mass=${rb.mass().toFixed(5)} I=(${rbi.x.toExponential(4)}, ${rbi.y.toExponential(4)}, ${rbi.z.toExponential(4)}) com=${JSON.stringify(rb.worldCom())}`);
  }
  w.step();
  const rb0 = w.getRigidBody(0)!;
  const p = rb0.translation();
  console.log(`④ skeleton+真形状+mprops: rb0=(${p.x}, ${p.y.toFixed(6)}, ${p.z})  ${Number.isFinite(p.y) ? '✔' : '✘ NaN'}`);
}
