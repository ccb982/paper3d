import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const ang = (n: string, ax: number): string => { try { const di = body.dofByName(n, ax); if (di<0) return ' n/a'; return (body.dofs[di]!.angle*57.3).toFixed(1).padStart(6); } catch { return '  err'; } };
const roll = (n: string): string => { try { const ix = body.indexByKey.get(n); if (ix === undefined) return '  n/a'; const q = body.bodies[ix].rotation(); return (Math.atan2(2*(q.w*q.x+q.y*q.z), 1-2*(q.x*q.x+q.y*q.y))*57.3).toFixed(1).padStart(6); } catch { return '  err'; } };
console.log('t | 脊1 | 脊2 | 脊3(相对°) | 髋_r/0(相对) | 小腿roll | 腰以上roll | comZ');
for (let s = 0; s < Math.round(2.9 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 1.8 && s % 16 === 0) {
    console.log(`${t.toFixed(2)} | ${ang('spine1',0)} | ${ang('spine2',0)} | ${ang('spine3',0)} | ${ang('hip_r',0)} | ${roll('shin_r')} | ${roll('torso')} | ${(ctl.sensors.com[2]!*100).toFixed(1).padStart(6)}`);
  }
}
