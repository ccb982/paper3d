/**
 * 落点策略（footfall）——"往哪落"的选择归动作层（Bauby & Kuo 2000：foot placement
 * 是侧向平衡的主机制）。单脚站立默认版：CoM 外推 + 防碰撞带；
 * 走路版将提供步幅/捕获点策略（同一接口）。
 */
export interface FootfallIn {
  comX: number; vx: number;
  comZ: number; vz: number;
  supportZ0: number;
}
export interface Footfall { x: number; z: number }

/** CoM 外推时域（s）：Winter 末段近水平 + 实测调参 */
export const FOOTFALL_HORIZON = 0.35;
/** 防碰撞带：不得越过支撑脚内侧 10cm（摆动腿不与支撑腿打架） */
export const FOOTFALL_INNER = 0.10;

export function defaultFootfall(s: FootfallIn): Footfall {
  const inner = s.supportZ0 + Math.sign(-s.supportZ0) * FOOTFALL_INNER;
  return {
    x: Math.max(-0.12, Math.min(0.20, s.comX + s.vx * FOOTFALL_HORIZON)),
    z: Math.max(inner, Math.min(s.supportZ0 + 0.30, s.comZ + s.vz * FOOTFALL_HORIZON)),
  };
}
