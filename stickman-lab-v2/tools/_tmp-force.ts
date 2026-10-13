import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
// ★ 纯手动实验（用户：关伺服和动作层）：平衡伺服全零 + 不播动作 + 手动直控力
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8, comKp: 0, comKd: 0 } as any);
w.controller = ctl;
w.reset();
// 不播动作（静立）
const manual = (ctl as any).warner.manual;
const body = w.body as any;
const diH = body.dofByName('hip_r', 0);
const upZ = (): number => {
  const q = body.bodies[body.indexByKey.get('spine4')]!.rotation();
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.y * q.z + q.w * q.x);
  return Math.atan2(uz, uy) * 57.3;
};
// 站稳 1.2s
for (let s = 0; s < Math.round(1.2 / w.dt); s++) w.advance(1);
console.log('静立：tilt=' + upZ().toFixed(1) + '°');
// ① 推倒：髇 -260 持续 0.5s（强制侧倒）
for (let s = 0; s < Math.round(0.18 / w.dt); s++) { manual.setTorque('hip_r', 0, -260); w.advance(1); }
manual.setTorque('hip_r', 0, 0);
const tiltFall = upZ();
let vmax = 0;
for (let s = 0; s < Math.round(0.08 / w.dt); s++) { w.advance(1); const v = Math.abs((ctl.sensors.torsoAngVel?.[1] ?? 0)); if (v > vmax) vmax = v; }
console.log('推倒后：tilt=' + tiltFall.toFixed(1) + '°，倾速峰=' + (vmax * 57.3).toFixed(0) + '°/s');
// ② 全力反打：髇 +228（τmax档）持续到倾速反转或 1.5s
console.log('t | tilt° | 倾速°/s | 髇力');
for (let s = 0; s < Math.round(1.5 / w.dt); s++) {
  manual.setTorque('hip_r', 0, 228);
  w.advance(1);
  if (s % 12 === 0) {
    const t = (s * w.dt).toFixed(2);
    console.log(t + ' | ' + upZ().toFixed(1) + ' | ' + ((ctl.sensors.torsoAngVel?.[1] ?? 0) * 57.3).toFixed(0) + ' | ' + (body.dofs[diH].tauMax?.toFixed(0) ?? '?'));
  }
}
