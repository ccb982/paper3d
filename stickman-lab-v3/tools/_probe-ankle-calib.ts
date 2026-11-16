/** _probe-ankle-calib: 法庭预载/释放瞬间 脚踝矢状力矩标定 */
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
const buf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
const report = (tag: string): void => {
  const b = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  const comX = ctl.sensors.com[0]!;
  console.log(`--- ${tag} t=${court.t.toFixed(3)} rel=${court.released} comX=${(comX*100).toFixed(1)}cm`);
  for (const sd of ['l','r'] as const) {
    const fi = w.body.dofByName(`foot_${sd}`, 2);
    const d = w.body.dofs[fi]!;
    const fz = w.body.footNormalForce(sd, w.dt);
    const cop = ctl.sensors.feet[sd==='l'?0:1]!;
    const ax = d.anchorWorld[0]!;
    const base = b ? b[fi] ?? 0 : 0;
    const req = -fz * (cop.copX - ax);
    console.log(`${sd} fz=${fz.toFixed(0)} copX=${(cop.copX*100).toFixed(1)}cm ankleX=${(ax*100).toFixed(1)}cm comX=${(comX*100).toFixed(1)}cm req=${req.toFixed(1)} base=${base.toFixed(1)} ang=${(d.angle*57.3).toFixed(1)}° vel=${d.vel.toFixed(3)} axisZ=${d.axisWorld[2]!.toFixed(2)}`);
  }
};
for (let s=0; s<Math.round(2.2/w.dt); s++) {
  supportClean(ctx,'r'); supportClean(ctx,'l'); w.advance(1); squatFrame(w,ctl,court);
  if (s === Math.round(1.9/w.dt)) report('pre-release');
  if (s === Math.round(2.05/w.dt)) report('post-release');
  if (s === Math.round(2.15/w.dt)) report('post2');
}
