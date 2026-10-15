/**
 * servo/upperBase.ts —— 上身基础挡（新实装，2026-10-15 用户定调）
 *
 * 用户："我的设计是持续输出这个基础挡的参数，再根据弯曲弧度从而±参数。
 *        因为人即使是站直也是依旧有肌肉的力矩的。"
 *
 * 律（脊柱 6 轴：spine1/2/3 × 轴0/轴2，每帧）：
 *   τ = SCALE·BASE                     —— 基础挡（站直也有的力矩；来自冻结实验静载测量）
 *     + K·(θ₀ − θ)                     —— 弯曲弧度修正（回初始位置；θ₀=单腿起点标准位置）
 *     − D·θ̇                            —— 阻尼（可选，UPPER_D=0 即纯弹簧）
 *   总钳 ±UPPER_CAP。
 *
 * 通道：drive 前馈（ff）。生效条件：单腿相 && standardPose 已建立 && !upperOff()。
 * 取代已作废的 planeSag / lateralStab（调用点同址替换）。
 *
 * env：UPPER_BASE=1/0 总开关（默 1）；UPPER_K 曲率刚度（默 150）；UPPER_D 阻尼（默 15）；
 *      UPPER_CAP 总钳（默 150）；UPPER_SCALE 基础挡缩放（默 1）；UPPER_SIGN 全局符号（默 1）。
 */
import type { ServoRefs } from './supportReg';
import { standardPose, upperOff } from './rescue';

const ENV = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});
const num = (k: string, d: number): number => {
  const v = Number(ENV[k]);
  return Number.isFinite(v) ? v : d;
};

/** 基础挡（N·m；来自 `_tmp-ubstd` 冻结测量 @抬腿+0.4s 的静载，2026-10-15 对照实验标定：
 *  横向（轴0）对照观测到"一股脑向承重腿方向移动"→ 削到 4 成（−7.3/−5.2/−1.6）；
 *  矢状（轴2）保持测得值。扫参纪录见 docs/对照实验-单腿标准发力.md） */
const BASE: ReadonlyArray<readonly [string, number, number]> = [
  ['spine1', 0, -7.3], ['spine1', 2, 10.3],
  ['spine2', 0, -5.2], ['spine2', 2, 2.8],
  ['spine3', 0, -1.6], ['spine3', 2, 0.5],
];

export function upperBaseWrite(ctx: ServoRefs, dt: number): void {
  if (String(ENV.UPPER_BASE ?? '1') !== '1') return;
  if (upperOff()) return;
  if (!standardPose.ready) return;
  if (ctx.bal.drive.legReflex.side === null) return;   // 单腿相才写
  const def = num('UPPER_K', 150), defD = num('UPPER_D', 30), cap = num('UPPER_CAP', 150);
  const scale = num('UPPER_SCALE', 1), sign = num('UPPER_SIGN', 1);
  // ★ 前后/左右独立系数（用户："重心本来就不稳，所以前后左右本来就是独立的基础和调整系数"）：
  //   轴0（左右）：K0/KN0(承重侧)/KP0(摆动侧)/D0；轴2（前后）：K2/KN2/KP2/D2。
  //   KN0 默认 75 = 2026-10-15 对照实验标定冠军（见 docs/对照实验-单腿标准发力.md）。
  const K0 = num('UPPER_K0', def), K2 = num('UPPER_K2', def);
  const KN0 = num('UPPER_KN0', num('UPPER_KN', 75)), KP0 = num('UPPER_KP0', num('UPPER_KP', K0));
  const KN2 = num('UPPER_KN2', num('UPPER_KN', 75)), KP2 = num('UPPER_KP2', num('UPPER_KP', K2));
  const D0 = num('UPPER_D0', defD), D2 = num('UPPER_D2', defD);
  // dev = θ−θ₀；dev<0=往承重侧（−z）、dev>0=往摆动侧（+z）。
  // UPPER_BSIDE=基础挡只在哪一侧生效（''=两侧 | 'neg' | 'pos'）。
  const bside = String(ENV.UPPER_BSIDE ?? '');
  // ★ 对照实验用：UPPER_B="b0,b1,b2,b3,b4,b5"（spine1/0, spine1/2, spine2/0, spine2/2, spine3/0, spine3/2）
  const ovr = (ENV.UPPER_B ?? '').split(',').map(Number);
  const hasOvr = ovr.length === 6 && ovr.every((v) => Number.isFinite(v));
  for (let bi = 0; bi < BASE.length; bi++) {
    const [n, ax, b0] = BASE[bi]!;
    const di = ctx.body.dofByName(n, ax);
    if (di < 0) continue;
    const d = ctx.body.dofs[di]!;
    const k = n === 'spine1' ? 0 : n === 'spine2' ? 1 : 2;
    const th0 = ax === 0 ? standardPose.sp0L[k]! : standardPose.sp0P[k]!;
    const b = hasOvr ? ovr[bi]! : b0;
    const dev = d.angle - th0;
    const kUse = ax === 0 ? (dev >= 0 ? KP0 : KN0) : (dev >= 0 ? KP2 : KN2);
    const dUse = ax === 0 ? D0 : D2;
    const bUse = bside === '' ? b : bside === 'pos' ? (dev >= 0 ? b : 0) : (dev < 0 ? b : 0);
    let tau = sign * (scale * bUse + kUse * (th0 - d.angle) - dUse * d.vel);
    if (tau > cap) tau = cap; else if (tau < -cap) tau = -cap;
    ctx.bal.drive.setTorque(di, tau);
  }
  void dt;
}
