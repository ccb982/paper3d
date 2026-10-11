import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const d = w.body.dofByName('hip_l', 0);
const hits = new Map<string, number>();
const orig = ctl.warner.manual.setAngle.bind(ctl.warner.manual);
(ctl.warner.manual as any).setAngle = (j: string, a: number, rad: number, kp?: number, kd?: number) => {
  const i = w.body.dofByName(j, a);
  if (i === d && (globalThis as any).__on) {
    const st = (new Error().stack ?? '').split('\n')[2]?.trim().replace(/.*[\/]/, '').slice(0, 70) ?? '?';
    hits.set(st, (hits.get(st) ?? 0) + 1);
  }
  return orig(j, a, rad, kp, kd);
};
ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round(5 / w.dt); s++) {
  (globalThis as any).__on = s * w.dt > 3.0 && s * w.dt < 4.5;
  w.advance(1);
}
console.log('hip_l/0 的 manual.setAngle 调用者（A/B 窗口）：');
for (const [k, v] of [...hits.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}x ${k}`);
console.log(`hasAngle=${ctl.warner.manual.hasAngle(d)}`);
