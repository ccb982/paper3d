/**
 * diag-boot.ts —— 装配诊断：质量/惯量/锚点/关节数
 * 用法：node tools/run.mjs diag-boot
 */
import './_boot';
import { World, DEFAULT_WORLD_OPTIONS } from '../src/core/world';

const w = new World({ ...DEFAULT_WORLD_OPTIONS });
console.log('════ 装配诊断 ════');
console.log(`关节数 = ${w.sk.joints.length}   刚体数 = ${w.sk.bodies.length}   Rapier 刚体 = ${w.body.bodies.length}`);
console.log(`质量合计(skeleton 声明) = ${w.sk.massTotal.toFixed(2)} kg`);
console.log('');

console.log('bodyKey            | skeleton.mass | Rapier.mass  | I(x,y,z)');
let totalRapier = 0;
let bad = 0;
w.sk.bodies.forEach((b, i) => {
  const rb = w.body.bodies[i]!;
  const m = rb.mass();
  totalRapier += m;
  const I = rb.principalInertia();
  const isBad = !(m > 1e-6);
  if (isBad) bad++;
  console.log(
    `${b.key.padEnd(18)} | ${b.mass.toFixed(4).padStart(13)} | ${m.toFixed(4).padStart(12)} | ` +
    `${I.x.toExponential(2)} ${I.y.toExponential(2)} ${I.z.toExponential(2)}${isBad ? '  ← m≈0!' : ''}`,
  );
});
console.log('');
console.log(`Rapier 质量合计 = ${totalRapier.toFixed(2)} kg   病态刚体 = ${bad}`);

// colliders 细节（第一个刚体）
console.log('');
console.log('第一个刚体的 colliders：');
const b0 = w.sk.bodies[0]!;
console.log(`  key=${b0.key}  colliders=${b0.colliders.length}`);
b0.colliders.forEach((c, i) => {
  console.log(`   [${i}] shape=${c.shape} mass=${c.mass} halfHeight=${c.halfHeight} radius=${c.radius} hx=${c.hx} hy=${c.hy} hz=${c.hz} offY=${c.offsetY}`);
});

// 锚点重合
console.log('');
const anchors = w.body.checkAnchorCoincidence();
console.log(`锚点不重合的关节数 = ${anchors.length} / ${w.sk.joints.length}`);
for (const a of anchors.slice(0, 5)) console.log(`  ${a.name}: ${(a.err * 1000).toFixed(3)} mm`);

// 关节类型
console.log('');
console.log('关节类型：');
w.sk.joints.forEach((j, i) => {
  const t = j.revoluteAxis ? `revolute[${JSON.stringify(j.revoluteAxis)}]` : 'spherical';
  console.log(`  ${j.name.padEnd(12)} ${t.padEnd(28)} maxTorque=[${j.maxTorque.join(', ')}]`);
});
