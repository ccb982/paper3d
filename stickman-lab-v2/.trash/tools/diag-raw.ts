/**
 * diag-raw.ts —— 直接打印 spine4/head 的原始数值，找非法值
 * 用法：node tools/run.mjs diag-raw
 */
import './_boot';
import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
console.log('════ 原始数值 ════');
for (const k of ['head', 'spine4', 'torso', 'foot_l']) {
  const b = sk.bodies.find((x) => x.key === k)!;
  console.log(`${k}:`);
  console.log(`   c=(${b.cx}, ${b.cy}, ${b.cz})  有限? ${[b.cx, b.cy, b.cz].every(Number.isFinite)}`);
  console.log(`   tilt=${b.restTiltRad}  yaw=${b.restYawRad}  有限? ${[b.restTiltRad, b.restYawRad].every(Number.isFinite)}`);
  console.log(`   mass=${b.mass}  有限? ${Number.isFinite(b.mass)}`);
  b.colliders.forEach((c, i) => {
    const vals = [c.mass, c.comY, c.inertiaXY, c.inertiaZ, c.offsetY, c.offsetX ?? 0, c.offsetZ ?? 0,
      c.shape === 'capsule' ? c.halfHeight : c.hx, c.shape === 'capsule' ? c.radius : c.hy,
      c.shape === 'capsule' ? 0 : c.hz];
    console.log(`   c[${i}] 全部有限? ${vals.every(Number.isFinite)}  ${JSON.stringify(vals.map((v) => Number.isFinite(v) ? v : String(v)))}`);
  });
}

// 逐个试：只用位置，不设旋转
console.log('\n════ 只设位置 / 只设旋转 ════');
function tryStep(label: string, cfg: (b: typeof sk.bodies[number]) => { t?: boolean; r?: boolean }) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  for (const k of ['spine4', 'head']) {
    const b = sk.bodies.find((x) => x.key === k)!;
    const o = cfg(b);
    let d = RAPIER.RigidBodyDesc.dynamic();
    if (o.t) d = d.setTranslation(b.cx, b.cy, b.cz);
    if (o.r) {
      const [x, y, z, wq] = [0, 0, 0, 1];
      d = d.setRotation({ x, y, z, w: wq });
    }
    const rb = w.createRigidBody(d);
    w.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1), rb);
  }
  w.step();
  const p = w.getRigidBody(0)!.translation();
  console.log(`${label.padEnd(30)} rb0=(${p.x.toFixed(4)}, ${p.y.toFixed(6)}, ${p.z.toFixed(4)})  ${Number.isFinite(p.y) ? '✔' : '✘ NaN'}`);
}
tryStep('位置+单位旋转', () => ({ t: true, r: true }));
tryStep('位置+无旋转', () => ({ t: true }));
tryStep('默认位置+无旋转', () => ({}));

// 逐个刚体单独放
console.log('\n════ 逐个刚体单独放（位置+单位四元数） ════');
for (const k of ['head', 'spine4', 'torso', 'spine2', 'spine3', 'arm_l', 'hand_l', 'thigh_l', 'shin_l', 'foot_l', 'arch_l', 'mfoot_l']) {
  const b = sk.bodies.find((x) => x.key === k)!;
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz),
  );
  w.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1), rb);
  w.step();
  const p = rb.translation();
  console.log(`${k.padEnd(10)} c=(${b.cx.toFixed(4)}, ${b.cy.toFixed(4)}, ${b.cz.toFixed(4)})  step后=(${p.x.toFixed(4)}, ${p.y.toFixed(6)}, ${p.z.toFixed(4)})  ${Number.isFinite(p.y) ? '✔' : '✘ NaN'}`);
}
