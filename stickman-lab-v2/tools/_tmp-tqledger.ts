import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
const W = w.body.sk.massTotal * 9.81;
console.log('t     支撑fz   CoPx    踝τ  摆腿fz  | 髋_r/2 膝_r/2 踝_r/2 髋_r/0 | 髋_l/2 膝_l/2 | sp1/2 sp2/2 肩l/2 肩r/2');
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.0 || t > 4.5) continue;
  if (Math.abs(t * 5 - Math.round(t * 5)) > 1e-6) continue;
  const tau = (n: string, ax: number) => {
    const di = w.body.dofByName(n, ax);
    if (di < 0) return 0;
    const bd = drive?.lastBreakdown?.[di] ?? { stiff: 0, itb: 0, lum: 0, act: 0, servo: 0, ff: 0, damp: 0 };
    return bd.stiff + bd.itb + bd.lum + bd.act + bd.servo + bd.ff + bd.damp;
  };
  const f = ctl.sensors.feet[1]!;
  console.log(`${t.toFixed(1)} ${f.fz.toFixed(0).padStart(6)} ${f.copX.toFixed(3).padStart(7)} ${tau('foot_r', 2).toFixed(0).padStart(5)} ${ctl.sensors.feet[0]!.fz.toFixed(0).padStart(6)} | ${tau('hip_r', 2).toFixed(0).padStart(6)} ${tau('knee_r', 2).toFixed(0).padStart(6)} ${tau('foot_r', 2).toFixed(0).padStart(6)} ${tau('hip_r', 0).toFixed(0).padStart(6)} | ${tau('hip_l', 2).toFixed(0).padStart(6)} ${tau('knee_l', 2).toFixed(0).padStart(6)} | ${tau('spine1', 2).toFixed(0).padStart(5)} ${tau('spine2', 2).toFixed(0).padStart(5)} ${tau('shoulder_l', 2).toFixed(0).padStart(5)} ${tau('shoulder_r', 2).toFixed(0).padStart(5)}`);
}
