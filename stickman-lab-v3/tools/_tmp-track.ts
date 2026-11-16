import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const act = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN;
};
const tgt = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  if (di < 0) return NaN;
  // manual 目标表
  const m = (ctl as any).manual;
  const a = m?.angle?.[di];
  return typeof a === 'number' && !Number.isNaN(a) ? a * 57.3 : NaN;
};
const fy = (): number => { const ix = body.indexByKey.get('foot_l'); return ix === undefined ? NaN : body.bodies[ix].translation().y * 100; };
console.log('t | hipL2实 | hipL2靶 | kneeL2实 | kneeL2靶 | 足高');
for (let s = 0; s < Math.round(3.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.3 && s % 24 === 0) {
    console.log(`${t.toFixed(2)} | ${act('hip_l',2).toFixed(0).padStart(4)} | ${tgt('hip_l',2).toFixed(0).padStart(4)} | ${act('knee_l',2).toFixed(0).padStart(4)} | ${tgt('knee_l',2).toFixed(0).padStart(4)} | ${fy().toFixed(1)}`);
  }
}
