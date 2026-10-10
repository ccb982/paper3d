/** 临时：抬腿几何直读（世界位置） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const pos = (n: string) => { const b = w.body.bodies[w.body.indexByKey.get(n) ?? 0]!; return b.translation(); };
console.log('t     相位      髋R(支)y 膝R(支)y 髋L(摆)y 膝L(摆)y 脚L(摆)y 脚Lx');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.6 || t > 4.5) continue;
  if (s % Math.round(0.05 / w.dt) !== 0) continue;
  const hr = pos('hip_r'), kr = pos('knee_r'), hl = pos('hip_l'), kl = pos('knee_l'), fl = pos('foot_l');
  console.log(`${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${hr.y.toFixed(3)} ${kr.y.toFixed(3)} ${hl.y.toFixed(3)} ${kl.y.toFixed(3)} ${fl.y.toFixed(3)} ${fl.x.toFixed(3)}`);
}
