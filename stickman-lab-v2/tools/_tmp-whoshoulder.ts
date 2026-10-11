import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const d = w.body.dofByName('shoulder_l', 2);
const hits = new Map<string, number>();
const orig = w.drive.setAngle.bind(w.drive);
(w.drive as any).setAngle = (i: number, rad: number, kp?: number, kd?: number) => {
  if (i === d && (globalThis as any).__on) {
    const st = (new Error().stack ?? '').split('\n')[2]?.trim().replace(/.*[\/]/, '').slice(0, 60) ?? '?';
    hits.set(st, (hits.get(st) ?? 0) + 1);
  }
  return orig(i, rad, kp, kd);
};
ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  (globalThis as any).__on = s * w.dt > 4.4 && s * w.dt < 5.4;
  w.advance(1);
}
console.log('肩L/2 写手（C 相窗口）：');
for (const [k, v] of [...hits.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}x ${k}`);
