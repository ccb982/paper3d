import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
console.log('t | CoMz cm | CoM速 | CoPz cm | 内缘 cm | 反转矩余量 N·m');
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.6 && s % 24 === 0) {
    const f = ctl.sensors.feet[1]!;
    const W = body.sk.massTotal * 9.81;
    const comZ = ctl.sensors.com[2]!;
    const copZ = f.copZ;
    const medEdge = f.z + 0.045;   // 右脚内侧缘（+z侧）
    const medRest = f.fz * (medEdge - comZ);   // 向内侧可用的恢复矩
    console.log(`${t.toFixed(2)} | ${((comZ - f.z) * 100).toFixed(1)} | ${((ctl.sensors.comVel[2] ?? 0) * 100).toFixed(0)} | ${((copZ - f.z) * 100).toFixed(1)} | ${((medEdge - f.z) * 100).toFixed(1)} | ${medRest.toFixed(0)} (${(medRest / W * 100).toFixed(1)}%Wm)`);
  }
}
