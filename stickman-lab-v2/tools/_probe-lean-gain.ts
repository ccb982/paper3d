/**
 * _probe-lean-gain.ts —— 侧移环路增益扫描：找共振稳定点（0.4 m/s 横向冲量）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function run(gain: number): void {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  ctl.warner.opt.leanGain = gain;
  w.controller = ctl;
  w.reset();
  let pushed = false;
  const env: number[] = [];
  let segPeak = 0, segT = 0, minChest = Infinity;
  const chest = () => w.body.bodies[w.body.indexByKey.get('spine4') ?? 0]!.translation().y;
  for (let s = 0; s < Math.round(6 / w.dt); s++) {
    const t = s * w.dt;
    if (!pushed && t >= 0.5) {
      for (const b of w.body.bodies) b.applyImpulse({ x: 0, y: 0, z: b.mass() * 0.4 }, true);
      pushed = true;
    }
    w.advance(1);
    const az = Math.abs(ctl.sensors.com[2]!);
    if (az > segPeak) segPeak = az;
    minChest = Math.min(minChest, chest());
    segT += w.dt;
    if (segT >= 0.25) { env.push(segPeak); segPeak = 0; segT = 0; }
  }
  const first = Math.max(...env.slice(2, 6));
  const last = Math.max(...env.slice(18, 24));
  console.log(
    `增益${gain.toFixed(2)}：${env.slice(2, 20).map((v) => v.toFixed(2)).join(' ')}` +
    ` → ${(first * 100).toFixed(0)}→${(last * 100).toFixed(0)}cm ${last > first * 1.2 ? '★放大' : last < first * 0.8 ? '衰减✓' : '等幅'} 最低胸${minChest.toFixed(2)}`
  );
}

for (const g of [1.0, 0.7, 0.5, 0.35, 0.2]) run(g);
