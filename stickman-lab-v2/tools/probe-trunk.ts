/** probe-trunk.ts —— 上身（躯干）侧翻到底谁在管、够不够力
 *
 *  用户（2026-10-27）：『回读上身的调控 / **上身别侧翻怎么都行** / 但是这个上身一直在侧翻，没人救啊』
 *
 *  只量三件事，不谈机制：
 *    ① **需要多少**：`spine1` 关节以上的**子树质量**，其质心相对 `spine1` 锚点的侧向偏移 Δz
 *       ⇒ 静态所需力矩 τ_need = m·g·Δz（这才是"救上身"的最低成本）
 *    ② **实际给了多少**：侧向通道（spine1-3/0、hip_l/r/0）的 `ledger.applied` 之和
 *    ③ **还有多少没用**：这些轴的 τmax 之和 ⇒ 用权比例
 *
 *  ★ 为什么用子树动量法而不是"看角度"：躯干侧翻的力矩需求只取决于**质量分布**，
 *    与"关节角偏离目标多少"无关 —— 后者正是现在写手在做的事（所以它救不了）。
 *
 *  用法：node tools/run.mjs probe-trunk
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, type CourtState } from '../src/core/court';
import { squatFrame } from '../src/core/servo/squat';

const ENV = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
const T_END = Number(ENV.T_END ?? 6);
const w = new World();
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.driveEnabled = true;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState | null;
const body = w.body;
const G = 9.81;
const ledger = w.executor.ledger as unknown as Array<{ applied: number }>;

const si = body.dofByName('spine1', 0);
const s1j = body.dofs[si]!.joint;
/** spine1 以上的所有刚体（= 躯干 + 头颈 + 手臂） */
const above = body.subtree[s1j] ?? [];

/** 侧向通道：谁应该救上身 */
const LAT: Array<[string, number]> = [
  ['spine1', 0], ['spine2', 0], ['spine3', 0], ['hip_l', 0], ['hip_r', 0],
];

console.log('   t(s)  躯干侧倾°  子树质量kg  Δz(mm)  τ_need  Σ|applied|  用权%  τmax和  髋线°');
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  if (!court || !court.released) continue;
  const t = court.t;
  if (Math.abs(t / 0.25 - Math.round(t / 0.25)) > w.dt / 0.25 / 2) {
    if (court.fall >= 0 && t >= court.fall + 0.1) break;
    continue;
  }

  // ① 子树质量与侧向质心偏移
  const anch = body.dofs[si]!.anchorWorld;
  let m = 0, mz = 0;
  for (const bi of above) {
    const rb = body.bodies[bi]!;
    const c = rb.worldCom();
    m += rb.mass();
    mz += rb.mass() * (c.z - anch[2]!);
  }
  const dz = m > 1e-6 ? mz / m : 0;
  const need = m * G * Math.abs(dz);

  // ② 侧向通道实际下发
  let applied = 0, tmax = 0;
  const each: string[] = [];
  for (const [nm, ax] of LAT) {
    const i = body.dofByName(nm, ax);
    if (i < 0) continue;
    const a = Math.abs(ledger[i]!.applied);
    applied += a;
    tmax += body.dofs[i]!.tauMax;
    each.push(`${a.toFixed(0)}`);
  }

  // ③ 躯干世界侧倾（spine1 锚点 → 头）
  const hi = body.indexByKey.get('head');
  const hp = hi !== undefined ? body.bodies[hi]!.translation() : null;
  const trunkDeg = hp
    ? Math.atan2(hp.z - anch[2]!, Math.max(1e-6, Math.abs(hp.y - anch[1]!))) * 57.3
    : NaN;

  // 髋线
  const il = body.dofByName('hip_l', 2), ir = body.dofByName('hip_r', 2);
  const hl = il >= 0 ? body.dofs[il]!.anchorWorld : null;
  const hr = ir >= 0 ? body.dofs[ir]!.anchorWorld : null;
  const hipRoll = hl && hr ? Math.atan2(hl[1]! - hr[1]!, Math.abs(hl[2]! - hr[2]!)) * 57.3 : NaN;

  console.log(
    `${t.toFixed(2).padStart(6)} ${trunkDeg.toFixed(1).padStart(9)} ${m.toFixed(1).padStart(10)} ${(dz * 1000).toFixed(0).padStart(7)}` +
    ` ${need.toFixed(0).padStart(7)} ${applied.toFixed(0).padStart(11)} ${(applied / tmax * 100).toFixed(0).padStart(6)}%` +
    ` ${tmax.toFixed(0).padStart(6)} ${hipRoll.toFixed(1).padStart(6)}   [${each.join(',')}]`,
  );
  if (court.fall >= 0 && t >= court.fall + 0.1) break;
}
console.log(`\nfall=${court && court.fall >= 0 ? `${court.fall.toFixed(2)}s ${court.reason}` : '未倒'}`);
