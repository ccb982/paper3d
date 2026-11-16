/** _probe-liftoff-tq: ALL-joint net torque matrix aligned to liftoff. 30ms. */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const W = body.sk.massTotal * 9.81;
const J: Array<[string, string, number]> = [
  ['支髋0', 'hip_r', 0], ['支髋2', 'hip_r', 2], ['支膝', 'knee_r', 2], ['支踝0', 'foot_r', 0], ['支踝2', 'foot_r', 2],
  ['摆髋0', 'hip_l', 0], ['摆髋2', 'hip_l', 2], ['摆膝', 'knee_l', 2],
  ['脊1/0', 'spine1', 0], ['脊1/2', 'spine1', 2], ['脊2/2', 'spine2', 2], ['脊3/2', 'spine3', 2],
  ['肩L', 'shoulder_l', 2], ['肩R', 'shoulder_r', 2],
];
const net = (i: number) => { const b = w.drive.lastBreakdown[i]!; return b.stiff + b.itb + b.lum + b.act + b.servo + b.ff + b.damp; };
let t0 = -1;
console.log('τ矩阵(N·m，削掉±5以下为0)： ' + J.map(([n]) => n.padStart(6)).join(''));
for (let s = 0; s < Math.round(4.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const fl = ctl.sensors.feet[0]!;
  if (t0 < 0 && fl.fz < 0.05 * W && t > 3.2) t0 = t;
  if (t0 < 0 || Math.abs(t - t0) > 0.33) continue;
  if (s % Math.round(0.03 / w.dt) !== 0) continue;
  const dx = t - t0;
  const vals = J.map(([, jn, ax]) => { const i = body.dofByName(jn, ax); if (i < 0) return '     -'; const v = net(i); return (Math.abs(v) < 5 ? '' : v.toFixed(0)).padStart(6); });
  console.log(`${dx >= 0 ? '+' : ''}${dx.toFixed(2)}  ${vals.join('')}   骨盆滚${(ctl.sensors.torsoTilt[1]! * 180 / Math.PI).toFixed(0)}°`);
}
