/** _tmp-danger-chain.ts —— 危险时刻全链回读（用户："为啥危险位置没足够力矩拉起来"）
 *  用法：node tools/run.mjs _tmp-danger-chain
 *  每 0.1s：前后/左右倾角、CoM侧偏 | 支撑侧各轴 实际出力(act)/预算(pairCap)：足0 膝0 髋0|2 脊1|2|3(0轴)
 *  读法：出力≈预算 = 力气用尽（额度/接触限制）；出力≪预算 = 没申请（控制不敢要/没要）。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone, resetFootLateral } from '../src/core/servo/supportReg';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
resetFootLateral();
ctl.actions.play('singleLegR');
const DEG = 180 / Math.PI;
const dr = (ctl.warner as unknown as {
  drive: {
    pairCap: number[];
    target: Float64Array;
    lastBreakdown: Array<{ act: number; servo: number; stiff: number; damp: number }>;
  };
}).drive;
const drt = dr as { target: Float64Array };
const drA = (dr as unknown as { actuator: { activationOf(i: number): number } }).actuator;
const drP = dr as unknown as { pairRef: Float64Array; pairC: Float64Array };
const axes: Array<[string, number]> = [
  ['foot_r', 0], ['knee_r', 0], ['hip_r', 0], ['hip_r', 2],
  ['spine1', 0], ['spine2', 0], ['spine3', 0], ['spine1', 2],
];
const dIdx = axes.map(([n, a]) => w.body.dofByName(n, a));
let tLift = -1, nextMark = 0;
for (let s = 0; s < Math.round(14.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const liftNow = tLift < 0 && isLiftDone();
  if (liftNow) { tLift = t; nextMark = t; console.log(`★抬腿 t=${t.toFixed(2)}s`); }
  if (tLift >= 0 && t >= nextMark) {
    const pitch = ctl.sensors.torsoTilt[0]! * DEG;
    const roll = ctl.sensors.torsoTilt[1]! * DEG;
    const lat = ctl.sensors.com[2]! * 100;
    const cells = axes.map(([n, a], k) => {
      const i = dIdx[k]!;
      if (i < 0) return `${n}/${a}:-`;
      const b = dr.lastBreakdown[i] ?? { act: 0, servo: 0, stiff: 0, damp: 0 };
      const bfull = b as unknown as { stiff: number; itb: number; lum: number; act: number; servo: number; ff: number; damp: number };
      const net = (bfull.stiff ?? 0) + (bfull.itb ?? 0) + (bfull.lum ?? 0) + (bfull.act ?? 0) + (bfull.servo ?? 0) + (bfull.ff ?? 0) + (bfull.damp ?? 0);
      const cap = Number.isFinite(dr.pairCap[i]!) ? dr.pairCap[i]! : -1;
      // λ−θ：伺服目标与当前角之差（度）；dpe=pairRef−θ（度，真 dev）；c=pairC；a：激活；v：角速度
      const tg = drt.target[i]!;
      const lamMinus = Number.isFinite(tg) ? ((tg - w.body.dofs[i]!.angle) * DEG).toFixed(0) : '-';
      const devPair = ((drP.pairRef[i]! - w.body.dofs[i]!.angle) * DEG);
      const cPair = drP.pairC[i]!;
      const aAct = drA.activationOf(i);
      const vDeg = (w.body.dofs[i]!.vel * DEG).toFixed(0);
      return `${n}/${a}:净${net.toFixed(0)} dpe=${devPair.toFixed(0).padStart(4)} c=${cPair.toFixed(2)} a=${aAct.toFixed(2).padStart(5)} v=${vDeg.padStart(4)}`;
    });
    console.log(`+${(t - tLift).toFixed(1)}s 前=${pitch.toFixed(1).padStart(5)}° 左=${roll.toFixed(1).padStart(5)}° 侧=${lat.toFixed(1).padStart(6)}cm | ${cells.join(' ')}`);
    nextMark = Math.round((t + 0.1) * 100) / 100;
  }
  if (tLift >= 0 && t - tLift > 3.8) break;
}
