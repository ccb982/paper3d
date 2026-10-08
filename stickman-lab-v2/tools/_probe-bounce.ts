/**
 * _probe-bounce.ts —— "砸地反弹"复现：侧推倒地，控制器开/关对比胸高轨迹
 * 判定：落地后胸高再次显著回升 = 反弹；比较纯布娃娃（无控制器、无驱动）
 * 与完整控制（ControlModule）两种情形，定位能量来源。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function run(label: string, useCtl: boolean, dv: number): void {
  const w = new World();
  let ctl: ControlModule | null = null;
  if (useCtl) {
    ctl = new ControlModule(w, { postureTone: 8 });
    w.controller = ctl;
  } else {
    w.driveEnabled = false;                  // 纯布娃娃
  }
  w.reset();
  const chest = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3') ?? 0;
  let pushed = false;
  const trace: string[] = [];
  let minSoFar = Infinity, minT = 0, rebound = 0, tAfter = 0;
  for (let s = 0; s < Math.round(3.5 / w.dt); s++) {
    const t = s * w.dt;
    if (!pushed && t >= 0.5) {
      for (const b of w.body.bodies) b.applyImpulse({ x: b.mass() * dv, y: 0, z: 0 }, true);
      pushed = true;
    }
    w.advance(1);
    const cy = w.body.bodies[chest]!.translation().y;
    if (cy < minSoFar - 1e-6) { minSoFar = cy; minT = t; }
    if (t > minT && cy > minSoFar + rebound) rebound = cy - minSoFar;
    if (s % Math.round(0.1 / w.dt) === 0) trace.push(`${t.toFixed(1)}:${cy.toFixed(2)}`);
  }
  console.log(`${label}：${trace.join(' ')}`);
  console.log(`   首次最低胸=${minSoFar.toFixed(3)} @${minT.toFixed(2)}s  其后最大回升=${(rebound * 100).toFixed(1)}cm  末胸=${w.body.bodies[chest]!.translation().y.toFixed(2)}`);
}

run('纯布娃娃（无驱动/无控制器）', false, 2.0);
run('完整控制（ControlModule）', true, 2.0);
run('完整控制（小推力）', true, 0.8);
