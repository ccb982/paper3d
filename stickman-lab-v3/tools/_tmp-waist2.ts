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
const row = (n: string, ax: number): string => {
  const di = body.dofByName(n, ax);
  if (di < 0) return 'n/a';
  const b = dr.lastBreakdown[di] as any;
  const tot = b ? ((b.stiff||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0)+(b.itb||0)+(b.lum||0)) : 0;
  const pc = (dr.pairC[di] ?? 0).toFixed(2);
  const cap = dr.pairCap[di];
  return tot.toFixed(0).padStart(5) + ' [C' + pc + ' cap' + (Number.isFinite(cap) ? cap.toFixed(0) : '8') + ' a' + (b?.act||0).toFixed(0) + ' lu' + (b?.lum||0).toFixed(0) + ']';
};
console.log('t | hipR0(侧) | hipR2(矢) | kneeR2 | (tot[C cap act lum])');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    console.log(`${t.toFixed(2)} | ${row('spine1',0)} | ${row('spine2',0)} | ${row('spine3',0)}`);
  }
}
