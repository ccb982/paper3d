import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const rot = (n: string): string => { try { const ix = body.indexByKey.get(n); if (ix === undefined) return '   n/a'; const q = body.bodies[ix].rotation();
  const rz = Math.atan2(2*(q.w*q.z+q.x*q.y), 1-2*(q.z*q.z+q.y*q.y))*57.3;
  const rx = Math.atan2(2*(q.w*q.x+q.y*q.z), 1-2*(q.x*q.x+q.y*q.y))*57.3;
  const ry = Math.atan2(2*(q.w*q.y-q.z*q.x), 1-2*(q.y*q.y+q.z*q.z))*57.3;
  return ('rz='+rz.toFixed(1)).padStart(8)+' rx='+rx.toFixed(1).padStart(6)+' ry='+ry.toFixed(1).padStart(6); } catch { return '   err'; } };
console.log('t | 躯干 | 小腿_r');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) console.log(t.toFixed(2), '|', rot('torso'), '|', rot('shin_r'));
}
