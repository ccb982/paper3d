/** _probe-onset: aligned timeline at the load-drop onset. Supports: Fz% + joint torques/angles + CoM. */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const W = body.sk.massTotal * 9.81;
const net = (n: string, ax: number) => { const i = body.dofByName(n, ax); if (i < 0) return [0, 0] as const; const b = w.drive.lastBreakdown[i]!; return [body.dofs[i]!.angle, b.stiff + b.itb + b.lum + b.act + b.servo + b.ff + b.damp] as const; };
console.log('t      Fz%   comZ   vz    az   | 支髋角 abτ | 支膝角 τ | 支踝角 τ | 摆髋角 摆膝角 | 骨盆y');
let vPrev = 0;
for (let s = 0; s < Math.round(8 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.70 || t > 4.10) continue;
  if (s % Math.round(0.02 / w.dt) !== 0) continue;
  const fr = ctl.sensors.feet[1]!.fz;
  const vz = ctl.sensors.comVel[2]!;
  const az = (vz - vPrev) / w.dt; vPrev = vz;
  const [ha, ht] = net('hip_r', 0);
  const [ka, kt] = net('knee_r', 2);
  const [fa, ft] = net('foot_r', 2);
  const [hla] = net('hip_l', 2);
  const [kla] = net('knee_l', 2);
  console.log(
    `${t.toFixed(3)} ${(fr / W * 100).toFixed(0).padStart(4)} ${ctl.sensors.com[2]!.toFixed(3).padStart(6)} ${vz.toFixed(2).padStart(5)} ${az.toFixed(0).padStart(4)} | ` +
    `${ha.toFixed(2).padStart(6)} ${ht.toFixed(0).padStart(4)} | ${ka.toFixed(2).padStart(5)} ${kt.toFixed(0).padStart(4)} | ${fa.toFixed(2).padStart(5)} ${ft.toFixed(0).padStart(4)} | ${hla.toFixed(2).padStart(5)} ${kla.toFixed(2).padStart(5)} | ${body.bodies[body.indexByKey.get('torso') ?? 0]!.translation().y.toFixed(3)}`,
  );
}
