/**
 * _probe-gravity2.ts —— 重力下"裸结构"稳定性：关掉 Drive 的一切，只剩约束+接触+引擎电机
 */
import './_boot';
import { World } from '../src/core/world';

function run(label: string, opts: { lift?: number; midMass?: number; midI?: number; iters?: number; fric?: number; noMotor?: boolean } = {}): void {
  const w = new World({
    body: {
      ...(opts.midMass !== undefined ? { gimbalMidMass: opts.midMass } : {}),
      ...(opts.midI !== undefined ? { gimbalMidInertia: opts.midI } : {}),
      ...(opts.iters !== undefined ? { solverIterations: opts.iters } : {}),
      ...(opts.fric !== undefined ? { frictionIterations: opts.fric } : {}),
    },
  });
  w.driveEnabled = false;
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
  const trace: string[] = [];
  for (let s = 0; s < 480; s++) {
    w.advance(1);
    if (s % 60 === 0 || s === 479) {
      const t = w.body.torso().translation();
      trace.push(`${(s * w.dt).toFixed(2)}s:ω=${w.totalRelVel().toFixed(0)},y=${t.y.toFixed(2)}`);
    }
  }
  console.log(`${label.padEnd(30)} ${trace.join('  ')}`);
}

console.log('════ 裸结构重力（关 Drive；480拍=2s）════');
run('① 基线（电机开，接触）');
run('② 电机开，抬离0.2m');
run('③ 电机关，接触');
run('④ 电机开，接触 mid=0.05/I=1e-4', { midMass: 0.05, midI: 1e-4 });
run('⑤ 电机开，接触 iters=64/fric=16', { iters: 64, fric: 16 });
run('⑥ 电机开，接触 mid=0.5/I=5e-3', { midMass: 0.5, midI: 5e-3 });
