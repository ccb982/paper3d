import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t     支撑髋° 支撑膝° 支撑踝° | 骨盆pitch° | 胸高 | comX');
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
  console.log(`${t.toFixed(1)} ${g('hip_r', 2).toFixed(1).padStart(6)} ${g('knee_r', 2).toFixed(1).padStart(7)} ${g('foot_r', 2).toFixed(1).padStart(7)} | ${pitch.toFixed(1).padStart(8)} | ${ctl.sensors.com[1]!.toFixed(3)} ${ctl.sensors.com[0]!.toFixed(3)}`);
}
