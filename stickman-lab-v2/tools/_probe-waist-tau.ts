/** _probe-waist-tau.ts —— 蹬地挺腰：腰部力矩实测（脊柱 1–3 /2 轴 + 髋/2 对照）
 *  数据源：executor.ledger[].applied = 该自由度**实际下发的净力矩**（含伺服+驱动）。
 *  每 0.1s 打印一次；结尾报各轴峰值与积分（腰椎冲量）。 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('pushRise');
const wl = (n: string): number => w.body.dofByName(n, 2);
const idSp1 = wl('spine1'), idSp2 = wl('spine2'), idSp3 = wl('spine3');
const idHpL = wl('hip_l'), idHpR = wl('hip_r');
const tau = (i: number): number => (i >= 0 ? w.executor.ledger[i]!.applied : 0);
const peak = { sp1: 0, sp2: 0, sp3: 0, hpL: 0, hpR: 0 };
const integ = { sp: 0, hp: 0 };
console.log('t     胸     spine1 spine2 spine3   hipL  hipR   [spine 折叠指令]');
for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
  w.advance(1);
  const a1 = tau(idSp1), a2 = tau(idSp2), a3 = tau(idSp3);
  const hL = tau(idHpL), hR = tau(idHpR);
  peak.sp1 = Math.max(peak.sp1, Math.abs(a1));
  peak.sp2 = Math.max(peak.sp2, Math.abs(a2));
  peak.sp3 = Math.max(peak.sp3, Math.abs(a3));
  peak.hpL = Math.max(peak.hpL, Math.abs(hL));
  peak.hpR = Math.max(peak.hpR, Math.abs(hR));
  integ.sp += (Math.abs(a1) + Math.abs(a2) + Math.abs(a3)) * w.dt;
  integ.hp += (Math.abs(hL) + Math.abs(hR)) * w.dt;
  if (s % 48 === 0) {
    const bend = ctl.lastProposal?.reflexDirectives.find((d) => d.id === 'trunk');
    console.log(
      `${(s * w.dt).toFixed(2)}  ${w.body.bodies[w.body.indexByKey.get('spine4')!]!.translation().y.toFixed(3)}` +
      `  ${a1.toFixed(0).padStart(6)} ${a2.toFixed(0).padStart(6)} ${a3.toFixed(0).padStart(6)}` +
      `  ${hL.toFixed(0).padStart(5)} ${hR.toFixed(0).padStart(5)}   [fold=${bend ? (bend.params?.fold ?? 0).toFixed(3) : '-'} τ=${bend ? (bend.params?.tau ?? 0).toFixed(0) : '-'}]`);
  }
}
console.log('── 峰值：spine1/2/3 = ' +
  `${peak.sp1.toFixed(0)}/${peak.sp2.toFixed(0)}/${peak.sp3.toFixed(0)} N·m  髋L/R = ${peak.hpL.toFixed(0)}/${peak.hpR.toFixed(0)} N·m`);
console.log(`── 积分（2s 冲量）：脊柱 Σ|τ|dt = ${integ.sp.toFixed(0)} N·m·s   髋 = ${integ.hp.toFixed(0)} N·m·s`);
