import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const DOF = (process.env.DOF ?? 'spine1').trim();
const AX = Number(process.env.AX ?? 0);
const TAU = Number(process.env.TAU ?? 5);
const MODE = (process.env.MODE ?? 'common').trim(); // common | diff
const T0 = Number(process.env.T0 ?? 2.1);
const HOLD = Number(process.env.HOLD ?? 0.4);
const T_END = Number(process.env.T_END ?? 3.2);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const dl = w.body.dofByName(`${DOF}_l`, AX);
const dr = w.body.dofByName(`${DOF}_r`, AX);
const single = w.body.dofByName(DOF, AX);

const robust = (): { pitch: number; roll: number } => {
  const i = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
  if (i === undefined) return { pitch: 0, roll: 0 };
  const q = w.body.bodies[i]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  return { pitch: Math.atan2(ux, uy), roll: Math.atan2(uz, Math.hypot(ux, uy)) };
};
const anc = (name: string, ax: number): number => {
  const i = w.body.dofByName(name, ax);
  return i >= 0 ? w.body.dofs[i]!.anchorWorld[2]! : 0;
};
let base: { pitch: number; roll: number; comZ: number; copZ: number; hipC: number; hipW: number; load: number } | null = null;
let resp: typeof base = null;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1, () => {
    if (w.clock < T0 || w.clock > T0 + HOLD) return;
    if (single >= 0) w.executor.addTorque(single, TAU);
    else if (dl >= 0 && dr >= 0) {
      w.executor.addTorque(dl, MODE === 'diff' ? TAU : TAU);
      w.executor.addTorque(dr, MODE === 'diff' ? -TAU : TAU);
    }
  });
  if (court) squatFrame(w, ctl, court);
  if (!base && w.clock >= T0 - 0.02) {
    const t = robust();
    const L = w.lateral.state;
    base = { pitch: t.pitch, roll: t.roll, comZ: L.comZ, copZ: L.copZ, hipC: (anc('hip_l', 0) + anc('hip_r', 0)) / 2, hipW: anc('hip_l', 0) - anc('hip_r', 0), load: L.loadDiff };
  }
  if (!resp && w.clock >= T0 + HOLD - 0.02) {
    const t = robust();
    const L = w.lateral.state;
    resp = { pitch: t.pitch, roll: t.roll, comZ: L.comZ, copZ: L.copZ, hipC: (anc('hip_l', 0) + anc('hip_r', 0)) / 2, hipW: anc('hip_l', 0) - anc('hip_r', 0), load: L.loadDiff };
  }
}
if (base && resp) {
  const d = (a: number, b: number): string => ((a - b) * 1000).toFixed(1);
  console.log(`RESULT ${DOF}/${AX} mode=${MODE} tau=${TAU}Nm dPitch=${((resp.pitch - base.pitch) * 57.3).toFixed(2)}deg dRoll=${((resp.roll - base.roll) * 57.3).toFixed(2)}deg dComZ=${d(resp.comZ, base.comZ)}mm dCopZ=${d(resp.copZ, base.copZ)}mm dHipC=${d(resp.hipC, base.hipC)}mm dHipW=${d(resp.hipW, base.hipW)}mm dLoad=${(resp.load - base.load).toFixed(0)}N fall=${court && court.fall >= 0 ? court.fall.toFixed(2) : '-'}`);
} else {
  console.log('RESULT no base/resp');
}
