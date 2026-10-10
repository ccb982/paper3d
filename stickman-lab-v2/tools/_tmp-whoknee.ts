/** 临时：追踪支撑膝 drive 目标的写入者 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const dKnee = w.body.dofByName('knee_r', 2);
const orig = w.drive.setAngle.bind(w.drive);
const hits = new Map<string, number>();
(globalThis as any).__p = 0;
(w.drive as any).setAngle = (i: number, rad: number, kp?: number, kd?: number) => {
  if (i === dKnee && (globalThis as any).__traceOn) {
    const st = new Error().stack ?? '';
    const lines = st.split('\n').slice(2, 5).map((l) => l.trim().replace(/.*[\/]/, '').replace(/\)$/, ''));
    const key = lines.join(' | ');
    hits.set(key, (hits.get(key) ?? 0) + 1);
  }
  return orig(i, rad, kp, kd);
};
ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  (globalThis as any).__traceOn = true;
  (globalThis as any).__t = s * w.dt;
  w.advance(1);
}
console.log('写入者统计（B 相窗口）：');
for (const [k, v] of [...hits.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}x  ${k}`);
