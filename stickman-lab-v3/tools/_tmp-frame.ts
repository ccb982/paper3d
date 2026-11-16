import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = (w.body as any);
const torsoIdx = body.indexByKey.get('torso');
console.log('t      comX   髋_r/2° 跨x(躯干基)  跨x−踝x  踝x     CoPx    fz    vel髋');
let cnt = 0;
for (let s = 0; s < Math.round(4.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.5 || t > 4.1) continue;
  cnt++;
  if (cnt % 12 !== 0) continue;   // 每 12 帧 = 0.05s
  const torso = (body.bodies[torsoIdx] as any).translation();
  const ank = (body.bodies[body.indexByKey.get('mfoot_r')] as any).translation();
  const di = w.body.dofByName('hip_r', 2);
  const g = di >= 0 ? w.body.dofs[di]!.angle * 57.3 : 0;
  const v = di >= 0 ? w.body.dofs[di]!.vel : 0;
  const f = ctl.sensors.feet[1]!;
  console.log(`${t.toFixed(2)} ${ctl.sensors.com[0]!.toFixed(3)} ${g.toFixed(1).padStart(7)} ${torso.x.toFixed(3).padStart(10)} ${(torso.x - ank.x).toFixed(3).padStart(9)} ${ank.x.toFixed(3).padStart(7)} ${f.copX.toFixed(3).padStart(7)} ${f.fz.toFixed(0).padStart(5)} ${v.toFixed(2).padStart(6)}`);
}
