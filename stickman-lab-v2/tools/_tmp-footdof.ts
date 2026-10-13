import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const b = w.body as any;
for (const ax of [0,1,2]) console.log('foot_r axis', ax, '=', b.dofByName('foot_r', ax));
for (const ax of [0,1,2]) console.log('spine1 axis', ax, '=', b.dofByName('spine1', ax));
// pairCap 现状
const dr = ctl.warner.drive as any;
console.log('pairCap foot_r/0 =', dr.pairCap[b.dofByName('foot_r',0)]);
console.log('pairCap spine1/1 =', dr.pairCap[b.dofByName('spine1',1)]);
console.log('pairCap spine1/0 =', dr.pairCap[b.dofByName('spine1',0)]);
