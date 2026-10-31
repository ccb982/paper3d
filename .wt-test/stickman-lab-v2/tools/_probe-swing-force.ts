/** _probe-swing-force —— 摆动脚完整受力（用户要求：找出让全身侧翻的极大力的来源）。
 *  读：摆动脚 fz(总法向)/fz%/CoP 位置/脚体速度(横向/垂直)；支撑脚 fz；骨盆滚转。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const fi = body.indexByKey.get('foot_l') ?? -1;
let lastV = { x: 0, y: 0, z: 0 };
let first = true;
console.log('t     相位      脚y    fz(N)  fz%W   CoPx   CoPz   vx     vy     vz     ax(Δv/dt)   支fz%  骨盆滚°');
for (let s = 0; s < Math.round(6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const f = ctl.sensors.feet[0]!;
  const v = body.bodies[fi]!.linvel();
  if (!first && t > 3.9 && t < 5.0 && (s % Math.round(0.04 / w.dt) === 0)) {
    const W = body.sk.massTotal * 9.81;
    const ax = (v.x - lastV.x) / w.dt, ay = (v.y - lastV.y) / w.dt, az = (v.z - lastV.z) / w.dt;
    const mag = Math.hypot(ax, ay, az);
    console.log(
      `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${f.y.toFixed(3)} ${f.fz.toFixed(0).padStart(6)} ${(f.fz / W * 100).toFixed(0).padStart(5)}  ${f.copX.toFixed(3).padStart(6)} ${f.copZ.toFixed(3).padStart(6)}  ` +
      `${v.x.toFixed(1).padStart(5)} ${v.y.toFixed(1).padStart(6)} ${v.z.toFixed(1).padStart(6)}  ${mag.toFixed(0).padStart(7)} m/s²  ${(ctl.sensors.feet[1]!.fz / W * 100).toFixed(0).padStart(5)}  ${(ctl.sensors.torsoTilt[1]! * 180 / Math.PI).toFixed(1).padStart(6)}`,
    );
  }
  lastV = { x: v.x, y: v.y, z: v.z };
  first = false;
}
