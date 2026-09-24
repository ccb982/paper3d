// ============================================================
// engine/OrderValidator.ts —— 发令统一校验链（铁律 13；用户定 2026-09-24）
// ============================================================
// 所有复合命令下发前统一过三关（**一处实现、不许旁路**）：
//   ① 事态范围：目标夹进 [ringMin, ringMax]；**到上限 → 建议改防御**（用户定）
//   ② 密度：同兵种目标间距 ≥ SPREAD.MIN（太近 → 沿连线错开）
//   ③ 可达：初级寻路核验（不可达 → 调用方缩近/换点/不发）
// 纯逻辑（可达由 canReach 回调注入）→ 可独立自检。
// ============================================================

import { spreadFix, SPREAD, type SpreadPt } from './Spread';

export interface ValidateCtx {
  /** 环心（玩家位置；由 Positions 单源提供） */
  px: number;
  pz: number;
  ringMin: number;
  ringMax: number;
  /** 本队兵种（② 用） */
  role: string;
  /** 同兵种其他队当前目标（不含自己；② 用） */
  siblings: readonly SpreadPt[];
  /** 可达核验（注入；缺省跳过 ③） */
  canReach?: (x: number, z: number) => boolean;
}

export interface ValidateResult {
  x: number;
  z: number;
  /** 被夹进环（超上限或低于下限） */
  clamped: boolean;
  /** 因密度被错开 */
  spread: boolean;
  /** 可达（③） */
  reachable: boolean;
  /** 是否可发令（不可达 → false） */
  ok: boolean;
  /** 建议复合命令：到事态函数上限 → 'defend'；否则 null */
  suggest: 'defend' | null;
}

/** 统一校验链：输入目标点 → 输出可下发点（+ 夹环/错开/可达/建议） */
export function validateOrder(id: number, sx: number, sz: number, ctx: ValidateCtx): ValidateResult {
  let x = sx;
  let z = sz;
  let clamped = false;
  let suggest: ValidateResult['suggest'] = null;

  // ① 事态范围（环）
  if (ctx.ringMax > 0) {
    const dx = x - ctx.px;
    const dz = z - ctx.pz;
    const d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      const hi = ctx.ringMax;
      const lo = ctx.ringMin > 0 ? ctx.ringMin : 0;
      if (d > hi) {
        const k = hi / d;
        x = ctx.px + dx * k;
        z = ctx.pz + dz * k;
        clamped = true;
        suggest = 'defend';   // ★ 到事态函数上限 → 执行防御（用户定）
      } else if (d < lo) {
        const k = lo / d;
        x = ctx.px + dx * k;
        z = ctx.pz + dz * k;
        clamped = true;
      }
    }
  }

  // ② 密度（同兵种；切向推开，保径向距离——"前近/拉开"两体系互不干扰）
  let spread = false;
  if (ctx.siblings.length) {
    const all: SpreadPt[] = [...ctx.siblings, { id, role: ctx.role, x, z }];
    const fixed = spreadFix(all, { x: ctx.px, z: ctx.pz });
    for (const f of fixed) {
      if (f.id !== id) continue;
      if (f.moved > 1e-3) {
        x = f.x;
        z = f.z;
        spread = true;
      }
      break;
    }
  }

  // ③ 可达（注入核验）
  const reachable = ctx.canReach ? ctx.canReach(x, z) : true;
  return { x, z, clamped, spread, reachable, ok: reachable, suggest };
}

export { SPREAD };
