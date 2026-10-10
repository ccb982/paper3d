/** 临时：knee_r 的 setAngle 全量记录（B 窗口） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const dKnee = w.body.dofByName('knee_r', 2);
const orig = w.drive.setAngle.bind(w.drive);
(w.drive as any).setAngle = (i: number, rad: number, kp?: number, kd?: number) => {
  const t = (globalThis as any).__t ?? 0;
  if (i === dKnee && t > 3.55 && t < 3.72) {
    const st = (new Error().stack ?? '').split('\n')[2] ?? '';
    console.log(`  t=${t.toFixed(3)} rad=${rad.toFixed(3)} kp=${(kp ?? 0).toFixed(0)} <- ${st.trim().slice(0, 110)}`);
  }
  return orig(i, rad, kp, kd);
};
ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  (globalThis as any).__t = s * w.dt;
  w.advance(1);
}
