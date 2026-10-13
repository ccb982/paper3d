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
const act = (n: string, ax: number): string => { try { const di = body.dofByName(n, ax); if (di<0) return '  n/a'; const b = dr.lastBreakdown[di] as any; if (!b) return '  ---'; return ((b.act||0)).toFixed(0).padStart(5); } catch { return '  err'; } };
const ang = (n: string, ax: number): string => { try { const di = body.dofByName(n, ax); if (di<0) return ' n/a'; return (body.dofs[di]!.angle*57.3).toFixed(1).padStart(6); } catch { return '  err'; } };
const wp = (n: string): string => { try { const ix = body.indexByKey.get(n); if (ix === undefined) return '  n/a'; const q = body.bodies[ix].rotation(); return (Math.atan2(2*(q.w*q.z+q.x*q.y), 1-2*(q.z*q.z+q.y*q.y))*57.3).toFixed(1).padStart(6); } catch { return '  err'; } };
console.log('t | comZ | 盘骨roll | 支撑髋/0力 | 摆动髋/0力 | 摆动髋/0角 | 摆动腿世roll | sp1/0力 | tiltRel');
for (let s = 0; s < Math.round(3.3 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.3 && s % 20 === 0) {
    console.log(`${t.toFixed(2)} | ${(ctl.sensors.com[2]!*100).toFixed(1).padStart(5)} | ${wp('torso')} | ${act('hip_r',0)} | ${act('hip_l',0)} | ${ang('hip_l',0)} | ${wp('thigh_l')} | ${act('spine1',0)} | ${((ctl.sensors as any).torsoTilt ? ctl.sensors.torsoTilt[1]*57.3 : 0).toFixed(1).padStart(5)}`);
  }
}
