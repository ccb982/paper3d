/** _probe-sl-tau.ts —— 单腿站立全程力矩实测：
 *   承重髋/承重膝 | 腰(脊柱0/2) | 摆动腿(髋0/2、膝、踝) —— 峰值 + 饱和计数 + 负载
 *   数据源：executor.ledger[].applied（实际下发净力矩）、.saturated（被 τmax 削）。 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const di = (n: string, ax: number): number => w.body.dofByName(n, ax);
const ax: Record<string, number> = {
  supHip0: di('hip_r', 0), supHip2: di('hip_r', 2), supKnee: di('knee_r', 2),
  sp10: di('spine1', 0), sp20: di('spine2', 0), sp30: di('spine3', 0),
  sp12: di('spine1', 2), sp22: di('spine2', 2), sp32: di('spine3', 2),
  swHip0: di('hip_l', 0), swHip2: di('hip_l', 2), swKnee: di('knee_l', 2), swFoot: di('foot_l', 2),
};
const peak: Record<string, number> = {}, satN: Record<string, number> = {}, integ: Record<string, number> = {};
for (const k of Object.keys(ax)) { peak[k] = 0; satN[k] = 0; integ[k] = 0; }
console.log('t     Lfz% | 承重髋0 承重膝 | 腰0(1/2/3) 腰2(1/2/3) | 摆髋0 摆髋2 摆膝 摆踝');
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  for (const k of Object.keys(ax)) {
    const i = ax[k];
    if (i < 0) continue;
    const l = w.executor.ledger[i]!;
    const a = Math.abs(l.applied);
    peak[k] = Math.max(peak[k]!, a);
    integ[k] = (integ[k] ?? 0) + a * w.dt;
    if (l.saturated) satN[k] = (satN[k] ?? 0) + 1;
  }
  if (s % 48 === 0) {
    const t = (s * w.dt).toFixed(2).padStart(5);
    const tau = (k: string): string => (ax[k]! >= 0 ? (w.executor.ledger[ax[k]!]!.applied).toFixed(0).padStart(5) : '   - ');
    console.log(`${t}  ${(ctl.sensors.feet[0]!.fz / (w.sk.massTotal * 9.81) * 100).toFixed(0).padStart(3)} | ${tau('supHip0')} ${tau('supKnee')} | ${tau('sp10')} ${tau('sp20')} ${tau('sp30')} | ${tau('sp12')} ${tau('sp22')} ${tau('sp32')} | ${tau('swHip0')} ${tau('swHip2')} ${tau('swKnee')} ${tau('swFoot')}`);
  }
}
console.log('\n小结（峰值 N·m | 饱和帧数 | 冲量 N·m·s）:');
for (const k of Object.keys(ax)) {
  if (ax[k]! < 0) continue;
  console.log(`  ${k.padEnd(8)} 峰值=${peak[k]!.toFixed(0).padStart(4)}  饱和帧=${satN[k]!.toString().padStart(4)}  冲量=${integ[k]!.toFixed(0).padStart(5)}  (τmax=${w.body.dofs[ax[k]!]?.tauMax?.toFixed?.(0) ?? '-'})`);
}
