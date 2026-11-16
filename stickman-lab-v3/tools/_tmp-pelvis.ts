/** _tmp-pelvis.ts —— 盆骨处侧向力回读（单腿 R 支撑，零扰动）
 *  盆骨（torso 刚体）：世界线速度/角速度、(有限差分)侧向加速度→净侧向力 F_z=m·a_z；
 *  同帧读各写手在**盆骨上的力矩**：hip_r/0、hip_l/0、hip_r/1、hip_l/1、spine1/0（applied）。
 *  用法：node tools/run.mjs _tmp-pelvis
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
const idx = body.indexByKey;
const tIdx = idx.get('torso')!;
const mPel = body.bodies[tIdx]!.mass();

const tau = (n: string, ax: number): number => { const i = body.dofByName(n, ax); return i >= 0 ? w.executor.ledger[i]!.applied : 0; };

let tLift = -1, n = 0;
let prevVz = 0, fzSum = 0, fzAbs = 0, azPeak = 0;
const DEG = 180 / Math.PI;
console.log('t      | 盆 vz(cm/s) az(m/s²) F_z(N) | 盆 ωx ωy ωz(°/s) | hipR0 hipL0 hipR1 hipL1 sp1/0 | 摆腿质量z偏移(cm) | CoM vz');
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0) { if (isLiftDone()) tLift = t; else { prevVz = body.bodies[tIdx]!.linvel().z; continue; } }
  const dtL = t - tLift;
  const rb = body.bodies[tIdx]!;
  const v = rb.linvel();
  const av = rb.angvel();
  const az = (v.z - prevVz) / w.dt;   // 世界 z 加速度（正=+z）
  prevVz = v.z;
  if (dtL > 0.1 && dtL < 2.5) { fzSum += mPel * az; fzAbs += Math.abs(mPel * az); n++; azPeak = Math.max(azPeak, Math.abs(az)); }
  if (s % Math.round(0.05 / w.dt) !== 0) continue;
  // 摆动腿（左）质量相对盆骨的 z 偏移
  let swingZ = 0, swingM = 0;
  for (const k of ['thigh_l', 'shin_l', 'foot_l', 'arch_l', 'mfoot_l']) {
    const i = idx.get(k); if (i === undefined) continue;
    swingZ += body.bodies[i]!.translation().z * body.bodies[i]!.mass();
    swingM += body.bodies[i]!.mass();
  }
  swingZ = swingZ / Math.max(1e-9, swingM) - rb.translation().z;
  console.log(
    `${t.toFixed(2)} | ${(v.z * 100).toFixed(1).padStart(7)} ${az.toFixed(2).padStart(7)} ${(mPel * az).toFixed(0).padStart(6)} |` +
    ` ${(av.x * DEG).toFixed(0).padStart(4)} ${(av.y * DEG).toFixed(0).padStart(4)} ${(av.z * DEG).toFixed(0).padStart(4)} |` +
    ` ${tau('hip_r', 0).toFixed(0).padStart(5)} ${tau('hip_l', 0).toFixed(0).padStart(5)} ${tau('hip_r', 1).toFixed(0).padStart(5)} ${tau('hip_l', 1).toFixed(0).padStart(5)} ${tau('spine1', 0).toFixed(0).padStart(5)} |` +
    ` ${(swingZ * 100).toFixed(1).padStart(6)} | ${(ctl.sensors.comVel[2]! * 100).toFixed(1)}`,
  );
}
console.log(`\n窗口(+0.1..+2.5s)：净侧向力均值=${(fzSum / Math.max(1, n)).toFixed(1)}N  绝对均值=${(fzAbs / Math.max(1, n)).toFixed(1)}N  峰值=${(azPeak * mPel).toFixed(0)}N  盆骨质量=${mPel.toFixed(2)}kg`);
