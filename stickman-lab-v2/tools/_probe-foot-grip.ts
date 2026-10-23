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
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
let last = -1;
console.log('t fzL fzR contactL contactR slipL slipR copZL copZR footZL footZR footVzL footVzR comZ');
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (t - last < 0.1 - 1e-9) continue;
  last = t;
  const feet = w.perception.feet;
  const fz = (i: number): number => feet[i]!.fz;
  const cp = (i: number): number => feet[i]!.copZ * 1000;
  const fzpos = (k: string): number => w.body.bodies[w.body.indexByKey.get(k)!]!.translation().z * 1000;
  const fv = (k: string): number => w.body.bodies[w.body.indexByKey.get(k)!]!.linvel().z * 1000;
  console.log(`${t.toFixed(2)} ${fz(0).toFixed(0)} ${fz(1).toFixed(0)} ${feet[0]!.contact?1:0} ${feet[1]!.contact?1:0} ${feet[0]!.slip?1:0} ${feet[1]!.slip?1:0} ${cp(0).toFixed(1)} ${cp(1).toFixed(1)} ${fzpos('foot_l').toFixed(1)} ${fzpos('foot_r').toFixed(1)} ${fv('foot_l').toFixed(1)} ${fv('foot_r').toFixed(1)} ${(w.perception.com[2]!*1000).toFixed(1)}`);
}
console.log(`RESULT fall=${court && court.fall >= 0 ? `${court.fall.toFixed(3)}s ${court.reason}` : 'none'}`);
