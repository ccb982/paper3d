/**
 * _probe-gravity3.ts —— 中间体额外迭代 / 物理频率 扫描（重力+接触，关 Drive）
 */
import './_boot';
import { World } from '../src/core/world';

function run(label: string, p: { hz?: number; extra?: number; iters?: number; midMass?: number; midI?: number } = {}): void {
  const w = new World({
    physicsHz: p.hz ?? 240,
    body: {
      ...(p.extra !== undefined ? { gimbalMidExtraIters: p.extra } : {}),
      ...(p.iters !== undefined ? { solverIterations: p.iters } : {}),
      ...(p.midMass !== undefined ? { gimbalMidMass: p.midMass } : {}),
      ...(p.midI !== undefined ? { gimbalMidInertia: p.midI } : {}),
    },
  });
  w.driveEnabled = false;
  w.reset();
  const trace: string[] = [];
  const N = Math.round(2 / w.dt);
  for (let s = 0; s < N; s++) {
    w.advance(1);
    if (s % Math.round(0.5 / w.dt) === 0 || s === N - 1) {
      trace.push(`${(s * w.dt).toFixed(1)}s:ω=${w.totalRelVel().toFixed(0)}`);
    }
  }
  const t = w.body.torso().translation();
  console.log(`${label.padEnd(30)} ${trace.join(' ')}  y=${t.y.toFixed(2)}`);
}

console.log('════ 中间体额外迭代 / 频率（重力+接触，关 Drive）════');
run('① 基线（extra 默认32）');
run('② extra=0', { extra: 0 });
run('③ extra=8', { extra: 8 });
run('④ extra=64', { extra: 64 });
run('⑤ extra=32 + iters32', { iters: 32 });
run('⑥ hz=480 extra=32', { hz: 480 });
run('⑦ hz=960 extra=32', { hz: 960 });
run('⑧ hz=480 extra=32 mid=0.01', { hz: 480, midMass: 0.01, midI: 1e-5 });
run('⑨ hz=480 extra=64 mid=0.05', { hz: 480, extra: 64, midMass: 0.05, midI: 1e-4 });
