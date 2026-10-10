/**
 * 伺服 · 侧向律（lateralLaw）——**唯一伺服**的侧向主通道（§2.17/§2.20 收编，2026-10）。
 *
 * 用户诊断："侧向塌陷其实是**盆骨和支撑腿撑不起来**"——支撑髋轴0 此前四写手混写
 * （baseline/posture 指令/applyPosture 的 posHip/力偶），最终目标不可控（实测漂到 −0.169 内收）。
 * 本模块 = 该轴**唯一写手**（manual，高优先级）：
 *   · 骨盆水平保持：目标 = max(0, −k·del + attL)——**只许外展不许内收**（内收=骨盆塌=侧倒）；
 *   · CoM-支撑对齐：del = 支撑踝z − comZ，CoM 偏内（del 负）→ 目标外展 → 管回支撑；
 *   · 文献：ML 落脚点为主（§2.20），此为伺服侧的第二道（支撑柱）。
 * 时序归动作层（C/D/E 单支撑段调用）；写戳让 baseline/posture 自然让位。
 */
import type { ServoRefs } from './supportReg';

export const LATERAL_LAW = {
  /** CoM-对齐增益（目标 rad / m） */
  gain: 1.4,
  /** 外展上限（rad） */
  cap: 0.35,
  /** 刚度 */
  kp: 300,
  kd: 30,
};

export function lateralLaw(ctx: ServoRefs, support: 'l' | 'r'): void {
  const di = ctx.body.dofByName(`hip_${support}`, 0);
  if (di < 0) return;
  // 支撑踝的 z（锚点）与 CoM 的侧向差
  const supZ = ctx.body.dofs[di]!.anchorWorld[2]!;
  const del = Math.max(-0.2, Math.min(0.2, supZ - ctx.sensors.com[2]!));
  const tgt = Math.max(0, Math.min(LATERAL_LAW.cap, -LATERAL_LAW.gain * del));
  ctx.bal.manual.setAngle(`hip_${support}`, 0, tgt, LATERAL_LAW.kp, LATERAL_LAW.kd);
}
