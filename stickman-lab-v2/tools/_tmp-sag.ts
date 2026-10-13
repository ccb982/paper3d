import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe as obs } from '../src/core/servo/unified';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const A = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
const T = (n: string, ax: number): number => { const di = body.dofByName(n, ax); if (di < 0) return NaN; const b = ctl.warner.drive.lastBreakdown[di] as any; return b ? ((b.stiff||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0)) : NaN; };
console.log('t | pitchRel | sp1/2 | sp2/2 | sp3/2 | hipR2 | sp2/2矩 | hipR2矩');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const U = obs({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    console.log(`${t.toFixed(2)} | ${U.pitchRelDeg.toFixed(1).padStart(6)} | ${A('spine1',2).toFixed(1).padStart(5)} | ${A('spine2',2).toFixed(1).padStart(5)} | ${A('spine3',2).toFixed(1).padStart(5)} | ${A('hip_r',2).toFixed(0).padStart(4)} | ${T('spine2',2).toFixed(0).padStart(5)} | ${T('hip_r',2).toFixed(0).padStart(5)}`);
  }
}
