import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
const tau = (n: string, ax: number): number => {
  const di = w.body.dofByName(n, ax);
  if (di < 0) return 0;
  const b = drive?.lastBreakdown?.[di] ?? {};
  return (b.stiff ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.act ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0);
};
console.log('t | CoM_y | vy | 支膝τ | 支髋τ | 支踝τ | 支fz | 摆fz');
for (let s = 0; s < Math.round(2.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.05 || t > 2.45) continue;
  if (s % 3 !== 0) continue;
  const fr = ctl.sensors.feet[1]!, fl = ctl.sensors.feet[0]!;
  console.log(`${t.toFixed(3)} | ${ctl.sensors.com[1]!.toFixed(4)} | ${ctl.sensors.comVel[1]!.toFixed(3).padStart(6)} | ${tau('knee_r', 2).toFixed(0).padStart(5)} | ${tau('hip_r', 2).toFixed(0).padStart(5)} | ${tau('foot_r', 2).toFixed(0).padStart(5)} | ${fr.fz.toFixed(0).padStart(5)} | ${fl.fz.toFixed(0).padStart(4)}`);
}
