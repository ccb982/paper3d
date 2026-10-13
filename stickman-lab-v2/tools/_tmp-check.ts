import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe } from '../src/core/servo/unified';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  if (s % 24 === 0 && s * w.dt > 3.2 && s * w.dt < 3.8) {
    const U = observe({ bal: ctl.warner, body: w.body, sensors: ctl.sensors } as any, 'r');
    console.log(`t=${(s * w.dt).toFixed(2)} tiltRel=${U.tiltRelDeg.toFixed(1)} pitchRel=${U.pitchRelDeg.toFixed(1)} worldOff=${(U.worldOffM * 100).toFixed(1)}cm`);
  }
}
