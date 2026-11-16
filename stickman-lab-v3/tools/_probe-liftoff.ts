/** _probe-liftoff: aligned to swing-foot liftoff (fl fz->0). 30ms. Lateral start analysis. */
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
let t0 = -1, vPrev = 0;
const ang = (n: string, ax: number) => { const i = body.dofByName(n, ax); return i >= 0 ? body.dofs[i]!.angle : 0; };
const rows: string[] = [];
for (let s = 0; s < Math.round(6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const fl = ctl.sensors.feet[0]!;
  if (t0 < 0 && fl.fz < 0.05 * W && t > 3.2) t0 = t;
  if (t0 < 0 || Math.abs(t - t0) > 0.45) continue;
  if (s % Math.round(0.03 / w.dt) !== 0) continue;
  const vz = ctl.sensors.comVel[2]!;
  const az = (vz - vPrev) / w.dt; vPrev = vz;
  const dx = t - t0;
  const sp2 = ang('spine1', 2) + ang('spine2', 2) + ang('spine3', 2);
  const sp0 = ang('spine1', 0) + ang('spine2', 0) + ang('spine3', 0);
  const dSp = body.dofByName('spine2', 2);
  const bdSp = dSp >= 0 ? w.drive.lastBreakdown[dSp]! : { servo: 0, ff: 0, damp: 0 } as { servo: number; ff: number; damp: number };
  const dSh = body.dofByName('shoulder_l', 2);
  const bdSh = dSh >= 0 ? w.drive.lastBreakdown[dSh]! : { servo: 0, ff: 0, damp: 0 } as { servo: number; ff: number; damp: number };
  rows.push(
    `${dx >= 0 ? '+' : ''}${dx.toFixed(2)} fz${(fl.fz / W * 100).toFixed(0).padStart(4)}% comZ ${ctl.sensors.com[2]!.toFixed(3).padStart(6)} vz ${vz.toFixed(2).padStart(5)} | 脊2总 ${sp2.toFixed(2).padStart(5)} 脊0总 ${sp0.toFixed(2).padStart(5)} | 脊2τ:伺${bdSp.servo.toFixed(0).padStart(4)}阻${bdSp.damp.toFixed(0).padStart(4)} | 肩τ:伺${bdSh.servo.toFixed(0).padStart(4)}阻${bdSh.damp.toFixed(0).padStart(4)} | 胸y ${body.bodies[body.indexByKey.get('spine4') ?? 0]!.translation().y.toFixed(3)} 骨盆滚${(ctl.sensors.torsoTilt[1]! * 180 / Math.PI).toFixed(0).padStart(4)}°`,
  );
}
console.log(`t0(摆动脚离地)=${t0.toFixed(2)}s；窗 −0.45~+0.45：`);
console.log(rows.join('\n'));
