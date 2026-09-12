// ============================================================
// lod —— LOD 距离分级（服务层，架构 3.10）
// ============================================================
// 分级决策：xz 距离 → lodLevel（可调参，集中一处）
// 渲染遍历（renderAll）消费；未来小地图/其他系统也可用。

/** LOD 距离阈值（米）：lod0 < 30 < lod1 < 60 < lod2 < 90 ≤ lod3
 *  ★ 2026-09-12 放宽（用户定调）：卡顿主因是地形流式加载，不是实体 LOD →
 *    敌人可视/动画/影子/扭曲更新距离 60m → 90m；材质 LOD（发光带/实时太阳
 *    方向重映射）在 TerrainMaterial 从本表推导，同步外扩。 */
export const LOD_RANGES = [30, 60, 90] as const;

/** 距离 → lodLevel（0 近 / 1 中 / 2 远渐隐 / 3 消失不渲染） */
export function levelForDistance(d: number): number {
  if (d < LOD_RANGES[0]) return 0;
  if (d < LOD_RANGES[1]) return 1;
  if (d < LOD_RANGES[2]) return 2;
  return 3;
}

/** lod3 消失距离（= 最远阈值） */
export const LOD_MAX_DIST = LOD_RANGES[LOD_RANGES.length - 1];
