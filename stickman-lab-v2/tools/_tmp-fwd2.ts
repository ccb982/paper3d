import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
console.log('t      comX    vX     支撑踝x  支撑髋x  |  髋_r/2ff 踝_r/2ff  膝_r/2ff | spine1/2° spine2/2° 摆髋° 摆膝°');
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.0 || t > 4.5) continue;
  if (Math.abs(t * 5 - Math.round(t * 5)) > 1e-6) continue;
  const pos = (n: string) => { const i = (w.body as any).indexByKey.get(n); return i != null ? (w.body.bodies[i] as any).translation() : { x: 0 }; };
  const ff = (n: string, ax: number) => { const di = w.body.dofByName(n, ax); return di >= 0 ? drive?.ff?.[di] ?? 0 : 0; };
  const g = (n: string, ax: number) => { const di = w.body.dofByName(n, ax); return di >= 0 ? w.body.dofs[di]!.angle * 57.3 : 0; };
  console.log(`${t.toFixed(1)} ${ctl.sensors.com[0]!.toFixed(3)} ${ctl.sensors.comVel[0]!.toFixed(2).padStart(6)} ${pos('mfoot_r').x.toFixed(3).padStart(7)} ${pos('torso').x.toFixed(3).padStart(7)} | ${ff('hip_r', 2).toFixed(0).padStart(6)} ${ff('foot_r', 2).toFixed(0).padStart(6)} ${ff('knee_r', 2).toFixed(0).padStart(6)} | ${g('spine1', 2).toFixed(1).padStart(5)} ${g('spine2', 2).toFixed(1).padStart(5)} ${g('hip_l', 2).toFixed(1).padStart(5)} ${g('knee_l', 2).toFixed(1).padStart(5)}`);
}
