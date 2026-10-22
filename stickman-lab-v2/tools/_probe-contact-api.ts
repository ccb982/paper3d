import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  if (!court || court.t < 2.3) continue;
  if (Math.round(court.t * 240) % 240 !== 0) continue;
  console.log(`t=${court.t.toFixed(2)} support=${w.perception.support} fzL=${w.perception.feet[0]!.fz.toFixed(0)} fzR=${w.perception.feet[1]!.fz.toFixed(0)} contact=${w.perception.feet[0]!.contact}/${w.perception.feet[1]!.contact} slip=${w.perception.feet[0]!.slip}/${w.perception.feet[1]!.slip} dHat=(${w.perception.dHat[0]!.toFixed(1)},${w.perception.dHat[1]!.toFixed(1)},${w.perception.dHat[2]!.toFixed(1)})`);
  for (const side of ['l', 'r'] as const) {
    for (const key of [`foot_${side}`, `arch_${side}`, `mfoot_${side}`]) {
      const bi = w.body.indexByKey.get(key);
      if (bi === undefined) continue;
      for (const col of w.body.collidersByBody[bi] ?? []) {
        w.world.contactPairsWith(col, (other) => {
          w.world.contactPair(col, other, (m) => {
            const nc = m.numContacts();
            const ns = m.numSolverContacts();
            const i = 0;
            const tx = nc > i ? m.contactTangentImpulseX(i) : NaN;
            const ty = nc > i ? m.contactTangentImpulseY(i) : NaN;
            const fr = ns > i ? m.solverContactFriction(i) : NaN;
            const tv = ns > i ? m.solverContactTangentVelocity(i) : null;
            const sp = ns > i ? m.solverContactPoint(i) : null;
            console.log(`  ${side} ${key} nc=${nc} ns=${ns} imp=${nc > i ? m.contactImpulse(i) : NaN} tx=${tx} ty=${ty} fric=${fr} tv=${tv ? `(${tv.x.toFixed(2)},${tv.y.toFixed(2)},${tv.z.toFixed(2)})` : '-'} sp=${sp ? `(${sp.x.toFixed(2)},${sp.y.toFixed(2)},${sp.z.toFixed(2)})` : '-'}`);
          });
        });
      }
    }
  }
  break;
}
