import './_env-web';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';

const T = Number(process.env.T_END ?? 2.5);
const JX = Number(process.env.JX ?? 0);
const JZ = Number(process.env.JZ ?? 0);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const ti = w.body.indexByKey.get('torso')!;
const sp = (n: string, a: number): number => { const i = w.body.dofByName(n, a); return i >= 0 ? w.body.dofs[i]!.angle * 57.2958 : 0; };
let fired = false;
console.log('t comX comZ sp1L sp1S sp2L sp2S sp3L sp3S hip0L hip0R fzL fzR');
for (let k = 0; k < Math.round(T / w.dt); k++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  const t = w.clock;
  if (!fired && t >= 1.0) {
    w.body.bodies[ti]!.applyImpulse({ x: JX, y: 0, z: JZ }, true);
    fired = true;
    console.log(`IMPULSE t=${t.toFixed(2)} J=(${JX},${JZ})`);
  }
  if (k % Math.round(0.1 / w.dt) !== 0) continue;
  const fzL = w.body.footNormalForce('l', w.dt), fzR = w.body.footNormalForce('r', w.dt);
  console.log(`${t.toFixed(2)} ${(ctl.sensors.com[0]!*100).toFixed(1)} ${(ctl.sensors.com[2]!*100).toFixed(1)} ${sp('spine1',0).toFixed(1)} ${sp('spine1',2).toFixed(1)} ${sp('spine2',0).toFixed(1)} ${sp('spine2',2).toFixed(1)} ${sp('spine3',0).toFixed(1)} ${sp('spine3',2).toFixed(1)} ${sp('hip_l',0).toFixed(1)} ${sp('hip_r',0).toFixed(1)} ${fzL.toFixed(0)} ${fzR.toFixed(0)}`);
}
