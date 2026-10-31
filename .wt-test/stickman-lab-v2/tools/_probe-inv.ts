/** _probe-inv.ts —— 踝内外翻侧向力测试：全幅 copSide=0.10 步进，比较阻尼 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function run(label: string, damp: number, copSide: number): void {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  ctl.warner.opt.leanSign = 0;                 // 隔离：只测垫脚侧向
  ctl.warner.opt.bendSign = 0;
  ctl.pad.opt.copSide = copSide;
  ctl.pad.opt.invDamp = damp;
  w.controller = ctl;
  w.reset();
  const W = w.sk.massTotal * 9.81;
  const inv = w.body.dofByName('foot_l', 0);
  for (let s = 0; s < Math.round(0.6 / w.dt); s++) w.advance(1);
  ctl.pad.auto = false;
  ctl.pad.setTarget('l', 0, copSide);
  ctl.pad.setTarget('r', 0, copSide);
  let maxVel = 0, maxRoll = 0;
  const trace: string[] = [];
  for (let s = 0; s < Math.round(1.6 / w.dt); s++) {
    w.advance(1);
    const v = Math.abs(w.body.dofs[inv]!.vel);
    const r = Math.abs(w.body.dofs[inv]!.angle);
    if (v > maxVel) maxVel = v;
    if (r > maxRoll) maxRoll = r;
    if (s % 24 === 0) trace.push(`t=${(s * w.dt).toFixed(2)} 脚角=${w.body.dofs[inv]!.angle.toFixed(2)} ω=${w.body.dofs[inv]!.vel.toFixed(1)} FzL=${(ctl.sensors.feet[0]!.fz / W * 100).toFixed(0)}%`);
  }
  console.log(`${label}：${trace.slice(6, 18).join(' ')}`);
  console.log(`   峰值 |ω|=${maxVel.toFixed(1)} rad/s  |脚角|=${maxRoll.toFixed(2)} rad  末FzL=${(ctl.sensors.feet[0]!.fz / W * 100).toFixed(0)}%`);
}

run('阻尼0  侧向2cm ', 0, 0.02);
run('阻尼0  侧向10cm', 0, 0.10);
run('阻尼4  侧向10cm', 4, 0.10);
run('阻尼10 侧向10cm', 10, 0.10);
