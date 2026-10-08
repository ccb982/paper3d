/**
 * _probe-servo.ts —— 分离伺服环：弹簧 vs 阻尼
 */
import './_boot';
import { World } from '../src/core/world';

function run(label: string, mode: 'spring' | 'damp' | 'both'): void {
  const w = new World();
  w.reset();
  for (const d of w.body.dofs) {
    if (d.engineMotor) continue;
    const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
    const kp = 0.5 * d.tauMax / lim;
    if (mode === 'spring') w.drive.setAngle(d.dofIndex, 0, kp, 0);
    else if (mode === 'damp') w.drive.setAngle(d.dofIndex, 0, 0, 2 * Math.sqrt(kp * Math.max(1e-6, d.inertia)));
    else w.drive.setAngle(d.dofIndex, 0);
  }
  const trace: string[] = [];
  for (let s = 0; s < 480; s++) {
    w.advance(1);
    if (s % 60 === 0 || s === 479) {
      let top = 0, topN = '';
      for (const d of w.body.dofs) { const v = Math.abs(d.vel); if (v > top) { top = v; topN = `${d.name}/${d.axis}`; } }
      trace.push(`${(s * w.dt).toFixed(2)}s:ω=${w.totalRelVel().toFixed(0)}(max ${topN} ${top.toFixed(0)})`);
    }
  }
  const t = w.body.torso().translation();
  console.log(`${label.padEnd(16)} ${trace.join('  ')}  y=${t.y.toFixed(2)}`);
}

console.log('════ 伺服环分离（重力+地面）════');
run('弹簧 only', 'spring');
run('阻尼 only', 'damp');
run('全环', 'both');
