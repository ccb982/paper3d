/** _probe-hip-ab-demand.ts —— 单侧盆骨（支撑髋外展）力矩实测量：
 *  静态需求（重力矩 W·d，d=CoM 相对支撑髋的横向偏距）| 下发值(ledger) | τmax | Inman 理论下界。 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const W = w.sk.massTotal * 9.81;
// 静息：髋间距（Inman 半距）
const hR = w.body.dofs[w.body.dofByName('hip_r', 2)]!.anchorWorld[2]!;
const hL = w.body.dofs[w.body.dofByName('hip_l', 2)]!.anchorWorld[2]!;
const half = Math.abs(hL - hR) / 2;
console.log(`体重 W=${W.toFixed(0)}N  髋间距=${(half * 2).toFixed(3)}m  Inman 理论下界 = W·(间距/2) = ${(W * half).toFixed(0)} N·m`);
ctl.actions.play('singleLegR');
const iR0 = w.body.dofByName('hip_r', 0);
const tauMaxR = w.body.dofs[iR0]!.tauMax;
let demandPeak = 0, appliedPeak = 0, ratioPeak = 0;
console.log('t     comZ-髋锚 | 重力矩需求 | 下发(ledger) | 饱和度% | 负载R%');
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const hz = w.body.dofs[w.body.dofByName('hip_r', 2)]!.anchorWorld[2]!;
  const off = ctl.sensors.com[2]! - hz;          // CoM 相对髋的横向偏距
  const demand = W * off;                         // 单点近似：全身重量的重力矩
  const applied = w.executor.ledger[iR0]!.applied;
  const sat = Math.abs(applied) / tauMaxR * 100;
  demandPeak = Math.max(demandPeak, Math.abs(demand));
  appliedPeak = Math.max(appliedPeak, Math.abs(applied));
  ratioPeak = Math.max(ratioPeak, sat);
  if (s % 96 === 0) {
    console.log(`${(s * w.dt).toFixed(2)}  ${off.toFixed(3).padStart(7)} | ${demand.toFixed(0).padStart(5)} | ${applied.toFixed(0).padStart(5)} | ${sat.toFixed(0).padStart(4)} | ${(ctl.sensors.feet[1]!.fz / W * 100).toFixed(0)}`);
  }
}
console.log(`\n峰值：|重力矩需求|=${demandPeak.toFixed(0)} N·m  |下发|= ${appliedPeak.toFixed(0)} N·m（τmax=${tauMaxR}）  饱和度峰值=${ratioPeak.toFixed(0)}%`);
console.log(`Inman 下界对照：${(W * half).toFixed(0)} N·m —— ${tauMaxR > W * half ? '容量够（τmax 下界以上）' : '容量不足！'}`);
