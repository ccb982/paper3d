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
let inHold = false, alignT = 0, totalSL = 0, alignMax = 0, cur = 0, worstD = 0;
for (let s = 0; s < Math.round(7.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
  const single = (fl.loaded !== fr.loaded);
  if (single) {
    totalSL += w.dt;
    const d = Math.abs((body.bodies[torsoIdx] as any).translation().x - (body.bodies[ankIdx] as any).translation().x);
    if (d < 0.05) { alignT += w.dt; cur += w.dt; if (cur > alignMax) alignMax = cur; }
    else { cur = 0; if (d > worstD) worstD = d; }
  } else { cur = 0; }
}
console.log(`单腿总时长=${totalSL.toFixed(2)}s  对齐(±5cm)累计=${alignT.toFixed(2)}s (${(alignT / Math.max(0.01, totalSL) * 100).toFixed(0)}%)  最长连续对齐=${alignMax.toFixed(2)}s  最大偏移=${(worstD * 100).toFixed(0)}cm`);
