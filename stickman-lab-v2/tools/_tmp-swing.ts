import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t     摆髋目标° 摆髋实际°  摆膝目标° 摆膝实际°  摆ab目标° 摆ab实际°  comZ');
for (let s = 0; s < Math.round(5.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.3 || t > 4.9) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const g = (n: string, ax: number) => { const di = w.body.dofByName(n, ax); return di >= 0 ? w.body.dofs[di]!.angle * 57.3 : 0; };
  const drv = (w as any).drive ?? (ctl as any).drive;
  const tgt = (n: string, ax: number) => { const di = w.body.dofByName(n, ax); const v = drv?.target?.[di]; return Number.isNaN(v) || v === undefined ? NaN : v * 57.3; };
  const f = (v: number) => (Number.isNaN(v) ? ' NaN ' : v.toFixed(1).padStart(5));
  console.log(`${t.toFixed(1)} ${f(tgt('hip_l', 2))}  ${g('hip_l', 2).toFixed(1).padStart(8)}  ${f(tgt('knee_l', 2))}  ${g('knee_l', 2).toFixed(1).padStart(8)}  ${f(tgt('hip_l', 0))}  ${g('hip_l', 0).toFixed(1).padStart(8)}  ${ctl.sensors.com[2]!.toFixed(3)}`);
}
