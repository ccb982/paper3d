import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
(globalThis as any).__PB_OFF = 1;   // 禁用 pelvisBearing 实验
ctl.actions.play('singleLegR');
const body = (w.body as any);
const torsoIdx = body.indexByKey.get('torso');
const thighIdx = body.indexByKey.get('thigh_r');
console.log('t     躯干pitch° 躯干roll° | 大腿_r pitch° | 支撑髋角° | 髋外展° | 胸高');
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.0 || t > 4.5) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const euler = (idx: number) => {
    const q = body.bodies[idx].rotation();
    const pitch = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y)) * 57.3;
    const roll = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y)) * 57.3;
    return { pitch, roll };
  };
  const te = euler(torsoIdx);
  const th = euler(thighIdx);
  const g = (n: string, ax: number) => { const di = w.body.dofByName(n, ax); return di >= 0 ? w.body.dofs[di]!.angle * 57.3 : 0; };
  console.log(`${t.toFixed(1)} ${te.pitch.toFixed(1).padStart(9)} ${te.roll.toFixed(1).padStart(8)} | ${th.pitch.toFixed(1).padStart(11)} | ${g('hip_r', 2).toFixed(1).padStart(9)} | ${g('hip_r', 0).toFixed(1).padStart(7)} | ${ctl.sensors.com[1]!.toFixed(3)}`);
}
