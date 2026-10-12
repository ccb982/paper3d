import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const g = (n: string, ax: number): number => {
  const i = w.body.dofByName(n, ax);
  return i >= 0 ? w.body.dofs[i]!.angle * 57.3 : NaN;
};
const drive = (w as any).drive ?? (ctl as any).drive;
const tau = (n: string, ax: number): number => {
  const di = w.body.dofByName(n, ax);
  if (di < 0) return 0;
  const b = drive?.lastBreakdown?.[di] ?? {};
  return (b.stiff ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.act ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0);
};
console.log('t | 摆髋L屈 | 摆膝L折 | 抬腿角速度°/s | 支髋R(伸展-)τ | 支膝R τ | 支踝R τ | 支fz | 摆fz');
let pq = 0;
for (let s = 0; s < Math.round(3.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.25 || t > 3.45) continue;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;
  const hipL = g('hip_l', 2);
  const vq = (hipL - pq) * 20; pq = hipL;
  const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
  console.log(`${t.toFixed(2)} | ${hipL.toFixed(0).padStart(6)} | ${g('knee_l', 2).toFixed(0).padStart(6)} | ${vq.toFixed(0).padStart(6)} | ${tau('hip_r', 2).toFixed(0).padStart(6)} | ${tau('knee_r', 2).toFixed(0).padStart(5)} | ${tau('foot_r', 2).toFixed(0).padStart(5)} | ${fr.fz.toFixed(0).padStart(5)} | ${fl.fz.toFixed(0).padStart(4)}`);
}
