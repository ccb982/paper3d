/** _probe-squat-twitch: 正常蹲下→交接→伺服，测腿抖（网页默认参数） */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import { captureSquatCourt, type CourtState } from '../src/core/court';
import { squatFrame } from '../src/core/servo/squat';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
ctl.actions.idleEnabled = false;
w.reset();
w.switchPoseState('stand');
ctl.actions.play('squatDown');

const names = ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r'] as const;
const dofs: Array<{ n: string; ax: number; i: number }> = [];
for (const n of names) for (const ax of [0, 2] as const) {
  const i = w.body.dofByName(n, ax);
  if (i >= 0) dofs.push({ n, ax, i });
}
let court: CourtState | null = null;
let handT = -1;
let last = -1;
const flips = new Map<number, { prev: number; n: number }>();
let maxV = 0;
const start = Number(process.env.TSTART ?? 0);
const HT = Number(process.env.HT ?? -1);
console.log(`env SC_SQUAT_LEGS=${process.env.SC_SQUAT_LEGS ?? '(default 2)'} FOOT_DEG=${process.env.SQC_LAT_LOCK_FOOT_DEG ?? '(default 0)'}`);
for (let s = 0; s < Math.round(10 / w.dt); s++) {
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
  w.advance(1);
  if (!court) {
    const knee = w.body.dofs[w.body.dofByName('knee_l', 2)]!.angle;
    const forced = ctl.actions.status.phase === '交接' && knee < -60 / 57.29578;
    const idleEnd = !ctl.actions.status.active && w.clock > 4;
    const timed = HT > 0 && w.clock >= HT;
    if (forced || idleEnd || timed) {
      ctl.actions.abort();
      ctl.manual.clear();
      court = captureSquatCourt(w, ctl);
      handT = w.clock;
      console.log(`HANDOFF t=${handT.toFixed(2)} knee=${(knee * 57.3).toFixed(0)} forced=${forced} idleEnd=${idleEnd} timed=${timed}`);
    }
  }
  if (court) squatFrame(w, ctl, court);
  if (handT < 0) continue;
  const t = w.clock - handT;
  if (t < start) continue;
  let frameMax = 0;
  for (const d of dofs) {
    const v = w.body.dofs[d.i]!.vel;
    frameMax = Math.max(frameMax, Math.abs(v));
    maxV = Math.max(maxV, Math.abs(v));
    const st = flips.get(d.i) ?? { prev: v, n: 0 };
    if (st.prev * v < -1e-9 && Math.abs(v) > 0.05) st.n++;
    st.prev = v;
    flips.set(d.i, st);
  }
  if (w.clock - last >= 0.1) {
    last = w.clock;
    const v = (n: string, ax: number): string => {
      const i = w.body.dofByName(n, ax);
      return i >= 0 ? w.body.dofs[i]!.vel.toFixed(2) : '-';
    };
    const nf = [...flips.values()].reduce((a, b) => a + b.n, 0);
    const c = ctl.sensors.com;
    console.log(`TW t=${t.toFixed(2)} hand+${(w.clock - handT).toFixed(2)} comY=${(c[1]! * 100).toFixed(1)} comX=${(c[0]! * 100).toFixed(1)} kneeV=${v('knee_l', 2)}/${v('knee_r', 2)} hipV=${v('hip_l', 2)}/${v('hip_r', 2)} footV=${v('foot_l', 2)}/${v('foot_r', 2)} latV=${v('hip_l', 0)}/${v('knee_l', 0)} frameMax=${frameMax.toFixed(2)} flips=${nf} maxV=${maxV.toFixed(2)} fall=${court.fall}`);
    if (t > 2.0) break;
  }
}
console.log(`DONE hand=${handT >= 0 ? handT.toFixed(2) : '-'} maxV=${maxV.toFixed(2)} flips=${[...flips.values()].reduce((a, b) => a + b.n, 0)}`);
