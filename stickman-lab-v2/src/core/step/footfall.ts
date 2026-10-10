/**
 * 落点策略（footfall）——"往哪落"的选择归动作层（Bauby & Kuo 2000：foot placement
 * 是侧向平衡的主机制）。单脚站立默认版：CoM 外推 + 防碰撞带；
 * 走路版将提供步幅/捕获点策略（同一接口）。
 */
export interface FootfallIn {
  comX: number; vx: number;
  comZ: number; vz: number;
  supportZ0: number;
  /** ★ 摆脚自然步宽位（rest z）——落点回原位，不跟着 CoM 内收（用户定调 2026-10） */
  restZ: number;
}
export interface Footfall { x: number; z: number }

/** CoM 外推时域（s）：Winter 末段近水平 + 实测调参 */
export const FOOTFALL_HORIZON = 0.35;
/** 防碰撞带：不得越过支撑脚内侧 10cm（摆动腿不与支撑腿打架） */
export const FOOTFALL_INNER = 0.10;
/** ★ 后脚优先（用户定调 2026-10）：落点后移偏置——摆动脚应落在**身后/身下**，
 *  不是前伸（前伸=落地时身体还在前冲，向后冲量最大） */
export const FOOTFALL_REAR = 0.10;
/** ★ 安全落点：外偏（用户定调：脚要往外一点，别内收）——在自然步宽基础上向外再偏 */
export const FOOTFALL_OUT = 0.04;

export function defaultFootfall(s: FootfallIn): Footfall {
  const inner = s.supportZ0 + Math.sign(-s.supportZ0) * FOOTFALL_INNER;
  // ★ z：**自然步宽为主**（rest z）+ 捕获点小修正（Bauby & Kuo 的侧向落点机制，
  //   增益取小）——不再让 z 跟着 comZ 走（那样脚落在 CoM 正下=往里收，用户定调）
  // ★ 安全落点（行动层 footfall 职责）：自然步宽 + **外偏**（别内收）+ 捕获点小修正；
  //   边界：不越支撑腿内侧（防撞）、不超外缘 0.34（防过宽不稳）。
  const out = Math.sign(s.restZ || 1) * FOOTFALL_OUT;
  const zCap = s.restZ + out + 0.35 * (s.comZ + s.vz * FOOTFALL_HORIZON - s.supportZ0);
  return {
    x: Math.max(-0.20, Math.min(0.10, s.comX + s.vx * FOOTFALL_HORIZON - FOOTFALL_REAR)),
    z: Math.max(inner, Math.min(s.supportZ0 + 0.34, zCap)),
  };
}
