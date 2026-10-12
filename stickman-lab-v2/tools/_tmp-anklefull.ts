import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
const dFlex = w.body.dofByName('foot_r', 2);
const dLat = w.body.dofByName('foot_r', 0);
console.log('t     屈伸角° τ(srv|ff|dmp|Σ)  | 侧向角° τ(srv|ff|dmp|Σ) | fz   CoPx   CoPz');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.0 || t > 4.2) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const bd = (di: number) => {
    const b = drive?.lastBreakdown?.[di] ?? { servo: 0, ff: 0, damp: 0 };
    return `${b.servo.toFixed(0)}|${b.ff.toFixed(0)}|${b.damp.toFixed(0)}|${(b.servo + b.ff + b.damp).toFixed(0)}`;
  };
  const aF = dFlex >= 0 ? w.body.dofs[dFlex]!.angle * 57.3 : 0;
  const aL = dLat >= 0 ? w.body.dofs[dLat]!.angle * 57.3 : 0;
  const f = ctl.sensors.feet[1]!;
  console.log(`${t.toFixed(1)} ${aF.toFixed(1).padStart(8)} ${(dFlex >= 0 ? bd(dFlex) : '--').padStart(12)} | ${aL.toFixed(1).padStart(8)} ${(dLat >= 0 ? bd(dLat) : '--').padStart(12)} | ${f.fz.toFixed(0).padStart(4)} ${f.copX.toFixed(3)} ${f.copZ.toFixed(3)}`);
}
