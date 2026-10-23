import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { captureCourtRef, estimateRightingState, computeSafeSetV2, RightingControllerV2 } from '../src/core/servo/rightingController';

const T_END = Number(process.env.T_END ?? 4.2);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
const court: CourtState = squatCourtSetup(w, ctl, 2.0);
let ref: ReturnType<typeof captureCourtRef> | null = null;
const rc = new RightingControllerV2();
let last = -1;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1);
  squatFrame(w, ctl, court);
  if (!court.released) continue;
  if (!ref) ref = captureCourtRef(w, court);
  const t = court.t;
  if (t - last >= 0.1 - 1e-9) {
    last = t;
    const st = estimateRightingState(w, ctl, ref);
    const z = computeSafeSetV2(st);
    const r = rc.step(w, ctl, court);
    const cmd = r ? `cmd cop=${(r.cmd.copOffset*1000).toFixed(2)} hip=${r.cmd.hipTau.toFixed(1)} back=${r.cmd.backTau.toFixed(1)}` : 'cmd -';
    console.log(`RSTATE t=${t.toFixed(2)} e=${(st.e * 1000).toFixed(2)} v=${(st.v * 1000).toFixed(1)} trZ=${(st.trunkZ * 1000).toFixed(2)} trR=${(st.trunkR * 57.3).toFixed(2)} copM=${(st.copMargin * 1000).toFixed(1)} gate=${z.gate.toFixed(2)} in=${z.inside?1:0} ${cmd}`);
  }
  if (court.fall >= 0) break;
}
console.log(`RSTATE_RESULT fall=${court.fall >= 0 ? (court.fall - court.settle).toFixed(3) : 'none'}`);
