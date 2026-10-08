import './_boot';
import { buildSkeleton, DEFAULT_CONFIG, restQuatOf } from '../src/core/skeleton';
import { qMul, qConj, qOf, qRel, qToRotVec } from '../src/core/quat';

const sk = buildSkeleton(DEFAULT_CONFIG);
for (const key of ['shin_l', 'foot_l', 'arch_l', 'mfoot_l', 'shin_r', 'foot_r']) {
  const b = sk.bodies.find((x) => x.key === key)!;
  const q = restQuatOf(b.restTiltRad, b.restYawRad);
  console.log(`${key.padEnd(9)} tilt=${(b.restTiltRad * 180 / Math.PI).toFixed(2)}° yaw=${(b.restYawRad * 180 / Math.PI).toFixed(2)}° q=(${q.map((v) => v.toFixed(4)).join(',')})`);
}
const shin = sk.bodies.find((x) => x.key === 'shin_l')!;
const foot = sk.bodies.find((x) => x.key === 'foot_l')!;
const qs = restQuatOf(shin.restTiltRad, shin.restYawRad);
const qf = restQuatOf(foot.restTiltRad, foot.restYawRad);
const rel = qRel(qOf({ x: qs[0], y: qs[1], z: qs[2], w: qs[3] }), qOf({ x: qf[0], y: qf[1], z: qf[2], w: qf[3] }));
const out = new Float64Array(3);
qToRotVec(rel, out);
console.log(`qrel(shin_l→foot_l) 旋转向量 = (${(out[0]! * 180 / Math.PI).toFixed(3)}, ${(out[1]! * 180 / Math.PI).toFixed(3)}, ${(out[2]! * 180 / Math.PI).toFixed(3)})°`);
void qMul; void qConj;
