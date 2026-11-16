import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const detail = (n: string, ax: number): string => {
  const di = body.dofByName(n, ax);
  if (di < 0) return 'n/a';
  const b = ctl.warner.drive.lastBreakdown[di] as any;
  if (!b) return '---';
  return (b.act + b.servo + b.damp).toFixed(0).padStart(5) + '(act' + (b.act || 0).toFixed(0).padStart(5) + ')';
};
const C = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? (ctl.warner.drive.pairC[di] ?? 0) : -1;
};
console.log('t | sp1矩(act) | sp2矩(act) | sp3矩(act) | C1/C2/C3 | 偏移速');
for (let s = 0; s < Math.round(4.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.85 && s % 12 === 0) {
    console.log(`${t.toFixed(2)} | ${detail('spine1', 0)} | ${detail('spine2', 0)} | ${detail('spine3', 0)} | ${C('spine1', 0).toFixed(2)}/${C('spine2', 0).toFixed(2)}/${C('spine3', 0).toFixed(2)} | ${(ctl.sensors.torsoTilt[1]! * 57.3).toFixed(1)}`);
  }
}
