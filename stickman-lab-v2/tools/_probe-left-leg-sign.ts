import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
(globalThis as { __IK_DBG?: boolean }).__IK_DBG = true;
process.env.SQC_SQUAT_DBG = '1';
const SUPPORT_OFF = process.env.SQC_SUPPORT_OFF === '1';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);

const D = 57.29578;
const i = (n: string, a: number): number => w.body.dofByName(n, a);
const q = (n: string, a: number): number => { const k = i(n, a); return k >= 0 ? w.body.dofs[k]!.angle * D : 0; };
const v = (n: string, a: number): number => { const k = i(n, a); return k >= 0 ? w.body.dofs[k]!.vel : 0; };
const led = (n: string, a: number): { cmd: number; pair: number; passive: number; applied: number; pd: number; ff: number; damp: number; act: number } => {
  const k = i(n, a);
  const l = k >= 0 ? w.executor.ledger[k]! : null;
  const bd = k >= 0 ? w.drive.lastBreakdown[k] : null;
  const pd = (globalThis as { __PD_TAU?: Record<string, number> }).__PD_TAU?.[`${n}/${a}`] ?? 0;
  return l ? { cmd: l.cmd, pair: l.pair ?? 0, passive: l.passive, applied: l.applied, pd, ff: bd?.ff ?? 0, damp: bd?.damp ?? 0, act: bd?.act ?? 0 } : { cmd: 0, pair: 0, passive: 0, applied: 0, pd: 0, ff: 0, damp: 0, act: 0 };
};
const ancZ = (n: string, a: number): number => { const k = i(n, a); return k >= 0 ? w.body.dofs[k]!.anchorWorld[2]! : 0; };
const ancYZ = (n: string, a: number, c: number): number => { const k = i(n, a); return k >= 0 ? w.body.dofs[k]!.anchorWorld[c]! : 0; };
const bodyY = (key: string): number => { const k = w.body.indexByKey.get(key); return k === undefined ? 0 : w.body.bodies[k]!.translation().y; };

type Cmd = {
  hip0T: number; foot0T: number; knee0T: number; hip2T: number; knee2T: number; foot2T: number;
  eSag?: number; hipBase?: number; hipRight?: number; supFf?: number; hipFf?: number; relax?: number;
  kneeSup?: number; supScale?: number; hip2Q?: number; knee2Q?: number;
  hipT?: number; kneeT?: number; shankT?: number;
};
const one = (side: 'l' | 'r'): string => {
  const d = (globalThis as { __SQUAT_DBG?: Record<string, Cmd> }).__SQUAT_DBG?.[side];
  const rows = [
    [`hip_${side}`, 0, d?.hip0T],
    [`knee_${side}`, 0, d?.knee0T],
    [`foot_${side}`, 0, d?.foot0T],
    [`hip_${side}`, 2, d?.hip2T],
    [`knee_${side}`, 2, d?.knee2T],
    [`foot_${side}`, 2, d?.foot2T],
  ] as Array<[string, number, number | undefined]>;
  const s = rows.map(([n, a, tgt]) => {
    if (tgt === undefined) return `${n}=?`;
    const qd = q(n, a);
    const td = tgt * D;
    const e = td - qd;
    const l = led(n, a);
    const bad = e * l.pd < 0 ? '!' : ' ';
    return `${n}${bad} q=${qd.toFixed(1)} tgt=${td.toFixed(1)} e=${e.toFixed(1)} ` +
      `pd=${l.pd.toFixed(0)} ff=${l.ff.toFixed(0)} damp=${l.damp.toFixed(0)} act=${l.act.toFixed(0)} ` +
      `cmd=${l.cmd.toFixed(0)} pair=${l.pair.toFixed(0)} pas=${l.passive.toFixed(0)} app=${l.applied.toFixed(0)} v=${v(n, a).toFixed(1)}`;
  }).join(' | ');
  const iks = (globalThis as { __IK_STATE?: Record<string, { eqTau?: { hip: number; knee: number; ankle: number } }> }).__IK_STATE?.[side];
  const eqH = iks?.eqTau?.hip;
  const eqK = iks?.eqTau?.knee;
  const kneeZ = ancZ(`knee_${side}`, 2);
  const ankleZ = ancZ(`foot_${side}`, 2);
  const kneeY = ancYZ(`knee_${side}`, 2, 1);
  const ankleY = ancYZ(`foot_${side}`, 2, 1);
  const shankLat = Math.atan2((kneeZ - ankleZ) * (side === 'l' ? 1 : -1), Math.max(1e-4, kneeY - ankleY)) * D;
  const sd = (globalThis as { __SQC_SHANK_DBG?: Record<string, { tilt: number; target: number; err: number; u: number }> }).__SQC_SHANK_DBG?.[side];
  const sl = sd ? ` sT=${sd.target.toFixed(1)} sA=${sd.tilt.toFixed(1)} sE=${sd.err.toFixed(1)} sU=${sd.u.toFixed(0)}` : '';
  return `${side} kz=${kneeZ.toFixed(3)} az=${ankleZ.toFixed(3)} lat=${shankLat.toFixed(1)}${sl} cy=${bodyY('spine4').toFixed(3)} hy=${bodyY('torso').toFixed(3)} eqH=${eqH?.toFixed(0) ?? '-'} eqK=${eqK?.toFixed(0) ?? '-'} | ${s}`;
};

const sag = (side: 'l' | 'r'): string => {
  const d = (globalThis as { __SQUAT_DBG?: Record<string, Cmd> }).__SQUAT_DBG?.[side];
  if (!d) return `[SAG] ${side} no dbg`;
  const h2 = q(`hip_${side}`, 2);
  const k2 = q(`knee_${side}`, 2);
  return `[SAG] t=${court.t.toFixed(2)} ${side} eSag=${(d.eSag ?? 0).toFixed(4)} ` +
    `hip2T=${((d.hip2T ?? 0) * D).toFixed(1)} hip2Q=${h2.toFixed(1)} ` +
    `hipBase=${(d.hipBase ?? 0).toFixed(0)} hipRight=${(d.hipRight ?? 0).toFixed(0)} supFf=${(d.supFf ?? 0).toFixed(0)} ` +
    `hipFf=${(d.hipFf ?? 0).toFixed(0)} relax=${(d.relax ?? 0).toFixed(2)} ` +
    `knee2T=${((d.knee2T ?? 0) * D).toFixed(1)} knee2Q=${k2.toFixed(1)} kneeSup=${(d.kneeSup ?? 0).toFixed(0)} supScale=${(d.supScale ?? 0).toFixed(2)} ` +
    `hipT=${(d.hipT ?? 0).toFixed(0)} kneeT=${(d.kneeT ?? 0).toFixed(0)} shankT=${(d.shankT ?? 0).toFixed(0)}`;
};

for (let s = 0; s < Math.round(3.7 / w.dt); s++) {
  if (!SUPPORT_OFF) { supportClean(ctx, 'r'); supportClean(ctx, 'l'); }
  w.advance(1);
  squatFrame(w, ctl, court);
  if (court.t < 1.99) continue;
  if ([2.0, 2.3, 2.6, 3.0].some((x) => Math.abs(court.t - x) < 1e-6)) {
    console.log(sag('l'));
    console.log(sag('r'));
  }
  if (Math.abs(court.t * 50 - Math.round(court.t * 50)) > 1e-6) continue;
  console.log(`t=${court.t.toFixed(2)} ${one('l')}`);
  if (Math.abs(court.t - 3.0) < 0.051) console.log(`       ${one('r')}`);
  if (court.fall >= 0) { console.log('FALL', court.fall.toFixed(3), court.reason); break; }
}
