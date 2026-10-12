import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
const joints: Array<[string, number]> = [
  ['hip_r', 2], ['knee_r', 2], ['foot_r', 2], ['hip_r', 0],
  ['hip_l', 2], ['knee_l', 2], ['hip_l', 0],
  ['spine1', 2], ['spine2', 2], ['spine3', 2],
  ['shoulder_l', 2], ['shoulder_r', 2],
];
console.log('t      comX    vX    | ' + joints.map(([n, a]) => `${n}/${a}`.padEnd(9)).join(''));
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.4 || t > 4.4) continue;
  if (Math.abs(t * 5 - Math.round(t * 5)) > 1e-6) continue;
  const row = joints.map(([n, a]) => {
    const di = w.body.dofByName(n, a);
    const f = di >= 0 ? (drive?.ff?.[di] ?? 0) : 0;
    const srv = di >= 0 ? (drive?.lastBreakdown?.[di]?.servo ?? 0) : 0;
    return (f + srv).toFixed(0).padStart(8);
  }).join(' ');
  console.log(`${t.toFixed(1)} ${ctl.sensors.com[0]!.toFixed(3)} ${ctl.sensors.comVel[0]!.toFixed(2).padStart(5)} | ${row}`);
}
