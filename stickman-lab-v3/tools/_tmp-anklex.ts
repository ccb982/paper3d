import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
const di = w.body.dofByName('foot_r', 2);
const d = w.body.dofs[di]!;
console.log('t     踝角°(限位-38~30)  vel   | servo  ff   damp | 合计  | 支撑fz  CoPx');
d as unknown;
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.8 || t > 4.2) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const bd = drive?.lastBreakdown?.[di] ?? { servo: 0, ff: 0, damp: 0 };
  const sum = bd.servo + bd.ff + bd.damp;
  const ang = d.angle * 57.3;
  const limit = ang <= -37.9 ? '※限位' : ang >= 29.9 ? '※限位' : '';
  const f = ctl.sensors.feet[1]!;
  console.log(`${t.toFixed(1)} ${ang.toFixed(1).padStart(10)}${limit.padEnd(5)} ${d.vel.toFixed(2).padStart(5)} | ${bd.servo.toFixed(0).padStart(5)} ${bd.ff.toFixed(0).padStart(4)} ${bd.damp.toFixed(0).padStart(5)} | ${sum.toFixed(0).padStart(5)} | ${f.fz.toFixed(0).padStart(5)} ${f.copX.toFixed(3)}`);
}
