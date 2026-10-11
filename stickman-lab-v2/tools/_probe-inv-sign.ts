/** _probe-inv-sign —— 踝内外翻符号标定（隔离实验）：
 *  静站，给右脚 foot_r/0 固定力矩 → 读 CoP_z 响应方向。定出"τ→CoP_z"的符号。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function trial(tau: number): { copZ0: number; copZ1: number } {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  const dInv = w.body.dofByName('foot_r', 0);
  let copZ0 = 0, copZ1 = 0;
  for (let s = 0; s < Math.round(2 / w.dt); s++) {
    const t = s * w.dt;
    w.advance(1, () => { if (t > 0.5) w.executor.addTorque(dInv, tau); });   // ★ onStep 钩子（beginStep 之后）
    if (t > 0.6 && t < 1.0) copZ0 += ctl.sensors.feet[1]!.copZ;
    if (t > 1.5 && t < 1.9) copZ1 += ctl.sensors.feet[1]!.copZ;
  }
  return { copZ0: copZ0 / (0.4 / w.dt), copZ1: copZ1 / (0.4 / w.dt) };
}
for (const tau of [0, 10, -10]) {
  const r = trial(tau);
  console.log(`τ=${tau.toString().padStart(4)} N·m: CoPz 前=${r.copZ0.toFixed(4)} → 后=${r.copZ1.toFixed(4)}  Δ=${(r.copZ1 - r.copZ0).toFixed(4)}`);
}
