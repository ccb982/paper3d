/**
 * _probe-sideaxis.ts —— 脊柱侧屈轴标定：哪根轴能把胸腔往侧面搬
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const chest = (w: World) => w.body.bodies[w.body.indexByKey.get('spine4') ?? 0]!.translation();
for (const [axis, ang] of [[0, 0.3], [0, -0.3], [1, 0.3], [1, -0.3], [2, 0.3], [2, -0.3]] as Array<[number, number]>) {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  for (let s = 0; s < Math.round(0.25 / w.dt); s++) w.advance(1);
  const c0 = chest(w);
  const z0 = c0.z, y0 = c0.y;
  ctl.manual.setAngle('spine2', axis, ang);
  for (let s = 0; s < Math.round(0.8 / w.dt); s++) w.advance(1);
  const c = chest(w);
  console.log(`spine2/${axis} ${ang > 0 ? '+' : ''}${ang}: 胸 Δz=${((c.z - z0) * 100).toFixed(0)}cm Δy=${((c.y - y0) * 100).toFixed(0)}cm`);
}
