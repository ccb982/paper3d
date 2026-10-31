/**
 * _probe-lean.ts —— 侧向转移符号标定：目标 z = −0.10（往右脚方向搬）
 * 谁的 comZ 朝 −0.10 收敛，谁的 leanSign 正确。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

for (const sign of [0, 1, -1]) {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  ctl.warner.opt.leanSign = sign;       // 隔离：只测 lean
  ctl.warner.opt.bendSign = 0;
  w.controller = ctl;
  w.reset();
  ctl.warner.setComTarget(0, 0);
  const weight = w.sk.massTotal * 9.81;
  const trace: string[] = [];
  for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
    const tt = s * w.dt;
    ctl.warner.setComTarget(0, -Math.min(0.16, 0.06 * tt));   // 与动作一致的斜坡
    w.advance(1);
    if (s % Math.round(0.5 / w.dt) === 0) {
      trace.push(`t=${tt.toFixed(1)} z=${ctl.sensors.com[2]!.toFixed(3)} L=${(ctl.sensors.feet[0]!.fz / weight * 100).toFixed(0)}%`);
    }
  }
  console.log(`leanSign=${sign.toString().padStart(2)}：${trace.join('  ')}  末z=${ctl.sensors.com[2]!.toFixed(3)}`);
  void ctl;
}
