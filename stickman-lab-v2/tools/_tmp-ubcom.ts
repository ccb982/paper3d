import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const upperKeys = ['torso', 'spine4', 'spine3', 'spine2', 'head', 'neck', 'shoulder_l', 'shoulder_r', 'elbow_l', 'elbow_r'];
const ubCom = (): { z: number; m: number } => {
  let mz = 0, mm = 0;
  for (const k of upperKeys) {
    const ix = body.indexByKey.get(k);
    if (ix === undefined) continue;
    const b = body.bodies[ix];
    const m = b.mass();
    mz += b.translation().z * m;
    mm += m;
  }
  return { z: mz / Math.max(1e-9, mm), m: mm };
};
console.log('t | 上身CoM z | 质量 | 脚心z | 足内缘 | 足外缘 | 上身余量(內/外)');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const ub = ubCom();
    const f = ctl.sensors.feet[1]!;
    const hw = 0.045;
    const medEdge = f.z - hw, latEdge = f.z + hw;
    console.log(`${t.toFixed(2)} | ${(ub.z*100).toFixed(1).padStart(6)} | ${ub.m.toFixed(1).padStart(4)} | ${(f.z*100).toFixed(1).padStart(6)} | ${(medEdge*100).toFixed(1).padStart(6)} | ${(latEdge*100).toFixed(1).padStart(6)} | ${((medEdge-ub.z)*100).toFixed(1).padStart(5)}/${((ub.z-latEdge)*100).toFixed(1)}`);
  }
}
