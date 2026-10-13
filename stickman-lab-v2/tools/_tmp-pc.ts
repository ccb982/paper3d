import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
console.log('spine1 dof0 =', body.dofByName('spine1', 0), ' spine2 dof0 =', body.dofByName('spine2', 0), ' spine3 dof0 =', body.dofByName('spine3', 0));
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
}
const dr = ctl.warner.drive as any;
for (const sn of ['spine1', 'spine2', 'spine3']) {
  console.log(sn, 'pinned=', ctl.warner.manual.isPinned(sn, 0));
  const di = body.dofByName(sn, 0);
  console.log(sn, 'di=', di, 'pairC=', dr.pairC ? dr.pairC[di] : 'n/a', 'pairRef=', dr.pairRef ? (dr.pairRef[di] ?? 0).toFixed(3) : 'n/a');
}
