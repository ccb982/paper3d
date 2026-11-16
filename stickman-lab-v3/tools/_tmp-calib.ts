import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
// 静立双脚
console.log('== 双脚静立：CoM vs CoP ==');
console.log('t | CoM(z,x) cm | L CoP(z,x) | R CoP(z,x) | fz总/W');
for (let s = 0; s < Math.round(2.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (s % 120 === 0 && t > 0.5) {
    const W = (w.body as any).sk.massTotal * 9.81;
    const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
    console.log(`${t.toFixed(1)} | ${(ctl.sensors.com[2]! * 100).toFixed(1)},${(ctl.sensors.com[0]! * 100).toFixed(1)} | ${(fl.copZ * 100).toFixed(1)},${(fl.copX * 100).toFixed(1)} | ${(fr.copZ * 100).toFixed(1)},${(fr.copX * 100).toFixed(1)} | ${((fl.fz + fr.fz) / W * 100).toFixed(0)}%`);
  }
}
// 单腿：操作下动态（看 CoP 跟随 CoM）
ctl.actions.play('singleLegR');
console.log('== 单腿（转移后）：CoM vs R CoP ==');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (s % 60 === 0 && t > 2.6) {
    const fr = ctl.sensors.feet[1]!;
    console.log(`${t.toFixed(2)} | CoM(z,x)=${(ctl.sensors.com[2]! * 100).toFixed(1)},${(ctl.sensors.com[0]! * 100).toFixed(1)} | RCoP=${(fr.copZ * 100).toFixed(1)},${(fr.copX * 100).toFixed(1)} | fzR=${(fr.fz / ((w.body as any).sk.massTotal * 9.81) * 100).toFixed(0)}%`);
  }
}
