/** _probe-push-ablate.ts —— 挺腰残余抖动（153）的通道消融（arch 220/40 基线） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function run(label: string, o: { pad?: boolean; tone?: number; grav?: boolean }): void {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: o.tone ?? 8 });
  if (o.grav === false) ctl.warner.opt.gravityComp = false;
  if (o.pad === false) ctl.padEnabled = false;
  w.controller = ctl;
  w.reset();
  ctl.actions.play('pushRise');
  const knee = w.body.dofByName('knee_l', 2);
  const foot = w.body.dofByName('foot_l', 2);
  const hf = [0, 0];
  const st = [0, 0, 0, 0];
  for (let s = 0; s < Math.round(2.6 / w.dt); s++) {
    w.advance(1);
    const t = s * w.dt;
    if (t < 1.2 || t >= 2.6) { st[0] = 0; st[1] = 0; st[2] = 0; st[3] = 0; continue; }
    const vk = w.body.dofs[knee]!.vel, vf = w.body.dofs[foot]!.vel;
    hf[0] += (vk - 2 * st[1] + st[0]) ** 2;
    hf[1] += (vf - 2 * st[3] + st[2]) ** 2;
    st[0] = st[1]; st[1] = vk; st[2] = st[3]; st[3] = vf;
  }
  const n = 0.4 * 240;
  console.log(`${label}: 膝HF=${(hf[0]! / n).toExponential(1)} 脚HF=${(hf[1]! / n).toExponential(1)}`);
}
run('基线            ', {});
run('垫脚关          ', { pad: false });
run('姿势关(tone0)   ', { tone: 0 });
run('重力补偿关      ', { grav: false });
run('全关(纯力键)    ', { pad: false, tone: 0, grav: false });
