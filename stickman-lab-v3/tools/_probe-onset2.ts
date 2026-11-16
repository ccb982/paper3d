/** _probe-onset2: who drives the CoM drift at instability onset (all joints, 20ms). */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const ang = (n: string, ax: number) => { const i = body.dofByName(n, ax); return i >= 0 ? body.dofs[i]!.angle : 0; };
console.log('t     相位     comZ   vz | 摆髋屈 摆膝 摆ab | 支髋屈 支膝 支踝 | 脊2  摆髋ab | 骨盆y 骨盆滚°');
for (let s = 0; s < Math.round(5.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.55 || t > 4.05) continue;
  if (s % Math.round(0.025 / w.dt) !== 0) continue;
  console.log(
    `${t.toFixed(3)} ${(ctl.actions.status.phase ?? '-').slice(0, 4).padEnd(5)} ${ctl.sensors.com[2]!.toFixed(3).padStart(6)} ${ctl.sensors.comVel[2]!.toFixed(2).padStart(5)} | ` +
    `${ang('hip_l', 2).toFixed(2).padStart(5)} ${ang('knee_l', 2).toFixed(2).padStart(5)} ${ang('hip_l', 0).toFixed(2).padStart(5)} | ` +
    `${ang('hip_r', 2).toFixed(2).padStart(5)} ${ang('knee_r', 2).toFixed(2).padStart(5)} ${ang('foot_r', 2).toFixed(2).padStart(5)} | ` +
    `${(ang('spine1', 2) + ang('spine2', 2) + ang('spine3', 2)).toFixed(2).padStart(5)} ${ang('hip_l', 0).toFixed(2).padStart(5)} | ` +
    `${body.bodies[body.indexByKey.get('torso') ?? 0]!.translation().y.toFixed(3)} ${(ctl.sensors.torsoTilt[1]! * 180 / Math.PI).toFixed(0).padStart(4)}`,
  );
}
