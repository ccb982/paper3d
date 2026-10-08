/**
 * _probe-armaxis.ts —— 手臂侧摆标定（左右臂轴向/组合方向）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const cases: Array<[string, Array<[string, number, number]>]> = [
  ['L +0.8', [['shoulder_l', 0, 0.8]]],
  ['L -0.8', [['shoulder_l', 0, -0.8]]],
  ['R +0.8', [['shoulder_r', 0, 0.8]]],
  ['R -0.8', [['shoulder_r', 0, -0.8]]],
  ['L+R 同号 +0.8', [['shoulder_l', 0, 0.8], ['shoulder_r', 0, 0.8]]],
  ['L+ R- (0.8)', [['shoulder_l', 0, 0.8], ['shoulder_r', 0, -0.8]]],
];
for (const [label, cmds] of cases) {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  for (let s = 0; s < Math.round(0.25 / w.dt); s++) w.advance(1);
  const z0 = ctl.sensors.com[2]!;
  for (const [joint, axis, ang] of cmds) ctl.manual.setAngle(joint, axis, ang);
  for (let s = 0; s < Math.round(0.8 / w.dt); s++) w.advance(1);
  console.log(`${label.padEnd(14)}: CoM Δz=${((ctl.sensors.com[2]! - z0) * 100).toFixed(1)}cm  胸y=${w.body.bodies[w.body.indexByKey.get('spine4') ?? 0]!.translation().y.toFixed(2)}`);
}
