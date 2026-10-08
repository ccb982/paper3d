/**
 * _probe-balance-sign.ts —— 平衡环方向验证：给 CoM 目标一个阶跃，看 CoM 是否朝目标移动
 */
import './_boot';
import { World } from '../src/core/world';
import { BalanceController } from '../src/core/balance';

function run(label: string, tx: number, tz: number): void {
  const w = new World();
  const bal = new BalanceController(w, { gravityComp: true, comKp: 12, comKd: 5, maxForceFrac: 0.35, postureTone: 0.6 });
  w.controller = bal;
  w.reset();
  bal.setComTarget(tx, tz);
  const trace: string[] = [];
  for (let s = 0; s < 360; s++) {
    w.advance(1);
    if (s % 60 === 0) {
      // 统计腿链力矩下发
      let hipTau = 0, ankleTau = 0, sat = 0;
      for (const d of w.body.dofs) {
        const a = w.executor.ledger[d.dofIndex]!.applied;
        if (/^hip/.test(d.name)) hipTau += Math.abs(a);
        if (/^foot/.test(d.name)) ankleTau += Math.abs(a);
        if (w.executor.ledger[d.dofIndex]!.saturated) sat++;
      }
      trace.push(`${(s * w.dt).toFixed(1)}s:(${bal.telemetry.comX.toFixed(3)},${bal.telemetry.comZ.toFixed(3)}) Fz=${bal.telemetry.Fz.toFixed(0)}N clamp=${bal.telemetry.clampFrac.toFixed(2)} hipτ=${hipTau.toFixed(0)} ankτ=${ankleTau.toFixed(0)} sat=${sat}`);
    }
  }
  console.log(`${label.padEnd(24)} ${trace.join(' ')}  → 目标(${tx},${tz})`);
}

console.log('════ 平衡环方向（CoM 阶跃）════');
run('目标 +x 0.08', 0.08, 0);
run('目标 −x 0.08', -0.08, 0);
run('目标 +z 0.08', 0, 0.08);
run('目标 −z 0.08', 0, -0.08);
