/**
 * diag-foot-chain.ts —— 只排查柔性足三段链（foot→arch→mfoot）+ 头部/颈
 * 逐个 body 打印：体心、质量、主惯量、collider 数、collider 偏移/形状
 * 然后只装配"颈+头"这一对，单独 step，看是否 NaN
 *
 * 用法：node tools/run.mjs diag-foot-chain
 */
import './_boot';
import * as RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);

const KEYS = ['head', 'neck', 'spine3', 'spine2', 'spine1', 'foot_l', 'arch_l', 'mfoot_l'];
console.log('════ body 明细 ════');
for (const k of KEYS) {
  const b = sk.bodies.find((x) => x.key === k);
  if (!b) { console.log(`${k}: (不存在)`); continue; }
  console.log(`\n${k}  mass(decl)=${b.mass.toFixed(5)}  c=(${b.cx.toFixed(4)}, ${b.cy.toFixed(4)}, ${b.cz.toFixed(4)})  tilt=${(b.restTiltRad * 180 / Math.PI).toFixed(2)}°`);
  b.colliders.forEach((c, i) => {
    console.log(`   c[${i}] ${c.shape} mass=${c.mass.toFixed(5)} comY=${c.comY.toFixed(4)} iXY=${c.inertiaXY.toExponential(3)} iZ=${c.inertiaZ.toExponential(3)} off=(${(c.offsetX ?? 0).toFixed(4)}, ${c.offsetY.toFixed(4)}, ${(c.offsetZ ?? 0).toFixed(4)})` +
      (c.shape === 'capsule' ? ` hh=${c.halfHeight} r=${c.radius}` : ` h=(${c.hx.toFixed(4)}, ${c.hy.toFixed(4)}, ${c.hz.toFixed(4)})`));
  });
}

console.log('\n════ 关节明细（涉及这些 body 的） ════');
sk.joints.forEach((j, i) => {
  if (!KEYS.includes(j.parentKey) && !KEYS.includes(j.childKey)) return;
  console.log(`[${i}] ${j.name}  ${j.parentKey} → ${j.childKey}  revolute=${j.revoluteAxis ? JSON.stringify(j.revoluteAxis) : 'spherical'}`);
  console.log(`     parentLocal=(${j.parentLocal.map((v) => v.toFixed(4)).join(', ')})  childLocal=(${j.childLocal.map((v) => v.toFixed(4)).join(', ')})`);
  console.log(`     min(deg)=(${j.minRad.map((v) => (v * 180 / Math.PI).toFixed(1)).join(', ')})  max(deg)=(${j.maxRad.map((v) => (v * 180 / Math.PI).toFixed(1)).join(', ')})`);
});

// ── 最小复现：只建"头 + 颈"两根刚体 + 关节，step 5 步
console.log('\n════ 最小复现：头 + 颈 ════');
function buildPair(parentKey: string, childKey: string, jointName: string) {
  const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
  w.timestep = 1 / 240;
  w.numSolverIterations = 8;
  const map = new Map<string, RAPIER.RigidBody>();
  for (const k of [parentKey, childKey]) {
    const b = sk.bodies.find((x) => x.key === k)!;
    const rb = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(b.cx, b.cy, b.cz)
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
    map.set(k, rb);
  }
  const j = sk.joints.find((x) => x.name === jointName)!;
  const a1 = { x: j.parentLocal[0], y: j.parentLocal[1], z: j.parentLocal[2] };
  const a2 = { x: j.childLocal[0], y: j.childLocal[1], z: j.childLocal[2] };
  const jd = j.revoluteAxis
    ? RAPIER.JointData.revolute(a1, a2, { x: j.revoluteAxis[0], y: j.revoluteAxis[1], z: j.revoluteAxis[2] })
    : RAPIER.JointData.spherical(a1, a2);
  w.createImpulseJoint(jd, map.get(parentKey)!, map.get(childKey)!, true);

  // 打印 Rapier 视角的质量/惯量
  for (const [k, rb] of map) {
    const I = rb.principalInertia();
    console.log(`  Rapier ${k}: mass=${rb.mass().toFixed(5)}  I=(${I.x.toExponential(3)}, ${I.y.toExponential(3)}, ${I.z.toExponential(3)})`);
  }
  for (let s = 0; s < 5; s++) {
    w.step();
    const p = map.get(childKey)!.translation();
    const ok = Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
    console.log(`  step${s + 1}: ${childKey} = (${p.x.toFixed(5)}, ${p.y.toFixed(5)}, ${p.z.toFixed(5)})  ${ok ? '' : '  ✘ NaN'}`);
    if (!ok) break;
  }
}
buildPair('neck', 'head', 'neck');
