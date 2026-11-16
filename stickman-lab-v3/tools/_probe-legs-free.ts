import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { setRigidUpper, freezeUpperStep } from '../src/core/servo/rescue';
import { estimateHipLevel } from '../src/core/servo/squatHipLevel';

const T_END = Number(process.env.T_END ?? 10);
const w = new World();
w.setGravityZero();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
const court: CourtState = squatCourtSetup(w, ctl, 0.1);
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
setRigidUpper(true);

const foot0 = (s: 'l' | 'r'): number => { const i = w.body.dofByName(`foot_${s}`, 0); return i >= 0 ? w.body.dofs[i]!.angle * 57.3 : NaN; };
const kneeRel = (s: 'l' | 'r'): number => {
  const ki = w.body.dofByName(`knee_${s}`, 2);
  const fi = w.body.dofByName(`foot_${s}`, 0);
  return ki >= 0 && fi >= 0 ? (w.body.dofs[ki]!.anchorWorld[2]! - w.body.dofs[fi]!.anchorWorld[2]!) * 1000 : NaN;
};
let last = -1;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  freezeUpperStep(
    w.body as unknown as { indexByKey: Map<string, number>; bodies: Array<unknown>; dofByName(j: string, a: number): number },
    ctl.warner.manual as unknown as { setAngle(j: string, a: number, r: number, kp?: number, kd?: number): void; pin(j: string, a: number, v: boolean): void; clearAngle(j: string, a: number): void },
  );
  supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  if (court.t - last >= 1.0) {
    last = court.t;
    const h = estimateHipLevel(w, court);
    console.log(`FREE t=${court.t.toFixed(1)} hipRoll=${(h.hipRoll * 57.3).toFixed(2)}° dy=${(h.hipDY * 1000).toFixed(1)}mm kneeRelZ=${kneeRel('l').toFixed(1)}/${kneeRel('r').toFixed(1)}mm foot0=${foot0('l').toFixed(1)}/${foot0('r').toFixed(1)}° load=${(h.loadL * 100).toFixed(0)}/${(h.loadR * 100).toFixed(0)}%`);
  }
  if (court.fall >= 0) break;
}
console.log(`FREE_RESULT fall=${court.fall >= 0 ? court.fall.toFixed(2) : 'none'}`);
setRigidUpper(false);
