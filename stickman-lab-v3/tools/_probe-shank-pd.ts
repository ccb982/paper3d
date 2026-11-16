import './_env-web';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

process.env.V3_AR_MODE = 'monitor';
process.env.SQC_PD_DBG = '1';
process.env.SQC_SQUAT_DBG = '1';

const T_END = Number(process.env.T_END ?? 4.0);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
let lastPrint = -1;
const keys = ['knee_l/2', 'knee_l/0', 'foot_l/2', 'foot_l/0'];

for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(stepCtx, 'r');
  supportClean(stepCtx, 'l');
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (t - lastPrint < 0.1 - 1e-9) continue;
  lastPrint = t;
  const parts = (globalThis as { __PD_PARTS?: Record<string, Record<string, number>> }).__PD_PARTS ?? {};
  const out: string[] = [`t=${t.toFixed(2)}`];
  for (const k of keys) {
    const p = parts[k];
    if (!p) continue;
    const deg = 57.29578;
    out.push(
      `${k}: tgt=${(p.target! * deg).toFixed(1)} act=${(p.angle! * deg).toFixed(1)} ` +
      `pos=${p.posTerm!.toFixed(0)} damp=${p.dampTerm!.toFixed(0)} raw=${p.rawPd!.toFixed(0)} ` +
      `ff=${p.ff!.toFixed(0)} pas=${p.passive!.toFixed(0)} cap=${p.cap!.toFixed(0)} tau=${p.tau!.toFixed(0)}`,
    );
  }
  console.log(out.join(' | '));
  if (court && court.fall >= 0 && t >= court.fall + 0.1) break;
}
console.log(`RESULT fall=${court && court.fall >= 0 ? `${Math.max(0, court.fall - court.settle).toFixed(3)}s ${court.reason}` : 'none'}`);
