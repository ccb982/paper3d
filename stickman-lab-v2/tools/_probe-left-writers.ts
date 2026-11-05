import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { PROPOSALS } from '../src/core/proposalBus';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);
const axes = ['hip_l/0', 'hip_l/2', 'knee_l/0', 'knee_l/2', 'foot_l/0', 'foot_l/2'];
let last = -1;
for (let s = 0; s < Math.round(5.0 / w.dt); s++) {
  supportClean(stepCtx, 'r');
  supportClean(stepCtx, 'l');
  w.advance(1);
  PROPOSALS.length = 0;
  squatFrame(w, ctl, court);
  if (court.released && court.t >= 3.0 && court.t < 3.8 && court.t - last >= 0.35) {
    last = court.t;
    console.log(`LW t=${court.t.toFixed(2)}`);
    for (const nm of axes) {
      const [jn, axs] = nm.split('/');
      const i = w.body.dofByName(jn!, Number(axs));
      if (i < 0) continue;
      const l = w.executor.ledger[i];
      const ps = PROPOSALS.filter((p) => p.dof === i);
      const f = (v: number | undefined): string => Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '-';
      console.log(`${nm} cmd=${f(l?.cmd)} app=${f(l?.applied)} writes=${l?.writes ?? 0} | ` + ps.map((p) => `${p.src}[${p.kind}${p.channel ? '/' + p.channel : ''}]${p.kind === 'pair' ? ' c=' + f(p.c) + ' rad=' + f(p.rad) : ' tau=' + f(p.tau)}`).join(' | '));
    }
  }
  if (court.fall >= 0) break;
}
console.log(`LW_END t=${court.t.toFixed(2)} fall=${court.fall >= 0 ? court.fall.toFixed(2) : 'none'}`);
