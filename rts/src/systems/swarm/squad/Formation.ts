// ============================================================
// squad/Formation —— 小队阵型槽位（★ 重写 P2 归位）（编队本地坐标；《敌人管线设计.md》§3.3 轻量版）
// ============================================================
// 本地坐标：+fx 前、+fz 右（与小队前进方向对齐）。
// 同质小队 → 角色由小队类型决定：盾/突击走楔形（顶点突破），远程/后勤走横列
// （后排展开、不挡枪线）。槽位只表达几何位置；i = 成员稳定序号（按 uid 升序），
// 超出 12 席则环形复用（同质小队上限即 12，正常不会溢出）。
// ============================================================

import type { SquadType } from '../../../entity/SwarmUnit';

export interface SlotOffset { fx: number; fz: number }

/** 楔形：顶点在前中，两翼逐层外扩（间距 1.7m） */
const WEDGE: readonly SlotOffset[] = [
  { fx: 2.2, fz: 0 },
  { fx: 1.1, fz: -1.7 }, { fx: 1.1, fz: 1.7 },
  { fx: 0.0, fz: -3.4 }, { fx: 0.0, fz: 3.4 },
  { fx: -1.1, fz: -1.7 }, { fx: -1.1, fz: 1.7 },
  { fx: -2.2, fz: -5.1 }, { fx: -2.2, fz: 5.1 },
  { fx: -3.3, fz: -3.4 }, { fx: -3.3, fz: 3.4 },
  { fx: -3.3, fz: 0 },
];

/** 横列：一排展开 + 后排错位（远程/后勤站桩输出） */
const LINE: readonly SlotOffset[] = [
  { fx: 0.0, fz: -1.8 }, { fx: 0.0, fz: 0 }, { fx: 0.0, fz: 1.8 },
  { fx: -1.7, fz: -3.6 }, { fx: -1.7, fz: -1.8 }, { fx: -1.7, fz: 0 },
  { fx: -1.7, fz: 1.8 }, { fx: -1.7, fz: 3.6 },
  { fx: -3.4, fz: -2.7 }, { fx: -3.4, fz: -0.9 }, { fx: -3.4, fz: 0.9 }, { fx: -3.4, fz: 2.7 },
];

/** 小队属性 → 槽位偏移（稳定纯函数；不分配） */
export function formationOffset(type: SquadType, i: number): SlotOffset {
  if (type === 'ranged' || type === 'logistics') return LINE[i % LINE.length];
  return WEDGE[i % WEDGE.length];
}
