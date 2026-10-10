/** 临时：clearAngle 与 target 时序 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const dKnee = w.body.dofByName('knee_r', 2);
const origSet = w.drive.setAngle.bind(w.drive);
(w.drive as any).setAngle = (i: number, rad: number, kp?: number, kd?: number) => {
  const t = (globalThis as any).__t ?? 0;
  if (i === dKnee && t > 3.61 && t < 3.65) console.log(`  t=${t.toFixed(4)} setAngle(rad=${rad.toFixed(3)},kp=${(kp ?? 0).toFixed(0)}) ff=${w.drive.ffOf(i).toFixed(1)} pin=${ctl.warner.manual.isPinned('knee_r', 2)}`);
  return origSet(i, rad, kp, kd);
};
const origCl = ctl.warner.manual.clearAngle.bind(ctl.warner.manual);
(ctl.warner.manual as any).clearAngle = (j: string, a: number) => {
  const t = (globalThis as any).__t ?? 0;
  const i = w.body.dofByName(j, a);
  if (i === dKnee && t > 3.4 && t < 3.9) console.log(`  t=${t.toFixed(3)} clearAngle(${j},${a})`);
  return origCl(j, a);
};
ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  (globalThis as any).__t = s * w.dt;
  w.advance(1);
  const t = s * w.dt;
  if (t > 3.58 && t < 3.75 && s % 24 === 0) {
    console.log(`  t=${t.toFixed(3)} 帧末: target=${Number.isNaN(w.drive.target[dKnee]!) ? 'NaN' : w.drive.target[dKnee]!.toFixed(3)} pin=${ctl.warner.manual.isPinned('knee_r', 2)}`);
  }
}
