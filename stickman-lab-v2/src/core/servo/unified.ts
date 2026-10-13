// ============================================================
// unified.ts —— 统一调控层（v1：只读观测器 + 目标谓词）
//   用户定稿（2026-10-13）：三路共驾一个大脑；三输入源（关节位置/天平/力链）；
//   目的性判据（脚真着地/腰真反转/身体真平衡）；唯一读天平者。
//   本文件 stage-1：只读——收编散落判断，输出统一身体状态+谓词；不改行为。
// ============================================================
import type { ServoRefs } from './supportReg';
import { balanceScale } from './supportReg';   // ★ §2.366 MoS 真值（防死读数）

export interface UnifiedState {
  // 源1·关节位置（运动学真值）
  tiltDeg: number;        // 躯干世界倾角（up 向量）
  tiltRelDeg: number;     // 相对初始腰姿的左右偏（°）
  pitchRelDeg: number;    // 相对初始腰姿的前后倾（°）
  worldOffM: number;      // 世界坐标偏移（m，CoM vs 初始）
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
  otherFzW: number;       // 对侧脚载重（%栩）——双脚判定用
  footGrounded: boolean;  // 脚真着地
  waistReversed: boolean; // 腰真反转（倾速与倒向反号 或 已止）
  balanced: boolean;      // 身体真平衡（MoS≥2cm 或 CoM 在承重域）
  // ★ §2.363 份额（随力链直率自适应：弯的一侧多扶）
  shareHip: number; shareTrunk: number; shareAnkle: number;
  // 原始引用
  mosMin: number;
}

/** ★ §2.362 统一模式（用户：调控器需要统一）：散落门控合一（着地/抬腿/MoS → 单一模式） */
export type UMode = 'grip' | 'lift' | 'single' | 'edge';
/** ★ §2.365 成立条件（用户：只处理上身+承重腿；只有单腿时才形成）：
 *   单腿且着地且抬腿完成 → 调控器成立；否则不存在（双支撑/过渡归动作层）。 */
export function unifiedActive(U: UnifiedState, liftDone: boolean): boolean {
  return liftDone && U.footGrounded && singleLatch;   // ★ §2.366b 对侧迟滞门（防 15% 边界抖）
}

export function modeOf(U: UnifiedState, liftDone: boolean): UMode {
  if (!U.footGrounded) return 'grip';      // 没抓地：一切行为最小化，先恢复接触
  if (!liftDone) return 'lift';            // 抬腿过渡：修正静默（不打瞬态）
  if (!U.balanced) return 'edge';          // 平衡未达：全力度（fire）
  return 'single';                          // 常态精修
}

let tiltRef: number | null = null;   // ★ §2.379 初始腰姿基准（左右偏的 0 点）
let pitchRef: number | null = null; let comX0: number | null = null; let comZ0: number | null = null;   // ★ §2.381
let fzFilt = 100; let gripLatch = true;
let otherFilt = 0; let singleLatch = false;   // ★ §2.366b 对侧门态（迟滞：抬腿过渡期不许抖）

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
  if (tiltRef === null) tiltRef = tilt;   // 首帧=初始姿态
  if (pitchRef === null) { pitchRef = (s.torsoTilt[0] ?? 0) * 57.3; comX0 = s.com[0]!; comZ0 = s.com[2]!; }
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

  // 天平（MoS）：★ §2.366 回读修正（lastFut.mosZ 死读=1.000 常量）→ 用 balanceScale 真值
  const bsQ = balanceScale(ctx, side);
  const mosMin = Math.min(
    Number.isFinite(bsQ.mosMed) ? bsQ.mosMed : 1,
    Number.isFinite(bsQ.mosLat) ? bsQ.mosLat : 1,
    Number.isFinite(bsQ.mosPredMed) ? bsQ.mosPredMed : 1,
    Number.isFinite(bsQ.mosPredLat) ? bsQ.mosPredLat : 1);

  // 目标谓词
  // ★ §2.366 着地迟滞+低通（回读：fz 5↔218 闪烁→门斩波切断修正）
  fzFilt += (f.fz / W * 100 - fzFilt) * 0.06;
  if (fzFilt < 35) gripLatch = false;        // 丢地（迟滞下限）
  else if (fzFilt > 55) gripLatch = true;    // 着地（迟滞上限）
  const otherRaw = (s.feet[side === 'l' ? 1 : 0]!.fz / W) * 100;
  otherFilt += (otherRaw - otherFilt) * 0.05;
  if (otherFilt < 8) singleLatch = true;     // 对侧彻底卸载→单腿
  else if (otherFilt > 25) singleLatch = false;
  const footGrounded = gripLatch && f.copValid;
  const reversed = Math.abs(tiltRate) <= 3 || Math.sign(tiltRate) !== Math.sign(comVz) || Math.abs(comVz) < 0.02;
  // ★ §2.366c 回读：CoM在脚内 ∨ MoS 的"或"掩住了 MoS=0.001 的危机→edge 晚 0.45s；平衡=纯 MoS
  const balanced = mosMin >= 0.02;

  // 力链弯度 → 份额：腿组（胫/腿/盆）vs 上身组（腰上/胸/头）
  const dOf = (nm: string): number => chain.find((c) => c.name === nm)?.d ?? 0;
  const dLeg = Math.max(dOf('胫'), dOf('腿'), dOf('盆'), 0.01);
  const dUp = Math.max(dOf('腰'), dOf('腰+'), dOf('胸'), dOf('头'), 0.01);
  const shareAnkle = 0.12;
  const rest = 1 - shareAnkle;
  const shareHip = rest * dLeg / (dLeg + dUp);
  const shareTrunk = rest * dUp / (dLeg + dUp);

  return {
    tiltDeg: tilt, tiltRelDeg: tilt - (tiltRef ?? 0), tiltRateDeg: tiltRate,
    pitchRelDeg: (s.torsoTilt[0] ?? 0) * 57.3 - (pitchRef ?? 0),
    worldOffM: Math.hypot(com[0]! - (comX0 ?? com[0]!), com[2]! - (comZ0 ?? com[2]!)),
    comZ: com[2]!, comX: com[0]!, comY: com[1]!, comVz,
    footZ: f.z, footY: f.y,
    fzW: f.fz / W * 100, copZ: f.copZ, copX: f.copX,
    chain,
    otherFzW: (s.feet[side === 'l' ? 1 : 0]!.fz / W) * 100,
    footGrounded, waistReversed: reversed, balanced,
    shareHip, shareTrunk, shareAnkle,
    mosMin,
  };
}
