import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const dr = ctl.warner.drive as any;
const acc = (k: string): { az: number; ax: number } => {
  const ix = body.indexByKey.get(k);
  if (ix === undefined) return { az: 0, ax: 0 };
  const b = body.bodies[ix];
  const v = b.linvel();
  const pv = (b as any).__pv ?? b.linvel();
  const a = { x: (v.x - pv.x) * 240, z: (v.z - pv.z) * 240 };
  (b as any).__pv = { x: v.x, y: v.y, z: v.z };
  return { az: a.z * 100, ax: a.x * 100 };
};
const T = (n: string, ax: number): string => {
  const di = body.dofByName(n, ax);
  if (di < 0) return ' n/a';
  const b = dr.lastBreakdown[di] as any;
  if (!b) return ' ---';
  const tot = (b.stiff||0)+(b.itb||0)+(b.lum||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0);
  return tot.toFixed(0).padStart(4)+'[a'+(b.act||0).toFixed(0)+' s'+(b.servo||0).toFixed(0)+' d'+(b.damp||0).toFixed(0)+']';
};
console.log('t | UB加速z | UB加速x | 骨盆加速z | hip0矩 | hip2矩 | sp1/0矩 | sp2/0矩 | sp1/2矩');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const ia = acc('torso');
    const ip = acc('pelvis');
    console.log(`${t.toFixed(2)} | ${ia.az.toFixed(0).padStart(6)} | ${ia.ax.toFixed(0).padStart(6)} | ${ip.az.toFixed(0).padStart(6)} | ${T('hip_r',0)} | ${T('hip_r',2)} | ${T('spine1',0)} | ${T('spine2',0)} | ${T('spine1',2)}`);
  }
}
