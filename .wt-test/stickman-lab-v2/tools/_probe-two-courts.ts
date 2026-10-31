import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits, type CourtState } from '../src/core/servo/squat';

const T_END = Number(process.env.T_END ?? 12);
const RUNS = Number(process.env.RUNS ?? 2);
const w = new World();
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
for (let r = 0; r < RUNS; r++) {
  const ctl = new ControlModule(w, { postureTone: 8 });
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  ctl.resetCourt();
  squatResetLimits(w);
  const court: CourtState = squatCourtSetup(w, ctl, 2.0);
  let last = -1;
  for (let s = 0; s < Math.round(T_END / w.dt); s++) {
    w.advance(1);
    squatFrame(w, ctl, court);
    const t = court.t;
    if (t - last >= 0.5 - 1e-9) {
      last = t;
      const b = w.body;
      const ang = (n: string, ax: number): number => { const i = b.dofByName(n, ax); return i >= 0 ? b.dofs[i]!.angle * 57.3 : NaN; };
      const lim = (n: string, ax: number): string => { const i = b.dofByName(n, ax); return i >= 0 ? `${(b.dofs[i]!.min * 57.3).toFixed(1)}/${(b.dofs[i]!.max * 57.3).toFixed(1)}` : 'na'; };
      const z = (k: string): number => b.bodies[b.indexByKey.get(k)!]!.translation().z * 1000;
      const tau = (n: string, ax: number): number => { const i = b.dofByName(n, ax); return i >= 0 ? (w.executor.ledger[i]?.applied ?? 0) : NaN; };
      const tr = ctl.lateral.parts['trunk'];
      const cp = new Float64Array(3); w.body.footCoP('l', w.dt, cp);
      console.log(`R${r} t=${t.toFixed(1)} headZ=${z('head').toFixed(1)} comZ=${(w.perception.com[2]! * 1000).toFixed(1)} copL=${(cp[1]! * 1000).toFixed(1)} knee2=${ang('knee_l',2).toFixed(1)} hip0=${ang('hip_l',0).toFixed(1)} foot0=${ang('foot_l',0).toFixed(1)} k2T=${tau('knee_l',2).toFixed(1)} h0T=${tau('hip_l',0).toFixed(1)} f0T=${tau('foot_l',0).toFixed(1)} sp1T=${tau('spine1',0).toFixed(1)} trScore=${(tr?.score ?? 0).toFixed(2)} trZ=${(tr?.z ? tr.z * 1000 : NaN).toFixed(1)} trR=${(tr?.roll ? tr.roll * 57.3 : NaN).toFixed(2)}`);
    }
    if (court.fall >= 0) break;
  }
  console.log(`RUN${r} fall=${court.fall >= 0 ? `${Math.max(0, court.fall - court.settle).toFixed(3)}s ${court.reason}` : 'none'}`);
}
