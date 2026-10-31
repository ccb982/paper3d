/** _probe-fz-coverage: support-foot load-bearing coverage gauge.
 *  Metric: fraction of single-support (swing foot unloaded) time where support Fz >= 95% W.
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const W = w.body.sk.massTotal * 9.81;
let singleT = 0, okT = 0, minFz = 1e9;
const losses: string[] = [];
for (let s = 0; s < Math.round(9.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const fl = ctl.sensors.feet[0]!.fz;
  const fr = ctl.sensors.feet[1]!.fz;
  const ph = ctl.actions.status.phase ?? '-';
  // 单支撑判定：摆动脚载 <5%W 且相位在 B-E
  const single = fl < 0.05 * W && ['B抬腿', 'C保持', 'D落腿', 'E站稳'].includes(ph);
  if (!single) continue;
  singleT += w.dt;
  if (fr >= 0.95 * W) okT += w.dt; else if (t > 3.8) losses.push(`${t.toFixed(2)}(${(fr / W * 100).toFixed(0)}%)`);
  if (fr < minFz) minFz = fr;
}
console.log(`单支撑总时长: ${singleT.toFixed(2)}s`);
console.log(`Fz>=95%W   : ${okT.toFixed(2)}s  (${(okT / Math.max(0.001, singleT) * 100).toFixed(0)}%)`);
console.log(`最低支撑 Fz : ${(minFz / W * 100).toFixed(0)}%W`);
console.log(`欠载时刻: ${losses.slice(0, 12).join(' ')}`);
