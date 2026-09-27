// ============================================================
// spawn/MobPick —— 兵种选取（用户定 2026-09-27）
// ============================================================
// 修"一大堆原石虫/很多兵种没生成"：创建口不再 `find(role)` 只取第一个，
// 而是**按名册权重**在同 role 的**全部非精英/非 singleton**兵种里轮询；
// 近战按 ROSTER_TARGET 的 shield:assault 比例混合（确定性计数，不用随机）。
// 纯函数 → 可独立自检。
// ============================================================

export interface PickableDef {
  role?: string;
  elite?: boolean;
  squadMode?: string;
  weight?: number;
}

/** 黄金比步进：确定性、均匀铺开权重轮询（无随机） */
const GOLDEN = 0.6180339887;

/** 选取一个兵种：精英 → 取精英；否则同 role 非精英/非 singleton 按权重轮询 */
export function pickDef<T extends PickableDef>(
  defs: readonly T[],
  role: string,
  elite: boolean,
  acc: { [k: string]: number },
): T | undefined {
  if (elite) return defs.find((m) => m.elite === true);
  const pool = defs.filter((m) => m.role === role && m.elite !== true && m.squadMode !== 'singleton');
  if (pool.length === 0) return defs.find((m) => m.role === role) ?? defs[0];
  let total = 0;
  for (const m of pool) total += Math.max(0.01, m.weight ?? 1);
  acc[role] = ((acc[role] ?? GOLDEN) + GOLDEN) % 1;
  let t = acc[role]! * total;
  for (const m of pool) {
    t -= Math.max(0.01, m.weight ?? 1);
    if (t <= 0) return m;
  }
  return pool[pool.length - 1];
}

/** 近战混合：按盾占比（0~1）**均匀交错**轮询（黄金步进；无随机）→ 'shield' | 'assault'
 *  例：占比 0.37 → 每 100 只恰好 37 盾，且从第一只起就交替出现（不再前 36 只连出盾）。 */
export function meleeRole(acc: { mix: number }, shieldShare: number): 'shield' | 'assault' {
  const pct = Math.round(Math.max(0, Math.min(1, shieldShare)) * 100);
  acc.mix = ((acc.mix ?? 0) + 37) % 100;
  return acc.mix < pct ? 'shield' : 'assault';
}
