/**
 * _probe-d-sweep.ts —— 单脚 D 参数扫描：找"腰部增益 × 摆臂偏置"的通过组合
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function runD(boostSpine: number, boostArm: number): { minChest: number; lift: number } {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  ctl.warner.opt.leanBoostSpineGain = boostSpine;
  ctl.warner.opt.leanBoostArmBias = boostArm;
  w.controller = ctl;
  w.reset();
  ctl.actions.play('singleLegR');
  const chestIdx = w.body.indexByKey.get('spine4') ?? 0;
  let minChest = Infinity, maxLift = 0;
  for (let s = 0; s < Math.round(6 / w.dt); s++) {
    w.advance(1);
    const cy = w.body.bodies[chestIdx]!.translation().y;
    if (cy < minChest) minChest = cy;
    const lift = ctl.sensors.feet[0]!.y - 0.068;
    if (lift > maxLift) maxLift = lift;
  }
  return { minChest, lift: maxLift };
}

for (const gs of [0, 1.0, 2.0, 3.0]) {
  const row: string[] = [];
  for (const ba of [0.15, 0.3, 0.45]) {
    const r = runD(gs, ba);
    row.push(`臂${ba}: 胸${r.minChest.toFixed(2)} 抬${(r.lift * 100).toFixed(0)}cm${r.minChest > 1.25 && r.lift > 0.05 ? ' ✓' : ''}`);
  }
  console.log(`腰增益${gs}：${row.join(' | ')}`);
}
