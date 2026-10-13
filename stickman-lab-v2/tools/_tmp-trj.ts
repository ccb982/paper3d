import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const P = (k: string): {x:number;y:number;z:number} => {
  const ix = body.indexByKey.get(k);
  if (ix === undefined) return {x:NaN,y:NaN,z:NaN};
  const t = body.bodies[ix].translation();
  return {x: t.x*100, y: t.y*100, z: t.z*100};
};
const V = (k: string): number => {
  const ix = body.indexByKey.get(k);
  if (ix === undefined) return NaN;
  const v = body.bodies[ix].linvel();
  return Math.hypot(v.x, v.y, v.z)*100;
};
console.log('t | 左足 x/y/z | 右足 z | 左膝 z | 右膝 z | 两足距 | 左足v');
for (let s = 0; s < Math.round(4.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.2 && t < 4.0 && s % 24 === 0) {
    const fl = P('foot_l'), fr = P('foot_r'), kl = P('knee_l'), kr = P('knee_r');
    const d = Math.hypot(fl.z - fr.z, fl.x - fr.x);
    console.log(`${t.toFixed(2)} | ${fl.x.toFixed(0)}/${fl.y.toFixed(0)}/${fl.z.toFixed(0).padStart(4)} | ${fr.z.toFixed(0).padStart(4)} | ${kl.z.toFixed(0).padStart(4)} | ${kr.z.toFixed(0).padStart(4)} | ${d.toFixed(0).padStart(3)} | ${V('foot_l').toFixed(0).padStart(4)}`);
  }
}
