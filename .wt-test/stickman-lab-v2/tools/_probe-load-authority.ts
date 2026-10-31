import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const DOF = (process.env.DOF ?? 'hip').trim();
const AX = Number(process.env.AX ?? 0);
const TAU = Number(process.env.TAU ?? 0);
const MODE = (process.env.MODE ?? 'common').trim();
const T_END = Number(process.env.T_END ?? 2.7);
const DOF2 = (process.env.DOF2 ?? '').trim();
const AX2 = Number(process.env.AX2 ?? 0);
const TAU2 = Number(process.env.TAU2 ?? 0);
const MODE2 = (process.env.MODE2 ?? 'diff').trim();

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const dl = w.body.dofByName(`${DOF}_l`, AX);
const dr = w.body.dofByName(`${DOF}_r`, AX);
const dl2 = DOF2 ? w.body.dofByName(`${DOF2}_l`, AX2) : -1;
const dr2 = DOF2 ? w.body.dofByName(`${DOF2}_r`, AX2) : -1;

let sum = 0, n = 0, fzL = 0, fzR = 0, sumL = 0, sumR = 0;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1, () => {
    if (TAU === 0 || w.clock < 2.05 || court === null || court.fall >= 0) return;
    if (dl >= 0) w.executor.addTorque(dl, MODE === 'diff' ? TAU : TAU);
    if (dr >= 0) w.executor.addTorque(dr, MODE === 'diff' ? -TAU : TAU);
    if (dl2 >= 0 && TAU2 !== 0) w.executor.addTorque(dl2, MODE2 === 'diff' ? TAU2 : TAU2);
    if (dr2 >= 0 && TAU2 !== 0) w.executor.addTorque(dr2, MODE2 === 'diff' ? -TAU2 : TAU2);
  });
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (t >= 2.2 && t <= 2.6) {
    fzL = w.body.footNormalForce('l', w.dt);
    fzR = w.body.footNormalForce('r', w.dt);
    sum += fzL - fzR;
    sumL += fzL; sumR += fzR;
    n++;
  }
  if (court && court.fall >= 0 && t >= court.fall + 0.2) break;
}
console.log(`RESULT DOF=${DOF} AX=${AX} TAU=${TAU} MODE=${MODE} DOF2=${DOF2} AX2=${AX2} TAU2=${TAU2} MODE2=${MODE2} loadDiff=${n > 0 ? (sum / n).toFixed(1) : 'NaN'}N fzL=${(sumL / Math.max(1, n)).toFixed(1)} fzR=${(sumR / Math.max(1, n)).toFixed(1)} total=${((sumL + sumR) / Math.max(1, n)).toFixed(1)}`);
