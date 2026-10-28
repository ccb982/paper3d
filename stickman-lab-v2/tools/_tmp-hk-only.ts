/** _tmp-hk-only: 只拉 hip_0 + knee_0 时的矢状稳定性 + 侧向归零效果
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { propose, PRI } from '../src/core/proposalBus';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E = globalThis.process!.env;
const K = Number(E.K_SWEEP ?? '300');
const KD = Number(E.KD_SWEEP ?? '4');
const CAP = Number(E.CAP_SWEEP ?? '80');

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, Number(E.SETTLE ?? '2.0')) as CourtState;
const body = w.body;

function hkSoftLimit(): void {
  if (K <= 0) return;
  for (const nm of ['hip_l', 'hip_r', 'knee_l', 'knee_r']) {
    const di = body.dofByName(nm, 0);
    if (di < 0) continue;
    const d = body.dofs[di]!;
    if (d.preRing || d.engineMotor) continue;
    const tau = Math.max(-CAP, Math.min(CAP, K * (0 - d.angle) - KD * d.vel));
    if (Math.abs(tau) > 1e-6) propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'hkSoftLimit', channel: 'support' });
  }
}

console.log(' t    | hipL0  hipR0 | kneeL0 kneeR0 | footL0 footR0 | fl/2角 | comX  comZ  comY | 侧偏');
let last = -1;
for (let s = 0; s < Math.round(Number(E.T_END ?? '5.0') / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  hkSoftLimit();
  const t = court.t;
  if (t < 2.0 || t - last < 0.25 - 1e-9) continue;
  last = t;
  const g = (nm: string, ax: number): string => {
    const i = body.dofByName(nm, ax);
    return i < 0 ? ' n/a ' : (body.dofs[i]!.angle * 57.3).toFixed(1).padStart(6);
  };
  const coM = ctl.sensors.com;
  console.log(
    `${t.toFixed(2)} |${g('hip_l', 0)} ${g('hip_r', 0)} |${g('knee_l', 0)} ${g('knee_r', 0)} |` +
    `${g('foot_l', 0)} ${g('foot_r', 0)} |${g('foot_l', 2)} |` +
    ` ${(coM[0]! * 100).toFixed(1).padStart(5)} ${(coM[2]! * 100).toFixed(1).padStart(5)} ${(coM[1]! * 100).toFixed(1).padStart(5)} |`,
  );
  if (court.fall >= 0 && t >= court.fall + 0.05) break;
}
console.log(`fall=${court.fall >= 0 ? `${court.fall.toFixed(2)}s ${court.reason}` : '未倒'}  K=${K}`);
