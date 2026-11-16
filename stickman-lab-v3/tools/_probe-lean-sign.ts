/** _probe-lean-sign.ts —— 躯干侧倾（spine1/2/3 轴0）→ CoM z 位移的符号与灵敏度
 *  用途：把 Mouchnino 稳定模式实现为"闭环侧倾调重心"前的标定。 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;

for (const tgt of [0, 0.08, -0.08]) {
  w.reset();
  const m = ctl.manual;
  let cz = 0, cx = 0;
  for (let s = 0; s < 480; s++) {
    m.setAngle('spine1', 0, tgt, 300, 30);
    m.setAngle('spine2', 0, tgt, 300, 30);
    m.setAngle('spine3', 0, tgt, 300, 30);
    m.setAngle('spine1', 2, tgt, 300, 30);
    m.setAngle('spine2', 2, tgt, 300, 30);
    m.setAngle('spine3', 2, tgt, 300, 30);
    w.advance(1);
    if (s > 300) { cz = ctl.sensors.com[2]!; cx = ctl.sensors.com[0]!; }
  }
  console.log(`spine=${tgt.toFixed(2).padStart(5)}  comZ=${cz.toFixed(4).padStart(8)}  comX=${cx.toFixed(4).padStart(8)}`);
}
