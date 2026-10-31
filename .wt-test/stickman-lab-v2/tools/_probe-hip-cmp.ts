import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const TAU = Number(process.env.TAU ?? 10);
const MODE = (process.env.MODE ?? 'common').trim();
const T0 = Number(process.env.T0 ?? 2.10);
const HOLD = Number(process.env.HOLD ?? 0.15);
const T_END = Number(process.env.T_END ?? 3.0);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const hl = w.body.dofByName('hip_l', 0);
const hr = w.body.dofByName('hip_r', 0);
const robustRoll = (): number => {
  const i = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
  if (i === undefined) return 0;
  const q = w.body.bodies[i]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  return Math.atan2(uz, Math.hypot(ux, uy));
};
const hipC = (): number => {
  if (hl < 0 || hr < 0) return 0;
  return (w.body.dofs[hl]!.anchorWorld[2]! + w.body.dofs[hr]!.anchorWorld[2]!) / 2;
};
const row = (tag: string): void => {
  const L = w.lateral.state;
  console.log(`${tag} t=${(court ? court.t : w.clock).toFixed(3)} com=${(L.comZ * 1000).toFixed(2)} v=${(L.comVelZ * 1000).toFixed(0)} xi=${(L.xiZ * 1000).toFixed(2)} cop=${(L.copZ * 1000).toFixed(2)} cmp=${(L.cmpZ * 1000).toFixed(2)} hipC=${(hipC() * 1000).toFixed(2)} roll=${(robustRoll() * 57.3).toFixed(2)} load=${L.loadDiff.toFixed(0)} tau=${TAU}`);
};
let base: { com: number; xi: number; cop: number; cmp: number; hipC: number; roll: number } | null = null;
let resp: typeof base = null;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1, () => {
    if (w.clock < T0 || w.clock > T0 + HOLD) return;
    if (hl < 0 || hr < 0) return;
    w.executor.addTorque(hl, TAU);
    w.executor.addTorque(hr, MODE === 'diff' ? -TAU : TAU);
  });
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (!base && t >= T0 - 0.02) {
    const L = w.lateral.state;
    base = { com: L.comZ, xi: L.xiZ, cop: L.copZ, cmp: L.cmpZ, hipC: hipC(), roll: robustRoll() };
    row('BASE');
  }
  if (!resp && t >= T0 + HOLD - 0.02) {
    const L = w.lateral.state;
    resp = { com: L.comZ, xi: L.xiZ, cop: L.copZ, cmp: L.cmpZ, hipC: hipC(), roll: robustRoll() };
    row('RESP');
  }
  if (base && resp && t >= T0 + HOLD + 0.05) break;
}
if (base && resp) {
  const d = (a: number, b: number): string => ((a - b) * 1000).toFixed(2);
  console.log(`RESULT tau=${TAU} mode=${MODE} dCom=${d(resp.com, base.com)}mm dXi=${d(resp.xi, base.xi)}mm dCop=${d(resp.cop, base.cop)}mm dCmp=${d(resp.cmp, base.cmp)}mm dHipC=${d(resp.hipC, base.hipC)}mm dRoll=${((resp.roll - base.roll) * 57.3).toFixed(2)}deg fall=${court && court.fall >= 0 ? court.fall.toFixed(2) : '-'}`);
} else {
  console.log('RESULT no data');
}
