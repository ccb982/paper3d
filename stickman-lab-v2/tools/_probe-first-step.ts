/**
 * _probe-first-step.ts —— 第 1 拍谁在飞：全自由度 |ω| 排行
 */
import './_boot';
import { World } from '../src/core/world';

const w = new World();
w.driveEnabled = false;
w.setGravityZero();
w.reset();
for (const b of w.body.allBodies) {
  const t = b.translation();
  b.setTranslation({ x: t.x, y: t.y + 2, z: t.z }, true);
}

for (const step of [1, 2, 3]) {
  w.advance(1);
  const rows = w.body.dofs.map((d) => ({ n: `${d.name}/${d.axis}`, v: Math.abs(d.vel) }))
    .sort((a, b) => b.v - a.v).slice(0, 8);
  console.log(`── 第 ${step} 拍 Σ|ω| = ${w.totalRelVel().toFixed(3)} ──`);
  console.log('   ' + rows.map((r) => `${r.n}=${r.v.toFixed(2)}`).join('  '));
}
