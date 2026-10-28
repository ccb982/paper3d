/** _tmp-freeze-limit: 冻结期漂移的两个候选根因
 *
 *  已实测：
 *    · 大腿相对躯干拧 +47.6°，大腿绕长轴 roll −20.8°，小腿反拧 −7.8°
 *      ⇒ 膝面朝中线 55°（视觉「膝盖内收」）
 *    · 位置只内移 1.7cm（膝仍在踝外 1.5cm）⇒ 是「朝向拧」不是「位置塌」
 *    · 冻结期 hip0/hip1/knee0/knee1 的**施加力矩全程 = 0 N·m**
 *      ⇒ hipStrategy（膝竖直/髋水平/膝扭转限位）在冻结期**根本没工作**
 *        （目标在释放瞬间才捕获）
 *
 *  本探针：
 *  ① 摆姿刚成形时，逐 DOF 检查**是否越出自身限位**（运动学摆姿绕过限位 ⇒ 解算器一直往回推）
 *  ② A/B：把闭链目标提前到 setup 捕获（让 hipStrategy 冻结期就工作）→ 看拧转是否消失
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { captureHipStrategyTarget } from '../src/core/servo/hipStrategy';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E: Record<string, string> = globalThis.process!.env;
const D = 180 / Math.PI;

interface Snapshot { dThigh: number; dShin: number; dKa: number; viol: string[] }

const run = (captureEarly: boolean): Snapshot => {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
  const body = w.body;

  // ① 摆姿刚成形的越限检查
  const viol: string[] = [];
  for (const d of body.dofs) {
    if (!/^(hip|knee|foot|spine|torso|neck)/.test(d.name)) continue;
    const a = d.angle * D;
    if (a > d.max * D + 0.5) viol.push(`${d.name}/${d.axis} ${a.toFixed(1)}° > max ${(d.max * D).toFixed(1)}°`);
    if (a < d.min * D - 0.5) viol.push(`${d.name}/${d.axis} ${a.toFixed(1)}° < min ${(d.min * D).toFixed(1)}°`);
  }

  if (captureEarly) captureHipStrategyTarget(w);   // ★ 修复假设：冻结期就让 hipStrategy 工作

  const yaw = (key: string): number => {
    const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
    return Math.atan2(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)) * D;
  };
  const kz = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;
  const t0 = { th: yaw('thigh_l'), sh: yaw('shin_l'), ka: kz('knee_l') - kz('foot_l') };
  for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
  }
  return {
    dThigh: yaw('thigh_l') - t0.th,
    dShin: yaw('shin_l') - t0.sh,
    dKa: (kz('knee_l') - kz('foot_l') - t0.ka) * 100,
    viol,
  };
};

console.log('\n════ ① 摆姿刚成形的关节越限（冻结期解算器会一直往回推 ⇒ 持续漂移源）════');
const a = run(false);
for (const v of a.viol) console.log('   ⚠ ' + v);
if (!a.viol.length) console.log('   （无越限）');

console.log('\n════ ② A/B：闭链目标提前捕获（让 hipStrategy 冻结期就工作）════');
console.log(`  现状（目标只在释放瞬间捕获）  Δ大腿yaw=${a.dThigh.toFixed(1)}°  Δ小腿yaw=${a.dShin.toFixed(1)}°  Δ膝vs踝=${a.dKa.toFixed(2)}cm`);
const b = run(true);
console.log(`  修复（setup 时就捕获目标）    Δ大腿yaw=${b.dThigh.toFixed(1)}°  Δ小腿yaw=${b.dShin.toFixed(1)}°  Δ膝vs踝=${b.dKa.toFixed(2)}cm`);
console.log(`  ⇒ 拧转 ${a.dThigh.toFixed(1)}° → ${b.dThigh.toFixed(1)}°（改善 ${(a.dThigh - b.dThigh).toFixed(1)}°）`);
console.log(`\n★ env：KEEP=${E.SQC_KEEP_ANG_TABLE ?? '2'} LIVE=${E.SQC_LIVE ?? '0'} GONS=${E.SQC_GONS ?? '0'} ZERO=${E.SQC_ZERO ?? '1'} PAIR=${E.SQC_PAIR_OFF ?? '0'}`);
