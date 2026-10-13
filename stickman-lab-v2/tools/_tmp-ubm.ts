import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const UB = ['torso','spine4','spine3','spine2','head','neck','shoulder_l','shoulder_r','elbow_l','elbow_r'];
let prevV: {x:number;y:number;z:number}|null = null;
const ubState = (): any => {
  let mz=0,mx=0,mm=0,vx=0,vy=0,vz=0;
  for (const k of UB) {
    const ix = body.indexByKey.get(k);
    if (ix===undefined) continue;
    const b = body.bodies[ix]; const m=b.mass(); const t=b.translation(); const v=b.linvel();
    mz+=t.z*m; mx+=t.x*m; mm+=m; vx+=v.x*m; vy+=v.y*m; vz+=v.z*m;
  }
  return { z: mz/mm*100, x: mx/mm*100, vx: vx/mm*100, vz: vz/mm*100, vy: vy/mm*100, m: mm };
};
console.log('t | UBz | UBx | UBvz(cm/s) | UBvx | UBvy | 侧余量 | 矢余量');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const u = ubState();
    const f = ctl.sensors.feet[1]!;
    const hw = 0.045;
    const medEdge = f.z - hw, latEdge = f.z + hw;
    const latM = Math.min(u.z - medEdge*100, latEdge*100 - u.z);
    const sagM = 4.5 - Math.abs(u.x);
    console.log(`${t.toFixed(2)} | ${u.z.toFixed(1).padStart(6)} | ${u.x.toFixed(1).padStart(5)} | ${u.vz.toFixed(0).padStart(5)} | ${u.vx.toFixed(0).padStart(5)} | ${u.vy.toFixed(0).padStart(5)} | ${latM.toFixed(1).padStart(5)} | ${sagM.toFixed(1)}`);
  }
}
