// ============================================================
// hullShape —— 舰船船体碰撞分段（物理刚体 / 角色推挤 / 甲板 共用唯一数据源）
// ============================================================
// 为什么分段：船体是楔形（首尾窄、中段宽），单盒会在首尾形成远超视觉的"空气墙"。
// 每段取该 z 区间内**视觉截面的最小宽/高**（保守）→ 物理体积恒 ≤ 渲染体积。
// 坐标：舰船局部（+z = 机头，原点 = 实体位置）；单位：世界米（已含 4× 模型缩放）。
// 数据来源：proceduralShip 的 loft 站位（halfW 0.95 / halfH 0.55 / 截面 0.98×4）。
// ★ 若将来换 GLB 模型，需同步更新本表（或改为从网格自动生成）。
// ============================================================

export interface HullSegment {
  /** 段中心沿机头方向的偏移（局部 z，米） */
  cz: number;
  /** 段半长（沿机头，米） */
  hz: number;
  /** 段半宽（局部 x，米） */
  hw: number;
  /** 段中心高度（相对实体位置，米） */
  cy: number;
  /** 段半高（米） */
  hy: number;
}

/** 船体分段（尾 → 首；z 区间首尾相接，无缝隙） */
export const SHIP_HULL_SEGMENTS: HullSegment[] = [
  { cz: -11.5, hz: 1.5, hw: 2.7, cy: 0.15, hy: 1.70 }, // 尾段（视觉 sx≈0.74~0.94）
  { cz: -5.6,  hz: 4.4, hw: 3.5, cy: 0.10, hy: 1.95 }, // 后段（sx≈0.94~1.0）
  { cz: 0.8,   hz: 2.0, hw: 3.2, cy: 0.10, hy: 1.85 }, // 中段（最宽，sx≈0.88~1.0）
  { cz: 4.6,   hz: 1.8, hw: 2.5, cy: 0.15, hy: 1.45 }, // 前中段（sx≈0.68~0.88）
  { cz: 7.8,   hz: 1.4, hw: 1.7, cy: 0.25, hy: 1.10 }, // 前段（sx≈0.46~0.68）
  { cz: 11.1,  hz: 1.9, hw: 0.6, cy: 0.35, hy: 0.45 }, // 首段（sx≈0.08~0.46）
];

/** 甲板站立面 = 最高分段（中段）的顶面（相对实体位置，米） */
export const SHIP_DECK_TOP = SHIP_HULL_SEGMENTS[2]!.cy + SHIP_HULL_SEGMENTS[2]!.hy;

/** 船体俯视投影内？返回命中段（局部坐标换算由调用方负责；这里给世界坐标 + 航向） */
export function hullSegmentAt(
  x: number, z: number, shipX: number, shipZ: number, heading: number,
): HullSegment | null {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const dx = x - shipX, dz = z - shipZ;
  const lz = dx * fx + dz * fz;       // 沿机头
  const lx = dx * fz - dz * fx;       // 右舷
  for (const s of SHIP_HULL_SEGMENTS) {
    if (Math.abs(lx) <= s.hw && Math.abs(lz - s.cz) <= s.hz) return s;
  }
  return null;
}
