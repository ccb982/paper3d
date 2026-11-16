import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const wp = (n: string): string => { try { const ix = body.indexByKey.get(n); if (ix === undefined) return ' n/a '; const q = body.bodies[ix].rotation(); const ux = 2*(q.x*q.y-q.w*q.z), uy = 1-2*(q.x*q.x+q.z*q.z); return (Math.atan2(-ux, uy)*57.3).toFixed(1).padStart(6); } catch { return '  err'; } };
const dj = (n: string, ax: number): string => { try { const di = body.dofByName(n, ax); if (di < 0) return '  n/a'; return (body.dofs[di]!.angle * 57.3).toFixed(1).padStart(5); } catch { return '  err'; } };
console.log('t | 盘骨 | sp1 | sp2 | sp3 | 头 | || sp1(0,1,2) | sp2(0,1,2) | sp3(0,1,2) | hip(0,1,2) 相对°');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 18 === 0) {
    console.log(`${t.toFixed(2)} | ${wp('pelvis')} | ${wp('spine1')} | ${wp('spine2')} | ${wp('spine3')} | ${wp('head')} | || ${dj('spine1',0)},${dj('spine1',1)},${dj('spine1',2)} | ${dj('spine2',0)},${dj('spine2',1)},${dj('spine2',2)} | ${dj('spine3',0)},${dj('spine3',1)},${dj('spine3',2)} | ${dj('hip_r',0)},${dj('hip_r',1)},${dj('hip_r',2)}`);
  }
}
