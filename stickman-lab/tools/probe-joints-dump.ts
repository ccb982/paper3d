/** 一次性：dump 关节表（索引/名字/自由轴/限位/τmax）—— 足部侧向发力重构的地面真值 */
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';

const sk = buildSkeleton(DEFAULT_CONFIG);
const DEG = 180 / Math.PI;
console.log('idx  name          revoluteAxis   minRad(deg)              maxRad(deg)              tau(N·m)');
for (let i = 0; i < sk.joints.length; i++) {
  const j = sk.joints[i]!;
  const ax = j.revoluteAxis ? `[${j.revoluteAxis.join(',')}]` : '(ball)   ';
  const mn = j.minRad.map((v) => (v * DEG).toFixed(1).padStart(7)).join(',');
  const mx = j.maxRad.map((v) => (v * DEG).toFixed(1).padStart(7)).join(',');
  const tq = j.maxTorque.map((v) => (v ?? 0).toFixed(0).padStart(4)).join(',');
  console.log(`${String(i).padStart(3)}  ${j.name.padEnd(13)} ${ax.padEnd(14)} ${mn}  ${mx}  ${tq}`);
}
console.log('\n── 轴映射（flat = joint*3 + axis）──');
for (let i = 0; i < sk.joints.length; i++) {
  const j = sk.joints[i]!;
  if (!/(foot|arch|mfoot|hip|knee)/.test(j.name)) continue;
  for (let a = 0; a < 3; a++) {
    console.log(`  轴${i * 3 + a} = ${j.name}/${a}  τmax=${(j.maxTorque[a] ?? 0).toFixed(1)} N·m`);
  }
}
