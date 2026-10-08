/**
 * diag-step.ts —— 逐拍诊断：第几拍开始出现 NaN，以及是哪个刚体/哪个来源
 * 用法：node tools/run.mjs diag-step
 */
import './_boot';
import { World, DEFAULT_WORLD_OPTIONS } from '../src/core/world';

const w = new World({ ...DEFAULT_WORLD_OPTIONS });
w.setGravityZero();
w.body.reset();

const nj = w.sk.joints.length;

function scanNaN(tag: string): boolean {
  let found = false;
  for (let i = 0; i < w.body.bodies.length; i++) {
    const b = w.body.bodies[i]!;
    const t = b.translation(), v = b.linvel(), av = b.angvel();
    if (!Number.isFinite(t.x) || !Number.isFinite(v.x) || !Number.isFinite(av.x)) {
      console.log(`  ${tag}: 刚体 ${w.sk.bodies[i]!.key} 出现 NaN  t=(${t.x},${t.y},${t.z}) v=(${v.x},${v.y},${v.z}) ω=(${av.x},${av.y},${av.z})`);
      found = true;
      if (found) return true;
    }
  }
  void nj;
  return found;
}

console.log('════ 逐拍 NaN 诊断 ════');
console.log('步进前：', scanNaN('t=0') ? 'NaN!' : 'OK');

for (let s = 0; s < 20; s++) {
  w.advance(1);
  const bad = scanNaN(`step ${s + 1}`);
  if (bad) {
    console.log('');
    console.log(`⇒ 第 ${s + 1} 步首次出现 NaN。`);
    // 检查限位惯量
    console.log('');
    console.log('各关节的轴向折合惯量（axisInertia）：');
    for (let i = 0; i < nj; i++) {
      const vals = [0, 1, 2].map((k) => w.body.axisInertia(i, k));
      const badI = vals.some((v) => !Number.isFinite(v) || v <= 0);
      console.log(`  ${w.sk.joints[i]!.name.padEnd(11)} [${vals.map((v) => v.toExponential(2)).join(', ')}]${badI ? '  ← 病态!' : ''}`);
    }
    break;
  }
}
console.log('');
console.log(`总步数 = ${w.steps}   limitHits = ${w.body.limitHits}`);
