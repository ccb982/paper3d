/** 只留重力+被动：关掉全部主动力矩（stability/伺服/动作层的 setAngle/setTorque）——看 comX 是否还跑。 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 0 });   // postureTone=0 → 姿势张力关
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t     comX    vX     支撑踝x  胸高');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.0 || t > 4.3) continue;
  if (Math.abs(t * 5 - Math.round(t * 5)) > 1e-6) continue;
  const pos = (n: string) => { const i = (w.body as any).indexByKey.get(n); return i != null ? (w.body.bodies[i] as any).translation() : { x: 0 }; };
  console.log(`${t.toFixed(1)} ${ctl.sensors.com[0]!.toFixed(3)} ${ctl.sensors.comVel[0]!.toFixed(2).padStart(6)} ${pos('mfoot_r').x.toFixed(3).padStart(7)} ${ctl.sensors.com[1]!.toFixed(3)}`);
}
