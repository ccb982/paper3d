/** _tmp-freeze-attr: 冻结期「大腿朝中线拧」的力矩归因（决定性）
 *
 *  已实测事实（_tmp-freeze-pose2）：
 *    冻结期 0→2s：左大腿局部 +X 的水平偏航 yaw 90° → 137°
 *                  （左腿在 +Z 侧 ⇒ yaw 增大 = 大腿正面转向中线 = **膝盖朝内**）
 *                  小腿 yaw 90° → 82°，脚 yaw 65°（外八 rest 偏置，不变）
 *    ⇒ 冻结期大腿相对小腿拧了 ~55° ⇒ 视觉「膝盖内收」。
 *
 *  本探针（口径修正）：
 *    ★ 力矩读 **executor.ledger[].applied**（唯一施加点），
 *      不用 drive.lastBreakdown（它不含 ext 通道 ⇒ 上一版全 0 是读错通道）。
 *    ★ 提案读 proposalBus 的 __PROPLOG（dof, kind, tau, src）。
 *
 *  输出：每 0.1s 一行，列出该帧**所有非零力矩**的腿关节 DOF + 写手。
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E: Record<string, string> = globalThis.process!.env;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
const body = w.body;

const D = 180 / Math.PI;
const yaw = (key: string): number => {
  const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
  return Math.atan2(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)) * D;
};
const LOG: Array<[number, string, number, string]> = [];
(globalThis as { __PROPLOG?: Array<[number, string, number, string]> }).__PROPLOG = LOG;

const LEG = ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r'];
const idx = new Map<number, string>();
for (const nm of LEG) for (const ax of [0, 1, 2]) {
  const i = body.dofByName(nm, ax);
  if (i >= 0) idx.set(i, `${nm}/${ax}`);
}

console.log(`\n════ 冻结期归因（HIP_STRATEGY=${E.SQC_HIP_STRATEGY ?? '1'} HIP_SOFT=${E.SQC_HIP_SOFT ?? '1'} PAIR=${E.SQC_PAIR_OFF ?? '0'}）════`);
console.log('  t   | 大腿yawL | 腿关节非零力矩（executor.applied N·m）与写手');
for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
  LOG.length = 0;
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = s * w.dt;
  if (Math.round(t * 10) % 2 !== 0) continue;

  const ex = (w as unknown as { executor?: { ledger: Array<{ applied: number; cmd: number; writes: number }> } }).executor;
  const parts: string[] = [];
  if (ex) {
    for (const [di, name] of idx) {
      const l = ex.ledger[di];
      if (!l || Math.abs(l.applied) < 0.5) continue;
      // 该 DOF 的写手
      const srcs = new Map<string, number>();
      for (const [dof, kind, v, src] of LOG) {
        if (dof !== di) continue;
        srcs.set(src, (srcs.get(src) ?? 0) + v);
      }
      const sTxt = [...srcs.entries()].map(([k, v]) => `${k}:${v.toFixed(0)}`).join('+');
      parts.push(`${name}=${l.applied.toFixed(0)}${sTxt ? `(${sTxt})` : ''}`);
    }
  }
  console.log(` ${t.toFixed(2)} | ${yaw('thigh_l').toFixed(1).padStart(7)} | ${parts.join('  ')}`);
}
console.log('\n★ 大腿 yaw 增大 = 大腿正面转向中线（膝盖朝内）');
console.log('★ 力矩 = executor.ledger.applied（唯一施加点）；括号内 = proposalBus 写手与提案值');
