/** _tmp-spine-lat.ts —— 倾倒前的腰肌/腰椎侧向出力回读（用户："要倾倒时为何高位侧腰肌不多发力、腰椎不挺"）
 *  用法：node tools/run.mjs _tmp-spine-lat
 *  干净起点单腿；抬腿后到破框(≈3.7s)每 0.1s：躯滚/侧偏 + 全部 spine* 轴（角/主动(act)/伺服/阻尼）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone, resetFootLateral } from '../src/core/servo/supportReg';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
resetFootLateral();
ctl.actions.play('singleLegR');
const DEG = 180 / Math.PI;
const dr = (ctl.warner as unknown as {
  drive: { lastBreakdown: Array<{ stiff: number; itb: number; lum: number; act: number; servo: number; ff: number; damp: number }> };
}).drive;
const spineDofs: number[] = [];
for (let i = 0; i < w.body.dofs.length; i++) {
  const d = w.body.dofs[i]!;
  if (/^spine/.test(d.name)) spineDofs.push(i);
  if (/pivot|waist|chest|lumbar/i.test(d.name)) spineDofs.push(i);
}
console.log(`spine 轴：${spineDofs.map((i) => `${w.body.dofs[i]!.name}/${w.body.dofs[i]!.axis}`).join(' ')}`);
let tLift = -1, nextMark = 0;
for (let s = 0; s < Math.round(14.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const liftNow = tLift < 0 && isLiftDone();
  if (liftNow) { tLift = t; nextMark = t; console.log(`★抬腿 t=${t.toFixed(2)}s`); }
  if (tLift >= 0 && t >= nextMark) {
    const roll = ctl.sensors.torsoTilt[1]! * DEG;
    const lat = ctl.sensors.com[2]! * 100;
    const parts = spineDofs.map((i) => {
      const d = w.body.dofs[i]!;
      const b = dr.lastBreakdown[i] ?? { act: 0, servo: 0, stiff: 0, damp: 0 };
      return `${d.name}/${d.axis}:角${(d.angle * DEG).toFixed(1)} 主${b.act.toFixed(0)} 伺${b.servo.toFixed(0)} 弹${b.stiff.toFixed(0)} 阻${b.damp.toFixed(0)}`;
    });
    console.log(`+${(t - tLift).toFixed(1)}s 躯滚=${roll.toFixed(1).padStart(5)}° 侧=${lat.toFixed(1).padStart(6)}cm | ${parts.join(' | ')}`);
    nextMark = Math.round((t + 0.1) * 100) / 100;
  }
  if (tLift >= 0 && t - tLift > 3.7) break;
}
