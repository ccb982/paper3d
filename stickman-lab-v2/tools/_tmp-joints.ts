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
const wp = (n: string): string => { try { const ix = body.indexByKey.get(n); if (ix === undefined) return '  n/a'; const q = body.bodies[ix].rotation(); const ux = 2*(q.x*q.y-q.w*q.z), uy = 1-2*(q.x*q.x+q.z*q.z); return (Math.atan2(-ux, uy)*57.3).toFixed(1).padStart(6); } catch { return '  err'; } };
console.log('t | sp1θ | sp2θ | sp3θ | hipθ | kneeθ | footθ (矢状) | 胸世 | 腰世 | 盆世');
for (let s = 0; s < Math.round(3.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.0 && s % 24 === 0) {
    console.log(`${t.toFixed(2)} | ${ang('spine1',2)} | ${ang('spine2',2)} | ${ang('spine3',2)} | ${ang('hip_r',2)} | ${ang('knee_r',2)} | ${ang('foot_r',2)} | ${wp('spine4')} | ${wp('spine2')} | ${wp('torso')}`);
  }
}
