/** _probe-upper-fine: 法庭释放后上身各轴高频统计 + top 轴时间序列 */
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
w.controller = ctl; w.reset(); ctl.actions.idleEnabled = false; ctl.manual.clear(); squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);
const names = ['spine1','spine2','spine3','neck','shoulder_l','shoulder_r','elbow_l','elbow_r'];
type AxisStat = { name: string; ax: number; di: number; flips: number; maxV: number; range: number; minA: number; maxA: number; lastA: number; lastV: number; sumAbs: number; n: number; minT: number; maxT: number; };
const stats: AxisStat[] = [];
for (const nm of names) for (const ax of [0,1,2] as const) {
  const di = w.body.dofByName(nm, ax); if (di < 0) continue;
  const d = w.body.dofs[di]!;
  stats.push({ name: nm, ax, di, flips: 0, maxV: 0, range: 0, minA: d.angle, maxA: d.angle, lastA: d.angle, lastV: d.vel, sumAbs: 0, n: 0, minT: Infinity, maxT: -Infinity });
}
const series: string[] = [];
for (let s=0; s<Math.round(2.55/w.dt); s++) {
  supportClean(ctx,'r'); supportClean(ctx,'l'); w.advance(1); squatFrame(w,ctl,court);
  const t = court.t;
  if (t < 2.0 || t > 2.35) continue;
  for (const st of stats) {
    const d = w.body.dofs[st.di]!;
    const app = w.executor.ledger[st.di]!.applied;
    st.n++;
    if (st.n > 1) {
      if ((d.vel > 0) !== (st.lastV > 0) && Math.abs(d.vel) > 0.2) st.flips++;
    }
    st.lastV = d.vel;
    st.maxV = Math.max(st.maxV, Math.abs(d.vel));
    st.minA = Math.min(st.minA, d.angle); st.maxA = Math.max(st.maxA, d.angle);
    st.range = st.maxA - st.minA;
    st.sumAbs += Math.abs(app);
    st.minT = Math.min(st.minT, app); st.maxT = Math.max(st.maxT, app);
    if (st.range > 0.2 || st.maxV > 2) {
      series.push(`${t.toFixed(3)} ${st.name}/${st.ax} a=${(d.angle*57.3).toFixed(1)} v=${d.vel.toFixed(2)} app=${app.toFixed(1)}`);
    }
  }
}
stats.sort((a,b)=> (b.flips*Math.max(0.1,b.maxV)) - (a.flips*Math.max(0.1,a.maxV)));
for (const st of stats.slice(0,12)) console.log(`${st.name}/${st.ax} flips=${st.flips} maxV=${st.maxV.toFixed(2)} range=${(st.range*57.3).toFixed(1)}° app=[${st.minT.toFixed(1)},${st.maxT.toFixed(1)}] meanAbs=${(st.sumAbs/Math.max(1,st.n)).toFixed(1)}`);
console.log('--- top series ---');
console.log(series.slice(-80).join('\n'));
