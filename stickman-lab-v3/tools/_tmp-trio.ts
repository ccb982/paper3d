import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
let ankle = 0, thigh = 0, abs_ = 0;
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.2 || t > 4.4) continue;
  const tau = (n: string, ax: number) => {
    const di = w.body.dofByName(n, ax);
    if (di < 0) return 0;
    const bd = drive?.lastBreakdown?.[di] ?? { servo: 0, ff: 0, damp: 0 };
    return Math.abs(bd.servo + bd.ff + bd.damp);
  };
  ankle += (tau('foot_r', 2) + tau('foot_r', 0)) * w.dt;
  thigh += (tau('hip_r', 2) + tau('hip_r', 0) + tau('knee_r', 2)) * w.dt;
  abs_ += (tau('spine1', 0) + tau('spine2', 0) + tau('spine3', 0) + tau('spine1', 2) + tau('spine2', 2) + tau('spine3', 2)) * w.dt;
}
const tot = ankle + thigh + abs_;
console.log(`踝=${ankle.toFixed(1)} (${(ankle / tot * 100).toFixed(0)}%)  大腿=${thigh.toFixed(1)} (${(thigh / tot * 100).toFixed(0)}%)  腹肌=${abs_.toFixed(1)} (${(abs_ / tot * 100).toFixed(0)}%)  总=${tot.toFixed(1)} N·m·s`);
