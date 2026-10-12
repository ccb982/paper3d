import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
console.log('t      sp1/0:τ(srv|ff|dmp)  sp2/0:τ  hip_r/0:τ(srv|ff|dmp) | latStab?  |  roll°');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.5 || t > 3.2) continue;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;
  const tau = (n: string, ax: number) => {
    const di = w.body.dofByName(n, ax);
    if (di < 0) return null;
    const bd = drive?.lastBreakdown?.[di];
    return bd ? { s: bd.servo, f: bd.ff, d: bd.damp } : { s: 0, f: 0, d: 0 };
  };
  const a = tau('spine1', 0)!, b = tau('spine2', 0)!, c = tau('hip_r', 0)!;
  const q = (w.body as any).bodies[(w.body as any).indexByKey.get('torso')].rotation();
  const roll = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y)) * 57.3;
  console.log(`${t.toFixed(2)}  s1:${a.s.toFixed(0)}|${a.f.toFixed(0)}|${a.d.toFixed(0)}  s2:${b.s.toFixed(0)}  hip:${c.s.toFixed(0)}|${c.f.toFixed(0)}|${c.d.toFixed(0)} | ${roll.toFixed(2)}`);
}
