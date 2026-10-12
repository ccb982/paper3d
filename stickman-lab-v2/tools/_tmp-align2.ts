import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = (w.body as any);
const torsoIdx = body.indexByKey.get('torso');
const ankIdx = body.indexByKey.get('mfoot_r');
const footIdx = body.indexByKey.get('foot_r');
let alignT = 0, totalSL = 0, alignMax = 0, cur = 0;
for (let s = 0; s < Math.round(7.5 / w.dt); s++) {
  w.advance(1);
  const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
  const single = (fl.loaded !== fr.loaded);
  if (single) {
    totalSL += w.dt;
    const d = Math.abs((body.bodies[torsoIdx] as any).translation().x - (body.bodies[ankIdx] as any).translation().x);
    // 脚竖直判据：足部上向量与世界上方向的夹角 < 20°
    const q = (body.bodies[footIdx] as any).rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);   // 局部+Y 转到世界后的 y 分量（万向式）
    const tilt = Math.acos(Math.max(-1, Math.min(1, upY))) * 57.3;
    const ok = d < 0.05 && tilt < 20;
    if (ok) { alignT += w.dt; cur += w.dt; if (cur > alignMax) alignMax = cur; }
    else { cur = 0; }
  } else { cur = 0; }
}
console.log(`单腿总时长=${totalSL.toFixed(2)}s  【对齐+脚竖直】累计=${alignT.toFixed(2)}s (${(alignT / Math.max(0.01, totalSL) * 100).toFixed(0)}%)  最长连续=${alignMax.toFixed(2)}s`);
