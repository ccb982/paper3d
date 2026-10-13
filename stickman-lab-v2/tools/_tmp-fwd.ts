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
const dr = ctl.warner.drive as any;
const T = (n: string, ax: number): string => {
  const di = body.dofByName(n, ax);
  if (di < 0) return '  n/a';
  const b = dr.lastBreakdown[di] as any;
  if (!b) return '  ---';
  const tot = (b.stiff||0)+(b.itb||0)+(b.lum||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0);
  return tot.toFixed(0).padStart(4)+'[a'+(b.act||0).toFixed(0)+' f'+(b.ff||0).toFixed(0)+']';
};
console.log('t | pitchRel | UBx | UBvx | hip2 | footR2(蹬地) | sp1/2 | sp2/2');
for (let s = 0; s < Math.round(3.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const U = obs({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    console.log(`${t.toFixed(2)} | ${U.pitchRelDeg.toFixed(1).padStart(6)} | ${(ctl.sensors.com[0]!*100).toFixed(1).padStart(5)} | ${(ctl.sensors.comVel[0]!*100).toFixed(0).padStart(4)} | ${T('hip_r',2)} | ${T('foot_r',2)} | ${T('spine1',2)} | ${T('spine2',2)}`);
  }
}
