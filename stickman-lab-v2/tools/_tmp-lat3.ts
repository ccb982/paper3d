import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
const js: Array<[string, number]> = [['spine1', 0], ['hip_r', 0], ['foot_r', 0]];
const dis = js.map(([n, a]) => w.body.dofByName(n, a));
console.log('t      | ' + js.map(([n, a]) => `${n}/${a} 角°|servo|ff|damp`).join('  | '));
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.2 || t > 4.5) continue;
  if (Math.abs(t * 5 - Math.round(t * 5)) > 1e-6) continue;
  const row = dis.map((di) => {
    if (di < 0) return '--';
    const bd = drive?.lastBreakdown?.[di] ?? { servo: 0, ff: 0, damp: 0 };
    const ang = w.body.dofs[di]!.angle * 57.3;
    return `${ang.toFixed(1).padStart(6)}|${bd.servo.toFixed(0).padStart(5)}|${bd.ff.toFixed(0).padStart(4)}|${bd.damp.toFixed(0).padStart(5)}`;
  }).join('  | ');
  console.log(`${t.toFixed(1)}  | ${row}`);
}
