/** squat.ts —— 蹲下模块（2026-10-21 架构清理版）
 *
 * 蹲姿 = **一个写手**（squat.pairBase）+ **一个捕获点**（释放瞬间）+ **一套参数**（状态表）。
 *
 *   L0 基础力：释放瞬间按标准姿势算一次静态支撑力矩（子树+GRF），固定不变
 *   L1 回正力：pair 的 PD（kp·(ref−θ) − kd·ω），ref = 释放姿势目标角
 *   L2 阻尼：drive.step 的 td（唯一阻尼）
 *
 * 任何新增写手必须先在本文件登记，否则禁止。
 */

import { baseState, baseParams, baseAng } from './baseTable';
import { propose, PRI } from '../proposalBus';

import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep, courtInject } from '../court';

/** 基础力缓存（释放瞬间捕获一次；离开蹲姿清空） */
/**
 * 蹲姿每帧：唯一关节力写手（pair）。
 * 基础力 = 法庭 setup 时 captureSquatBase() 解一次（ctl.warner.sqBaseBuf），每帧原样读；
 * 回正力 = pair 的 kp·(ref−θ) − kd·ω（ref = captureAngFrom 的标准姿势）；
 * foot/ankle 完全排除（不主动发力；由引擎限位 + drive 阻尼维持）。
 */
export function squatPairBase(w: World, ctl: ControlModule): void {
  if (baseState() !== 'squat') return;
  const baseBuf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  if (!baseBuf) return;   // 未捕获 → 蹲姿不写 pair
  const body = w.body;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const bp = baseParams() as unknown as { pairC?: number };
  const cPair = Number(env.SQC_PAIR_C ?? bp.pairC ?? 0.7);
  for (const d of body.dofs) {
    if (d.engineMotor) continue;
    // ★ foot 完全排除（用户：'foot = 完全排除（不主动发力）'）
    if (!(/^(hip|knee|spine|neck)/.test(d.name) && (d.axis === 0 || d.axis === 2))) continue;
    let base = baseBuf[d.dofIndex] ?? 0;
    // ★ 调试滑块：髋补充力（仅 hip 矢状轴）
    if (/^hip_/.test(d.name) && d.axis === 2) base += Number((globalThis as { __SQC_HIPBOOST?: number }).__SQC_HIPBOOST ?? 0);
    const ref = baseAng(d.name, d.axis) ?? d.angle;
    // ★ 调试：固定髋（高增益 PD 力矩；motor 通道对非引擎关节无效）
    const hipPin = Boolean((globalThis as { __SQC_HIPPIN?: boolean }).__SQC_HIPPIN) || String(env.SQC_HIPPIN ?? '0') === '1';
    if (hipPin && /^hip_/.test(d.name) && d.axis === 2) {
      const pinTau = 4000 * (ref - d.angle) - 200 * d.vel;
      propose({ dof: d.dofIndex, kind: 'ext', pri: PRI.direct, tau: pinTau, src: 'squat.hipPin' });
    }
    propose({ dof: d.dofIndex, kind: 'pair', pri: PRI.action, c: cPair, rad: ref, tau: base, src: 'squat.pairBase' });
  }
}

// ── 蹲姿编排入口：法庭 + 注入（唯一入口）──
export {
  squatCourtSetup,
  courtStep,
  courtInject,
  type CourtState,
} from '../court';

/** 蹲姿每物理步：法庭（目标/判死）+ 唯一写手 */
export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  squatPairBase(w, ctl);
  courtInject(w, ctl);
}
