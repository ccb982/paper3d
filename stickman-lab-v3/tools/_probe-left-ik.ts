import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { PROPOSALS } from '../src/core/proposalBus';

(globalThis as { __PRED_OFF_RT?: boolean; __IK_DBG?: boolean }).__PRED_OFF_RT = true;
(globalThis as { __PRED_OFF_RT?: boolean; __IK_DBG?: boolean }).__IK_DBG = true;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);
const ang = (n: string, a: number): number => {
  const i = w.body.dofByName(n, a);
  return i >= 0 ? w.body.dofs[i]!.angle * 57.29578 : NaN;
};
const led = (n: string, a: number): string => {
  const i = w.body.dofByName(n, a);
  if (i < 0) return '-';
  const l = w.executor.ledger[i];
  const ps = PROPOSALS.filter((p) => p.dof === i);
  return `cmd=${(l?.cmd ?? 0).toFixed(1)} app=${(l?.applied ?? 0).toFixed(1)} sel=${ps.map((p) => `${p.src}:${(p.tau ?? 0).toFixed(1)}`).join(',')}`;
};
let last = -1;
for (let s = 0; s < Math.round(5.0 / w.dt); s++) {
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
  w.advance(1);
  PROPOSALS.length = 0;
  squatFrame(w, ctl, court);
  if (!court.released || court.t < 3.0 || court.t > 3.8 || court.t - last < 0.1) continue;
  last = court.t;
  const g = globalThis as unknown as {
    __IK_STATE?: Record<string, { ik?: Record<string, number>; H?: { x: number; y: number; z: number } }>;
    __SQUAT_DBG?: Record<string, Record<string, number>>;
  };
  const ik = g.__IK_STATE?.l?.ik;
  const mode = (globalThis as { __SQC_MODE?: string }).__SQC_MODE ?? '-';
  const dbg = g.__SQUAT_DBG?.l;
  const f = (v: unknown): string => Number.isFinite(Number(v)) ? Number(v).toFixed(3) : 'nan';
  console.log(`t=${court.t.toFixed(2)} mode=${mode} fzL=${ctl.sensors.feet[0]!.fz.toFixed(0)} fzR=${ctl.sensors.feet[1]!.fz.toFixed(0)} hipHigh=${f(dbg?.hipHigh)} gate=${f(dbg?.baseGate)} kneeSup=${f(dbg?.kneeSup)} lat=${f(dbg?.lateralFoot0)} sel=${String(dbg?.shankSelSide)} fLat=${f(dbg?.latF)} fPerp=${f(dbg?.latPerp)} chain=${f(dbg?.latChain)} copZ=${f(dbg?.latCopZ)} fric=${f(dbg?.latFric)} copIn=${String(dbg?.latCopIn)}`);
  console.log(`  ik      h0=${f(ik?.hip0)} h2=${f(ik?.hip2)} k2=${f(ik?.knee2)} a0=${f(ik?.foot0)} a2=${f(ik?.foot2)}`);
  console.log(`  target  h0=${f(dbg?.hip0T)} h2=${f(dbg?.hip2T)} k0=${f(dbg?.knee0T)} k2=${f(dbg?.knee2T)} a0=${f(dbg?.lateralFoot0)} a2=${f(dbg?.foot2T)}`);
  console.log(`  actual  h0=${ang('hip_l', 0).toFixed(1)} h2=${ang('hip_l', 2).toFixed(1)} k0=${ang('knee_l', 0).toFixed(1)} k2=${ang('knee_l', 2).toFixed(1)} a0=${ang('foot_l', 0).toFixed(1)} a2=${ang('foot_l', 2).toFixed(1)}`);
  console.log(`  L0 ${led('hip_l', 0)} | L2 ${led('hip_l', 2)} | K2 ${led('knee_l', 2)} | A0 ${led('foot_l', 0)} | A2 ${led('foot_l', 2)}`);
  for (const nm of ['knee_l/0', 'foot_l/0']) {
    const pp = (globalThis as { __PD_PARTS?: Record<string, Record<string, number | boolean>> }).__PD_PARTS?.[nm];
    if (pp) console.log(`  ${nm} target=${Number(pp.target).toFixed(3)} angle=${Number(pp.angle).toFixed(3)} pos=${Number(pp.posTerm).toFixed(2)} damp=${Number(pp.dampUse).toFixed(2)} raw0=${Number(pp.rawPd0).toFixed(2)} dead=${Number(pp.dead).toFixed(2)} raw=${Number(pp.rawPd).toFixed(2)} ff=${Number(pp.ff).toFixed(2)} passive=${Number(pp.passive).toFixed(2)} tau=${Number(pp.tau).toFixed(2)} cap=${Number(pp.cap).toFixed(2)}`);
  }
  if (court.fall >= 0) break;
}
console.log(`END t=${court.t.toFixed(2)} fall=${court.fall >= 0 ? court.fall.toFixed(2) : 'none'}`);
