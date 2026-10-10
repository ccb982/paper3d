/**
 * _probe-momentum.ts —— 动量账本回读（§2.16 工具验收）：
 * 单脚站立全程 WBAM（绕 CoM 三轴）+ 归一化 + κ 抵消系数 + 摆动腿段分量。
 * 看：抬腿/落腿段绕 z（矢状俯仰）的角动量多大、谁来抵消。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { computeMomentum } from '../src/core/servo/momentum';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

console.log('t     相位        Lx(滚)   Ly(偏)   Lz(俯)   norm    κx   κy   κz | 摆腿Lz 上身Lz');
const N = Math.round(7 / w.dt);
for (let s = 0; s < N; s++) {
  w.advance(1);
  if (s % Math.round(0.1 / w.dt) !== 0) continue;
  const t = s * w.dt;
  const mm = computeMomentum(w.body);
  const leg = ['thigh_l', 'shank_l', 'foot_l'].reduce((a, k) => a + (mm.segs.get(k)?.z ?? 0), 0);
  const up = ['pelvis', 'spine1', 'spine2', 'spine3', 'chest', 'head', 'arm_l', 'arm_r', 'forearm_l', 'forearm_r']
    .reduce((a, k) => a + (mm.segs.get(k)?.z ?? 0), 0);
  const ph = ctl.actions.status.phase ?? '-';
  console.log(
    `${t.toFixed(2)}  ${ph.padEnd(10)} ${mm.L.x.toFixed(2).padStart(6)} ${mm.L.y.toFixed(2).padStart(6)} ${mm.L.z.toFixed(2).padStart(6)} ${mm.norm.toFixed(3)}  ` +
    `${mm.kappa.x.toFixed(2)} ${mm.kappa.y.toFixed(2)} ${mm.kappa.z.toFixed(2)} | ${leg.toFixed(2).padStart(6)} ${up.toFixed(2).padStart(6)}`,
  );
}
