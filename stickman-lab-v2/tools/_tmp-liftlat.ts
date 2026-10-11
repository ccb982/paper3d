import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const diAbL = w.body.dofByName('hip_l', 0);
const diAbR = w.body.dofByName('hip_r', 0);
console.log('t      comZ     vz      az(raw)   摆L髋ab角/torque   支R髋ab角    骨盆滚°');
let prevVz = 0;
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.05 || t > 3.95) { prevVz = ctl.sensors.comVel[2]!; continue; }
  if (Math.round(t * 20) % 2 !== 0) { prevVz = ctl.sensors.comVel[2]!; continue; }
  const vz = ctl.sensors.comVel[2]!, az = (vz - prevVz) / w.dt;
  prevVz = vz;
  const dL = w.body.dofs[diAbL]!, dR = w.body.dofs[diAbR]!;
  const tq = (i: number) => { const e = (w.executor as any); return typeof e?.lastTorque === 'function' ? e.lastTorque(i) : 0; };
  const pi = (w.body as any).indexByKey.get('pelvis') ?? (w.body as any).indexByKey.get('pelvis_body') ?? 6;
  const q = w.body.bodies[pi >= 0 ? pi : 6]!.rotation();
  const roll = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)) * 57.3;
  console.log(`${t.toFixed(3)}  ${ctl.sensors.com[2]!.toFixed(3)}  ${vz.toFixed(3)}  ${az.toFixed(1)}   swingL ${(dL.angle * 57.3).toFixed(1)}°   supR ${(dR.angle * 57.3).toFixed(1)}°   ${roll.toFixed(0)}`);
}
