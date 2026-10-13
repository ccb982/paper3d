// ============================================================
// unified.ts —— 统一调控层（v1：只读观测器 + 目标谓词）
//   用户定稿（2026-10-13）：三路共驾一个大脑；三输入源（关节位置/天平/力链）；
//   目的性判据（脚真着地/腰真反转/身体真平衡）；唯一读天平者。
//   本文件 stage-1：只读——收编散落判断，输出统一身体状态+谓词；不改行为。
// ============================================================
import type { ServoRefs } from './supportReg';

export interface UnifiedState {
  // 源1·关节位置（运动学真值）
  tiltDeg: number;        // 躯干世界倾角（up 向量）
  tiltRateDeg: number;    // 腰旋转速度（躯干角速）
  comZ: number; comX: number; comY: number;   // CoM 世界坐标
  comVz: number;
  footZ: number; footY: number;               // 支撑脚位置（位置直读）
  // 源2·天平（接触力）
  fzW: number;            // 支撑脚载重（%W）
  copZ: number; copX: number;
  // 源3·力链（由 1×2 推导）
  chain: Array<{ name: string; d: number; tau: number }>;   // 直率表（垂距/力矩档）
  // 目标谓词
  footGrounded: boolean;  // 脚真着地
  waistReversed: boolean; // 腰真反转（倾速与倒向反号 或 已止）
  balanced: boolean;      // 身体真平衡（MoS≥2cm 或 CoM 在承重域）
  // 原始引用
  mosMin: number;
}

const SEGS: ReadonlyArray<[string, string]> = [
  ['foot_r', '足'], ['shin_r', '胫'], ['thigh_r', '腿'], ['torso', '盆'],
  ['spine2', '腰'], ['spine3', '腰+'], ['spine4', '胸'], ['head', '头'],
];

/** 统一观测器：三源融合 → 唯一身体状态（只读，每帧调用） */
export function observe(ctx: ServoRefs, side: 'l' | 'r'): UnifiedState {
  const W = ctx.body.sk.massTotal * 9.81;
  const s = ctx.sensors;
  const fi = side === 'l' ? 0 : 1;
  const f = s.feet[fi]!;
  const tilt = (s.torsoTilt[1] ?? 0) * 57.3;
  const tiltRate = (s.torsoAngVel?.[1] ?? 0) * 57.3;
  const com = [s.com[0]!, s.com[1]!, s.com[2]!];
  const comVz = s.comVel[2] ?? 0;

  // 源3·力链直率（CoM 重力线到各节中心的水平距 → 力矩臂档）
  const chain: Array<{ name: string; d: number; tau: number }> = [];
  for (const [k, nm] of SEGS) {
    const ix = ctx.body.indexByKey.get(k);
    if (ix === undefined) continue;
    const p = ctx.body.bodies[ix]!.translation();
    const d = Math.hypot(p.x - com[0]!, p.z - com[2]!);
    chain.push({ name: nm, d, tau: W * d });
  }

  // 天平（MoS）
  const bs = (ctx.bal as unknown as { lastFut?: { mosZ?: number } }).lastFut;
  const mosMin = typeof bs?.mosZ === 'number' ? bs.mosZ : 1;

  // 目标谓词
  const footGrounded = f.fz >= 0.6 * W && f.copValid;
  const reversed = Math.abs(tiltRate) <= 3 || Math.sign(tiltRate) !== Math.sign(comVz) || Math.abs(comVz) < 0.02;
  const inFoot = Math.abs(com[2]! - f.z) < 0.045;
  const balanced = mosMin >= 0.02 || inFoot;

  return {
    tiltDeg: tilt, tiltRateDeg: tiltRate,
    comZ: com[2]!, comX: com[0]!, comY: com[1]!, comVz,
    footZ: f.z, footY: f.y,
    fzW: f.fz / W * 100, copZ: f.copZ, copX: f.copX,
    chain,
    footGrounded, waistReversed: reversed, balanced,
    mosMin,
  };
}
