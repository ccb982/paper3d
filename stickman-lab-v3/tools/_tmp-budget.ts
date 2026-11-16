/** _tmp-budget.ts —— 盆骨申请制预算回读：逐级 cap（pairCap 实写值）vs 硬件 τmax vs 物理需求
 *  用法：node tools/run.mjs _tmp-budget
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
const dr = (ctl.warner as unknown as { drive: { pairCap: Float64Array; opt: { musclePairK: number } } }).drive;
const iA0 = body.dofByName('foot_r', 0), iK0 = body.dofByName('knee_r', 0);
const iH0 = body.dofByName('hip_r', 0), iS0 = body.dofByName('spine1', 0);
const tauMax = (i: number): number => (i >= 0 ? body.dofs[i]!.tauMax : 0);
const cap = (i: number): number => (i >= 0 ? dr.pairCap[i]! : NaN);
const tau = (i: number): number => (i >= 0 ? w.executor.ledger[i]!.applied : 0);
const M = body.sk.massTotal, W = M * 9.81;
const D = (r: number): number => (r * 180) / Math.PI;

let tLift = -1;
console.log('t      | fz  接触帽(fz×.072) | 踝0cap 膝0cap 髋0cap 脊1cap | 硬件: 踝τmax 髋τmax | 髋0 τap | 需求W×|CoM−髋| | 盆roll°');
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0) { if (isLiftDone()) tLift = t; else continue; }
  if (t < 2.3 || t > 3.3) continue;
  if (s % Math.round(0.05 / w.dt) !== 0) continue;
  const f = ctl.sensors.feet[1]!;
  const hipZ = iH0 >= 0 ? body.dofs[iH0]!.anchorWorld[2]! : f.z;
  const demand = W * Math.abs(ctl.sensors.com[2]! - hipZ);
  const q = body.bodies[body.indexByKey.get('torso')!]!.rotation();
  const roll = Math.atan2(2 * (q.y * q.z + q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y)) * D(1);
  console.log(
    `${t.toFixed(2)} | ${f.fz.toFixed(0).padStart(4)} ${(f.fz * 0.072).toFixed(0).padStart(8)} |` +
    ` ${cap(iA0).toFixed(0).padStart(6)} ${cap(iK0).toFixed(0).padStart(6)} ${cap(iH0).toFixed(0).padStart(6)} ${cap(iS0).toFixed(0).padStart(6)} |` +
    ` ${tauMax(iA0).toFixed(0).padStart(6)} ${tauMax(iH0).toFixed(0).padStart(6)} | ${tau(iH0).toFixed(0).padStart(7)} | ${demand.toFixed(0).padStart(12)} | ${roll.toFixed(1).padStart(6)}`,
  );
}
