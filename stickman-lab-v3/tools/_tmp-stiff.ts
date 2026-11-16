import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const dr = ctl.warner.drive as any;
console.log('K=' + dr.opt.musclePairK + ' Damp=' + dr.opt.musclePairDamp + ' iap=' + dr.opt.iapSpineStiffness + ' lumbar=' + dr.opt.lumbarPassiveStiffness);
console.log('t | hip2 C/刚度 | sp1 C/刚度 | sp2 C | sp3 C | hip2角 | sp世界pitch');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const K = dr.opt.musclePairK;
    const c2 = dr.pairC[body.dofByName('hip_r',2)] ?? 0;
    const c1 = dr.pairC[body.dofByName('spine1',2)] ?? 0;
    const c3 = dr.pairC[body.dofByName('spine2',2)] ?? 0;
    const c4 = dr.pairC[body.dofByName('spine3',2)] ?? 0;
    const ixT = body.indexByKey.get('spine3'); const q = body.bodies[ixT].rotation();
    const ux = 2*(q.x*q.y-q.w*q.z), uy = 1-2*(q.x*q.x+q.z*q.z);
    const pw = Math.atan2(-ux, uy)*57.3;
    console.log(`${t.toFixed(2)} | ${c2.toFixed(2)}/${(K*c2).toFixed(0)} | ${c1.toFixed(2)}/${(K*c1).toFixed(0)} | ${c3.toFixed(2)} | ${c4.toFixed(2)} | ${((body.dofs[body.dofByName('hip_r',2)]?.angle??0)*57.3).toFixed(0)} | ${pw.toFixed(1)}`);
  }
}
