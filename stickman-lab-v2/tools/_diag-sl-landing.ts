/** _diag-sl-landing.ts —— 单脚站立·落地窗口侧向冲量诊断（0.05s 分辨率）
 *  重点看：落地前后 comZ 的侧向速度 vz 何时起峰、谁在发力（lean copZ / 两脚 fz / 消力）。 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { applyLumbar, DEFAULT_LUMBAR } from '../src/core/lumbarPolicy';
import * as fs from 'node:fs';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
if (process.env.LUMBAR_JSON) {   // 复现浏览器：加载训练策略
  const j = JSON.parse(fs.readFileSync(process.env.LUMBAR_JSON, 'utf8')) as { p?: object } | object;
  const pp = (j as { p?: object }).p ?? j;
  applyLumbar(ctl.warner.opt, { ...DEFAULT_LUMBAR, ...(pp as object) });
}
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const W = w.sk.massTotal * 9.81;
let lastPh = '';
const idHpR0 = w.body.dofByName('hip_r', 0), idHpL0 = w.body.dofByName('hip_l', 0);
const idSp10 = w.body.dofByName('spine1', 0);
console.log('t     相位        comZ   vz     comX   vx     Lfz% Rfz%  髋R0角  髋L0角  τ髋R0  τ髋L0  τ脊柱0  脚Lx 脚Ly 脚Lz 髋L锚z');
for (let s = 0; s < Math.round(6.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const ph = ctl.actions.status.phase ?? '-';
  // 相位切换打一行；落地窗口（D/E）每 0.05s 打一行
  const inLand = ph.startsWith('D') || ph.startsWith('E') || (lastPh.startsWith('D') && ph === '-');
  const print = ph !== lastPh || (inLand && s % 24 === 0);
  if (print) {
    const sup = ctl.lastProposal?.support;
    const lean = ctl.lastProposal?.reflexDirectives.find((d) => d.id === 'lean');
    console.log(
      `${t.toFixed(2)}  ${ph.padEnd(10)} ${ctl.sensors.com[2]!.toFixed(3)}  ${ctl.sensors.comVel[2]!.toFixed(2).padStart(5)}  ` +
      `${ctl.sensors.com[0]!.toFixed(3)}  ${ctl.sensors.comVel[0]!.toFixed(2).padStart(5)}  ` +
      `${(ctl.sensors.feet[0]!.fz / W * 100).toFixed(0).padStart(4)}  ${(ctl.sensors.feet[1]!.fz / W * 100).toFixed(0).padStart(4)}  ` +
      `${ctl.landing.depthOf(0).toFixed(2)}   ${sup ? sup.supZ.toFixed(2) : '-'}    ` +
      `${lean ? (lean.params?.copZ ?? 0).toFixed(2) : '-'}  ` +
      `${idHpR0 >= 0 ? w.body.dofs[idHpR0]!.angle.toFixed(2) : '-'}  ${idHpL0 >= 0 ? w.body.dofs[idHpL0]!.angle.toFixed(2) : '-'}  ` +
      `${idHpR0 >= 0 ? w.executor.ledger[idHpR0]!.applied.toFixed(0) : '-'}  ${idHpL0 >= 0 ? w.executor.ledger[idHpL0]!.applied.toFixed(0) : '-'}  ` +
      `${idSp10 >= 0 ? w.executor.ledger[idSp10]!.applied.toFixed(0) : '-'}  ` +
      `${ctl.sensors.feet[0]!.x.toFixed(2)} ${ctl.sensors.feet[0]!.y.toFixed(2)} ${ctl.sensors.feet[0]!.z.toFixed(2)}  ` +
      `${idHpL0 >= 0 ? w.body.dofs[idHpL0]!.anchorWorld[2].toFixed(2) : '-'}`);
  }
  lastPh = ph;
}
