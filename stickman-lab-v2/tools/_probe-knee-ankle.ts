import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const MODE = process.env.MODE ?? 'log';
const ACT = process.env.ACT ?? 'hip';
const SIGN = Number(process.env.SIGN ?? 1);
const AMP = Number(process.env.AMP ?? 1);
const T_PULSE = Number(process.env.T_PULSE ?? 2.5);
const DUR = Number(process.env.DUR ?? 0.2);
const SIDE = process.env.SIDE ?? 'both';
const T_END = Number(process.env.T_END ?? 5);
const PRINT = Number(process.env.PRINT ?? 0.1);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
let pulsed = false;
let last = -1;
let kref: { l: number; r: number } | null = null;
const D = 57.3;

const kz = (side: 'l' | 'r'): number => {
  const ki = w.body.dofByName(`knee_${side}`, 2);
  const fi = w.body.dofByName(`foot_${side}`, 0);
  if (ki < 0 || fi < 0) return NaN;
  return (w.body.dofs[ki]!.anchorWorld[2]! - w.body.dofs[fi]!.anchorWorld[2]!) * 1000;
};
const ang = (n: string, ax: number): number => {
  const i = w.body.dofByName(n, ax);
  return i >= 0 ? w.body.dofs[i]!.angle * D : NaN;
};
const fz = (side: 'l' | 'r'): number => w.body.footNormalForce(side, w.dt);
const fmt = (v: number, n = 2): string => (Number.isFinite(v) ? v.toFixed(n) : 'NaN').padStart(8);

console.log('t kneeL kneeR foot0L foot0R hip0L hip0R kneeFlexL kneeFlexR fzL fzR');
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  const t0 = court ? court.t : w.clock;
  w.advance(1, () => {
    if (MODE !== 'pulse') return;
    if (t0 < T_PULSE || t0 > T_PULSE + DUR) return;
    const side = ACT === 'foot' ? 'foot' : 'hip';
    for (const sd of (SIDE === 'both' ? ['l', 'r'] : [SIDE]) as Array<'l' | 'r'>) {
      const di = w.body.dofByName(`${side}_${sd}`, 0);
      if (di >= 0) w.executor.addTorque(di, SIGN * AMP);
    }
    if (!pulsed) { pulsed = true; console.log(`PULSE t=${t0.toFixed(3)} ${side}/0 ${SIGN * AMP}Nm`); }
  });
  if (court) squatFrame(w, ctl, court);
  if (court?.released && !kref) kref = { l: kz('l'), r: kz('r') };
  const t = court ? court.t : w.clock;
  if (t - last < PRINT - 1e-9) continue;
  last = t;
  console.log(
    `${t.toFixed(3)} ${fmt(kref ? kz('l') - kref.l : NaN)} ${fmt(kref ? kz('r') - kref.r : NaN)} ${fmt(ang('foot_l', 0))} ${fmt(ang('foot_r', 0))} ` +
    `${fmt(ang('hip_l', 0))} ${fmt(ang('hip_r', 0))} ${fmt(ang('knee_l', 2))} ${fmt(ang('knee_r', 2))} ` +
    `${fz('l').toFixed(0).padStart(4)} ${fz('r').toFixed(0).padStart(4)}`,
  );
  if (court && court.fall >= 0 && t >= court.fall + 0.1) break;
}
console.log(`RESULT fall=${court && court.fall >= 0 ? Math.max(0, court.fall - court.settle).toFixed(3) : 'none'}`);
