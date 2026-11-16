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
const ang = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
console.log('t | 髇R0角 | pairC | 髇pair矩 | sp1/0角 | sp2/0角 | sp3/0角 | 盆骨roll预估(髇R0-初)');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const di = body.dofByName('hip_r', 0);
    const b = dr.lastBreakdown[di] as any;
    const tt = b ? ((b.stiff||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0)+(b.itb||0)+(b.lum||0)) : 0;
    console.log(`${t.toFixed(2)} | ${ang('hip_r',0).toFixed(0).padStart(5)} | ${(dr.pairC[di]??0).toFixed(2)} | ${tt.toFixed(0).padStart(6)} | ${ang('spine1',0).toFixed(1).padStart(5)} | ${ang('spine2',0).toFixed(1).padStart(5)} | ${ang('spine3',0).toFixed(1).padStart(5)}`);
  }
}
