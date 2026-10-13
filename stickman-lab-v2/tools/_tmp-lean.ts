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
console.log('t | 髇R0实 | pairRef(hip0) | sp1实 | pairRef(sp1) | comZ | comVz');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const dh = body.dofByName('hip_r', 0);
    const ds = body.dofByName('spine1', 0);
    console.log(`${t.toFixed(2)} | ${((body.dofs[dh]?.angle??0)*57.3).toFixed(0).padStart(5)} | ${((dr.pairRef[dh]??0)*57.3).toFixed(1).padStart(6)} | ${((body.dofs[ds]?.angle??0)*57.3).toFixed(1).padStart(5)} | ${((dr.pairRef[ds]??0)*57.3).toFixed(1).padStart(6)} | ${(ctl.sensors.com[2]!*100).toFixed(1).padStart(6)} | ${(ctl.sensors.comVel[2]!*100).toFixed(0).padStart(4)}`);
  }
}
