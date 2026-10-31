/** _probe-leanpose.ts —— 站立侧倾诊断：comZ/髋踝角对比 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

for (const hz of [240, 480]) {
  const w = new World({ physicsHz: hz });
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  const ang = (n: string, a: number) => {
    const i = w.body.dofByName(n, a);
    return i >= 0 ? w.body.dofs[i]!.angle : NaN;
  };
  for (let s = 0; s < Math.round(4 / w.dt); s++) w.advance(1);
  const c = ctl.sensors.com;
  console.log(
    `Hz=${hz}: com=(${c[0]!.toFixed(3)}, ${c[2]!.toFixed(3)})` +
    ` 胸=${w.body.bodies[w.body.indexByKey.get('spine4')!]!.translation().y.toFixed(3)}` +
    ` hipL0=${ang('hip_l', 0).toFixed(3)} hipR0=${ang('hip_r', 0).toFixed(3)}` +
    ` footL0=${ang('foot_l', 0).toFixed(3)} footR0=${ang('foot_r', 0).toFixed(3)}` +
    ` spine2_0=${ang('spine2', 0).toFixed(3)}`
  );
}
