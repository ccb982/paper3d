import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const TQ = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.ARR ?? -100);
const T0 = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.T0 ?? 3.95);
const manual = (ctl as unknown as { warner: { manual: { setTorque(j: string, ax: number, t: number): void } } }).warner.manual;
console.log(`\u52a8\u6001\u5236\u52a8\u5b9e\u9a8c: \u81c2\u5f20 t>${T0} \u4e14 vZ>0.008 \u65f6 \u9acb\u989d\u72b6\u6052\u529b = ${TQ} N\u00b7m`);
console.log('t | comZ vZ(cm/s) | 事件');
let armed = false, tArm = -1;
for (let s = 0; s < Math.round(4.8 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const vZ = ctl.sensors.comVel[2]!;
  if (!armed && t > T0 && Math.abs(vZ) > 0.03) { armed = true; tArm = t; console.log(`${t.toFixed(3)} | ${(ctl.sensors.com[2]! * 100).toFixed(1)} ${(vZ * 100).toFixed(1)} | \u2605\u6b66\u88c5\uff01\u6052\u529b\u63a5\u7ba1`); }
  if (armed && t < 4.6) manual.setTorque('hip_r', 0, TQ);
  // ★ 回读：手动矩阵与 drive ff 通道是否落位
  const m2 = (ctl as unknown as { warner: { manual: { torqueOf(d: number): number } } }).warner.manual;
  const drv = (ctl as unknown as { warner: { drive: { ffOf(d: number): number } } }).warner.drive;
  const diH = (w.body as unknown as { dofByName(n: string, ax: number): number }).dofByName('hip_r', 0);
  if (armed && Math.abs(t * 120 - Math.round(t * 120)) < 1e-6 && t < 4.3) {
    console.log(`   [读] t=${t.toFixed(3)} dof=${diH} manual矩阵=${m2.torqueOf(diH).toFixed(1)} drive_ff=${drv.ffOf(diH).toFixed(1)}`);
  }
  if (t < 3.9 || t > 4.65) continue;
  if (Math.abs(t * 120 - Math.round(t * 120)) > 1e-6) continue;
  console.log(`${t.toFixed(3)} | ${(ctl.sensors.com[2]! * 100).toFixed(1).padStart(6)} ${(vZ * 100).toFixed(1).padStart(6)} | ${armed ? '\u00b7\u00b7\u00b7' : ''}`);
}
