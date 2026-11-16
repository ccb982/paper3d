/** _tmp-vchain.ts —— 完整竖向力链 + 动量平衡残差（零扰动）
 *  审计：单腿期只有地面竖直力 → fz − M·g − M·a_y ≈ 0；残差≠0 = 未审批竖直力。
 *  另读：踝/膝/髋/脊柱屈伸力矩、骨盆/胸/头竖直加速度、arch 电机目标与让位状态。
 *  用法：node tools/run.mjs _tmp-vchain
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
const M = body.sk.massTotal;
const Mg = M * 9.81;
const tau = (n: string, ax: number): number => { const i = body.dofByName(n, ax); return i >= 0 ? w.executor.ledger[i]!.applied : 0; };
const legReflex = (ctor: unknown): unknown => ctor;

let tLift = -1, prevVy = 0, n = 0, sumRes = 0, maxRes = 0, sqRes = 0, nAir = 0, nHard = 0;
console.log('t      | fz   fz/W  | M·a_y(N) | 残差(N) | 盆ay 胸ay 头ay | 踝2τ 膝2τ 髋2τ 脊2τ | arch目标 让位');
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0) { if (isLiftDone()) { tLift = t; prevVy = ctl.sensors.rawVel[1]!; } continue; }
  const dtL = t - tLift;
  const vyRaw = ctl.sensors.rawVel[1]!;
  const ay = (vyRaw - prevVy) / w.dt;
  prevVy = vyRaw;
  const fz = ctl.sensors.feet[1]!.fz;
  const May = M * ay;
  const res = fz - Mg - May;
  if (dtL > 0.1 && dtL < 2.6) { n++; sumRes += res; sqRes += res * res; maxRes = Math.max(maxRes, Math.abs(res)); if (fz < 50) nAir++; if (fz > 1.5 * Mg) nHard++; }
  if (dtL < 0.05 || dtL > 2.6) continue;
  if (s % Math.round(0.05 / w.dt) !== 0) continue;
  const aOf = (k: string): number => { const i = idx.get(k)!; const rb = body.bodies[i]! as unknown as { linvel(): { y: number } }; void rb; return 0; };
  void aOf;
  const pel = body.bodies[idx.get('torso')!]!.linvel().y;
  const ch = body.bodies[idx.get('spine4')!]!.linvel().y;
  const hd = body.bodies[idx.get('head')!]!.linvel().y;
  const pad = ctl.pad as unknown as { feet: Array<{ side: string; archNow: number; effDx: number; effDz: number }> };
  const fr = pad.feet.find((x) => x.side === 'r')!;
  const yielded = fr.effDx === 0 && fr.effDz === 0;
  void legReflex;
  console.log(
    `${t.toFixed(2)} | ${fz.toFixed(0).padStart(4)} ${(fz / Mg).toFixed(2).padStart(5)} | ${May.toFixed(0).padStart(8)} | ${res.toFixed(0).padStart(7)} |` +
    ` ${(pel * 100).toFixed(0).padStart(4)} ${(ch * 100).toFixed(0).padStart(4)} ${(hd * 100).toFixed(0).padStart(4)} |` +
    ` ${tau('foot_r', 2).toFixed(0).padStart(5)} ${tau('knee_r', 2).toFixed(0).padStart(4)} ${tau('hip_r', 2).toFixed(0).padStart(5)} ${tau('spine2', 2).toFixed(0).padStart(5)} |` +
    ` ${fr.archNow.toFixed(3).padStart(6)} ${yielded ? '让位' : '在写'}`,
  );
}
console.log(`\n窗口(${n}帧)：残差 均=${(sumRes / n).toFixed(0)}N RMS=${Math.sqrt(sqRes / n).toFixed(0)}N 峰=${maxRes.toFixed(0)}N | fz<50N 帧=${nAir}(${(nAir / n * 100).toFixed(0)}%) | fz>1.5W 帧=${nHard}(${(nHard / n * 100).toFixed(0)}%)`);
