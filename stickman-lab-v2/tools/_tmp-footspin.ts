import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const fi = (w.body as any).indexByKey.get('foot_r')!;
console.log('t     支脚yaw°   ωy(转/秒)  ωx     ωz    脚fz    脚翻角°');
for (let s = 0; s < Math.round(5.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.4 || t > 4.8) continue;
  if (Math.round(t * 10) % 1 !== 0) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const b = w.body.bodies[fi]!;
  const q = b.rotation();
  const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) * 57.3;
  const wv = b.angvel();
  const dAnk = w.body.dofByName('foot_r', 0);
  console.log(`${t.toFixed(1)}  ${yaw.toFixed(1)}   ${wv.y.toFixed(2)}  ${wv.x.toFixed(1)}  ${wv.z.toFixed(1)}  ${ctl.sensors.feet[1]!.fz.toFixed(0)}N  ${(w.body.dofs[dAnk]!.angle * 57.3).toFixed(0)}`);
}
