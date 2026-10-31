import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import { pinSquatDownFeet } from '../src/core/actions';

const PIN = String(process.env.PIN ?? '1') === '1';
const T_END = Number(process.env.T_END ?? 6.0);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.reset(); w.switchPoseState('stand');
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.play('squatDown');
const foot = (s: 'l' | 'r') => w.body.bodies[w.body.indexByKey.get('foot_' + s)!]!;
const ang = (n: string): number => { const i = w.body.dofByName(n, 2); return i >= 0 ? w.body.dofs[i]!.angle * 57.3 : NaN; };
let last = { l: foot('l').translation(), r: foot('r').translation() };
let maxJump = 0, maxV = 0, flip = 0, prevVx = 0;
let lastPrint = -1;
for (let i = 0; i < Math.round(T_END / w.dt); i++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  if (PIN) pinSquatDownFeet(w.body, w.dt);
  const fl = foot('l'), fr = foot('r');
  const vl = fl.linvel(), vr = fr.linvel();
  const jump = Math.max(Math.hypot(fl.translation().x - last.l.x, fl.translation().y - last.l.y, fl.translation().z - last.l.z), Math.hypot(fr.translation().x - last.r.x, fr.translation().y - last.r.y, fr.translation().z - last.r.z));
  maxJump = Math.max(maxJump, jump);
  maxV = Math.max(maxV, Math.hypot(vl.x, vl.y, vl.z), Math.hypot(vr.x, vr.y, vr.z));
  if (prevVx * vl.x < -1e-6) flip++;
  prevVx = vl.x;
  last = { l: fl.translation(), r: fr.translation() };
  const t = w.clock;
  if (t - lastPrint >= 0.2) {
    lastPrint = t;
    const c = ctl.sensors.com;
    console.log(`SD t=${t.toFixed(2)} ph=${ctl.actions.status.phase ?? '-'} knee=${ang('knee_l').toFixed(0)} hip=${ang('hip_l').toFixed(0)} comX=${(c[0]! * 100).toFixed(1)} footL=(${(last.l.x * 100).toFixed(1)},${(last.l.y * 100).toFixed(1)},${(last.l.z * 100).toFixed(1)}) vL=(${(vl.x * 100).toFixed(1)},${(vl.y * 100).toFixed(1)},${(vl.z * 100).toFixed(1)}) jump=${(jump * 1000).toFixed(2)}mm`);
  }
}
console.log(`RESULT pin=${PIN} maxJump=${(maxJump * 1000).toFixed(2)}mm maxFootV=${maxV.toFixed(2)} signFlips=${flip}`);
