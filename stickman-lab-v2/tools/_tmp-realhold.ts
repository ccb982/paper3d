import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
// 实际保持 = 摆腿 fz<5%W 且支撑 fz>50%W 的持续时间（不管相位机说什么）
const W = w.body.sk.massTotal * 9.81;
let realT = 0, phT = 0, maxReal = 0, cur = 0;
let lastPh = '';
console.log('t      摆腿fz 支撑fz  实际单腿?  相位');
for (let s = 0; s < Math.round(7.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
  const real = fl.fz < 0.05 * W && fr.fz > 0.5 * W;
  const ph = ctl.actions.status.phase ?? '?';
  if (real) { realT += w.dt; cur += w.dt; if (cur > maxReal) maxReal = cur; } else cur = 0;
  if (ph === 'C保持') phT += w.dt;
  if (ph !== lastPh && t > 2) { console.log(`--- 相位→${ph} @${t.toFixed(2)}s (实际单腿累计=${realT.toFixed(2)}s)`); lastPh = ph; }
  if (t > 3.4 && t < 5.6 && Math.abs(t * 5 - Math.round(t * 5)) < 1e-6) {
    console.log(`${t.toFixed(1)} ${fl.fz.toFixed(0).padStart(7)} ${fr.fz.toFixed(0).padStart(7)}  ${real ? '是' : '否'}       ${ph}`);
  }
}
console.log(`\n相位机C保持=${phT.toFixed(2)}s  实际单腿累计=${realT.toFixed(2)}s  最长连续实际=${maxReal.toFixed(2)}s`);
