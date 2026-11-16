import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const drive = (w as any).drive ?? (ctl as any).drive;
const bd = (n: string, ax: number) => {
  const di = w.body.dofByName(n, ax);
  if (di < 0) return { s: 0, a: 0, se: 0, f: 0, d: 0, ang: 0, vel: 0 };
  const b = drive?.lastBreakdown?.[di] ?? {};
  const dd = w.body.dofs[di]!;
  return { s: b.stiff ?? 0, a: b.act ?? 0, se: b.servo ?? 0, f: b.ff ?? 0, d: b.damp ?? 0, ang: dd.angle * 57.3, vel: dd.vel };
};
const q = (w.body as any);
const pos = (key: string) => { const ix = q.indexByKey.get(key); return q.bodies[ix].translation(); };
const wv = (key: string) => { const ix = q.indexByKey.get(key); return q.bodies[ix].angvel(); };
console.log('t | 踝L2 vel | 足L0 vel | mfoot_L x y z (cm) | mfoot ωx ωy ωz');
for (let s = 0; s < Math.round(4.3 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.3 || t > 4.1) continue;
  
  const k = bd('foot_l', 2);
  const f0 = bd('foot_l', 0);
  const p = pos('mfoot_l');
  const av = wv('mfoot_l');
  console.log(`${t.toFixed(3)} | ${k.vel.toFixed(2).padStart(5)} | ${f0.vel.toFixed(2).padStart(5)} | ${(p.x * 100).toFixed(1).padStart(6)} ${(p.y * 100).toFixed(1).padStart(5)} ${(p.z * 100).toFixed(1).padStart(6)} | ${av.x.toFixed(1).padStart(5)} ${av.y.toFixed(1).padStart(5)} ${av.z.toFixed(1).padStart(5)}`);
}
