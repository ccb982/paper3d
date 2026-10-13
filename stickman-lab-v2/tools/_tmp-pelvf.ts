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
  return tot.toFixed(0).padStart(4)+'[a'+(b.act||0).toFixed(0)+' s'+(b.servo||0).toFixed(0)+' d'+(b.damp||0).toFixed(0)+' f'+(b.ff||0).toFixed(0)+' it'+(b.itb||0).toFixed(0)+']';
};
const A = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
console.log('t | hipR0(侧) | hipR2(矢) | hipR1(yaw) | 角(0/1/2) | C(0/2) | λ(0/2)');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const d0 = body.dofByName('hip_r', 0), d2 = body.dofByName('hip_r', 2);
    console.log(`${t.toFixed(2)} | ${F('hip_r',0)} | ${F('hip_r',2)} | ${F('hip_r',1)} | ${A('hip_r',0).toFixed(0)}/${A('hip_r',1).toFixed(0)}/${A('hip_r',2).toFixed(0)} | ${(dr.pairC[d0]??0).toFixed(2)}/${(dr.pairC[d2]??0).toFixed(2)} | ${((dr.pairRef[d0]??0)*57.3).toFixed(0)}/${((dr.pairRef[d2]??0)*57.3).toFixed(0)}`);
  }
}
