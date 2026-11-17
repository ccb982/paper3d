import './_env-web';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';

const T = Number(process.env.T_END ?? 6);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
ctl.actions.playPart(process.env.PART ?? '摸头');
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
console.log('t comX comZ y sp1L sp1S sp3L sp3S fzL fzR');
for (let k = 0; k < Math.round(T / w.dt); k++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  if (k % Math.round(0.5 / w.dt) !== 0) continue;
  const sp = (n: string, a: number): number => { const i = w.body.dofByName(n, a); return i >= 0 ? w.body.dofs[i]!.angle * 57.2958 : 0; };
  const fzL = w.body.footNormalForce('l', w.dt), fzR = w.body.footNormalForce('r', w.dt);
  const y = w.body.bodies[w.body.indexByKey.get('spine4') ?? 0]!.translation().y;
  console.log(`${w.clock.toFixed(1)} ${(ctl.sensors.com[0]!*100).toFixed(1)} ${(ctl.sensors.com[2]!*100).toFixed(1)} ${y.toFixed(3)} ${sp('spine1',0).toFixed(1)} ${sp('spine1',2).toFixed(1)} ${sp('spine3',0).toFixed(1)} ${sp('spine3',2).toFixed(1)} ${fzL.toFixed(0)} ${fzR.toFixed(0)}`);
}
