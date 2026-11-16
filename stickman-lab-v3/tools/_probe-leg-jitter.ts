import './_env-web';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

process.env.V3_AR_MODE = process.env.JITTER_MODE ?? 'monitor';
process.env.SQC_PD_DBG = '1';

const T_END = Number(process.env.T_END ?? 4.0);
const T0 = Number(process.env.T0 ?? 2.4);
const T1 = Number(process.env.T1 ?? 3.2);
const names = ['hip_l/0', 'hip_l/1', 'hip_l/2', 'knee_l/2', 'knee_l/0', 'foot_l/2', 'foot_l/0'];
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);

const rows: Array<Record<string, number>> = [];
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(stepCtx, 'r');
  supportClean(stepCtx, 'l');
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (t < T0 || t > T1) continue;
  const parts = (globalThis as { __PD_PARTS?: Record<string, Record<string, number>> }).__PD_PARTS ?? {};
  const row: Record<string, number> = { t };
  for (const k of names) {
    const p = parts[k];
    const i = w.body.dofByName(k.split('/')[0]!, Number(k.split('/')[1]));
    const d = i >= 0 ? w.body.dofs[i]! : null;
    row[`${k}.q`] = d?.angle ?? 0;
    row[`${k}.qd`] = d?.vel ?? 0;
    row[`${k}.tgt`] = p?.target ?? 0;
    row[`${k}.tau`] = p?.tau ?? 0;
    row[`${k}.pos`] = p?.posTerm ?? 0;
    row[`${k}.damp`] = p?.dampTerm ?? 0;
    row[`${k}.ff`] = p?.ff ?? 0;
    row[`${k}.pas`] = p?.passive ?? 0;
  }
  rows.push(row);
  if (court && court.fall >= 0) break;
}

const dt = w.dt;
for (const k of names) {
  let flipsQg = 0, flipsTau = 0, maxQd = 0, maxTau = 0, maxDamp = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!, p = rows[i - 1]!;
    const qd = r[`${k}.qd`]!, pqd = p[`${k}.qd`]!;
    const tau = r[`${k}.tau`]!, ptau = p[`${k}.tau`]!;
    if (pqd * qd < 0 && Math.max(Math.abs(pqd), Math.abs(qd)) > 0.05) flipsQg++;
    if (ptau * tau < 0 && Math.max(Math.abs(ptau), Math.abs(tau)) > 0.5) flipsTau++;
    maxQd = Math.max(maxQd, Math.abs(qd));
    maxTau = Math.max(maxTau, Math.abs(tau));
    maxDamp = Math.max(maxDamp, Math.abs(r[`${k}.damp`]!));
  }
  const dur = Math.max(1e-6, rows.length * dt);
  console.log(
    `${k.padEnd(9)} flipsQd=${String(flipsQg).padStart(4)} (${(flipsQg / (2 * dur)).toFixed(1)}Hz) ` +
    `flipsTau=${String(flipsTau).padStart(4)} (${(flipsTau / (2 * dur)).toFixed(1)}Hz) ` +
    `maxQd=${maxQd.toFixed(2)} maxTau=${maxTau.toFixed(0)} maxDamp=${maxDamp.toFixed(0)}`,
  );
}
console.log(`RESULT fall=${court && court.fall >= 0 ? `${Math.max(0, court.fall - court.settle).toFixed(3)}s ${court.reason}` : 'none'} frames=${rows.length}`);
