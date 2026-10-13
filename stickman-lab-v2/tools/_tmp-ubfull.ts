import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const ori = (k: string): { px: number; py: number; pz: number; x: number; y: number; z: number } => {
  const ix = body.indexByKey.get(k);
  if (ix === undefined) return { px: 0, py: 0, pz: 0, x: 0, y: 0, z: 0 };
  const b = body.bodies[ix]; const q = b.rotation(); const t = b.translation();
  const upx = 2*(q.x*q.y - q.w*q.z), upy = 1-2*(q.x*q.x+q.z*q.z), upz = 2*(q.y*q.z + q.w*q.x);
  return { px: t.x*100, py: t.y*100, pz: t.z*100, x: Math.atan2(-upx, upy)*57.3, y: Math.atan2(upz, upy)*57.3, z: Math.atan2(2*(q.w*q.y+q.z*q.x), 1-2*(q.y*q.y+q.z*q.z))*57.3 };
};
console.log('t | 骶驨pitch(y) | 腰sp1pitch | 胸sp2pitch | 头pitch | 胸com x/y/z');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const p = ori('pelvis'), s1 = ori('spine2'), s2 = ori('spine3'), h = ori('head');
    const ch = ori('torso');
    console.log(`${t.toFixed(2)} | ${p.x.toFixed(0).padStart(5)} | ${s1.x.toFixed(1).padStart(5)} | ${s2.x.toFixed(1).padStart(5)} | ${h.x.toFixed(0).padStart(5)} | ${ch.px.toFixed(0)}/${ch.py.toFixed(0)}/${ch.pz.toFixed(0)}`);
  }
}
