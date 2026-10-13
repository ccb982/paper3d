import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
let lastPh = '';
const t0 = () => (s: number): string => (s * w.dt).toFixed(2);
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const ph = ctl.actions.status.phase ?? '?';
  if (ph !== lastPh) {
    const cz = (ctl.sensors.com[2]! - ctl.sensors.feet[1]!.z) * 100;
    const tilt = (ctl.sensors.torsoTilt[1]! * 57.3);
    const vz = (ctl.sensors.comVel?.[2] ?? 0) * 100;
    console.log(`${t0()(s)}s ${lastPh}\u2192${ph}: CoMz=${cz.toFixed(1)}cm tilt=${tilt.toFixed(1)}\u00b0 CoMvz=${vz.toFixed(1)}cm/s`);
    lastPh = ph;
  }
  if (ph === 'B\u62ac\u817f') {
    const el = s - Math.round(0);
    void el;
  }
}
