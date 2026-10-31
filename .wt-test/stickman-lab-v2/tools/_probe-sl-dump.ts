/**
 * _probe-sl-dump.ts —— 单脚站立全过程回读：关节角 / 实际施加力矩 / 力矩上限 +
 * 预警侧移指令（lean 提案参数）+ CoM。用于诊断"快倒时到底使了多大劲"。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const names: Array<[string, number]> = [
  ['hip_r', 0], ['hip_l', 0], ['spine2', 0], ['spine4', 0],
  ['shoulder_r', 0], ['shoulder_l', 0],
  ['hip_r', 2], ['knee_r', 2], ['knee_l', 2], ['foot_r', 2],
];
const chestIdx = w.body.indexByKey.get('spine4') ?? 0;
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.8 || s % 20 !== 0) continue;
  const lean = ctl.lastProposal?.reflexDirectives.find((d) => d.id === 'lean')?.params;
  const chest = w.body.bodies[chestIdx]!.translation().y;
  const cells = names.map(([n, a]) => {
    const i = w.body.dofByName(n, a);
    if (i < 0) return `${n}/${a}=—`;
    const d = w.body.dofs[i]!;
    const L = w.executor.ledger[i]!;
    return `${n}/${a} θ=${d.angle.toFixed(2)} τ=${L.applied.toFixed(0)}/${d.tauMax.toFixed(0)}`;
  }).join(' ');
  console.log(
    `t=${t.toFixed(2)} [${ctl.actions.status.phase}] comZ=${ctl.sensors.com[2]!.toFixed(3)}` +
    ` vz=${ctl.sensors.comVel[2]!.toFixed(2)} 胸=${chest.toFixed(2)}` +
    (lean ? ` lean h=${(lean.hip ?? 0).toFixed(2)} s=${(lean.spine ?? 0).toFixed(2)} a=${(lean.arm ?? 0).toFixed(2)}` : ' lean=—')
  );
  console.log(`    ${cells}`);
}
