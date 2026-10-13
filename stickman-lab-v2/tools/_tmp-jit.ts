import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
console.log('t | spine1/0 vel | spine1/0 ang | spine2/0 vel | servo(sp1/sp2/sp3) | act(pair)');
for (let s = 0; s < Math.round(3.8 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.9 && s % 12 === 0) {
    const d1 = body.dofs[body.dofByName('spine1', 0)];
    const d2 = body.dofs[body.dofByName('spine2', 0)];
    const b1 = ctl.warner.drive.lastBreakdown[body.dofByName('spine1', 0)] as any;
    const b2 = ctl.warner.drive.lastBreakdown[body.dofByName('spine2', 0)] as any;
    const b3 = ctl.warner.drive.lastBreakdown[body.dofByName('spine3', 0)] as any;
    console.log(`${t.toFixed(2)} | ${d1.vel.toFixed(1)} | ${(d1.angle*57.3).toFixed(1)} | ${d2.vel.toFixed(1)} | ${(b1?.servo||0).toFixed(0)}/${(b2?.servo||0).toFixed(0)}/${(b3?.servo||0).toFixed(0)} | ${(b1?.act||0).toFixed(0)}/${(b2?.act||0).toFixed(0)}/${(b3?.act||0).toFixed(0)}`);
  }
}
