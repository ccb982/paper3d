import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const dr = ctl.warner.drive as any;
let printedKeys = false;
console.log('t | dof | buckets(全字段)');
for (let s = 0; s < Math.round(2.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 1.9 && s % 24 === 0) {
    for (const sn of ['spine1', 'spine2', 'spine3']) {
      const di = body.dofByName(sn, 0);
      const b: any = dr.lastBreakdown[di];
      if (!b) continue;
      if (!printedKeys) { console.log('KEYS:', Object.keys(b).join(',')); printedKeys = true; }
      const parts = Object.entries(b).map(([k, v]) => k + '=' + (typeof v === 'number' ? v.toFixed(0) : v)).join(' ');
      console.log(`${t.toFixed(2)} | ${sn}/0 | ${parts}`);
    }
  }
}
