/** _probe-build-audit.ts —— 装配审计：逻辑轴重复映射 / 不可达自由环 */
import './_boot';
import { World } from '../src/core/world';

const w = new World();
const map = new Map<string, number[]>();
w.body.dofs.forEach((d, i) => {
  const k = `${d.name}/${d.axis}`;
  if (!map.has(k)) map.set(k, []);
  map.get(k)!.push(i);
});
console.log(`自由度总数=${w.body.dofs.length}（骨架逻辑轴应有 ${w.sk.joints.length * 3 - w.sk.joints.filter((j) => j.revoluteAxis !== undefined).length * 2} 个左右）`);
let dup = 0;
for (const [k, list] of map) {
  if (list.length > 1) {
    dup++;
    const info = list.map((i) => {
      const d = w.body.dofs[i]!;
      return `#${i}[rest=${d.rest.toFixed(3)} lim±${Math.max(Math.abs(d.min), Math.abs(d.max)).toFixed(2)} τ${d.tauMax.toFixed(0)} 轴${d.axisLocal.x.toFixed(1)},${d.axisLocal.y.toFixed(1)},${d.axisLocal.z.toFixed(1)} ${d.engineMotor ? 'engineMotor' : d.engineLimited ? 'engineLim' : 'driveLim'}]`;
    }).join('  ');
    console.log(`★ 重复映射 ${k} → ${info}`);
  }
}
console.log(dup === 0 ? '无重复映射' : `共 ${dup} 组重复`);
