/**
 * _probe-sl.ts —— 单脚站立细追踪：相位/CoM(x,z)/胸高/双脚Fz
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
if (process.env.NO_LANDING === '1') ctl.landing.opt.enabled = false;
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const chest = w.body.indexByKey.get('spine4') ?? 0;
const W = w.sk.massTotal * 9.81;
let lastPh = '';
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const ph = ctl.actions.status.phase ?? '—';
  const t = s * w.dt;
  if (t > 3.30 && t < 4.30 && s % 10 === 0) {
    const ang = (n: string, a: number) => {
      const i = w.body.dofByName(n, a);
      return i >= 0 ? w.body.dofs[i]!.angle : NaN;
    };
    console.log(
      `  g t=${t.toFixed(2)} [${ph}] comZ=${ctl.sensors.com[2]!.toFixed(3)}` +
      ` hipL0=${ang('hip_l', 0).toFixed(2)} hipR0=${ang('hip_r', 0).toFixed(2)}` +
      ` kneeL2=${ang('knee_l', 2).toFixed(2)} kneeR2=${ang('knee_r', 2).toFixed(2)}` +
      ` 消力L=${ctl.landing.depthOf(0).toFixed(2)} R=${ctl.landing.depthOf(1).toFixed(2)}` +
      ` 左vy=${ctl.sensors.feet[0]!.vy.toFixed(2)} fz=${ctl.sensors.feet[0]!.fz.toFixed(0)}N`
    );
  }
  if (t > 0.3 && t < 4.2 && s % 25 === 0) {
    console.log(
      `  f t=${t.toFixed(2)} [${ph}] comZ=${ctl.sensors.com[2]!.toFixed(3)}` +
      ` tgtZ=${ctl.warner.getComTarget().z.toFixed(3)} comVz=${ctl.sensors.comVel[2]!.toFixed(2)}` +
      ` Lfz=${(ctl.sensors.feet[0]!.fz / W * 100).toFixed(0)}% Rfz=${(ctl.sensors.feet[1]!.fz / W * 100).toFixed(0)}%`
    );
  }
  if (s % 20 === 0 || ph !== lastPh) {
    const com = ctl.sensors.com;
    console.log(
      `t=${(s * w.dt).toFixed(2)} [${ph}] com=(${com[0]!.toFixed(2)},${com[2]!.toFixed(2)})` +
      ` 胸=${w.body.bodies[chest]!.translation().y.toFixed(2)}` +
      ` Fz L=${(ctl.sensors.feet[0]!.fz / W * 100).toFixed(0)}% R=${(ctl.sensors.feet[1]!.fz / W * 100).toFixed(0)}%` +
      ` 铲脚z=${ctl.sensors.feet[0]!.z.toFixed(2)} 撑脚z=${ctl.sensors.feet[1]!.z.toFixed(2)}` +
      ` lvl=${ctl.lastProposal?.level ?? -1}`
    );
    lastPh = ph;
  }
}
