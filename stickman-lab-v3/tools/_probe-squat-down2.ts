import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';

const T_END = Number(process.env.T_END ?? 8);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
ctl.actions.idleEnabled = false;
w.reset(); w.switchPoseState('stand');
ctl.actions.play('squatDown');
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const y = (n: string): number => { const i = w.body.indexByKey.get(n); return i === undefined ? NaN : w.body.bodies[i]!.translation().y; };
const ang = (n: string): string => { const i = w.body.dofByName(n, 2); return i >= 0 ? (w.body.dofs[i]!.angle * 57.3).toFixed(0) : '-'; };
let last = -1;
for (let i = 0; i < Math.round(T_END / w.dt); i++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');   // 主程序现在蹲下也跑 supportClean
  w.advance(1);
  if (w.clock - last >= 0.25) {
    last = w.clock;
    const fL = w.body.footNormalForce('l', w.dt), fR = w.body.footNormalForce('r', w.dt);
    const c = ctl.sensors.com;
    console.log(`D2 t=${w.clock.toFixed(2)} ph=${(ctl.actions.status.phase ?? '-').padEnd(4)} gc=${ctl.warner.opt.gravityComp ? 1 : 0} footY=${(y('foot_l') * 100).toFixed(1)} comY=${(c[1]! * 100).toFixed(1)} comX=${(c[0]! * 100).toFixed(1)} fz=${fL.toFixed(0)}/${fR.toFixed(0)} hip=${ang('hip_l')} knee=${ang('knee_l')} ankle=${ang('foot_l')} sp1=${ang('spine1')}`);
  }
}
