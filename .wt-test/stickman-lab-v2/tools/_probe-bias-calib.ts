import './_boot';
import fs from 'node:fs';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const OUT = process.env.CALIB_OUT ?? 'bias_calib.csv';
const biases = [-0.004, -0.002, 0, 0.002, 0.004];
const impulses = [-5, -2, 0, 2, 5];
const rows: string[] = ['bias,e0,v0,roll0,headMean,trunkMean'];
for (const b of biases) {
  for (const imp of impulses) {
    process.env.SQC_ANKLE_BIAS = String(b);
    const w = new World();
    const ctl = new ControlModule(w, { postureTone: 8 });
    ctl.actions.idleEnabled = false;
    (globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
    w.controller = ctl;
    w.reset();
    const court: CourtState = squatCourtSetup(w, ctl, 2.0);
    const ti = w.body.indexByKey.get('torso')!;
    let e0 = 0, v0 = 0, roll0 = 0, nh = 0, nt = 0, n = 0, fired = false;
    for (let s = 0; s < Math.round(4.2 / w.dt); s++) {
      w.advance(1);
      squatFrame(w, ctl, court);
      const t = court.t;
      if (!fired && t >= 2.1) { w.body.bodies[ti]!.applyImpulse({ x: 0, y: 0, z: imp }, true); fired = true; }
      if (t >= 2.2 && t < 2.3 && e0 === 0) {
        e0 = ctl.sensors.com[2]!; v0 = ctl.sensors.comVel[2]!;
        roll0 = ctl.lateral.parts['trunk']?.roll ?? 0;
      }
      if (t >= 3.5 && t <= 4.0) {
        nh += Math.abs((w.body.bodies[w.body.indexByKey.get('head')!]!.translation().z) * 1000);
        nt += Math.abs((w.body.bodies[w.body.indexByKey.get('torso')!]!.translation().z) * 1000);
        n++;
      }
      if (court.fall >= 0) break;
    }
    rows.push([b, e0 * 1000, v0 * 1000, roll0 * 57.3, n ? nh / n : NaN, n ? nt / n : NaN].join(','));
  }
}
fs.writeFileSync(OUT, rows.join('\n'));
console.log(`WROTE ${OUT} rows=${rows.length}`);
