import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const F = (b: any, k: string): string => (b ? ((b[k] || 0) as number).toFixed(1).padStart(5) : '    0');
console.log('t | kneeL0: stiff itb lum act servo ff damp | 总 | kneeL1总 | hipL0总');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const d0 = body.dofByName('knee_l', 0);
    const b = ctl.warner.drive.lastBreakdown[d0] as any;
    const tot = b ? (b.stiff||0)+(b.itb||0)+(b.lum||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0) : 0;
    const d1 = body.dofByName('knee_l', 1);
    const b1 = ctl.warner.drive.lastBreakdown[d1] as any;
    const t1 = b1 ? (b1.stiff||0)+(b1.itb||0)+(b1.lum||0)+(b1.act||0)+(b1.servo||0)+(b1.ff||0)+(b1.damp||0) : 0;
    const dh = body.dofByName('hip_l', 0);
    const bh = ctl.warner.drive.lastBreakdown[dh] as any;
    const th = bh ? (bh.stiff||0)+(bh.itb||0)+(bh.lum||0)+(bh.act||0)+(bh.servo||0)+(bh.ff||0)+(bh.damp||0) : 0;
    console.log(`${t.toFixed(2)} | ${F(b,'stiff')}${F(b,'itb')}${F(b,'lum')}${F(b,'act')}${F(b,'servo')}${F(b,'ff')}${F(b,'damp')} | ${tot.toFixed(0).padStart(4)} | ${t1.toFixed(0).padStart(4)} | ${th.toFixed(0).padStart(4)}`);
  }
}
