// ============================================================
// SquadDoctrine —— 蜂群战术部署表（引擎侧；《敌人管线设计.md》§3.2 重置版）
// ============================================================
// 两层结构（都带**通用兜底**，属性只写差异；改战术只改表、不改逻辑）：
//   ① 通用部署 `GENERIC_DOCTRINE`：所有小队默认（低血后撤等通用战术在这里）
//   ② 小队属性部署 `SQUAD_DOCTRINE`：盾/突击/远程/后勤/飞行 覆盖差异
//   ③ 施工兵种 override：mode='build'（施工优先，与 role 解耦）
// 消费：SwarmCommander.engineeringTick（按 mode 分派目标/命令）。
// 队内层见 SquadTactics.UNIT_DOCTRINE（同结构：通用 + 角色/标签覆盖）。
// ============================================================

import type { SquadType, DeployMode, MobTactics } from '../../entity/SwarmUnit';

// 部署模式与逐兵种战术类型在契约层（entity/SwarmUnit）定义；此处再导出兼容旧引用
export type { DeployMode, MobTactics };

export interface SquadDoctrine {
  mode: DeployMode;
  /** 追击玩家（false = 守自己的位置；玩家移动敏感度低） */
  chase: boolean;
  /** 站距（米；0 = 不适用） */
  standoff: number;
  /** 优先掩体后驻守 */
  preferCover: boolean;
  /** 低血后撤阈值（0 = 不撤） */
  retreatHp: number;
  /** 施工期前出掩护距离（米；0 = 不掩护） */
  screenDist: number;
}

/** ★ 通用战术部署（所有小队默认；属性只写差异） */
export const GENERIC_DOCTRINE: SquadDoctrine = {
  mode: 'press',
  chase: true,
  standoff: 0,
  preferCover: false,
  retreatHp: 0.3,
  screenDist: 15,
};

/** ★ 小队属性部署（覆盖通用；缺省项继承通用） */
export const SQUAD_DOCTRINE: Record<SquadType, Partial<SquadDoctrine>> = {
  /** 盾：前出掩护、死守（低血不撤） */
  defense:   { mode: 'screen', chase: true, retreatHp: 0, screenDist: 15 },
  /** 突击：两翼包抄（低血撤出） */
  assault:   { mode: 'flank', chase: true, retreatHp: 0.25 },
  /** 远程：掩体/射程环驻守（不追脸） */
  ranged:    { mode: 'garrison', chase: false, standoff: 45, preferCover: true, retreatHp: 0.35 },
  /** 后勤：后方集结 */
  logistics: { mode: 'regroup', chase: false, retreatHp: 0.55 },
  /** 飞行：轰炸直扑（低血不撤） */
  flyer:     { mode: 'press', chase: true, retreatHp: 0, screenDist: 0 },
  /** 混编：通用 */
  mixed:     {},
};

/** ★ 解析：通用 ← 属性覆盖 ← **逐兵种引擎侧覆盖**；施工兵种强制 build（施工优先） */
export function resolveDoctrine(
  type: SquadType, builders: boolean, mob?: MobTactics | null,
): SquadDoctrine {
  const d: SquadDoctrine = { ...GENERIC_DOCTRINE, ...(SQUAD_DOCTRINE[type] ?? {}) };
  const e = mob?.engine;
  if (e) {
    if (e.mode !== undefined) d.mode = e.mode;
    if (e.chase !== undefined) d.chase = e.chase;
    if (e.standoff !== undefined) d.standoff = e.standoff;
    if (e.preferCover !== undefined) d.preferCover = e.preferCover;
    if (e.retreatHp !== undefined) d.retreatHp = e.retreatHp;
    if (e.screenDist !== undefined) d.screenDist = e.screenDist;
  }
  if (builders) {
    d.mode = 'build';
    d.chase = false;
    d.screenDist = 0;
  }
  return d;
}
