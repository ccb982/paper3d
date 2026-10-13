import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const g = globalThis as any;
g.__WRITELOG = [];
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const di = body.dofByName('hip_r', 2);
let first: any = null;
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  g.__WRITELOG = [];
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.3 && !first) {
    for (const e of g.__WRITELOG as any[]) {
      if (e[1] === di && (e[2] === 'angle' || e[2] === 'a-set')) { first = { t, e }; break; }
    }
  }
}
if (first) {
  console.log('t=', first.t.toFixed(2), 'kind=', first.e[2], 'val=', first.e[3].toFixed(3));
  console.log(String(first.e[4]).split('|').slice(0, 5).join(String.fromCharCode(10)));
} else console.log('no write found');
