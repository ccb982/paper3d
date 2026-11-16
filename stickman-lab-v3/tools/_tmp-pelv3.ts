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
const act = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  const b = di >= 0 ? ctl.warner.drive.lastBreakdown[di] as any : null;
  return b ? (b.act || 0) : 0;
};
const actOf = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  const b = di >= 0 ? ctl.warner.drive.lastBreakdown[di] as any : null;
  return b ? (b.act || 0) : 0;
};
console.log('t | tiltRel | 盆hipR0act | 脊1/2/3 act | CoM z(cm) | 支撑fz% | 模式');
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.6 && s % 12 === 0) {
    const U = obs({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    console.log(`${t.toFixed(2)} | ${U.tiltRelDeg.toFixed(1)} | ${actOf('hip_r',0).toFixed(0).padStart(5)} | ${actOf('spine1',0).toFixed(0)}/${actOf('spine2',0).toFixed(0)}/${actOf('spine3',0).toFixed(0)} | ${(ctl.sensors.com[2]!*100).toFixed(1)} | ${(ctl.sensors.feet[1]!.fz/(body.sk.massTotal*9.81)*100).toFixed(0)} | ${(ctl.warner.drive.legReflex.side ?? '-')}`);
  }
}
