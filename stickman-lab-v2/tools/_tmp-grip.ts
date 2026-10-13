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
console.log('t | 足CoP_z | 足心z | CoP偏移cm | footR0矩 | footR2矩 | fz% | 踝fused矩');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.5 && s % 24 === 0) {
    const f = ctl.sensors.feet[1]!;
    const F = (n: string, ax: number): number => { const di = body.dofByName(n, ax); if (di<0) return NaN; const b = dr.lastBreakdown[di] as any; return b ? ((b.stiff||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0)) : NaN; };
    const W = body.sk.massTotal * 9.81;
    console.log(`${t.toFixed(2)} | ${(f.copZ*100).toFixed(1).padStart(6)} | ${(f.z*100).toFixed(1).padStart(6)} | ${((f.copZ-f.z)*100).toFixed(1).padStart(5)} | ${F('foot_r',0).toFixed(0).padStart(5)} | ${F('foot_r',2).toFixed(0).padStart(5)} | ${(f.fz/W*100).toFixed(0).padStart(4)} | ${F('foot_r',1).toFixed(0).padStart(6)}`);
  }
}
