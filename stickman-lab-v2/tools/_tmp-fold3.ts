import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const wp = (n: string): string => { try { const ix = body.indexByKey.get(n); if (ix === undefined) return '  n/a'; const q = body.bodies[ix].rotation(); const ux = 2*(q.x*q.y-q.w*q.z), uy = 1-2*(q.x*q.x+q.z*q.z); return (Math.atan2(-ux, uy)*57.3).toFixed(1).padStart(6); } catch { return '  err'; } };
const dj = (n: string, ax: number): string => { try { const di = body.dofByName(n, ax); if (di < 0) return ' n/a'; return (body.dofs[di]!.angle * 57.3).toFixed(1).padStart(5); } catch { return ' err'; } };
console.log('t | torso | spine2 | spine3 | spine4 | head || thigh_r | shin_r | foot_r(世界pitch) || hip1(°) | hip2(°)');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 18 === 0) {
    console.log(`${t.toFixed(2)} | ${wp('torso')} | ${wp('spine2')} | ${wp('spine3')} | ${wp('spine4')} | ${wp('head')} || ${wp('thigh_r')} | ${wp('shin_r')} | ${wp('foot_r')} || ${dj('hip_r',1)} | ${dj('hip_r',2)}`);
  }
}
