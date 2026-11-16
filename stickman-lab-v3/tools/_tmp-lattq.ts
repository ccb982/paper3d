import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const F = (n: string, ax: number): string => {
  const di = body.dofByName(n, ax);
  if (di < 0) return '   n/a';
  const b = ctl.warner.drive.lastBreakdown[di] as any;
  if (!b) return '   ---';
  const tot = (b.stiff||0)+(b.itb||0)+(b.lum||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0);
  return tot.toFixed(0).padStart(4)+'[a'+(b.act||0).toFixed(0)+' s'+(b.servo||0).toFixed(0)+' d'+(b.damp||0).toFixed(0)+' f'+(b.ff||0).toFixed(0)+' lu'+(b.lum||0).toFixed(0)+' it'+(b.itb||0).toFixed(0)+']';
};
console.log('t | footR0 | kneeR0 | hipR0 | sp1/0 | sp2/0 | sp3/0');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    console.log(`${t.toFixed(2)} | ${F('foot_r',0)} | ${F('knee_r',0)} | ${F('hip_r',0)} | ${F('spine1',0)} | ${F('spine2',0)} | ${F('spine3',0)}`);
  }
}
