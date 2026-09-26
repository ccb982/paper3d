// ============================================================
// UnitTactics —— 掩体校验真源（队长/驻守/保护共用）
// ============================================================
// 收敛 2026-09-25：旧"兵种战术表 / 驻守站位 / 绕掩体采样 / 任务集"
//   整组属旧锚点时代，随锚点层一并删除（玩法改走"取目标函数→长/短寻路"，
//   见《RTS架构.md》§2.10b）；本文件只保留**掩体 LOS 真源** hasCoverFrom。
// ============================================================

import { coverBlocksLine } from '../../entity/CoverEntity';

/** 地形遮蔽查询（TerrainScore 结构满足；null = 无地形层，只查实体掩体） */
export interface TerrainCover {
  blockedAt(x: number, z: number): boolean;
  isTrenchAt(x: number, z: number): boolean;
  wallNearAt(x: number, z: number): boolean;
}

/** ★ 掩体校验真源：威胁 → 点的视线是否真被遮挡。
 *  = 实体掩体 LOS（coverBlocksLine：墙/掩体 slab 相交，含敌我）
 *  || 地形（端点身处战壕/贴硬墙 + 中线 ~3m 步进撞硬边界） */
export function hasCoverFrom(
  tx: number, tz: number, x: number, z: number, blocker?: TerrainCover | null,
): boolean {
  if (coverBlocksLine(tx, tz, x, z)) return true;
  if (!blocker) return false;
  if (blocker.isTrenchAt(x, z) || blocker.wallNearAt(x, z)) return true;
  const dx = x - tx, dz = z - tz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) return false;
  const steps = Math.min(16, Math.max(2, Math.ceil(len / 3)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (blocker.blockedAt(tx + dx * t, tz + dz * t)) return true;
  }
  return false;
}
