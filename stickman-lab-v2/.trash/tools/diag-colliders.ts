/**
 * diag-colliders.ts —— 检查 collider 是否真的建成了、质量是否真的设上了
 * 用法：node tools/run.mjs diag-colliders
 */
import './_boot';
import * as RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
w.timestep = 1 / 240;

console.log('════ collider 建成情况 ════');
console.log(`skeleton 声明的 collider 总数 = ${sk.bodies.reduce((a, b) => a + b.colliders.length, 0)}`);
console.log('');

// 手工按 body.ts 的方式建，逐个检查
let totalDeclared = 0, totalActual = 0;
sk.bodies.forEach((b, i) => {
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(b.cx, b.cy, b.cz),
  );
  let created = 0;
  for (const c of b.colliders) {
    const desc = c.shape === 'capsule'
      ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
      : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
    desc.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0).setMass(c.mass);
    const col = w.createCollider(desc, rb);
    if (col) created++;
    totalDeclared++;
  }
  totalActual += created;
  const col0 = rb.collider(0);
  const m0 = col0?.mass?.() ?? NaN;
  console.log(
    `${b.key.padEnd(18)} decl=${b.colliders.length} created=${created}  rb.mass()=${rb.mass().toFixed(4)}  col0.mass=${m0.toFixed(4)}`,
  );
});
console.log('');
console.log(`声明 collider = ${totalDeclared}  实际创建 = ${totalActual}`);

// 单个最简测试：一个 capsule + 一个球铰，看能不能 step
console.log('');
console.log('════ 最小可复现：2 刚体 + 1 球铰 ════');
const w2 = new RAPIER.World({ x: 0, y: 0, z: 0 });
w2.timestep = 1 / 240;
const r1 = w2.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0));
w2.createCollider(RAPIER.ColliderDesc.capsule(0.1, 0.05).setMass(1.0), r1);
const r2 = w2.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.3, 0));
w2.createCollider(RAPIER.ColliderDesc.capsule(0.1, 0.05).setMass(1.0), r2);
const jd = RAPIER.JointData.spherical({ x: 0, y: 0.15, z: 0 }, { x: 0, y: -0.15, z: 0 });
w2.createImpulseJoint(jd, r1, r2, true);
for (let s = 1; s <= 3; s++) {
  w2.step();
  const t = r2.translation();
  console.log(`  step ${s}: r2 = (${t.x.toFixed(4)}, ${t.y.toFixed(4)}, ${t.z.toFixed(4)})  质量 r1=${r1.mass().toFixed(3)} r2=${r2.mass().toFixed(3)}`);
}

// 带 setMass 的 cuboid 测试
console.log('');
console.log('════ 最小可复现：cuboid + setMass ════');
const w3 = new RAPIER.World({ x: 0, y: 0, z: 0 });
w3.timestep = 1 / 240;
const r3 = w3.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0));
w3.createCollider(
  RAPIER.ColliderDesc.cuboid(0.05, 0.1, 0.05).setTranslation(0, 0, 0).setMass(0.6667),
  r3,
);
const j3 = w3.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.3, 0));
w3.createCollider(RAPIER.ColliderDesc.cuboid(0.05, 0.1, 0.05).setMass(0.1227), j3);
w3.createImpulseJoint(
  RAPIER.JointData.revolute({ x: 0, y: 0.1, z: 0 }, { x: 0, y: -0.1, z: 0 }, { x: 0, y: 0, z: 1 }),
  r3, j3, true,
);
for (let s = 1; s <= 3; s++) {
  w3.step();
  const t = j3.translation();
  console.log(`  step ${s}: j3 = (${t.x.toFixed(4)}, ${t.y.toFixed(4)}, ${t.z.toFixed(4)})  m=${j3.mass().toFixed(4)} I=${j3.principalInertia().x.toExponential(2)}`);
}
