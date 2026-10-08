/**
 * diag-limit-axes.ts —— 列出「真的有限位」的轴（球铰侧）
 * 用法：node tools/run.mjs diag-limit-axes
 */
import './_boot';
import { World, DEFAULT_WORLD_OPTIONS } from '../src/core/world';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';

const sk = buildSkeleton({ ...DEFAULT_CONFIG });
const DEG = 180 / Math.PI;
console.log('════ 限位轴清单（球铰 / revolute）════');
let nLimited = 0, nFull = 0;
sk.joints.forEach((j, i) => {
  const revAx = j.revoluteAxis
    ? (j.revoluteAxis[0] !== 0 ? 0 : j.revoluteAxis[1] !== 0 ? 1 : 2)
    : -1;
  const tag = j.revoluteAxis ? 'revolute' : 'spherical';
  const parts: string[] = [];
  for (let k = 0; k < 3; k++) {
    const lo = j.minRad[k]!, hi = j.maxRad[k]!;
    const full = hi - lo >= Math.PI * 1.99;
    if (revAx === k) { parts.push(`ax${k}=ENGINE[${(lo * DEG).toFixed(1)},${(hi * DEG).toFixed(1)}]`); continue; }
    if (full) { parts.push(`ax${k}=FULL`); nFull++; }
    else { parts.push(`ax${k}=[${(lo * DEG).toFixed(1)},${(hi * DEG).toFixed(1)}]`); nLimited++; }
  }
  console.log(`${String(i).padStart(2)} ${j.name.padEnd(11)} ${tag.padEnd(9)} ${parts.join('  ')}`);
});
console.log('');
console.log(`自研限位会介入的轴数 = ${nLimited}（FULL 轴 = ${nFull}，revolute 自由轴 = 引擎管）`);
void World; void DEFAULT_WORLD_OPTIONS;
