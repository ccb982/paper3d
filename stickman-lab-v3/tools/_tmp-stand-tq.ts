/** _tmp-stand-tq.ts —— 正常站立（双脚静态）各关节力矩读数（用户："读一下正常站着的时候的各个关节力矩"）
 *  流程：新世界 → 控制器照常（站姿基线）→ 3s → 打印每关节 应用/需求gc/角度 + 双脚 fz。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
for (let s = 0; s < Math.round(3.0 / w.dt); s++) w.advance(1);

const gc = new Float64Array(w.body.dofs.length);
w.body.gravityComp(gc, w.world.gravity.y);
console.log('【正常站立·3s 末帧】关节 | 应用(总账) | 需求gc | 角度');
for (const d of w.body.dofs) {
  if (d.engineMotor) {
    console.log(`  ${`${d.name}/${d.axis}`.padEnd(10)} 电机τest=${(d.motorTqEst ?? 0).toFixed(1).padStart(7)}  角=${(d.angle * 57.29578).toFixed(1)}°`);
    continue;
  }
  const app = w.executor.appliedOf(d.dofIndex);
  console.log(`  ${`${d.name}/${d.axis}`.padEnd(10)} 应用=${app.toFixed(1).padStart(7)}  需求=${gc[d.dofIndex]!.toFixed(1).padStart(7)}  角=${(d.angle * 57.29578).toFixed(1)}°`);
}
const com = ctl.sensors.com;
console.log(`CoM=(${(com[0]! * 100).toFixed(1)}, ${(com[1]! * 100).toFixed(1)}, ${(com[2]! * 100).toFixed(1)})cm  脚fz L=${ctl.sensors.feet[0]!.fz.toFixed(0)} R=${ctl.sensors.feet[1]!.fz.toFixed(0)}`);
