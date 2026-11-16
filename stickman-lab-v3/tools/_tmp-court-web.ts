/** _tmp-court-web.ts —— 网页法庭模块冒烟测试：完整复刻 main.ts 点击序列（含前置运行） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { courtSetup, courtInject, courtStep } from '../src/core/court';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const yL = (): number => (w.body.bodies[w.body.indexByKey.get('mfoot_l')!]!.translation() as { y: number }).y * 100;
const xL = (): number => (w.body.bodies[w.body.indexByKey.get('mfoot_l')!]!.translation() as { x: number }).x * 100;

// 前置：先跑 1 秒（模拟用户点击前的会话）
for (let s = 0; s < 240; s++) w.advance(1);
console.log(`前置运行后 脚高=${yL().toFixed(1)}cm`);

// ==== 复刻 main.ts 的 court 点击序列 ====
ctl.actions.abort();
ctl.manual.clear();
w.controller = ctl;
w.driveEnabled = true;
w.reset();
const st = courtSetup(w, ctl, 2.0);
console.log(`②③④后 脚高=${yL().toFixed(1)}cm 脚x=${xL().toFixed(1)}  com=(${(ctl.sensors.com[0]! * 100).toFixed(1)},${(ctl.sensors.com[2]! * 100).toFixed(1)})cm`);

for (let s = 0; s < Math.round(6 / w.dt); s++) {
  courtInject(w, ctl);
  w.advance(1);
  courtStep(w, ctl, st);
  if (s % 120 === 0) {
    console.log(`t=${st.t.toFixed(1)}s ${st.t < st.settle ? '静置(扶)' : '放开'} 脚高=${yL().toFixed(1)}cm com=(${(ctl.sensors.com[0]! * 100).toFixed(1)},${(ctl.sensors.com[2]! * 100).toFixed(1)})cm ${st.fall >= 0 ? `✗@${st.fall.toFixed(2)}s ${st.reason}` : '✓'}`);
  }
}
console.log(`判决：${st.fall < 0 ? '站住' : `倒下@${st.fall.toFixed(2)}s ${st.reason}`}`);
