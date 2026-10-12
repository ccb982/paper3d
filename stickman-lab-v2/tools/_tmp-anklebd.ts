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
console.log('t     角度°    vel   | stiff   itb    lum    act    servo   ff    damp  | 合计');
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.2 || t > 4.5) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const bd = drive?.lastBreakdown?.[di];
  const a = w.body.dofs[di]!.angle * 57.3;
  const v = w.body.dofs[di]!.vel;
  if (!bd) { console.log(`${t.toFixed(1)}  no breakdown`); continue; }
  const sum = bd.stiff + bd.itb + bd.lum + bd.act + bd.servo + bd.ff + bd.damp;
  console.log(`${t.toFixed(1)} ${a.toFixed(1).padStart(6)} ${v.toFixed(2).padStart(6)} | ${bd.stiff.toFixed(1).padStart(6)} ${bd.itb.toFixed(1).padStart(6)} ${bd.lum.toFixed(1).padStart(6)} ${bd.act.toFixed(1).padStart(6)} ${bd.servo.toFixed(1).padStart(6)} ${bd.ff.toFixed(1).padStart(5)} ${bd.damp.toFixed(1).padStart(6)} | ${sum.toFixed(1)}`);
}
