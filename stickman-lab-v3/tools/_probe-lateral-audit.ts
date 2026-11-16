/** _probe-lateral-audit.ts —— 侧向四写手净效果回读（§侧向重构 ①） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const di = w.body.dofByName('hip_r', 0);
console.log('t     相位        posture指令 posHip(姿态通道) 力偶τ   drive目标  实际角');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.5 || t > 5.2) continue;
  if (s % Math.round(0.1 / w.dt) !== 0) continue;
  const tgt = (w.drive as unknown as { target: Float64Array }).target[di]!;
  const fl = w.body.footNormalForce('l', w.dt), fr = w.body.footNormalForce('r', w.dt);
  const imb = (fl + fr) > 1e-6 ? Math.abs(fl - fr) / (fl + fr) : 0;
  const yL = w.body.bodies[w.body.indexByKey.get('foot_l')!]!.translation().y;
  const yR = w.body.bodies[w.body.indexByKey.get('foot_r')!]!.translation().y;
  const gY = Math.min(yL, yR);
  (globalThis as any).__dbg = `fl=${fl.toFixed(0)} fr=${fr.toFixed(0)} imb=${imb.toFixed(2)} gapL=${(yL-gY).toFixed(3)} gapR=${(yR-gY).toFixed(3)}`;
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(10)} ` +
    `[${ctl.warner.supportState.mode}] ${ctl.warner.lastPostureHip.toFixed(3).padStart(8)} ${ctl.lean.postureHipNow.toFixed(3).padStart(10)} ` +
    `${ctl.lean.coupleNow.toFixed(1).padStart(6)} ${Number.isNaN(tgt) ? 'NaN' : tgt.toFixed(3).padStart(8)} ` +
    `${w.body.dofs[di]!.angle.toFixed(3).padStart(7)}  ${(globalThis as any).__dbg}`,
  );
}
