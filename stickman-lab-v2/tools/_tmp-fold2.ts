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
const A = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
const F = (n: string, ax: number): string => {
  const di = body.dofByName(n, ax);
  if (di < 0) return ' n/a';
  const b = dr.lastBreakdown[di] as any;
  if (!b) return ' ---';
  const tot = (b.stiff||0)+(b.itb||0)+(b.lum||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0);
  return tot.toFixed(0).padStart(4)+'[a'+(b.act||0).toFixed(0)+' s'+(b.servo||0).toFixed(0)+' d'+(b.damp||0).toFixed(0)+' f'+(b.ff||0).toFixed(0)+']';
};
console.log('t | hipR2角 | hipR2矩 | sp1/2角 | sp1/2矩 | sp2/2角 | sp2/2矩 | sp3/2矩');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    console.log(`${t.toFixed(2)} | ${A('hip_r',2).toFixed(0).padStart(5)} | ${F('hip_r',2)} | ${A('spine1',2).toFixed(1).padStart(5)} | ${F('spine1',2)} | ${A('spine2',2).toFixed(1).padStart(5)} | ${F('spine2',2)} | ${F('spine3',2)}`);
  }
}
