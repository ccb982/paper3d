import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
// 力链直率表：CoM 重力线（竖直）到各关节/段中心的水平距离 + 体重矩 + 占用率
const segs: Array<[string, string]> = [['foot_r','足'], ['shin_r','小腿'], ['thigh_r','大腿'], ['torso','骨盆段'], ['spine2','腰'], ['spine3','腰上'], ['spine4','胸'], ['head','头']];
let mode = 0;
for (let s = 0; s < Math.round(3.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.75 && mode === 0) {
    mode = 1;
    console.log('力链直率表 @t=' + t.toFixed(2) + '（CoM 重力线至各节中心的水平距）');
    const com = [ctl.sensors.com[0]!, ctl.sensors.com[1]!, ctl.sensors.com[2]!];
    const W = body.sk.massTotal * 9.81;
    for (const [k, nm] of segs) {
      const ix = body.indexByKey.get(k);
      if (ix === undefined) { console.log(nm + ': (无此体)'); continue; }
      const p = body.bodies[ix].translation();
      const d = Math.hypot(p.x - com[0], p.z - com[2]) * 100;
      console.log(`${nm.padEnd(4)} d=${d.toFixed(1)}cm  重力矩估=${(W * d / 100).toFixed(0)}·N·m档`);
    }
  }
}
