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
console.log('fr | t | mfootω: x y z | footL轴: v0 v1 v2 | archA mfootA | mfoot_y cm | footωy');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.0 || t > 3.25) continue;
  const m = wv('mfoot_l');
  const f = wv('foot_l');
  console.log(`${s} | ${t.toFixed(4)} | ${m.x.toFixed(2).padStart(6)} ${m.y.toFixed(2).padStart(6)} ${m.z.toFixed(2).padStart(6)} | ${dv('foot_l', 0).toFixed(2).padStart(6)} ${dv('foot_l', 1).toFixed(2).padStart(6)} ${dv('foot_l', 2).toFixed(2).padStart(6)} | ${da('arch_l', 0).toFixed(2).padStart(6)} ${da('mfoot_l', 0).toFixed(2).padStart(6)} | ${(pos('mfoot_l').y * 100).toFixed(1).padStart(5)} | ${f.y.toFixed(2).padStart(6)}`);
}
