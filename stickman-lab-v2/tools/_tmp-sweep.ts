import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const act = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
const tgt = (n: string, ax: number): number => { const di = body.dofByName(n, ax); if (di < 0) return NaN; const a = (ctl as any).manual?.angle?.[di]; return typeof a === 'number' && !Number.isNaN(a) ? a * 57.3 : NaN; };
const fz = (): number => { const ix = body.indexByKey.get('foot_l'); return ix === undefined ? NaN : body.bodies[ix].translation().z * 100; };
console.log('t | hipL0实 | hipL0靶 | 左足侧z | 右足侧z');
for (let s = 0; s < Math.round(3.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.3 && s % 24 === 0) {
    const fr = body.indexByKey.get('foot_r');
    console.log(`${t.toFixed(2)} | ${act('hip_l',0).toFixed(0).padStart(4)} | ${tgt('hip_l',0).toFixed(0).padStart(4)} | ${fz().toFixed(1).padStart(5)} | ${(body.bodies[fr].translation().z*100).toFixed(1).padStart(5)}`);
  }
}
