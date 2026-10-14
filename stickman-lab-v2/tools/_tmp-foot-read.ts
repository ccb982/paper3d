/** _tmp-foot-read.ts —— 脚部力矩与侧向力回读（单腿 R 支撑，零扰动）
 *  物理：单腿期唯一外力=支撑脚接触力。水平分量 = M·a_com（动量定理，精确）；
 *        法向分量 = fz（天平）。→ 摩擦利用率 μ_req=|F_lat|/fz（对比可用 μ=3-6.5）。
 *  另读：踝三轴角/力矩（foot_r 0/1/2）、CoP、竖直加速度（fz/M−g）。
 *  用法：node tools/run.mjs _tmp-foot-read
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
const dr = (ctl.warner as unknown as { drive: any }).drive;
const M = body.sk.massTotal;

const D = (r: number): number => (r * 180) / Math.PI;
const tau = (n: string, ax: number): number => { const i = body.dofByName(n, ax); return i >= 0 ? w.executor.ledger[i]!.applied : 0; };
const ang = (n: string, ax: number): number => { const i = body.dofByName(n, ax); return i >= 0 ? D(body.dofs[i]!.angle) : 0; };

let tLift = -1;
let prevVx = 0, prevVz = 0, n = 0;
let sumFz = 0, sumShear = 0, sumMu = 0, maxMu = 0, maxShear = 0, maxFz = 0, minFz = 1e9;
console.log('t      | fz   CoPx  CoPz | 踝0角 τ0 | 踝1角 τ1 | 踝2角 τ2 | 剪力Fx Fz (N) | μ_req | ay(m/s²)');
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0) { if (isLiftDone()) { tLift = t; prevVx = ctl.sensors.comVel[0]!; prevVz = ctl.sensors.comVel[2]!; } continue; }
  const dtL = t - tLift;
  const f = ctl.sensors.feet[1]!;
  const vx = ctl.sensors.comVel[0]!, vz = ctl.sensors.comVel[2]!;
  const ax = (vx - prevVx) / w.dt, az = (vz - prevVz) / w.dt;
  prevVx = vx; prevVz = vz;
  const Fx = M * ax, Fz = M * az;
  const shear = Math.hypot(Fx, Fz);
  const mu = f.fz > 30 ? shear / f.fz : 0;
  if (dtL > 0.1 && dtL < 2.6) {
    n++;
    sumFz += f.fz; sumShear += shear; sumMu += mu;
    maxMu = Math.max(maxMu, mu); maxShear = Math.max(maxShear, shear);
    maxFz = Math.max(maxFz, f.fz); minFz = Math.min(minFz, f.fz);
  }
  if (dtL < 0.05 || dtL > 2.6) continue;
  if (s % Math.round(0.05 / w.dt) !== 0) continue;
  console.log(
    `${t.toFixed(2)} | ${f.fz.toFixed(0).padStart(4)} ${(f.copValid ? f.copX : NaN).toFixed(2)} ${(f.copValid ? f.copZ : NaN).toFixed(2)} |` +
    ` ${ang('foot_r', 0).toFixed(1).padStart(5)} ${tau('foot_r', 0).toFixed(0).padStart(5)} |` +
    ` ${ang('foot_r', 1).toFixed(1).padStart(5)} ${tau('foot_r', 1).toFixed(0).padStart(5)} |` +
    ` ${ang('foot_r', 2).toFixed(1).padStart(5)} ${tau('foot_r', 2).toFixed(0).padStart(5)} |` +
    ` ${Fx.toFixed(0).padStart(5)} ${Fz.toFixed(0).padStart(5)} | ${mu.toFixed(2).padStart(5)} | ${(f.fz / M - 9.81).toFixed(2).padStart(6)}`,
  );
}
console.log(`\n窗口(${n}帧)：fz 均=${(sumFz / n).toFixed(0)}N[${minFz.toFixed(0)},${maxFz.toFixed(0)}] | 剪力均=${(sumShear / n).toFixed(0)}N 峰=${maxShear.toFixed(0)}N | μ_req 均=${(sumMu / n).toFixed(2)} 峰=${maxMu.toFixed(2)} | 可用 μ≈3-6.5`);
