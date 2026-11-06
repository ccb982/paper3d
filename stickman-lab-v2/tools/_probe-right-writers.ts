import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
(globalThis as { __SQUAT_DBG?: boolean }).__SQUAT_DBG = true;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl; w.driveEnabled = true; w.reset();
ctl.actions.idleEnabled = false; ctl.manual.clear(); squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);
const keys = ['knee_r', 'foot_r', 'hip_r'] as const;
const ax = 0 as const;
const ids = new Map<string, number>();
for (const k of keys) ids.set(k, w.body.dofByName(k, ax));
let last = -1;
for (let s = 0; s < Math.round(2.8 / w.dt); s++) {
  const log: Array<[number, string, number, string]> = [];
  (globalThis as { __PROPLOG?: typeof log }).__PROPLOG = log;
  supportClean(ctx, 'r'); supportClean(ctx, 'l'); w.advance(1); squatFrame(w, ctl, court);
  if (!court.released || court.t - last < 0.05) continue;
  last = court.t;
  const d = (globalThis as { __SQUAT_DBG?: Record<string, { knee0T?: number; foot0T?: number; hip0T?: number; eSag?: number }> }).__SQUAT_DBG;
  const parts: string[] = [`t=${court.t.toFixed(2)}`];
  for (const k of keys) {
    const i = ids.get(k)!;
    const l = w.executor.ledger[i]!;
    const props = log.filter((x) => x[0] === i).map((x) => `${x[1]}:${x[2].toFixed(1)}:${x[3]}`);
    parts.push(`${k} a=${(w.body.dofs[i]!.angle * 57.3).toFixed(1)} cmd=${l.cmd.toFixed(1)} app=${l.applied.toFixed(1)} writes=${props.length} [${props.join(' | ')}]`);
  }
  const sd = d?.r;
  parts.push(`tgtK0=${((sd?.knee0T ?? 0) * 57.3).toFixed(1)} tgtF0=${((sd?.foot0T ?? 0) * 57.3).toFixed(1)}`);
  console.log(parts.join(' '));
  if (court.fall >= 0) break;
}
