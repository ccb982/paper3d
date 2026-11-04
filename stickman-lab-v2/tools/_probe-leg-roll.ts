import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
(globalThis as { __IK_DBG?: boolean }).__IK_DBG = true;

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
const ang = (n: string, a: number): number => {
  const i = w.body.dofByName(n, a);
  return i >= 0 ? w.body.dofs[i]!.angle : 0;
};
const anc = (n: string, a: number): { x: number; y: number; z: number } => {
  const i = w.body.dofByName(n, a);
  if (i < 0) return { x: 0, y: 0, z: 0 };
  const p = w.body.dofs[i]!.anchorWorld;
  return { x: p[0]!, y: p[1]!, z: p[2]! };
};
const axis = (n: string, a: number): string => {
  const i = w.body.dofByName(n, a);
  if (i < 0) return '-';
  const u = w.body.dofs[i]!.axisWorld;
  return `(${u[0]!.toFixed(2)},${u[1]!.toFixed(2)},${u[2]!.toFixed(2)})`;
};
const pose = (key: string): { pitch: number; roll: number } => {
  const i = w.body.indexByKey.get(key);
  if (i === undefined) return { pitch: 0, roll: 0 };
  const q = w.body.bodies[i]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  return { pitch: Math.atan2(ux, uy), roll: Math.atan2(uz, Math.hypot(ux, uy)) };
};

let axesPrinted = false;
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  if (court.t < 1.99) continue;
  if (!axesPrinted) {
    axesPrinted = true;
    for (const sd of ['l', 'r'] as const) {
      console.log(`AXES ${sd} hip0=${axis(`hip_${sd}`, 0)} hip2=${axis(`hip_${sd}`, 2)} knee0=${axis(`knee_${sd}`, 0)} foot0=${axis(`foot_${sd}`, 0)}`);
    }
  }
  if (Math.abs(court.t * 20 - Math.round(court.t * 20)) > 1e-6) continue;
  const st = (globalThis as {
    __IK_STATE?: Record<string, {
      H: { z: number };
      ik: { hip0: number; knee0: number; foot0: number };
      targetKnee: { z: number };
      A: { z: number };
    }>
  }).__IK_STATE;
  const tp = pose('torso');
  const sp = pose('spine4');
  const one = (sd: 'l' | 'r'): string => {
    const h = anc(`hip_${sd}`, 0);
    const k = anc(`knee_${sd}`, 0);
    const a = anc(`foot_${sd}`, 0);
    const shankLat = Math.atan2(a.z - k.z, Math.max(1e-4, k.y - a.y)) * D;
    const thighLat = Math.atan2(k.z - h.z, Math.max(1e-4, h.y - k.y)) * D;
    const ik = st?.[sd]?.ik;
    const hz = st?.[sd]?.H.z ?? NaN;
    const kz = st?.[sd]?.targetKnee.z ?? NaN;
    const az = st?.[sd]?.A.z ?? NaN;
    return `${sd} z[h=${h.z.toFixed(3)} k=${k.z.toFixed(3)} a=${a.z.toFixed(3)}] ` +
      `shankLat=${shankLat.toFixed(1)} thighLat=${thighLat.toFixed(1)} ` +
      `ang0=${(ang(`hip_${sd}`, 0) * D).toFixed(1)}/${(ang(`knee_${sd}`, 0) * D).toFixed(1)}/${(ang(`foot_${sd}`, 0) * D).toFixed(1)} ` +
      `ik0=${ik ? `${(ik.hip0 * D).toFixed(1)}/${(ik.knee0 * D).toFixed(1)}/${(ik.foot0 * D).toFixed(1)}` : '-'} ` +
      `H=${hz.toFixed(3)} K*=${kz.toFixed(3)} A=${az.toFixed(3)}`;
  };
  console.log(`t=${court.t.toFixed(2)} pelvisRoll=${(tp.roll * D).toFixed(1)} trunkRoll=${(sp.roll * D).toFixed(1)} ${one('l')} || ${one('r')}`);
  if (court.fall >= 0) { console.log('FALL', court.fall.toFixed(3), court.reason); break; }
}
