import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { PROPOSALS } from '../src/core/proposalBus';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const T_END = Number(process.env.T_END ?? 3.14);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
const court: CourtState = squatCourtSetup(w, ctl, 2.0);
let last = -1;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = court.t;
  if (t >= 2.98 && t - last >= 0.02) {
    last = t;
    console.log(`AUDIT t=${t.toFixed(3)}`);
    for (const p of PROPOSALS) {
      const d = w.body.dofs[p.dof];
      if (!d) continue;
      if (d.name === 'foot_l' || d.name === 'hip_l' || d.name === 'spine1') {
        console.log(`  ${d.name}/${d.axis} kind=${p.kind} pri=${p.pri} tau=${(p.tau ?? 0).toFixed(2)} src=${p.src} applied=${(w.executor.ledger[p.dof]?.applied ?? 0).toFixed(2)}`);
      }
    }
  }
  if (court.fall >= 0) break;
}
