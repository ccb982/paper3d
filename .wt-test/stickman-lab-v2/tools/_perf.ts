/** _perf.ts —— 角色模拟性能基准（ms/步、µs/角色/帧、单核容量） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function bench(label: string, hz: number, mode: 'phys' | 'ctl' | 'action', nSec = 4): void {
  const w = new World({ physicsHz: hz });
  let ctl: ControlModule | null = null;
  if (mode !== 'phys') {
    ctl = new ControlModule(w, { postureTone: 8 });
    w.controller = ctl;
    w.reset();
    if (mode === 'action') ctl.actions.play('pushRise');
  }
  for (let i = 0; i < 2 * hz; i++) w.advance(1);   // 预热
  const steps = nSec * hz;
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) {
    w.advance(1);
    if (mode === 'action' && i === steps / 2) ctl!.actions.play('pushRise');  // 期间重播
  }
  const ms = performance.now() - t0;
  const perStep = ms / steps;
  const perSimSec = ms / nSec;
  const rt = 1000 / perSimSec;                       // 实时倍率
  const perFrame60 = perStep * (hz / 60);            // 60fps 每帧步数（480Hz→8 步）
  console.log(
    `${label.padEnd(16)} ${perStep.toFixed(3)} ms/步 | ${perSimSec.toFixed(1)} ms/仿真秒 | 实时 ${rt.toFixed(1)}× | 60fps 每帧 ${perFrame60.toFixed(2)} ms | 单核 ≈${Math.floor(rt)} 个`
  );
}
bench('240Hz 纯物理', 240, 'phys');
bench('240Hz 控制  ', 240, 'ctl');
bench('480Hz 纯物理', 480, 'phys');
bench('480Hz 控制  ', 480, 'ctl');
bench('480Hz 动作  ', 480, 'action');
