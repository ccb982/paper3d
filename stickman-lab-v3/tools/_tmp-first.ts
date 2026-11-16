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
console.log('t | sp1θ | sp1λ | sp1act | sp2act | sp3act | 髋2act | 踝2act | fz');
for (let s = 0; s < Math.round(2.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.03 && s % 2 === 0) {
    const g = (n: string, ax: number): number => { const di = body.dofByName(n, ax); if (di<0) return 0; const b = dr.lastBreakdown[di] as any; return b ? (b.act||0) : 0; };
    const d1 = body.dofByName('spine1',0);
    const th = body.dofs[d1]!.angle*57.3, la = (dr.pairRef[d1] ?? 0)*57.3;
    console.log(`${t.toFixed(3)} | ${th.toFixed(1).padStart(5)} | ${la.toFixed(1).padStart(5)} | ${g('spine1',0).toFixed(0).padStart(5)} | ${g('spine2',0).toFixed(0).padStart(5)} | ${g('spine3',0).toFixed(0).padStart(5)} | ${g('hip_r',2).toFixed(0).padStart(4)} | ${g('foot_r',2).toFixed(0).padStart(4)} | ${ctl.sensors.feet[1]!.fz.toFixed(0).padStart(4)}`);
  }
}
