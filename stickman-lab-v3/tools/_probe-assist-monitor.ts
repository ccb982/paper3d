import './_env-web';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import type { AssistSnapshot } from '../src/core/servo/assistRighting';

if (process.env.V3_AR_MODE === undefined) process.env.V3_AR_MODE = 'assist';
const J = Number(process.env.J ?? 2);
const T_IMP = Number(process.env.T_IMP ?? 2.1);
const T_END = Number(process.env.T_END ?? 6.0);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const torsoIdx = w.body.indexByKey.get('torso')!;
let fired = false;
let lastPrint = -1;

console.log('t state active maxSev maxG | legE legG legT hipE hipG hipT upE upG upT | rootEx rootEz rootAx rootAz rootG | worst');

for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(stepCtx, 'r');
  supportClean(stepCtx, 'l');
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (!fired && t >= T_IMP) {
    w.body.bodies[torsoIdx]!.applyImpulse({ x: 0, y: 0, z: J }, true);
    fired = true;
    console.log(`IMPULSE t=${t.toFixed(3)} Jz=${J}`);
  }
  if (t - lastPrint < 0.1 - 1e-9) continue;
  lastPrint = t;
  const ar = (globalThis as { __V3_AR?: AssistSnapshot }).__V3_AR;
  if (!ar) continue;
  const e = { leg: 0, hip: 0, upper: 0, limb: 0 };
  const g = { leg: 0, hip: 0, upper: 0, limb: 0 };
  const tq = { leg: 0, hip: 0, upper: 0, limb: 0 };
  let worst = '';
  let worstE = 0;
  for (const j of ar.joints) {
    const ae = Math.abs(j.e) * 57.29578;
    if (ae > e[j.layer]) e[j.layer] = ae;
    if (j.gain > g[j.layer]) g[j.layer] = j.gain;
    if (Math.abs(j.tau) > tq[j.layer]) tq[j.layer] = Math.abs(j.tau);
    if (ae > worstE) {
      worstE = ae;
      worst = `${j.name}/${j.axis}`;
    }
  }
  console.log(
    `${t.toFixed(2)} ${ar.state || '-'} ${ar.active ? 1 : 0} ${ar.maxSeverity.toFixed(2)} ${ar.maxGain.toFixed(2)} | ` +
    `${e.leg.toFixed(1)} ${g.leg.toFixed(2)} ${tq.leg.toFixed(0)} ${e.hip.toFixed(1)} ${g.hip.toFixed(2)} ${tq.hip.toFixed(0)} ${e.upper.toFixed(1)} ${g.upper.toFixed(2)} ${tq.upper.toFixed(0)} | ` +
    `${(ar.root.ex * 100).toFixed(1)} ${(ar.root.ez * 100).toFixed(1)} ${ar.root.ax.toFixed(1)} ${ar.root.az.toFixed(1)} ${ar.root.gain.toFixed(2)} | ${worst}`,
  );
  if (court && court.fall >= 0 && t >= court.fall + 0.1) break;
}
console.log(`RESULT fall=${court && court.fall >= 0 ? `${Math.max(0, court.fall - court.settle).toFixed(3)}s ${court.reason}` : 'none'}`);
