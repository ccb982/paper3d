/** _probe-joints.ts —— 骨架盘点：全部关节名/轴数/限位/τmax（含腕是否存在） */
import './_boot';
import { World } from '../src/core/world';

const w = new World();
const names = w.sk.joints.map((j) => j.name);
console.log(`关节总数=${names.length}\n`);
for (const j of w.sk.joints) {
  const axes: string[] = [];
  for (let a = 0; a < 3; a++) {
    const i = w.body.dofByName(j.name, a);
    if (i < 0) continue;
    const d = w.body.dofs[i]!;
    axes.push(`轴${a}[${d.min.toFixed(2)},${d.max.toFixed(2)}] τ${d.tauMax.toFixed(0)}`);
  }
  console.log(`${j.name.padEnd(12)} ${axes.join('  ')}`);
}
console.log(`\n腕相关关节：${names.filter((n) => /wrist|hand/i.test(n)).join(', ') || '（无）'}`);
