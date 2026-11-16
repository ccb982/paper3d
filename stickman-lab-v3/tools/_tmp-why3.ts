import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe as obs, modeOf } from '../src/core/servo/unified';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const act = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  const b = di >= 0 ? ctl.warner.drive.lastBreakdown[di] as any : null;
  return b ? (b.act || 0) : 0;
};
console.log('t | tiltRel | CoMz | 髇角 | 支撑fz% | hipPairAct | M2 | 最弯链(dZcm)');
for (let s = 0; s < Math.round(4.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.55 && s % 24 === 0) {
    const U = obs({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    const hc = U.chain.reduce((a: any, c: any) => Math.abs(c.dZ) > Math.abs(a.dZ) ? c : a, { name: '-', dZ: 0 });
    const hAng = (body.dofs[body.dofByName('hip_r', 0)]?.angle ?? 0) * 57.3;
    console.log(`${t.toFixed(2)} | ${U.tiltRelDeg.toFixed(1).padStart(5)} | ${(ctl.sensors.com[2]!*100).toFixed(1).padStart(6)} | ${hAng.toFixed(0).padStart(4)} | ${(ctl.sensors.feet[1]!.fz/(body.sk.massTotal*9.81)*100).toFixed(0).padStart(4)} | ${act('hip_r',0).toFixed(0).padStart(5)} | ${ctl.warner.drive.legReflex.pelvisDamp.toFixed(0).padStart(4)} | ${hc.name}${(hc.dZ*100).toFixed(1)}`);
  }
}
