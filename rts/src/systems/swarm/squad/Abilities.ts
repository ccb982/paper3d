// ============================================================
// squad/Abilities —— 原子能力四件套（稳定层；重写 P2）
// ============================================================
// 原子层 = 巡逻 / 驻守 / 行军 / 行动。**只增不改**：新增原子 = 加一行 + 该原子的
// 到位策略；队长核心（SquadCore）与执行侧（MarchAction）都从这里取口径。
//   · 行军：距离长 → 长寻路（走廊；nav/LongPath+Corridor）
//   · 行动：距离短 → 短跳（LOS 直线）
//   · 巡逻：到位后围绕目标游弋（loiter）
//   · 驻守：到掩体/站位后不动
// 复合命令（保护/防御/…）在队长侧落到原子：保护/防御 = 巡逻位，其余 = 驻守位。
// ============================================================

import type { AtomicKind, CompositeKind } from '../engine/contracts';

export interface AtomicDef {
  /** 到位后驻留的原子（到位即转） */
  onArrive: AtomicKind;
  /** 到位后是否游弋（围绕目标小半径摆动；站位由队长层算） */
  loiter: boolean;
  /** 距离分流档：true = 长寻路（> MARCH_DIST），false = 短跳 */
  long: boolean;
  /** 稳定层说明（文档；不参与逻辑） */
  note: string;
}

/** 四件套真源（稳定层；只增不改） */
export const ATOMIC: Record<AtomicKind, AtomicDef> = {
  march: { onArrive: 'garrison', loiter: false, long: true, note: '距离长 → 长寻路（走廊）' },
  act: { onArrive: 'garrison', loiter: false, long: false, note: '距离短 → 短跳（LOS 直线）' },
  garrison: { onArrive: 'garrison', loiter: false, long: true, note: '驻守：到站位后不动' },
  patrol: { onArrive: 'patrol', loiter: true, long: true, note: '巡逻：到位后围绕目标游弋' },
};

/** 到位后的驻留原子（复合命令走原映射：保护/防御/巡逻 = 巡逻位，其余 = 驻守位） */
export function onArriveAtom(kind: CompositeKind | AtomicKind): AtomicKind {
  const a = ATOMIC[kind as AtomicKind];
  if (a) return a.onArrive;
  return kind === 'patrol' || kind === 'defend' || kind === 'protect' ? 'patrol' : 'garrison';
}

/** 是否游弋原子（巡逻；队长层据此算站位摆动） */
export function isLoiter(kind: CompositeKind | AtomicKind): boolean {
  return ATOMIC[kind as AtomicKind]?.loiter ?? (kind === 'patrol' || kind === 'protect');
}
