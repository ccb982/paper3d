import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import { captureSquatCourt, type CourtState } from '../src/core/court';
import { squatFrame } from '../src/core/servo/squat';
import { sampleFootContact } from '../src/core/servo/footContact';

const T_END = Number(process.env.T_END ?? 20);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
ctl.actions.idleEnabled = false;
w.reset();
w.switchPoseState('stand');
ctl.actions.play('squatDown');

let t0 = w.clock;
let handT = -1;
let hold: CourtState | null = null;
let comY0 = NaN;
let pitch0 = NaN;
let roll0 = NaN;
let lostContactT = 0;
let fallT = -1;
let reason = '';
const dbg = (s: 'l' | 'r'): Record<string, number> =>
  (globalThis as { __SQC_KNEE_FOOT_DBG?: Record<string, Record<string, number>> }).__SQC_KNEE_FOOT_DBG?.[s] ?? {};
const tau = (n: string, ax: number): number => {
  const i = w.body.dofByName(n, ax);
  return i >= 0 ? w.executor.ledger[i]?.applied ?? 0 : 0;
};
const f1 = (v: number, n = 1): string => (Number.isFinite(v) ? v.toFixed(n) : '-');
const pitchOf = (q: { x: number; y: number; z: number; w: number }): number => {
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  return Math.atan2(ux, uy) * 57.29578;
};
const rollOf = (q: { x: number; y: number; z: number; w: number }): number => {
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  return Math.atan2(uz, Math.hypot(ux, uy)) * 57.29578;
};

for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
  w.advance(1);
  if (!hold) {
    const phase = ctl.actions.status.phase;
    const knee = (() => {
      const i = w.body.dofByName('knee_l', 2);
      return i >= 0 ? w.body.dofs[i]!.angle : 0;
    })();
    if ((phase === '交接' && knee < -60) || (!ctl.actions.status.active && w.clock - t0 > 4)) {
      ctl.actions.abort();
      ctl.manual.clear();
      hold = captureSquatCourt(w, ctl);
      handT = w.clock;
      comY0 = ctl.sensors.com[1]!;
      {
        const ti0 = w.body.indexByKey.get('spine4');
        const q0 = ti0 !== undefined ? w.body.bodies[ti0]!.rotation() : { x: 0, y: 0, z: 0, w: 1 };
        pitch0 = pitchOf(q0);
        roll0 = rollOf(q0);
      }
      console.log(`HANDOFF t=${handT.toFixed(3)} comY=${comY0.toFixed(3)} pitch0=${pitch0.toFixed(1)} roll0=${roll0.toFixed(1)}`);
    }
  }
  if (hold) squatFrame(w, ctl, hold);
  if (hold && handT >= 0 && w.clock - handT <= 0.30) {
    const rel = w.clock - handT;
    for (const side of ['l', 'r'] as const) {
      const fc = sampleFootContact(w, side);
      const d = dbg(side);
      const bi = w.body.indexByKey.get(`foot_${side}`);
      const footY = bi !== undefined ? w.body.bodies[bi]!.translation().y : NaN;
      const pitch = bi !== undefined ? pitchOf(w.body.bodies[bi]!.rotation()) : NaN;
      console.log(
        `F ${rel.toFixed(3)} ${side} footY=${f1(footY, 4)} pitch=${f1(pitch)} contact=${fc.contact ? 1 : 0} fz=${f1(fc.fz, 0)} ` +
        `fzUse=${f1(d.fzUse ?? 0, 0)} fzTot=${f1(d.fzTotalDesired ?? 0, 0)} fzDes=${f1(d.fzDesired ?? 0, 0)} fzCmd=${f1(d.fzCmd ?? 0, 0)} share=${f1(d.fzShare ?? 0, 2)} ` +
        `idH=${f1(d.idHip ?? 0, 0)} idK=${f1(d.idKnee ?? 0, 0)} hipFf=${f1(d.hipFf ?? 0, 0)} kneeFf=${f1(d.kneeFf ?? 0, 0)} ` +
        `apH=${f1(tau(`hip_${side}`, 2), 0)} apK=${f1(tau(`knee_${side}`, 2), 0)} apA=${f1(tau(`foot_${side}`, 2), 0)} ` +
        `handH=${f1(d.handHip ?? 0, 0)} handK=${f1(d.handKnee ?? 0, 0)}`,
      );
    }
    const hi = w.body.dofByName('hip_l', 2);
    const hipY = hi >= 0 ? w.body.dofs[hi]!.anchorWorld[1]! : NaN;
    console.log(`F ${rel.toFixed(3)} center hipY=${f1(hipY, 4)} comY=${f1(ctl.sensors.com[1]!, 4)} comVY=${f1(ctl.sensors.comVel[1]!, 2)}`);
  }
  if (hold && fallT < 0) {
    const comY = ctl.sensors.com[1]!;
    const ti = w.body.indexByKey.get('spine4');
    const q = ti !== undefined ? w.body.bodies[ti]!.rotation() : { x: 0, y: 0, z: 0, w: 1 };
    const pitch = pitchOf(q);
    const roll = rollOf(q);
    const fzL = w.body.footNormalForce('l', w.dt);
    const fzR = w.body.footNormalForce('r', w.dt);
    const bothLost = fzL < 5 && fzR < 5;
    lostContactT = bothLost ? lostContactT + w.dt : 0;
    if (comY < comY0 - 0.05) { fallT = w.clock; reason = `comY-5cm (${(comY * 100).toFixed(1)} vs ${(comY0 * 100).toFixed(1)})`; }
    else if (Math.abs(pitch - pitch0) > 20) { fallT = w.clock; reason = `torsoPitchΔ=${(pitch - pitch0).toFixed(1)}°`; }
    else if (Math.abs(roll - roll0) > 10) { fallT = w.clock; reason = `torsoRollΔ=${(roll - roll0).toFixed(1)}°`; }
    else if (lostContactT > 0.1) { fallT = w.clock; reason = 'both feet lost >0.1s'; }
  }
  if (fallT >= 0) break;
}
const total = (fallT >= 0 ? fallT : w.clock) - t0;
const descent = handT >= 0 ? handT - t0 : NaN;
const holdTime = fallT >= 0 && handT >= 0 ? fallT - handT : w.clock - handT;
console.log(`RESULT total=${total.toFixed(3)}s descent=${descent.toFixed(3)}s hold=${holdTime.toFixed(3)}s fall=${fallT >= 0 ? 'yes' : 'no'} reason=${reason || '-'}`);
