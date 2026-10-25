import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
ctl.actions.idleEnabled = false;
w.reset(); w.switchPoseState('stand');
ctl.actions.play('squatDown');
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const body = w.body;
const di = (n: string, ax: number): number => body.dofByName(n, ax);
const ang = (n: string, ax: number): number => { const i = di(n, ax); return i >= 0 ? body.dofs[i]!.angle * 57.3 : NaN; };
const tgt = (n: string, ax: number): number => { const i = di(n, ax); return i >= 0 ? ctl.manual.angleOf(i) * 57.3 : NaN; };
const cop = new Float64Array(3);
let last = -1;
for (let i = 0; i < Math.round(5 / w.dt); i++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  if (w.clock - last >= 0.15) {
    last = w.clock;
    const c = ctl.sensors.com;
    const fl = body.bodies[body.indexByKey.get('foot_l')!]!.translation();
    const fr = body.bodies[body.indexByKey.get('foot_r')!]!.translation();
    const footMid = (fl.x + fr.x) / 2;
    const fL = body.footNormalForce('l', w.dt), fR = body.footNormalForce('r', w.dt);
    const okL = body.footCoP('l', w.dt, cop);
    const copL = okL ? cop[0]! : NaN;
    const okR = body.footCoP('r', w.dt, cop);
    const copR = okR ? cop[0]! : NaN;
    const ankL = body.dofs[di('foot_l', 2)]!.anchorWorld[0]!;
    const copRel = okL ? (copL - ankL) * 100 : NaN;
    const heelRel = copRel - (-12);
    console.log(`BF t=${w.clock.toFixed(2)} ph=${(ctl.actions.status.phase ?? '-').padEnd(4)} comX=${(c[0]! * 100).toFixed(1)} footX=${(footMid * 100).toFixed(1)} rel=${((c[0]! - footMid) * 100).toFixed(1)} copRel=${copRel.toFixed(1)} heelRoom=${heelRel.toFixed(1)} fz=${fL.toFixed(0)}/${fR.toFixed(0)} hip=${ang('hip_l', 2).toFixed(0)}/${tgt('hip_l', 2).toFixed(0)} knee=${ang('knee_l', 2).toFixed(0)}/${tgt('knee_l', 2).toFixed(0)} ankle=${ang('foot_l', 2).toFixed(0)}/${tgt('foot_l', 2).toFixed(0)}`);
  }
}
