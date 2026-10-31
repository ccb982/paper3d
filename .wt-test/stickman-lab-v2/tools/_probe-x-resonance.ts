/** _probe-x-resonance.ts —— 前后（矢状）自激测试：0.4 m/s 前后冲量 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function run(label: string, o: { bend?: boolean; lean?: boolean; pad?: boolean }): void {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  if (o.bend === false) ctl.warner.opt.bendSign = 0;
  if (o.lean === false) ctl.warner.opt.leanSign = 0;
  if (o.pad === false) ctl.padEnabled = false;
  w.controller = ctl;
  w.reset();
  const chest = () => w.body.bodies[w.body.indexByKey.get('spine4') ?? 0]!.translation().y;
  let pushed = false, segPeak = 0, segT = 0, minChest = Infinity;
  const env: number[] = [];
  for (let s = 0; s < Math.round(6 / w.dt); s++) {
    const t = s * w.dt;
    if (!pushed && t >= 0.5) {
      for (const b of w.body.bodies) b.applyImpulse({ x: b.mass() * 0.2, y: 0, z: 0 }, true);
      pushed = true;
    }
    w.advance(1);
    segPeak = Math.max(segPeak, Math.abs(ctl.sensors.com[0]!));
    minChest = Math.min(minChest, chest());
    segT += w.dt;
    if (segT >= 0.25) { env.push(segPeak); segPeak = 0; segT = 0; }
  }
  const first = Math.max(...env.slice(2, 6));
  const last = Math.max(...env.slice(18, 24));
  console.log(`${label}：${env.slice(2, 20).map((v) => v.toFixed(2)).join(' ')} → ${(first * 100).toFixed(0)}→${(last * 100).toFixed(0)}cm ${last > first * 1.2 ? '★放大' : last < first * 0.8 ? '衰减✓' : '等幅'} 最低胸${minChest.toFixed(2)}`);
}
run('完整      ', {});
run('bend关    ', { bend: false });
run('lean关    ', { lean: false });
run('垫脚关    ', { pad: false });
