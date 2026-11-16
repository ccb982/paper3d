import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const qRoll = (key: string): number => {
  const ix = (w.body as any).indexByKey.get(key);
  if (ix === undefined) return NaN;
  const q = (w.body as any).bodies[ix].rotation();
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y)) * 57.3;
};
const g = (n: string, ax: number): number => {
  const i = w.body.dofByName(n, ax);
  return i >= 0 ? w.body.dofs[i]!.angle * 57.3 : NaN;
};
console.log('t      相位    torsoR°  hipAbR° 大腿R° 小腿R° 足R°(0=平)  膝R°');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.2 || t > 4.2) continue;
  if (Math.abs(t * 5 - Math.round(t * 5)) > 1e-6) continue;
  const ph = ctl.actions.status.phase ?? '?';
  console.log(`${t.toFixed(1)}  ${ph.padEnd(6)} ${qRoll('torso').toFixed(1).padStart(6)} ${g('hip_r', 0).toFixed(1).padStart(7)} ${qRoll('thigh_r').toFixed(1).padStart(7)} ${qRoll('shin_r').toFixed(1).padStart(6)} ${qRoll('foot_r').toFixed(1).padStart(8)} ${g('knee_r', 2).toFixed(1).padStart(6)}`);
}
