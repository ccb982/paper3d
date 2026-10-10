/** 临时：追踪支撑髋外展（hip_r 轴0）写手 + 目标 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const dAb = w.body.dofByName('hip_r', 0);
const hits = new Map<string, number>();
const orig = w.drive.setAngle.bind(w.drive);
(w.drive as any).setAngle = (i: number, rad: number, kp?: number, kd?: number) => {
  const t = (globalThis as any).__t ?? 0;
  if (i === dAb && t > 4.3 && t < 5.0) {
    const st = (new Error().stack ?? '').split('\n')[2] ?? '';
    const key = st.trim().split('/').pop()?.slice(0, 60) ?? '?';
    hits.set(key, (hits.get(key) ?? 0) + 1);
  }
  return orig(i, rad, kp, kd);
};
ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  (globalThis as any).__t = s * w.dt;
  w.advance(1);
}
console.log('外展轴写手（4.3-5.0）：');
for (const [k, v] of [...hits.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}x  ${k}`);
console.log(`结束 target=${Number.isNaN(w.drive.target[dAb]!) ? 'NaN' : w.drive.target[dAb]!.toFixed(3)} kp=${(w.drive.kp[dAb] ?? 0).toFixed(0)}`);
