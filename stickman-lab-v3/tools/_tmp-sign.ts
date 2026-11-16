import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
for (let s = 0; s < Math.round(1.2 / w.dt); s++) w.advance(1);
const body = w.body as any;
const manual = (ctl as any).warner.manual;
const df = body.dofByName('foot_r', 0);
// 基准 CoP
const cop0 = ctl.sensors.feet[1]!.copZ;
// 加 +30 N·m 到 foot_r/0，看 CoP 移向
for (let s = 0; s < Math.round(0.4 / w.dt); s++) { manual.setTorque('foot_r', 0, 30); w.advance(1); }
const cop1 = ctl.sensors.feet[1]!.copZ;
// 清零后再试 -30
for (let s = 0; s < Math.round(0.4 / w.dt); s++) { manual.setTorque('foot_r', 0, 0); w.advance(1); }
const cop2 = ctl.sensors.feet[1]!.copZ;
for (let s = 0; s < Math.round(0.4 / w.dt); s++) { manual.setTorque('foot_r', 0, -30); w.advance(1); }
const cop3 = ctl.sensors.feet[1]!.copZ;
console.log('CoP 基准=' + (cop0 * 100).toFixed(2) + 'cm（相对足中心 ' + ((cop0 - ctl.sensors.feet[1]!.z) * 100).toFixed(2) + '）');
console.log('+30N·m 后 CoP=' + ((cop1 - ctl.sensors.feet[1]!.z) * 100).toFixed(2) + 'cm  Δ=' + ((cop1 - cop0) * 100).toFixed(2));
console.log('归零后 CoP=' + ((cop2 - ctl.sensors.feet[1]!.z) * 100).toFixed(2) + 'cm');
console.log('-30N·m 后 CoP=' + ((cop3 - ctl.sensors.feet[1]!.z) * 100).toFixed(2) + 'cm  Δvs归零=' + ((cop3 - cop2) * 100).toFixed(2));
void df;
