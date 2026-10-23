import './_boot';
import fs from 'node:fs';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const MODE = String(process.env.IMP_MODE ?? 'back');
const OUT = process.env.IMP_OUT ?? `imp_${MODE}.csv`;
const T_END = Number(process.env.T_END ?? 3.4);
const T_IMP = Number(process.env.T_IMP ?? 2.2);
const J = Number(process.env.IMP_J ?? 5);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
const court: CourtState = squatCourtSetup(w, ctl, 2.0);
const ti = w.body.indexByKey.get('torso')!;
const hi = w.body.dofByName('hip_l', 0);
const ai = w.body.dofByName('foot_l', 0);
const rows: string[] = ['t,e,v,trZ,trR,u'];
let fired = false;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1, () => {
    const t = court.t;
    if (!fired && t >= T_IMP) {
      fired = true;
      if (MODE === 'back') w.body.bodies[ti]!.applyImpulse({ x: 0, y: 0, z: J }, true);
      else if (MODE === 'hip' && hi >= 0) w.executor.addTorque(hi, J * 20);
      else if (MODE === 'ankle' && ai >= 0) w.executor.addTorque(ai, J * 20);
    }
  });
  squatFrame(w, ctl, court);
  const t = court.t;
  if (t >= T_IMP - 0.1 && t <= T_END) {
    const tr = ctl.lateral.parts['trunk'];
    const uNow = t >= T_IMP && t < T_IMP + 0.02 ? (MODE === 'back' ? J : J * 20 * w.dt) : 0;
    rows.push(`${t.toFixed(4)},${(ctl.sensors.com[2]! * 1000).toFixed(3)},${(ctl.sensors.comVel[2]! * 1000).toFixed(3)},${((tr?.z ?? 0) * 1000).toFixed(3)},${((tr?.roll ?? 0) * 57.3).toFixed(4)},${uNow.toFixed(6)}`);
  }
  if (court.fall >= 0) break;
}
fs.writeFileSync(OUT, rows.join('\n'));
console.log(`WROTE ${OUT} rows=${rows.length} fall=${court.fall >= 0 ? (court.fall - court.settle).toFixed(3) : 'none'}`);
