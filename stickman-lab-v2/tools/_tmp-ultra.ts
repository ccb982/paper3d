import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const b = w.body as any;
const wv = (key: string) => { const ix = b.indexByKey.get(key); return b.bodies[ix].angvel(); };
const pos = (key: string) => { const ix = b.indexByKey.get(key); return b.bodies[ix].translation(); };
const dv = (n: string, ax: number) => { const i = w.body.dofByName(n, ax); return i >= 0 ? w.body.dofs[i]!.vel : 0; };
const da = (n: string, ax: number) => { const i = w.body.dofByName(n, ax); return i >= 0 ? w.body.dofs[i]!.angle * 57.3 : 0; };
const drive = (w as any).drive ?? (ctl as any).drive;
const tau = (n: string, ax: number): number => {
  const di = w.body.dofByName(n, ax);
  if (di < 0) return 0;
  const b = drive?.lastBreakdown?.[di] ?? {};
  return (b.stiff ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.act ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0);
};
console.log('fr | t | mfootωy | footL轴v(0/1/2) | 踝Lτ(2) | 踝Lτ(0) | mfootτ | 踝Lτmax=170');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.0 || t > 3.25) continue;
  const m = wv('mfoot_l');
  const f = wv('foot_l');
  console.log(`${s} | ${t.toFixed(4)} | ${m.y.toFixed(2).padStart(6)} | ${dv('foot_l', 0).toFixed(2).padStart(5)} ${dv('foot_l', 1).toFixed(2).padStart(5)} ${dv('foot_l', 2).toFixed(2).padStart(5)} | ${tau('foot_l', 2).toFixed(1).padStart(6)} | ${tau('foot_l', 0).toFixed(1).padStart(6)} | ${tau('mfoot_l', 0).toFixed(1).padStart(5)} |`);
}
