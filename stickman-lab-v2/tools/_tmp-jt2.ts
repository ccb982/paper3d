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
  const tot = (b.stiff||0)+(b.itb||0)+(b.lum||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0);
  return tot.toFixed(0).padStart(5)+'[a'+(b.act||0).toFixed(0)+' s'+(b.servo||0).toFixed(0)+' f'+(b.ff||0).toFixed(0)+' d'+(b.damp||0).toFixed(0)+']';
};
console.log('t | ankleR2 | kneeR2 | hipR2 | hipR0 | ankleR0');
for (let s = 0; s < Math.round(3.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    console.log(`${t.toFixed(2)} | ${detail('foot_r',2)} | ${detail('knee_r',2)} | ${detail('hip_r',2)} | ${detail('hip_r',0)} | ${detail('foot_r',0)}`);
  }
}
