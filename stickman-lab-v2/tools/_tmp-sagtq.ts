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
const F = (n: string, ax: number): string => {
  const di = body.dofByName(n, ax);
  if (di < 0) return '   n/a';
  const b = dr.lastBreakdown[di] as any;
  if (!b) return '   ---';
  const tot = (b.stiff||0)+(b.itb||0)+(b.lum||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0);
  return tot.toFixed(0).padStart(4)+'[a'+(b.act||0).toFixed(0)+' f'+(b.ff||0).toFixed(0)+' d'+(b.damp||0).toFixed(0)+']';
};
console.log('t | sp1/2 | sp2/2 | sp3/2 | hip2 | 合计 | 需求估算(40kg×g×sin(p)×0.5m)');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.1 && s % 20 === 0) {
    const g = (n: string): number => { const di = body.dofByName(n, 2); if (di<0) return 0; const b = dr.lastBreakdown[di] as any; return b ? ((b.stiff||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0)+(b.lum||0)) : 0; };
    const tot = g('spine1') + g('spine2') + g('spine3') + g('hip_r');
    const ixT = body.indexByKey.get('spine3'); const q = body.bodies[ixT].rotation();
    const ux = 2*(q.x*q.y-q.w*q.z), uy = 1-2*(q.x*q.x+q.z*q.z);
    const p = Math.atan2(-ux, uy);
    const need = 40 * 9.81 * Math.sin(p) * 0.5;
    console.log(`${t.toFixed(2)} | ${F('spine1',2)} | ${F('spine2',2)} | ${F('spine3',2)} | ${F('hip_r',2)} | ${tot.toFixed(0).padStart(5)} | ${need.toFixed(0).padStart(5)}`);
  }
}
