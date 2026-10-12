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
console.log('t | 支撑fz | 摆fz | CoM_y | CoM_vy | 支膝R角 | 支踝R角 | 支膝τ');
const drive = (w as any).drive ?? (ctl as any).drive;
const tau = (n: string, ax: number): number => {
  const di = w.body.dofByName(n, ax);
  if (di < 0) return 0;
  const b = drive?.lastBreakdown?.[di] ?? {};
  return (b.stiff ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.act ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0);
};
for (let s = 0; s < Math.round(2.9 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 1.6 || t > 2.85) continue;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;
  const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
  console.log(`${t.toFixed(2)} | ${fr.fz.toFixed(0).padStart(5)} | ${fl.fz.toFixed(0).padStart(4)} | ${ctl.sensors.com[1]!.toFixed(3)} | ${ctl.sensors.comVel[1]!.toFixed(2).padStart(5)} | ${g('knee_r', 2).toFixed(1).padStart(6)} | ${g('foot_r', 2).toFixed(1).padStart(6)} | ${tau('knee_r', 2).toFixed(0).padStart(5)}`);
}
