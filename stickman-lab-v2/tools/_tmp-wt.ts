import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
console.log('t | 节 | 活 | 伺 | ff | 阻 | 弹 | 角度');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 3.2 && t < 3.6 && s % 12 === 0) {
    for (const nm of ['spine1', 'spine2', 'spine3']) {
      for (const ax of [0, 2]) {
        const di = body.dofByName(nm, ax);
        const b = ctl.warner.drive.lastBreakdown[di] as any;
        const d = body.dofs[di];
        if (b && (Math.abs(b.act) + Math.abs(b.servo) + Math.abs(b.ff) + Math.abs(b.damp) + Math.abs(b.stiff)) > 5) {
          console.log(`${t.toFixed(2)} | ${nm}/${ax} | ${b.act.toFixed(0)} | ${b.servo.toFixed(0)} | ${b.ff.toFixed(0)} | ${b.damp.toFixed(0)} | ${b.stiff.toFixed(0)} | ${(d.angle * 57.3).toFixed(1)}`);
        }
      }
    }
  }
}
