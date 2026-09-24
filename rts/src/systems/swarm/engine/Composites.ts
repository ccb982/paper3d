// ============================================================
// engine/Composites.ts —— 复合命令选择（重写 P3；用户定 2026-09-24）
// ============================================================
// 事态函数 → 复合命令（复合定义见 contracts.COMPOSITES）：
//   · **到事态函数上限 → 防御**（用户定）
//   · 环内且有保护关系 → 保护
//   · 其余 → 行动（距离长=行军/短=行动由小队按距离自选）
// 纯函数 → 可独立自检。参数会持续调整（用户：后面还在进行不断的调整）。
// ============================================================

import type { CompositeKind } from './contracts';

export interface SelectCtx {
  /** 小队离环心（玩家）的距离 */
  d: number;
  /** 事态函数上限（0 = 不限制） */
  ringMax: number;
  /** 是否有保护关系（引擎 Protect 登记） */
  hasProtect: boolean;
}

export function selectComposite(ctx: SelectCtx): CompositeKind {
  if (ctx.ringMax > 0 && ctx.d >= ctx.ringMax) return 'defend';
  if (ctx.hasProtect) return 'protect';
  return 'act';
}
