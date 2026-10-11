import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const pi = (w.body as any).indexByKey.get('pelvis') ?? 6;
const q2e = (q: { x: number; y: number; z: number; w: number }) => {
  const s = Math.sqrt(1 + 2 * (q.w * q.y - q.x * q.z)) * 2;
  return {
    roll: Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y)) * 57.3,
    pitch: Math.asin(Math.max(-1, Math.min(1, 2 * (q.w * q.z - q.x * q.y)))) * 57.3,
    yaw: Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) * 57.3,
  };
};
console.log('t      骨盆roll  pitch   YAW     躯干yaw  摆腿yaw  支脚yaw');
for (let s = 0; s < Math.round(5.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.4 || t > 5.0) continue;
  if (Math.round(t * 10) % 1 !== 0) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const p = q2e(w.body.bodies[pi]!.rotation());
  const sp2 = q2e(w.body.bodies[(w.body as any).indexByKey.get('spine2')!]!.rotation());
  const thL = q2e(w.body.bodies[(w.body as any).indexByKey.get('thigh_l')!]!.rotation());
  const ft = q2e(w.body.bodies[(w.body as any).indexByKey.get('foot_r')!]!.rotation());
  console.log(`${t.toFixed(1)}  ${p.roll.toFixed(0).padStart(7)} ${p.pitch.toFixed(0).padStart(6)} ${p.yaw.toFixed(1).padStart(8)} ${sp2.yaw.toFixed(1).padStart(8)} ${thL.yaw.toFixed(1).padStart(8)} ${ft.yaw.toFixed(1).padStart(8)}`);
}
