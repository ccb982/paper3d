import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
// 削力效果 = 侧向冲量的"被削掉"的比例
// 方法：对比 (a) CoM 侧向速度的累积（危险动量）vs (b) 大腿+腹肌的实际出力积分（削力功）
let momZ = 0, workHip = 0, workSpine = 0, workTotal = 0;
const drive = (w as any).drive ?? (ctl as any).drive;
let prevVz = 0;
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.2 || t > 4.2) continue;
  const vz = ctl.sensors.comVel[2]!;
  const az = (vz - prevVz) / w.dt; prevVz = vz;
  momZ += Math.abs(vz) * w.dt;   // 危险动量累积
  const tau = (n: string, ax: number) => {
    const di = w.body.dofByName(n, ax);
    if (di < 0) return 0;
    const bd = drive?.lastBreakdown?.[di] ?? { servo: 0, ff: 0, damp: 0 };
    return Math.abs(bd.servo + bd.ff + bd.damp);
  };
  const wH = tau('hip_r', 0) + tau('hip_l', 0);
  const wS = tau('spine1', 0) + tau('spine2', 0) + tau('spine3', 0);
  workHip += wH * w.dt; workSpine += wS * w.dt; workTotal += (wH + wS) * w.dt;
  void az;
}
console.log(`3.2-4.2s 窗口：`);
console.log(`  危险侧向动量累积 ∫|vz|dt = ${momZ.toFixed(3)} m`);
console.log(`  大腿削力冲量 ∫|τ_hip|dt = ${workHip.toFixed(1)} N·m·s`);
console.log(`  腹部削力冲量 ∫|τ_spine|dt = ${workSpine.toFixed(1)} N·m·s`);
console.log(`  总削力 = ${workTotal.toFixed(1)} N·m·s  ⇒ 削力/危险动量比 = ${(workTotal / Math.max(0.001, momZ)).toFixed(0)} N·m·s per m`);
