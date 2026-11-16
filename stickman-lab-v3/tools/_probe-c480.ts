/** _probe-c480.ts —— 480Hz 下隐式 PD 的蹬地与站立 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

for (const hz of [240, 480]) {
  const w = new World({ physicsHz: hz });
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  const chest = w.body.indexByKey.get('spine4')!;
  let standChest = 0;
  for (let s = 0; s < Math.round(1.0 / w.dt); s++) w.advance(1);
  standChest = w.body.bodies[chest]!.translation().y;
  ctl.actions.play('pushRise');
  let minC = 9, maxC = 0;
  for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
    w.advance(1);
    const cy = w.body.bodies[chest]!.translation().y;
    minC = Math.min(minC, cy); maxC = Math.max(maxC, cy);
  }
  console.log(`Hz=${hz}: 静站胸=${standChest.toFixed(3)}  蹬地行程=${((maxC - minC) * 100).toFixed(1)}cm  末胸=${w.body.bodies[chest]!.translation().y.toFixed(3)}`);
}
