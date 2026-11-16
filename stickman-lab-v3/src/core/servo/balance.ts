/**
 * balance.ts —— balanceWriter（平衡写手，2026-10-19 用户：'交接，然后重构回正力'）
 *
 * 职责（唯一）：把平衡需求翻译成**肌肉的 ref 偏移**（EP 平衡点假设——平衡不发力矩，移平衡点）
 *
 * 站立/蹲姿同构（两天验证的结论）：
 *   站立: XCoM 外推（com + vel/w0——带预测）→ 误差 → ref 偏移
 *   蹲姿: 同公式（准静态时 vel≈0 自动退化为 CoM 误差）
 *
 * 范围: 髋/膝/脊柱（姿势链）；**脚不接**（只抓地——用户：'脚就钉在那'）
 * 输出: ref 偏移量（rad）——由回正力写手叠加到肌肉的 ref 上
 */
import type { Body } from '../body';

/** 释放时捕获的平衡目标（全局——静置期持续跟，释放后冻结） */
const _tgt: { x: number | null; z: number | null } = { x: null, z: null };

export interface BalanceIn {
  /** 是否静置期（目标跟随）；false=冻结（释放后） */
  settling: boolean;
  /** 状态: 蹲姿脚不接，站立全接 */
  squat: boolean;
  /** EP 增益（误差 m → ref 偏移 rad）；env SQ_EP_K */
  kEp: number;
}

/**
 * 计算某关节的 ref 偏移（rad）。返回 0 表示不参与平衡（如脚）。
 * 轴: 2=矢状（前后）, 0=侧向（左右）
 */
export function balanceRefShift(
  body: Body,
  com: Float64Array,
  comVel: Float64Array,
  jn: string,
  ax: number,
  inp: BalanceIn,
): number {
  if (jn === 'foot') return 0;   // 脚只抓地（铁律）
  if (ax !== 0 && ax !== 2) return 0;
  // 目标捕获/冻结
  if (_tgt.x === null || _tgt.z === null || inp.settling) {
    _tgt.x = com[0]!;
    _tgt.z = com[2]!;
  }
  // XCoM 外推（预测——站立的关键；蹲姿准静态自动退化）
  const h = Math.max(0.3, com[1]!);
  const w0 = Math.sqrt(9.81 / h);
  const xcomX = com[0]! + comVel[0]! / w0;
  const xcomZ = com[2]! + comVel[2]! / w0;
  const errX = xcomX - _tgt.x;
  const errZ = xcomZ - _tgt.z;
  // 误差 → ref 偏移（符号：CoM 偏前/偏侧 → ref 反向偏移=把平衡点移回）
  return ax === 2 ? -inp.kEp * errX : -inp.kEp * errZ;
}
