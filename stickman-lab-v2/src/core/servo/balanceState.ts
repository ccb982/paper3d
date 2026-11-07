/**
 * 髋回正的唯一状态选择器（只判定，不写执行器）。
 *
 * 髋只有两个任务：
 *   JOINT_HOLD   → 任务②：关节角修正（IK + posture）
 *   FORCE_RECOVER → 任务①：力链修正（成对 load/unload）
 *
 * "稳定/不稳定"不是状态名，是选择这两个 mode 的条件：
 *   力链/负载/姿态误差在死区内 → JOINT_HOLD
 *   任一误差出大带 → FORCE_RECOVER
 * 大带进入、小带持续 holdT 才回，滞回。
 */
export type HipMode = 'JOINT_HOLD' | 'FORCE_RECOVER';

export interface HipBalanceInput {
  /** 释放后才有意义；释放前保持 JOINT_HOLD */
  active: boolean;
  fzL: number;
  fzR: number;
  fzLTarget: number;
  fzRTarget: number;
  fzNominal: number;
  contactL: boolean;
  contactR: boolean;
  copValidL: boolean;
  copValidR: boolean;
  copInsideL: boolean;
  copInsideR: boolean;
  fParallelL: number;
  fParallelR: number;
  fPerpL: number;
  fPerpR: number;
  /** rad，相对捕获姿态的 roll 偏差 */
  roll: number;
  /** rad，相对捕获姿态的 pitch 偏差 */
  pitch: number;
  /** rad，髋三轴最大目标误差；没有可用目标时传 0 */
  qErrMax: number;
  prevMode: HipMode;
  stableT: number;
  /** 进入 FORCE_RECOVER 的持续计时（去抖） */
  faultT: number;
  dt: number;
}

export interface HipBalanceOutput {
  mode: HipMode;
  stableT: number;
  faultT: number;
  /** N，正 = 左脚需要更多负载 */
  loadDiff: number;
  supportSide: 'l' | 'r' | null;
  eForce: number;
  eChainFault: boolean;
  ePosture: number;
  reasons: string[];
}

const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};

export function assessHipBalance(i: HipBalanceInput): HipBalanceOutput {
  if (!i.active) {
    return {
      mode: 'JOINT_HOLD', stableT: 0, faultT: 0, loadDiff: 0, supportSide: null,
      eForce: 0, eChainFault: false, ePosture: 0, reasons: ['idle'],
    };
  }
  const forceHi = Math.abs(num('SQC_HIP_STATE_FORCE_HI', 0.20));
  const forceLo = Math.abs(num('SQC_HIP_STATE_FORCE_LO', 0.08));
  const postureHi = Math.abs(num('SQC_HIP_STATE_POSTURE_HI', 2.0));
  const postureLo = Math.abs(num('SQC_HIP_STATE_POSTURE_LO', 1.0));
  const rollRef = Math.abs(num('SQC_HIP_STATE_ROLL_REF', 5 / 57.29578));
  const pitchRef = Math.abs(num('SQC_HIP_STATE_PITCH_REF', 10 / 57.29578));
  const qRef = Math.abs(num('SQC_HIP_STATE_Q_REF', 8 / 57.29578));
  const chainAngleHi = Math.abs(num('SQC_HIP_CHAIN_ANGLE', 20 / 57.29578));
  const holdT = Math.max(0, num('SQC_HIP_STATE_HOLD_T', 0.15));
  const enterT = Math.max(0, num('SQC_HIP_STATE_ENTER_T', 0.05));

  const w = Math.max(1, i.fzNominal);
  const eForce = Math.max(Math.abs(i.fzLTarget - i.fzL), Math.abs(i.fzRTarget - i.fzR)) / w;
  const chainAngle = Math.max(
    Math.atan2(Math.abs(i.fPerpL), Math.max(1, Math.abs(i.fParallelL))),
    Math.atan2(Math.abs(i.fPerpR), Math.max(1, Math.abs(i.fParallelR))),
  );
  const eChainFault = !i.contactL || !i.contactR
    || i.fParallelL <= 0 || i.fParallelR <= 0
    || chainAngle > chainAngleHi;
  const ePosture = Math.max(
    Math.abs(i.roll) / Math.max(1e-6, rollRef),
    Math.abs(i.pitch) / Math.max(1e-6, pitchRef),
    Math.abs(i.qErrMax) / Math.max(1e-6, qRef),
  );

  const enter = eForce > forceHi || eChainFault || ePosture > postureHi;
  const holdOk = !eChainFault && eForce < forceLo && ePosture < postureLo;
  const faultT = enter ? Math.max(0, i.faultT) + Math.max(0, i.dt) : 0;
  const stableT = holdOk ? Math.max(0, i.stableT) + Math.max(0, i.dt) : 0;
  const mode: HipMode = i.prevMode === 'FORCE_RECOVER'
    ? (holdOk && stableT >= holdT ? 'JOINT_HOLD' : 'FORCE_RECOVER')
    : (faultT >= enterT ? 'FORCE_RECOVER' : 'JOINT_HOLD');

  const loadDiff = (i.fzLTarget - i.fzL) - (i.fzRTarget - i.fzR);
  const supportSide = Math.abs(loadDiff) < 1e-6 ? null : loadDiff > 0 ? 'l' : 'r';
  const reasons: string[] = [];
  if (eForce > forceHi) reasons.push('force');
  if (eChainFault) reasons.push('chain');
  if (ePosture > postureHi) reasons.push('posture');
  if (mode === 'JOINT_HOLD') reasons.push('hold');  return { mode, stableT, faultT, loadDiff, supportSide, eForce, eChainFault, ePosture, reasons };
}
