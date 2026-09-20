// ============================================================
// RangedTactics —— 远程兵战术（2026-09-21 用户定调重写）
// ============================================================
// 规则（与蜂群命令并行，不冲突）：
//   ① 执行命令遇敌**不追着打**：先找**制高点 / 掩体后**的有利位置；
//   ② 持续校验：距离是否安全（≥ DANGER，且能射到 ≤ 射程）、**掩体是否真的挡住子弹**；
//   ③ 校验通过 → 在该位**持续射击**；
//   ④ 玩家逼近（< DANGER）→ **边撤边打**，找下一个有利位置（kite）。
// 两位载体共用本模块（代理 think / L3 steer）。
// ============================================================

export const RANGED = {
  /** 危险距离（米；玩家进此圈 → 边撤边打） */
  DANGER: 24,
  /** 理想站位 = 射程 × 此比例（留命中余量） */
  PREFER_RATIO: 0.8,
  /** 选位搜索半径（米） */
  POST_SEARCH: 24,
  /** 换位冷却（秒；防抖） */
  REPOS_CD: 2.0,
} as const;

/** 边撤边打：撤向"以目标为圆心、理想站位为半径"的环上（沿目标→自身方向外推） */
export function kitePoint(
  tx: number, tz: number, px: number, pz: number, range: number,
): { x: number; z: number } {
  const ax = px - tx, az = pz - tz;
  const al = Math.hypot(ax, az) || 1;
  const want = range * RANGED.PREFER_RATIO;
  return { x: tx + (ax / al) * want, z: tz + (az / al) * want };
}

/** 是否需要边撤边打（玩家进入危险距离） */
export function shouldKite(dist: number, range: number): boolean {
  return dist < Math.min(RANGED.DANGER, range * 0.5);
}

/** ★ 代理侧一步到位：玩家逼近 → **边撤边打（优先撤向更远更安全的优势位置，没找到才径向后撤）**；
 *  否则 → 有利位置（制高/掩体后）；无 → null */
export function rangedMoveTarget(
  px: number, pz: number, tx: number, tz: number, dist: number, range: number,
  rangedPost?: (x: number, z: number, range: number, minDist?: number) => { x: number; z: number } | null,
): { x: number; z: number } | null {
  if (shouldKite(dist, range)) {
    // ★ 边撤边打的目的 = 换到"离玩家更远 + 有掩体/高地"的位置；次选才是径向后撤
    const post = rangedPost?.(px, pz, range, dist + 4);
    return post ?? kitePoint(tx, tz, px, pz, range);
  }
  return rangedPost ? rangedPost(px, pz, range, 0) : null;
}
