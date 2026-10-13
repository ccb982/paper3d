import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe as obs } from '../src/core/servo/unified';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
let liftT = -1, firstBreach = -1, inBox = 0, since = -1;
const DT = w.dt;
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const U = obs({ bal: ctl.warner, body: w.body, sensors: ctl.sensors } as any, 'r');
  const ok = Math.abs(U.pitchRelDeg) <= 20 && Math.abs(U.tiltRelDeg) <= 10;
  if (liftT < 0 && ctl.warner.drive.legReflex.side !== null) { liftT = t; since = t; }
  if (liftT >= 0) {
    if (ok) { inBox += DT; if (since < 0) since = t; }
    else {
      if (firstBreach < 0) { firstBreach = t; console.log(`首次破框 t=${t.toFixed(2)} pitch=${U.pitchRelDeg.toFixed(1)} tilt=${U.tiltRelDeg.toFixed(1)}`); }
      since = -1;
    }
  }
}
console.log(`【框内总时长】${inBox.toFixed(2)}s | 抬脚=${liftT.toFixed(2)} | 首次破=${firstBreach > 0 ? (firstBreach - liftT).toFixed(2) : 'never'}`);
