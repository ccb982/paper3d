import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
console.log('t | hip_l/0: ang vel | stiff itb lum act servo ff damp | lim(0=no) | hip_l/0 limit[min,max]');
const di = w.body.dofByName('hip_l', 0);
const d = w.body.dofs[di]!;
console.log(`limit: min=${d.min.toFixed(3)} max=${d.max.toFixed(3)} tauMax=${d.tauMax.toFixed(0)}`);
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.0 || t > 3.15) continue;
  if (s % 2 !== 0) continue;
  const b = drive?.lastBreakdown?.[di] ?? {};
  console.log(`${t.toFixed(3)} | ${(d.angle * 57.3).toFixed(1)} ${d.vel.toFixed(1)} | act=${(b.act ?? 0).toFixed(0)} srv=${(b.servo ?? 0).toFixed(0)} damp=${(b.damp ?? 0).toFixed(0)} | 激活=${(drive?.actuator?.activationOf?.(di) ?? 0).toFixed(2)} | lerReflexSide=${drive?.legReflex?.side}`);
}
