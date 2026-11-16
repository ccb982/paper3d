/**
 * _probe-liftaxis.ts —— 抬腿轴标定：哪根轴/什么符号能把左腿"抬起来且脚不越中线"
 * 期望：脚 y 升高、脚 z 保持 ≥ +0.10（往外侧抬，别横拖到中线）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const cases: Array<[string, number, number]> = [
  ['hip/0 +0.5', 0, +0.5],
  ['hip/0 -0.5', 0, -0.5],
  ['hip/1 +0.5', 1, +0.5],
  ['hip/1 -0.5', 1, -0.5],
];
for (const [label, axis, ang] of cases) {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  for (let s = 0; s < Math.round(0.25 / w.dt); s++) w.advance(1);
  const f0 = ctl.sensors.feet[0]!;
  const z0 = f0.z, y0 = f0.y;
  ctl.manual.setAngle(`hip_l`, axis, ang);
  for (let s = 0; s < Math.round(0.8 / w.dt); s++) w.advance(1);
  const f = ctl.sensors.feet[0]!;
  console.log(`${label}: 脚 Δy=${((f.y - y0) * 100).toFixed(0)}cm Δz=${((f.z - z0) * 100).toFixed(0)}cm  末z=${f.z.toFixed(2)} 胸=${w.body.bodies[w.body.indexByKey.get('spine4') ?? 0]!.translation().y.toFixed(2)}`);
}
