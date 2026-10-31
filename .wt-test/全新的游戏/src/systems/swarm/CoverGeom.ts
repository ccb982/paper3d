// ============================================================
// CoverGeom —— 掩体几何（通用；用户定 2026-09-29）
// ============================================================
// 只做几何、不读世界：任意传入**威胁点（舰/敌人）**、**受护点（工兵/保护对象）**、**掩体点**，
// 自由做三点检测：
//   · coverPoint(threat, unit, standoff) → unit **前部（朝威胁侧）** standoff 米的落点
//   · threePoint(threat, unit, cover)    → 三点检测：掩体在受护点的**威胁侧前部** ∧ 与 威胁→受护 连线共线
//     （即：真的挡住 威胁→受护点 的弹道；反侧/侧偏/太远/越过威胁 → false）
// ============================================================

export interface Pt { x: number; z: number; }

/** 共线容差（米；掩体半宽量级） */
export const COVER_TOL = 1.8;
/** 受护点前部带（米） */
export const COVER_FRONT = { min: 0.6, max: 4.5 };

/** 玩家进到该半径（米）→ 参照/朝向换成玩家（用户定 2026-09-29） */
export const THREAT_NEAR = 20;

/** 落点：unit 前部（朝 threat）standoff 米——即 威胁↔受护 连线上的受护侧一点 */
export function coverPoint(threat: Pt, unit: Pt, standoff: number): Pt {
  const dx = unit.x - threat.x, dz = unit.z - threat.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: unit.x - (dx / d) * standoff, z: unit.z - (dz / d) * standoff };
}

/** 三点检测：掩体能否保护 unit（来自 threat 的弹道） */
export function threePoint(
  threat: Pt, unit: Pt, cover: Pt,
  opt?: { tol?: number; minFront?: number; maxFront?: number },
): boolean {
  const tol = opt?.tol ?? COVER_TOL;
  const minFront = opt?.minFront ?? COVER_FRONT.min;
  const maxFront = opt?.maxFront ?? COVER_FRONT.max;
  const dx = unit.x - threat.x, dz = unit.z - threat.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return false;
  const ux = dx / d, uz = dz / d;              // 威胁 → 受护 单位向量
  const wx = cover.x - unit.x, wz = cover.z - unit.z;
  const dist = Math.hypot(wx, wz);
  if (dist < minFront || dist > maxFront) return false;
  const front = -(wx * ux + wz * uz);          // >0 = 掩体在受护点的威胁侧（前部）
  if (front < minFront || front > d - 0.5) return false;
  return Math.abs(wx * uz - wz * ux) <= tol;   // 到 威胁→受护 连线的垂距
}
