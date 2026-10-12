import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t     支撑膝°  支撑髋°  支撑踝° | 膝目标°  膝τ    胸高');
const drive = (w as any).drive ?? (ctl as any).drive;
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.0 || t > 4.2) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const g = (n: string, ax: number) => { const di = w.body.dofByName(n, ax); return di >= 0 ? w.body.dofs[di]!.angle * 57.3 : 0; };
  const di = w.body.dofByName('knee_r', 2);
  const kt = di >= 0 ? drive?.target?.[di] : NaN;
  const bd = drive?.lastBreakdown?.[di] ?? { servo: 0, ff: 0, damp: 0 };
  const sum = bd.servo + bd.ff + bd.damp;
  console.log(`${t.toFixed(1)} ${g('knee_r', 2).toFixed(1).padStart(8)} ${g('hip_r', 2).toFixed(1).padStart(8)} ${g('foot_r', 2).toFixed(1).padStart(8)} | ${(Number.isNaN(kt) ? 'NaN' : (kt * 57.3).toFixed(1)).padStart(8)} ${sum.toFixed(0).padStart(6)} ${ctl.sensors.com[1]!.toFixed(3)}`);
}
