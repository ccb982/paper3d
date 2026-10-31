// ============================================================
// Sectors —— 防区（扇区）定义单源（2026-09-30 架构收口）
// ============================================================
// 全工程只有这里定义"区数 / 角→区 / 区起中角 / 夹进区"；
// 其余模块一律引用（历史：SectorManager/SectorBuilder/BattalionManager/FortifyPlanner/
// EngineerManager/SwarmData 共 5 处各写各的 Math.atan2 ÷ 8）。
// ============================================================

/** 区数（全环均分） */
export const SECTOR_COUNT = 8;
export const TAU = Math.PI * 2;

/** 角（任意弧度）→ 区号 0..7 */
export function secOfAngle(ang: number): number {
  let a = ang % TAU;
  if (a < 0) a += TAU;
  return Math.floor((a / TAU) * SECTOR_COUNT) % SECTOR_COUNT;
}

/** 点（相对环心）→ 区号 */
export function secOfPoint(x: number, z: number, cx: number, cz: number): number {
  return secOfAngle(Math.atan2(z - cz, x - cx));
}

/** 点（相对环心）→ [0,2π) 角 */
export function angleOfPoint(x: number, z: number, cx: number, cz: number): number {
  let a = Math.atan2(z - cz, x - cx);
  if (a < 0) a += TAU;
  return a;
}

/** 区起点角 / 区中角 */
export function sectorStart(sec: number): number { return (sec / SECTOR_COUNT) * TAU; }
export function sectorMid(sec: number): number { return ((sec + 0.5) / SECTOR_COUNT) * TAU; }

/** 角夹进区楔形（±半区）；已在区内 → 原样 */
export function clampAngleToSector(ang: number, sec: number): number {
  const mid = sectorMid(sec);
  const half = TAU / (SECTOR_COUNT * 2);
  let d = ang - mid;
  d = ((d + Math.PI * 3) % TAU) - Math.PI;
  return Math.abs(d) <= half ? ang : mid + (d > 0 ? half : -half);
}
