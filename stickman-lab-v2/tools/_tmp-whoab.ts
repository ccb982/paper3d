import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const d = w.body.dofByName('hip_l', 0);
const hits = new Map<string, number>();
const orig = w.drive.setAngle.bind(w.drive);
(w.drive as any).setAngle = (i: number, rad: number, kp?: number, kd?: number) => {
  if (i === d && (globalThis as any).__on) {
    const st = (new Error().stack ?? '').split('\n')[2]?.trim().split(/[\/]/).pop()?.slice(0, 60) ?? '?';
    hits.set(st, (hits.get(st) ?? 0) + 1);
  }
  return orig(i, rad, kp, kd);
};
ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round(5 / w.dt); s++) {
  (globalThis as any).__on = s * w.dt > 3.6 && s * w.dt < 4.3;
  w.advance(1);
}
console.log('摆动髋ab 写手（B 窗口）：');
for (const [k, v] of [...hits.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}x ${k}`);
console.log(`末态 target=${w.drive.target[d]!.toFixed(3)} kp=${w.drive.kp[d]!.toFixed(0)}`);
