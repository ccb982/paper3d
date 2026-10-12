import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
console.log('t | foot_r/2: ang vel | stiff itb lum act servo ff damp | lim');
const di = w.body.dofByName('foot_r', 2);
const d = w.body.dofs[di]!;
console.log(`limit: min=${d.min.toFixed(3)} max=${d.max.toFixed(3)} tauMax=${d.tauMax.toFixed(0)}`);
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.5 || t > 4.4) continue;
  if (s % 20 !== 0) continue;
  const b = drive?.lastBreakdown?.[di] ?? {};
  console.log(`${t.toFixed(3)} | ${(d.angle * 57.3).toFixed(1)} ${d.vel.toFixed(1)} | stf=${(b.stiff ?? 0).toFixed(1)} itb=${(b.itb ?? 0).toFixed(1)} lum=${(b.lum ?? 0).toFixed(1)} act=${(b.act ?? 0).toFixed(1)} srv=${(b.servo ?? 0).toFixed(1)} ff=${(b.ff ?? 0).toFixed(1)} dmp=${(b.damp ?? 0).toFixed(1)} | ${drive?.stats?.limitHits ?? 0}`);
}
