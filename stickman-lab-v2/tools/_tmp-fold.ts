import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const wp = (n: string): number => { try { const ix = body.indexByKey.get(n); const q = body.bodies[ix].rotation(); const ux = 2*(q.x*q.y-q.w*q.z), uy = 1-2*(q.x*q.x+q.z*q.z); return Math.atan2(-ux, uy)*57.3; } catch { return 0; } };
console.log('t | 胸世界pitch | 腰世界pitch | 盆骨世界pitch | sp1 | sp2 | sp3 (相对角°)');
for (let s = 0; s < Math.round(3.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 18 === 0) {
    const sp = (n: string): number => { try { return body.dofs[body.dofByName(n, 2)]!.angle * 57.3; } catch { return 0; } };
    console.log(`${t.toFixed(2)} | ${wp('spine3').toFixed(1).padStart(7)} | ${wp('spine2').toFixed(1).padStart(7)} | ${wp('pelvis').toFixed(1).padStart(7)} | ${sp('spine1').toFixed(1).padStart(5)} | ${sp('spine2').toFixed(1).padStart(5)} | ${sp('spine3').toFixed(1).padStart(5)}`);
  }
}
