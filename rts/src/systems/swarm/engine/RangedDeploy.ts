// ============================================================
// engine/RangedDeploy —— 远程驻守决策（从 EngineBridge 抽出；2026-09-30）
// ============================================================
// 只算"这一步该干什么"（hold / march / 落兜底），不持有状态、不发令：
//   ① 部署位（RangedManager.rangedGarrisonSpot：高地/岗哨）→ 远则行军、近则驻守；
//   ② 退回：40m 内有"更靠舰"掩体 → 原地驻守；
//   ③ 都没有 → fallback（交给引擎唯一兜底：行军↔巡逻前进循环）。
// ============================================================

export interface RangedStepInput {
  squadId: number;
  from: { x: number; z: number };
  ship: { x: number; z: number };
  now: number;
  /** 上一拍的部署位缓存（粘性防抖；null = 无） */
  cached: { x: number; z: number; at: number } | null;
  garrisonSpot: ((id: number, x: number, z: number) => { x: number; z: number } | null) | null;
  coversNear: ((x: number, z: number, r: number) => readonly { x: number; z: number }[]) | null;
  holdR: number;
}

export interface RangedStep {
  action: 'hold' | 'march' | 'fallback';
  target?: { x: number; z: number };
  /** 缓存更新（undefined = 不动；null = 清空） */
  spot?: { x: number; z: number; at: number } | null;
}

/** 粘性窗口（秒）：部署位在窗口内不重算（防每拍扫描/抖动） */
const STICKY_S = 10;

export function rangedStep(i: RangedStepInput): RangedStep {
  let spot = i.cached && i.now - i.cached.at < STICKY_S ? i.cached : null;
  if (!spot) {
    const g = i.garrisonSpot?.(i.squadId, i.from.x, i.from.z) ?? null;
    if (g) spot = { x: g.x, z: g.z, at: i.now };
  }
  if (spot) {
    const d = Math.hypot(spot.x - i.from.x, spot.z - i.from.z);
    // ★ 到点也要**把件位当锚**发（队长核据此走进岗哨件，而不是就地起循环）
    if (d <= i.holdR) return { action: 'hold', target: { x: spot.x, z: spot.z }, spot };
    return { action: 'march', target: { x: spot.x, z: spot.z }, spot };
  }
  const covers = i.coversNear?.(i.from.x, i.from.z, 40) ?? [];
  const d0 = Math.hypot(i.from.x - i.ship.x, i.from.z - i.ship.z);
  const ahead = covers.some((c) => Math.hypot(c.x - i.ship.x, c.z - i.ship.z) < d0 - 0.5);
  return ahead ? { action: 'hold', target: { x: i.from.x, z: i.from.z }, spot: null } : { action: 'fallback', spot: null };
}
