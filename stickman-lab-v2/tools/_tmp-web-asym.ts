/** _tmp-web-asym: 'zero' 目标下左右不对称的来源
 *
 *  实测（2.1s 放开时刻）：
 *    目标=zero   膝vs踝 L+4.04cm R−5.29cm  ★不对称
 *    目标=pose   膝vs踝 L+1.20cm R+0.97cm  对称
 *
 *  假设：'zero' 把两个膝都拉向几何零，而两个方向的零**几何含义相同**
 *        （都=小腿相对大腿张开 0）⇒ 主动回正（膝竖直，逐侧独立增益 150/220）
 *        与被动张力在**同一轴上反向拉扯** ⇒ 哪边主动强哪边被拉过去 ⇒ 不对称。
 *
 *  本探针：逐个关掉可能的对手，看不对称是否消失
 *    ① 现状（zero）
 *    ② 关主动回正 SQC_HIP_STRATEGY=0
 *    ③ 主动膝增益左右对称（把 SQC_HS_KP_KNEE_R 改成 = L）
 *    ④ 关矢状基础力
 *    ⑤ 加大被动张力 K（看不对称是否随 K 变大）
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process?.env;
const E: Record<string, string> = globalThis.process!.env;
const D = 180 / Math.PI;
const ORIG = { ...E };

const run = (cfg: Record<string, string>): string => {
  for (const k of Object.keys(E)) delete E[k];
  Object.assign(E, ORIG, cfg);
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
  const body = w.body;
  for (let s = 0; s < Math.round(2.1 / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
  }
  const az = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;
  const ang = (nm: string, ax: number): number => body.dofs[body.dofByName(nm, ax)]!.angle * D;
  const kaL = (az('knee_l') - az('foot_l')) * 100;
  const kaR = (az('knee_r') - az('foot_r')) * 100;
  return `  膝vs踝 L=${kaL.toFixed(2).padStart(6)} R=${kaR.toFixed(2).padStart(6)} | knee1 L=${ang('knee_l', 1).toFixed(1).padStart(6)} R=${ang('knee_r', 1).toFixed(1).padStart(6)}` +
    ` | hip1 L=${ang('hip_l', 1).toFixed(1).padStart(6)} | 判死 ${court.fall >= 0 ? court.fall.toFixed(2) : '无'}`;
};

console.log('\n════ zero 目标的左右不对称归因 ════');
const cases: Array<[string, Record<string, string>]> = [
  ['① 现状（zero）', {}],
  ['② 关主动回正', { SQC_HIP_STRATEGY: '0' }],
  ['③ 主动膝增益左右对称 (R=150)', { SQC_HS_KP_KNEE_R: '150' }],
  ['④ 关矢状基础力', { SQC_PAIR_OFF: '1' }],
  ['⑤ 被动张力 K=200', { SQC_LT_K: '200', SQC_LT_CAP: '200' }],
  ['⑥ 被动张力 K=20', { SQC_LT_K: '20', SQC_LT_CAP: '20' }],
  ['⑦ 被动张力只管膝轴1（不碰髋）', {}],
];
for (const [name, cfg] of cases) {
  if (name.startsWith('⑦')) {
    console.log(`  ${name.padEnd(30)} (跳过)`);
    continue;
  }
  console.log(`  ${name.padEnd(30)} ${run(cfg)}`);
}
for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG);
