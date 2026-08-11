// ============================================================
// MapData —— 地图数据层（纯数据，无依赖）
// ============================================================
// 3D 地形版：heightmap 高度场（当前平地全 0，架构支持起伏）。
// 未来扩展：障碍表 / spawnPoints / fogMask。
// 可序列化（fogMask 存 Session，其余由 seed 重建）。

export interface MapData {
  /** 正方形地图边长（世界单位） */
  size: number;
  /** 每日地图种子（确定性生成） */
  seed: number;
  /** 主题标识（决定生成参数与视觉资产） */
  theme: string;
  /** ★ 高度场：size×size，值 = 地形高度 y（当前平地全 0） */
  heightmap: Float32Array;
  // 未来：grid: Uint8Array;       // 通行矩阵 0=可行 1=障碍
  //       obstacles: ...;         // 障碍物表
  //       spawnPoints: ...;       // 布点表（敌人/资源/事件）
  //       fogMask: Uint8Array;    // 迷雾掩码（Session 存）
}
