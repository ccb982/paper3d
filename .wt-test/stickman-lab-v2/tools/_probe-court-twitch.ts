/** _probe-court-twitch: 蹲姿法庭放开后腿抖（网页默认参数） */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);
const names = ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r'] as const;
const dofs: Array<{ n: string; ax: number; i: number }> = [];
for (const n of names) for (const ax of [0, 2] as const) {
  const i = w.body.dofByName(n, ax);
  if (i >= 0) dofs.push({ n, ax, i });
}
let last = -1;
let maxV = 0;
const flips = new Map<number, { prev: number; n: number }>();
console.log(`env SC_SQUAT_LEGS=${process.env.SC_SQUAT_LEGS ?? '(default 2)'} FOOT_DEG=${process.env.SQC_LAT_LOCK_FOOT_DEG ?? '(default 0)'} TRUNK=${process.env.SQC_TRUNK ?? '0'}`);
for (let s = 0; s < Math.round(6 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  if (!court.released) continue;
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
  const rel = court.t - court.settle;
  if (rel < 0.05 || w.clock - last < 0.1) continue;
  last = w.clock;
  const v = (n: string, ax: number): string => {
    const i = w.body.dofByName(n, ax);
    return i >= 0 ? w.body.dofs[i]!.vel.toFixed(2) : '-';
  };
  const nf = [...flips.values()].reduce((a, b) => a + b.n, 0);
  const c = ctl.sensors.com;
  console.log(`CT rel=${rel.toFixed(2)} comY=${(c[1]! * 100).toFixed(1)} comZ=${(c[2]! * 100).toFixed(1)} kneeV=${v('knee_l', 2)}/${v('knee_r', 2)} hipV=${v('hip_l', 2)}/${v('hip_r', 2)} footV=${v('foot_l', 2)}/${v('foot_r', 2)} latV=${v('hip_l', 0)}/${v('knee_l', 0)}/${v('foot_l', 0)} frameMax=${frameMax.toFixed(2)} flips=${nf} maxV=${maxV.toFixed(2)} fall=${court.fall >= 0 ? (court.fall - court.settle).toFixed(2) : '-'}`);
  if (rel > 2.0) break;
}
console.log(`DONE maxV=${maxV.toFixed(2)} flips=${[...flips.values()].reduce((a, b) => a + b.n, 0)} fall=${court.fall >= 0 ? (court.fall - court.settle).toFixed(2) : 'none'}`);
