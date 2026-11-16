import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const dr = ctl.warner.drive as any;
const wp = (n: string): string => { try { const ix = body.indexByKey.get(n); if (ix === undefined) return '   n/a'; const q = body.bodies[ix].rotation(); const ux = 2*(q.x*q.y-q.w*q.z), uy = 1-2*(q.x*q.x+q.z*q.z); const uz = 2*(q.z*q.y+q.w*q.x), uzz = 1-2*(q.x*q.x+q.y*q.y); return ((Math.atan2(-ux,uy)*57.3).toFixed(1)+'/'+(Math.atan2(uz,uzz)*57.3).toFixed(1)).padStart(12); } catch { return '   err'; } };
const ang = (n: string, ax: number): string => { try { const di = body.dofByName(n, ax); if (di<0) return ' n/a'; return (body.dofs[di]!.angle*57.3).toFixed(1).padStart(6); } catch { return '  err'; } };
const act = (n: string, ax: number): string => { try { const di = body.dofByName(n, ax); if (di<0) return '  n/a'; const b = dr.lastBreakdown[di] as any; return b ? ((b.act||0)).toFixed(0).padStart(5) : '  ---'; } catch { return '  err'; } };
console.log('t | 大腿世(p/r) | 小腿世(p/r) | 骫相(0/2) | 骫力(0/2) | 膝相(0/2) | 膝力(0/2) | 躯干世(p/r) | tilt');
for (let s = 0; s < Math.round(3.3 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    console.log(`${t.toFixed(2)} | ${wp('thigh_r')} | ${wp('shin_r')} | ${ang('hip_r',0)}|${ang('hip_r',2)} | ${act('hip_r',0)}|${act('hip_r',2)} | ${ang('knee_r',0)}|${ang('knee_r',2)} | ${act('knee_r',0)}|${act('knee_r',2)} | ${wp('torso')} | ${((ctl.sensors as any).torsoTilt ? ctl.sensors.torsoTilt[1]*57.3 : 0).toFixed(1)}`);
  }
}
