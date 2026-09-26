// ============================================================
// squad/Abilities —— 运行模式到位口径（稳定层；《RTS架构.md》§2.10b）
// ============================================================
// ★ 原子只有两个：**长寻路 march / 短寻路 act**（距离分裂在 ensurePath 一处，C4）。
//   patrol / garrison =「取目标函数 → 移动」的行为循环驻留模式（非原子）。
// 本表只回答"到位后转什么模式"；行为目标点由各取目标函数给（patrolNext/blockCheck…）。
// 复合命令（保护/防御/…）在队长侧落到模式：保护/防御/巡逻 = 巡逻位，其余 = 驻守位。
// ============================================================

import type { CompositeKind, SquadMode } from '../engine/contracts';

export interface ModeDef {
  /** 到位后驻留的运行模式（到位即转） */
  onArrive: SquadMode;
}

/** 运行模式到位口径（稳定层；§2.10b：march/act 是原子，patrol/garrison 是行为循环驻留） */
export const MODE: Record<SquadMode, ModeDef> = {
  march: { onArrive: 'garrison' },
  act: { onArrive: 'garrison' },
  garrison: { onArrive: 'garrison' },
  patrol: { onArrive: 'patrol' },
};

/** 到位后的驻留模式（复合命令：保护/防御/巡逻 = 巡逻位，其余 = 驻守位） */
export function onArriveAtom(kind: CompositeKind | SquadMode): SquadMode {
  const a = MODE[kind as SquadMode];
  if (a) return a.onArrive;
  return kind === 'patrol' || kind === 'defend' || kind === 'protect' ? 'patrol' : 'garrison';
}
