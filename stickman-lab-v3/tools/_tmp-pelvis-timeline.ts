/** _tmp-pelvis-timeline.ts —— 盆骨侧向力的时间轴（每0.2s窗）：它是抬腿期间发的吗？
 *  输出：窗内 盆骨 v_z/v_y RMS、F_z(绝对均值/RMS)、支撑脚 fz、摆脚 fz、liftDone 旗
 *  用法：node tools/run.mjs _tmp-pelvis-timeline
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone } from '../src/core/servo/supportReg';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const tIdx = body.indexByKey.get('torso')!;
const mPel = body.bodies[tIdx]!.mass();

const BIN = 0.2;
console.log('窗     | liftDone 摆脚fz 撑脚fz | 盆v_z RMS v_y RMS (cm/s) | F_z |均| RMS 峰 (N) | 大腿倾° 脚世界pitch° CoPx(m)');
let prevVz = 0, prevValid = false;
let binT = -1;
let n = 0, sqVz = 0, sqVy = 0, sAbs = 0, sqF = 0, peak = 0, sumSpFz = 0, sumSwFz = 0, sumTilt = 0, sumFoot = 0, sumCop = 0;
const hipI = body.dofByName('hip_r', 2), kneeI = body.dofByName('knee_r', 2);
const footI = body.indexByKey.get('foot_r')!;
const footPitch = (): number => {
  const q = body.bodies[footI]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z), uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  return Math.atan2(-ux, uy) * 180 / Math.PI;
};
const flush = (t: number): void => {
  if (n === 0) return;
  const r = (x: number): number => Math.sqrt(x / n);
  console.log(
    `${t.toFixed(2)}  | ${(isLiftDone() ? '是' : '否')}  ${(sumSwFz / n).toFixed(0).padStart(5)} ${(sumSpFz / n).toFixed(0).padStart(5)} |` +
    ` ${(r(sqVz) * 100).toFixed(1).padStart(6)} ${(r(sqVy) * 100).toFixed(1).padStart(6)} |` +
    ` ${(sAbs / n).toFixed(0).padStart(4)} ${r(sqF).toFixed(0).padStart(4)} ${peak.toFixed(0).padStart(4)} |` +
    ` ${(sumTilt / n).toFixed(1).padStart(5)} ${(sumFoot / n).toFixed(1).padStart(6)} ${(sumCop / n).toFixed(3).padStart(7)}`,
  );
  n = 0; sqVz = 0; sqVy = 0; sAbs = 0; sqF = 0; peak = 0; sumSpFz = 0; sumSwFz = 0; sumTilt = 0; sumFoot = 0; sumCop = 0;
};
for (let s = 0; s < Math.round(5.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 1.2) continue;
  const v = body.bodies[tIdx]!.linvel();
  if (!prevValid) { prevVz = v.z; prevValid = true; binT = t; continue; }
  const az = (v.z - prevVz) / w.dt;
  prevVz = v.z;
  if (t - binT >= BIN) { flush(binT); binT = t; }
  const F = mPel * az;
  n++; sqVz += v.z * v.z; sqVy += v.y * v.y; sAbs += Math.abs(F); sqF += F * F; peak = Math.max(peak, Math.abs(F));
  sumSpFz += ctl.sensors.feet[1]!.fz; sumSwFz += ctl.sensors.feet[0]!.fz;
  const a = body.dofs[hipI]!.anchorWorld, b = body.dofs[kneeI]!.anchorWorld;
  sumTilt += Math.atan2(b[2]! - a[2]!, -(b[1]! - a[1]!)) * 180 / Math.PI;
  sumFoot += footPitch();
  sumCop += ctl.sensors.feet[1]!.copX;
}
flush(binT);
