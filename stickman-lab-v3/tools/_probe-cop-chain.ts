import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const T_END = Number(process.env.T_END ?? 4.5);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
const court: CourtState = squatCourtSetup(w, ctl, 2.0);
const al = w.body.dofByName('foot_l', 0);
const ar = w.body.dofByName('foot_r', 0);
const cop = new Float64Array(3);
let last = -1;
console.log('t step f0L f0R copL copR trR comZ');
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  let step = 0;
  w.advance(1, () => {
    const t = court.t;
    step = t >= 3.0 && t < 3.5 ? 3 : t >= 4.0 && t < 4.5 ? -3 : 0;
    if (step !== 0) {
      if (al >= 0) w.executor.addTorque(al, step);
      if (ar >= 0) w.executor.addTorque(ar, step);
    }
  });
  squatFrame(w, ctl, court);
  const t = court.t;
  if (t - last < 0.05 - 1e-9) continue;
  last = t;
  const a0 = (i: number): number => i >= 0 ? w.body.dofs[i]!.angle * 57.3 : NaN;
  const cp = (side: 'l' | 'r'): number => (w.body.footCoP(side, w.dt, cop) ? cop[1]! * 1000 : NaN);
  const tr = ctl.lateral.parts['trunk'];
  console.log(`${t.toFixed(2)} ${step} ${a0(al).toFixed(2)} ${a0(ar).toFixed(2)} ${cp('l').toFixed(1)} ${cp('r').toFixed(1)} ${((tr?.roll ?? 0) * 57.3).toFixed(2)} ${(ctl.sensors.com[2]! * 1000).toFixed(1)}`);
  if (court.fall >= 0) break;
}
