/** _probe-lat-sweep: sweep lateralStab gains -> oscillation metric + fall time,
 *  find the stability boundary, then operate at boundary-15% margin (per papers). */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { LATERAL } from '../src/core/servo/lateralStab';

function run(kz: number, kv: number): string {
  LATERAL.stabKz = kz; LATERAL.kvz = kv; LATERAL.rate = 0.9;
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  ctl.actions.play('singleLegR');
  const body = w.body;
  const s1 = body.dofByName('spine1', 0);
  let p2p = 0, maxDev = 0, fallT = 0;
  let lo = 1, hi = -1;
  for (let s = 0; s < Math.round(7 / w.dt); s++) {
    w.advance(1);
    const t = s * w.dt;
    if (t > 4.8 && t < 6.8) {
      const a = body.dofs[s1]!.angle;
      if (a < lo) lo = a; if (a > hi) hi = a;
      p2p = hi - lo;
      const dev = Math.abs(ctl.sensors.com[2]! - ctl.sensors.feet[1]!.z);
      if (dev > maxDev) maxDev = dev;
      const chest = body.bodies[body.indexByKey.get('spine4') ?? 0]!.translation().y;
      if (fallT === 0 && chest < 1.0) fallT = t;
    }
  }
  return `kz=${kz.toFixed(2)} kv=${kv.toFixed(2)}  sp1p2p=${(p2p * 180 / Math.PI).toFixed(1)}°  comZ最大偏=${maxDev.toFixed(2)}m  ${fallT > 0 ? `倒地t=${fallT.toFixed(1)}` : '未倒'}`;
}
for (const kv of [0.1, 0.2, 0.35]) {
  for (const kz of [0.3, 0.55, 0.8, 1.1, 1.4, 1.8]) {
    console.log(run(kz, kv));
  }
  console.log('---');
}
