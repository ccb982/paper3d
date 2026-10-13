import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe as obs } from '../src/core/servo/unified';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
console.log('=== 力链自下而上 (d=dZ/dX cm, tau=Z/X) ===');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.5 && s % 48 === 0) {
    const U = obs({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    const fz = ctl.sensors.feet[1]!.fz / (body.sk.massTotal * 9.81) * 100;
    const rows = U.chain.map((c: any) => `${c.name} d${(c.dZ*100).toFixed(0)}/${(c.dX*100).toFixed(0)} τ${c.tauZ.toFixed(0)}/${c.tauX.toFixed(0)}`);
    console.log(`t=${t.toFixed(2)} fz=${fz.toFixed(0)}% | ${rows.join(' | ')}`);
  }
}
