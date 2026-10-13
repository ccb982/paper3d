import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
console.log('t | spine1/0: stiff itb lum act servo ff damp | 总');
for (let s = 0; s < Math.round(4.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.9 && s % 12 === 0) {
    const di = body.dofByName('spine1', 0);
    const b = ctl.warner.drive.lastBreakdown[di] as any;
    if (!b) continue;
    const tot = b.stiff + b.itb + b.lum + b.act + b.servo + b.ff + b.damp;
    console.log(`${t.toFixed(2)} | ${b.stiff.toFixed(0).padStart(5)} ${b.itb.toFixed(0).padStart(4)} ${b.lum.toFixed(0).padStart(4)} ${b.act.toFixed(0).padStart(4)} ${b.servo.toFixed(0).padStart(5)} ${(b.ff||0).toFixed(0).padStart(4)} ${b.damp.toFixed(0).padStart(5)} | ${tot.toFixed(0).padStart(5)}`);
  }
}
