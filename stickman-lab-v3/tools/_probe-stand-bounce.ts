/**
 * _probe-stand-bounce.ts —— 站立稳态竖向振荡诊断
 * 量拍长/幅值：胸高、com y、双脚 Fz、膝/髋角度细采样
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();

const chest = () => w.body.bodies[w.body.indexByKey.get('spine4') ?? 0]!.translation().y;
const ka = w.body.dofByName('knee_l', 2);
const ha = w.body.dofByName('hip_l', 2);
let minC = Infinity, maxC = -Infinity;
const W = w.sk.massTotal * 9.81;
for (let s = 0; s < Math.round(6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const cy = chest();
  if (t > 4) { minC = Math.min(minC, cy); maxC = Math.max(maxC, cy); }
  if (t > 4.5 && s % 12 === 0) {
    console.log(
      `t=${t.toFixed(2)} 胸=${cy.toFixed(4)} 膝=${w.body.dofs[ka]!.angle.toFixed(3)} 髋=${w.body.dofs[ha]!.angle.toFixed(3)}` +
      ` Lfz=${(ctl.sensors.feet[0]!.fz / W * 100).toFixed(0)}% Rfz=${(ctl.sensors.feet[1]!.fz / W * 100).toFixed(0)}%`
    );
  }
}
console.log(`4-6s 胸高峰峰=${((maxC - minC) * 1000).toFixed(1)}mm`);
