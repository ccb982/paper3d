import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import { captureSquatCourt, type CourtState } from '../src/core/court';
import { squatFrame } from '../src/core/servo/squat';
import { sampleFootContact } from '../src/core/servo/footContact';

const T_END = Number(process.env.T_END ?? 9.0);
const AFTER = Number(process.env.AFTER ?? 0.60);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
ctl.actions.idleEnabled = false;
w.reset();
w.switchPoseState('stand');
ctl.actions.play('squatDown');

let court: CourtState | null = null;
let handT = -1;
const fmt = (v: number, n = 1): string => (Number.isFinite(v) ? v.toFixed(n) : '-');
const ang = (n: string, ax: number): number => {
  const i = w.body.dofByName(n, ax);
  return i >= 0 ? w.body.dofs[i]!.angle * 57.2958 : 0;
};
const pitchOf = (q: { x: number; y: number; z: number; w: number } | undefined): number => {
  if (!q) return 0;
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  return Math.atan2(ux, uy) * 57.29578;
};
const footY = (s: 'l' | 'r'): number => {
  const i = w.body.indexByKey.get(`foot_${s}`);
  return i === undefined ? NaN : w.body.bodies[i]!.translation().y;
};
const footQ = (s: 'l' | 'r'): { x: number; y: number; z: number; w: number } | undefined => {
  const i = w.body.indexByKey.get(`foot_${s}`);
  return i === undefined ? undefined : w.body.bodies[i]!.rotation();
};
const dbg = (s: 'l' | 'r'): Record<string, number> =>
  (globalThis as { __SQC_KNEE_FOOT_DBG?: Record<string, Record<string, number>> }).__SQC_KNEE_FOOT_DBG?.[s] ?? {};
const tau = (n: string, ax: number): number => {
  const i = w.body.dofByName(n, ax);
  return i >= 0 ? w.executor.ledger[i]?.applied ?? 0 : 0;
};
const sideName = (s: 'l' | 'r'): string => (s === 'l' ? 'L' : 'R');

console.log('rel side footY pitch contact state fz fzLp fzHeld load latch count fzTgt share fzTotDes fzDes fzCmd fzUse floor max supC idH idK idA hipFf kneeFf hipAp kneeAp footAp ikH ikK tgtY tgtPitch hipY comY comVY');
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
  w.advance(1);
  const t = w.clock;
  if (!court) {
    const knee = ang('knee_l', 2);
    const phase = ctl.actions.status.phase;
    if ((phase === '交接' && knee < -60) || (!ctl.actions.status.active && t > 4)) {
      ctl.actions.abort();
      ctl.manual.clear();
      court = captureSquatCourt(w, ctl);
      handT = t;
      console.log(`HANDOFF t=${t.toFixed(3)} knee=${knee.toFixed(1)} phase=${phase}`);
    }
  }
  if (court) squatFrame(w, ctl, court);
  if (handT < 0) continue;
  const rel = t - handT;
  if (rel < -0.02 || rel > AFTER) continue;
  for (const side of ['l', 'r'] as const) {
    const fc = sampleFootContact(w, side);
    const d = dbg(side);
    const tgt = ctl.footAnkle.world.pose.get(side);
    const hi = w.body.dofByName(`hip_${side}`, 2);
    const hipY = hi >= 0 ? w.body.dofs[hi]!.anchorWorld[1]! : 0;
    console.log(
      `${rel.toFixed(3)} ${sideName(side)} ${fmt(footY(side), 4)} ${fmt(pitchOf(footQ(side)), 1)} ${fc.contact ? 1 : 0} ${fc.state} ` +
      `${fmt(fc.fz, 0)} ${fmt(fc.fzFiltered, 0)} ${fmt(fc.fzHeld, 0)} ${fc.loadValid ? 1 : 0} ${d.contactLatch ?? 0} ${d.contactLatch === 1 ? 'ON' : 'off'} ${fmt(d.contactFzLp ?? 0, 0)} ` +
      `| ${fmt(d.fzDesired ?? 0, 0)} ${fmt(d.fzShare ?? 0, 2)} ${fmt(d.fzTotalDesired ?? 0, 0)} ${fmt(d.fzDesired ?? 0, 0)} ${fmt(d.fzCmd ?? 0, 0)} ${fmt(d.fzUse ?? 0, 0)} ${fmt(d.fzAbsFloor ?? 0, 0)} ${fmt(d.fzAbsMax ?? 0, 0)} ${d.supportContact ?? 0} ` +
      `| ${fmt(d.idHip ?? 0, 0)} ${fmt(d.idKnee ?? 0, 0)} ${fmt(d.idAnkle ?? 0, 0)} ${fmt(d.hipFf ?? 0, 0)} ${fmt(d.kneeFf ?? 0, 0)} ${fmt(d.appliedHip ?? 0, 0)} ${fmt(d.appliedKnee ?? 0, 0)} ${fmt(d.appliedAnkle ?? 0, 0)} ${fmt(d.ikHip ?? 0, 0)} ${fmt(d.ikKnee ?? 0, 0)} ` +
      `| ${fmt(tgt?.p.y ?? 0, 4)} ${fmt(pitchOf(tgt?.q), 1)} ${fmt(hipY, 4)} ${fmt(ctl.sensors.com[1]!, 4)} ${fmt(ctl.sensors.comVel[1]!, 2)}`,
    );
  }
  if (court && court.fall >= 0 && rel > 0.05) {
    console.log(`FALL rel=${rel.toFixed(3)} reason=${court.reason}`);
    break;
  }
}
console.log(`RESULT handT=${handT.toFixed(2)} fall=${court && court.fall >= 0 ? `${Math.max(0, court.fall - court.settle).toFixed(3)}s ${court.reason}` : 'none'}`);
