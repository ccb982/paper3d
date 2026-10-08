/**
 * _probe-gravity.ts —— 重力场景隔离：接触 vs 纯重力载荷 × 中间体质量 × 迭代
 */
import './_boot';
import { World } from '../src/core/world';

function run(label: string, opts: { lift?: number; midMass?: number; midI?: number; iters?: number; noMotor?: boolean } = {}): void {
  const w = new World({
    body: {
      ...(opts.midMass !== undefined ? { gimbalMidMass: opts.midMass } : {}),
      ...(opts.midI !== undefined ? { gimbalMidInertia: opts.midI } : {}),
      ...(opts.iters !== undefined ? { solverIterations: opts.iters } : {}),
    },
  });
  w.reset();
  if (opts.lift) {
    for (const b of w.body.allBodies) {
      const t = b.translation();
      b.setTranslation({ x: t.x, y: t.y + opts.lift, z: t.z }, true);
    }
  }
  if (opts.noMotor) {
    for (const d of w.body.dofs) if (d.engineMotor && d.engineJoint) d.engineJoint.configureMotorVelocity(0, 0);
  }
  let peak = 0, peakAt = 0;
  for (let s = 0; s < 480; s++) {
    w.advance(1);
    const sw = w.totalRelVel();
    if (sw > peak) { peak = sw; peakAt = s; }
    if (sw > 50) break;
  }
  const t = w.body.torso().translation();
  console.log(`${label.padEnd(30)} Σ|ω|峰值=${peak.toFixed(1).padStart(8)} (t=${(peakAt * w.dt).toFixed(2)}s)  胸y=${t.y.toFixed(3)}  x=${t.x.toFixed(2)}`);
}

console.log('════ 重力场景（480拍=2s，被动）════');
run('① 重力+地面（基线）');
run('② 重力+抬离2m（无接触）', { lift: 2 });
run('③ 重力+抬离0.2m（软着陆）', { lift: 0.2 });
run('④ 重力+地面 关电机', { noMotor: true });
run('⑤ 重力+地面 mid=0.02/I=2e-5', { midMass: 0.02, midI: 2e-5 });
run('⑥ 重力+地面 mid=0.1/I=1e-3', { midMass: 0.1, midI: 1e-3 });
run('⑦ 重力+地面 mid=0.5/I=5e-3', { midMass: 0.5, midI: 5e-3 });
run('⑧ 重力+地面 iters=32', { iters: 32 });
run('⑨ 重力+抬离2m iters=32 mid=0.1', { lift: 2, iters: 32, midMass: 0.1, midI: 1e-3 });
