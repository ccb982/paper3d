/**
 * _probe-bend.ts —— 前后弯腰符号标定：目标 x = +0.08（往前搬 CoM）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

for (const sign of [0, 1, -1]) {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  ctl.warner.opt.leanSign = 0;          // 隔离：只测 bend
  ctl.warner.opt.bendSign = sign;
  w.controller = ctl;
  w.reset();
  ctl.warner.setComTarget(0.08, 0);
  const trace: string[] = [];
  const hipL = w.body.dofByName('hip_l', 2);
  let peakHipTau = 0;
  for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
    w.advance(1);
    const t = Math.abs(w.executor.ledger[hipL]!.applied);
    if (t > peakHipTau) peakHipTau = t;
    if (s % Math.round(0.5 / w.dt) === 0) trace.push(`t=${(s * w.dt).toFixed(1)} x=${ctl.sensors.com[0]!.toFixed(3)}`);
  }
  console.log(`bendSign=${sign.toString().padStart(2)}：${trace.join('  ')}  末x=${ctl.sensors.com[0]!.toFixed(3)}  髋τ峰=${peakHipTau.toFixed(0)}`);
}
