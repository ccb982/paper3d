/** _tmp-mirror: 'zero' 目标下左右不对称的机制
 *
 *  现象：目标=zero 时 knee_l/1 = +3.47（左右镜像读数，同一几何状态）
 *        但膝vs踝 L=+7.76cm R=−2.99cm ⇒ 左右**物理位置**不对称 10.7cm
 *
 *  假设 A：主动回正（hipStrategy）左右增益不同（膝 150 / 220）⇒ 主动输出不对称
 *  假设 B：镜像读数让左右被动张力符号相反，但轴也是镜像的 ⇒ 应该对称
 *  假设 C：矢状基础力左右不对称（pair 通道的镜像处理）
 *
 *  本探针逐个验证。
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
  const ex = (w as unknown as { executor?: { ledger: Array<{ applied: number; passive: number }> } }).executor;
  for (let s = 0; s < Math.round(2.1 / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
  }
  const az = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;
  const ang = (nm: string, ax: number): number => body.dofs[body.dofByName(nm, ax)]!.angle * D;
  const kaL = (az('knee_l') - az('foot_l')) * 100;
  const kaR = (az('knee_r') - az('foot_r')) * 100;
  // 各轴最终力矩
  const tq = (nm: string, ax: number): string => {
    const i = body.dofByName(nm, ax);
    const l = ex?.ledger[i];
    return l ? `${l.applied.toFixed(1)}` : '?';
  };
  return `  膝vs踝 L=${kaL.toFixed(2).padStart(6)} R=${kaR.toFixed(2).padStart(6)} | knee1 L=${ang('knee_l', 1).toFixed(1).padStart(6)} R=${ang('knee_r', 1).toFixed(1).padStart(6)}` +
    ` | τ knee1 L=${tq('knee_l', 1).padStart(7)} R=${tq('knee_r', 1).padStart(7)}` +
    ` | τ hip0 L=${tq('hip_l', 0).padStart(7)} R=${tq('hip_r', 0).padStart(7)}`;
};

console.log('\n════ 镜像/不对称机制验证 ════');
const cases: Array<[string, Record<string, string>]> = [
  ['① 现状（zero）', {}],
  ['② 关主动回正', { SQC_HIP_STRATEGY: '0' }],
  ['③ 主动膝增益左右对称 (R=150)', { SQC_HS_KP_KNEE_R: '150' }],
  ['④ 主动膝增益左右对称 (R=150,L=150)', { SQC_HS_KP_KNEE_R: '150', SQC_HS_KP_KNEE_L: '150' }],
  ['⑤ 关被动张力', { SQC_LEG_TENSION: '0' }],
  ['⑥ 只被动、无主动', { SQC_HIP_STRATEGY: '0' }],
  ['⑦ 关矢状基础力', { SQC_PAIR_OFF: '1' }],
  ['⑧ 被动 K=150', { SQC_LT_K: '150', SQC_LT_CAP: '150' }],
];
for (const [name, cfg] of cases) console.log(`  ${name.padEnd(34)} ${run(cfg)}`);
for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG);
