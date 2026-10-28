/** _tmp-authority: 下身回正力的「真实物理权限」实测
 *
 *  问题：闭链解算器给的是**自由体几何雅可比**（转关节→子树跟着转）。
 *  但蹲姿时**脚是钉在地上的**——转动 hip_0 会带动整条腿（含脚），
 *  脚不能动 ⇒ 真实响应与几何推算差很多。
 *
 *  测法：对某 dof 持续施加恒定力矩，跑真实物理，量膝/髋 z 的实际变化。
 *  由此得出「每个 dof 对闭链约束的真实权限」。
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { propose, PRI } from '../src/core/proposalBus';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E = globalThis.process!.env;

const TAU = Number(E.TAU ?? 60);      // 施加的力矩 N·m
const DUR = Number(E.DUR ?? 0.6);     // 施加时长 s
const WHICH = String(E.WHICH ?? 'hip_l/0');

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, Number(E.SETTLE ?? '2.0')) as CourtState;
const body = w.body;

const anch = (nm: string, ax: number): { x: number; y: number; z: number } => {
  const i = body.dofByName(nm, ax);
  if (i < 0) return { x: NaN, y: NaN, z: NaN };
  const a = body.dofs[i]!.anchorWorld;
  return { x: a[0]!, y: a[1]!, z: a[2]! };
};

const [tn, ta] = WHICH.split('/');
const dofIdx = body.dofByName(tn!, Number(ta));
console.log(`════ 施加 ${WHICH} 恒定力矩 ${TAU} N·m，持续 ${DUR}s ════`);
if (dofIdx < 0) { console.log('!! 找不到 dof'); process.exit(1); }

// 释放前捕获基准
const base = { k: anch('knee_l', 2), h: anch('hip_l', 2), a: anch('foot_l', 2) };
console.log(`  基准: 膝z=${(base.k.z * 100).toFixed(2)} 髋z=${(base.h.z * 100).toFixed(2)} 踝z=${(base.a.z * 100).toFixed(2)} cm`);

let tForce = 0;
const comBase = { x: ctl.sensors.com[0]!, z: ctl.sensors.com[2]! };
for (let s = 0; s < Math.round((Number(E.SETTLE ?? '2.0') + DUR + 0.3) / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const rel = court.t - court.settle;
  if (rel > 0 && rel < DUR) {
    propose({ dof: dofIdx!, kind: 'ext', pri: PRI.direct, tau: TAU, src: 'authorityProbe', channel: 'probe' });
    tForce += w.dt;
  }
}
const k2 = anch('knee_l', 2), h2 = anch('hip_l', 2), a2 = anch('foot_l', 2);
const com2 = { x: ctl.sensors.com[0]!, z: ctl.sensors.com[2]! };
console.log(`  施加后: 膝z=${(k2.z * 100).toFixed(2)} 髋z=${(h2.z * 100).toFixed(2)} 踝z=${(a2.z * 100).toFixed(2)} cm`);
console.log(`  Δ膝z=${((k2.z - base.k.z) * 100).toFixed(3)}  Δ髋z=${((h2.z - base.h.z) * 100).toFixed(3)}  Δ踝z=${((a2.z - base.a.z) * 100).toFixed(3)} cm`);
console.log(`  ΔCoM: x=${((com2.x - comBase.x) * 100).toFixed(3)} z=${((com2.z - comBase.z) * 100).toFixed(3)} cm  ← 整体平移 = 脚没钉住`);
console.log(`  → 真实权限: ∂(膝z−踝z)/∂τ = ${(((k2.z - base.k.z) - (a2.z - base.a.z)) * 100 / TAU).toFixed(4)} cm/(N·m)`);
console.log(`               ∂(髋z−膝z)/∂τ = ${(((h2.z - base.h.z) - (k2.z - base.k.z)) * 100 / TAU).toFixed(4)} cm/(N·m)`);
console.log(`  关节角变化: ${((body.dofs[dofIdx!]!.angle) * 57.3).toFixed(2)}°  (τmax=${body.dofs[dofIdx!]!.tauMax})`);
console.log(`  fall=${court.fall >= 0 ? `${court.fall.toFixed(2)}s ${court.reason}` : '未倒'}`);
