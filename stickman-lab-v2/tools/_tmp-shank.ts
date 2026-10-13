import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const ang = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
const vel = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.vel ?? 0) * 57.3 : NaN; };
const P = (k: string): any => { const ix = body.indexByKey.get(k); if (ix === undefined) return null; const t = body.bodies[ix].translation(); return { x: t.x*100, y: t.y*100, z: t.z*100 }; };
console.log('t | phase | 膝 x/y/z | 足 x/y/z | knee0 | knee1 | knee2 | 膝角速(k2) | foot0 | foot2');
for (let s = 0; s < Math.round(5.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.0 && s % 48 === 0) {
    const k = P('shin_l'), f = P('foot_l');
    const ph = (ctl as any).actions?.status?.phase ?? '?';
    console.log(`${t.toFixed(2)} | ${ph} | ${k.x.toFixed(0)}/${k.y.toFixed(0)}/${k.z.toFixed(0).padStart(4)} | ${f.x.toFixed(0)}/${f.y.toFixed(0)}/${f.z.toFixed(0).padStart(4)} | ${ang('knee_l',0).toFixed(0).padStart(3)} | ${ang('knee_l',1).toFixed(0).padStart(3)} | ${ang('knee_l',2).toFixed(0).padStart(4)} | ${vel('knee_l',2).toFixed(0).padStart(5)} | ${ang('foot_l',0).toFixed(0).padStart(3)} | ${ang('foot_l',2).toFixed(0).padStart(3)}`);
  }
}
