/** 临时：姿势基线时刻的 ff/pin 直读 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const dKnee = w.body.dofByName('knee_r', 2);
const orig = ctl.warner.contributeBaseline.bind(ctl.warner);
(ctl.warner as any).contributeBaseline = (skip?: Set<number>) => {
  const t = (globalThis as any).__t ?? 0;
  if (t > 3.6 && t < 3.9 && (globalThis as any).__n++ % 60 === 0) {
    console.log(`  t=${t.toFixed(2)} 姿势时刻: ff=${w.drive.ffOf(dKnee).toFixed(1)} pin=${ctl.warner.manual.isPinned('knee_r', 2)} hasAngle=${ctl.warner.manual.hasAngle(dKnee)} target=${Number.isNaN(w.drive.target[dKnee]!) ? 'NaN' : w.drive.target[dKnee]!.toFixed(2)}`);
  }
  return orig(skip);
};
(globalThis as any).__n = 0;
ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  (globalThis as any).__t = s * w.dt;
  w.advance(1);
}
