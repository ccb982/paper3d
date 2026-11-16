import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe } from '../src/core/servo/unified';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const ang = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN;
};
console.log('t | pitch | sp1/2 | sp2/2 | sp3/2 | hip/2 | CoMx cm | CoPx cm');
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  if (s % 24 === 0 && s * w.dt > 2.9 && s * w.dt < 3.8) {
    const U = observe({ bal: ctl.warner, body: w.body, sensors: ctl.sensors } as any, 'r');
    const fr = ctl.sensors.feet[1]!;
    console.log(`${(s * w.dt).toFixed(2)} | ${U.pitchRelDeg.toFixed(1)} | ${ang('spine1', 2).toFixed(1)} | ${ang('spine2', 2).toFixed(1)} | ${ang('spine3', 2).toFixed(1)} | ${ang('hip_r', 2).toFixed(1)} | ${(U.comX * 100).toFixed(1)} | ${(fr.copX * 100).toFixed(1)}`);
  }
}
