import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.5 && s % 48 === 0) {
    const m = ctl.warner.manual as any;
    console.log(`${t.toFixed(2)} | sp1/2 pinned=${m.isPinned('spine1',2)} sp2/2=${m.isPinned('spine2',2)} sp3/2=${m.isPinned('spine3',2)} hip_r/2=${m.isPinned('hip_r',2)}`);
  }
}
