import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t     sp1°  sp2°  sp3° | 支撑髋° | 骨盆roll/pitch° | 躯干pitch° | comX   torsoX');
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.0 || t > 4.5) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const g = (n: string, ax: number) => { const di = w.body.dofByName(n, ax); return di >= 0 ? w.body.dofs[di]!.angle * 57.3 : 0; };
  const body = (w.body as any);
  const pel = body.bodies[body.indexByKey.get('torso')] ?? body.bodies[body.indexByKey.get('spine4')];
  const q = pel.rotation();
  const pitch = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y)) * 57.3;
  const roll = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y)) * -57.3;
  const torsoPos = (body.bodies[body.indexByKey.get('torso')] as any).translation();
  console.log(`${t.toFixed(1)} ${g('spine1', 2).toFixed(1).padStart(5)} ${g('spine2', 2).toFixed(1).padStart(5)} ${g('spine3', 2).toFixed(1).padStart(5)} | ${g('hip_r', 2).toFixed(1).padStart(7)} | ${roll.toFixed(1).padStart(6)}/${pitch.toFixed(1).padStart(6)} | ${ctl.sensors.com[0]!.toFixed(3)} ${torsoPos.x.toFixed(3)}`);
}
