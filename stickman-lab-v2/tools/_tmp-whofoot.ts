import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const d = w.body.dofByName('foot_r', 0);
const hits = new Map<string, number>();
const origT = ctl.warner.drive.setTorque.bind(ctl.warner.drive);
(ctl.warner.drive as any).setTorque = (i: number, t: number) => {
  if (i === d && (globalThis as any).__on) {
    const st = (new Error().stack ?? '').split('\n')[2]?.trim().replace(/.*[\\/]/, '').slice(0, 60) ?? '?';
    hits.set('TQ ' + st, (hits.get('TQ ' + st) ?? 0) + 1);
  }
  return origT(i, t);
};
const orig = ctl.warner.manual.setAngle.bind(ctl.warner.manual);
(ctl.warner.manual as any).setAngle = (j: string, a: number, rad: number, kp?: number, kd?: number) => {
  const i = w.body.dofByName(j, a);
  if (i === d && (globalThis as any).__on) {
    const st = (new Error().stack ?? '').split('\n')[2]?.trim().replace(/.*[\\/]/, '').slice(0, 60) ?? '?';
    hits.set(st, (hits.get(st) ?? 0) + 1);
  }
  return orig(j, a, rad, kp, kd);
};
ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round(5.0 / w.dt); s++) {
  (globalThis as any).__on = s * w.dt > 3.4 && s * w.dt < 4.8;
  w.advance(1);
}
console.log('foot_r/0 写手（3.4-4.8）：');
for (const [k, v] of [...hits.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}x ${k}`);
