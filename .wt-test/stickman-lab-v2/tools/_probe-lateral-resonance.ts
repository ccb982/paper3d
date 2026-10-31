/**
 * _probe-lateral-resonance.ts —— 横向自激/共振复现与隔离（加大冲量版）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

interface Over { lean?: boolean; boost?: number; armBias?: number; pad?: boolean; }

function run(label: string, dv: number, o: Over): void {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  if (o.lean === false) ctl.warner.opt.leanSign = 0;
  if (o.boost !== undefined) ctl.warner.opt.leanBoostSpineGain = o.boost;
  if (o.armBias !== undefined) ctl.warner.opt.leanBoostArmBias = o.armBias;
  if (o.pad === false) ctl.padEnabled = false;
  w.controller = ctl;
  w.reset();
  const chest = () => w.body.bodies[w.body.indexByKey.get('spine4') ?? 0]!.translation().y;
  let pushed = false;
  const env: number[] = [];
  let segPeak = 0, segT = 0;
  let minChest = Infinity;
  for (let s = 0; s < Math.round(6 / w.dt); s++) {
    const t = s * w.dt;
    if (!pushed && t >= 0.5) {
      for (const b of w.body.bodies) b.applyImpulse({ x: 0, y: 0, z: b.mass() * dv }, true);
      pushed = true;
    }
    w.advance(1);
    const az = Math.abs(ctl.sensors.com[2]!);
    if (az > segPeak) segPeak = az;
    minChest = Math.min(minChest, chest());
    segT += w.dt;
    if (segT >= 0.25) { env.push(segPeak); segPeak = 0; segT = 0; }
  }
  const e = env.slice(2, 20).map((v) => v.toFixed(3)).join(' ');
  const first = Math.max(...env.slice(2, 6));
  const last = Math.max(...env.slice(18, 24));
  console.log(`${label}：${e}`);
  console.log(`   ${(first * 100).toFixed(1)}→${(last * 100).toFixed(1)}cm  ${last > first * 1.2 ? '★放大' : last < first * 0.8 ? '衰减 ✓' : '等幅'}  最低胸=${minChest.toFixed(2)}`);
}

run('冲量0.4 完整        ', 0.4, {});
run('冲量0.4 腰boost=0   ', 0.4, { boost: 0 });
run('冲量0.4 臂偏置=0    ', 0.4, { armBias: 0 });
run('冲量0.4 boost/臂=0  ', 0.4, { boost: 0, armBias: 0 });
run('冲量0.4 lean关      ', 0.4, { lean: false });
