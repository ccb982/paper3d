// ============================================================
// UnitTactics —— 兵种战术归属（独有 / 共用）与共用战术原语
// ============================================================
// 目的：把"哪些兵种共用哪套战术、哪些是兵种独有"集中成一张表——
//   · 施工（build）  = **独有**：只有施工属性小队（工程/兼任）进入施工状态；
//   · 保护（guard）  = **共用**：所有近战兵（盾/突击/混编）在施工期护卫工地；
//   · 突进（assault）= 近战共用；风筝/驻守（kite/hold）= 远程共用；后置（rear）= 后勤独有。
// 引擎（Decide/Commander）与队长只读这张表 + 原语，不再各自写 if(type===...)。
// ============================================================

import type { SquadType } from '../../entity/SwarmUnit';

/** 战术归属分类（共用面） */
export type RoleKind = 'melee' | 'ranged' | 'support' | 'air' | 'mixed';

/** ★ 任务种类（引擎布置任务用；队长再把任务拆成成员级） */
export type Mission = 'build' | 'guard' | 'assault' | 'flank' | 'hold' | 'kite' | 'rear';

export const TYPE_KIND: Record<SquadType, RoleKind> = {
  defense: 'melee',    // 盾
  assault: 'melee',    // 突击
  ranged: 'ranged',
  logistics: 'support',
  flyer: 'air',
  mixed: 'mixed',
};

/** ★ 每兵种**可接任务集**（引擎/队长都只从这里面挑；独有 vs 共用一眼可见） */
export const TYPE_MISSIONS: Record<SquadType, Mission[]> = {
  defense:   ['guard', 'assault'],        // 共用：护卫/突进
  assault:   ['guard', 'assault', 'flank'],
  ranged:    ['hold', 'kite'],            // 远程专用打法
  logistics: ['rear'],                    // 后勤不能施工（canBuild 与 role 解耦）
  flyer:     ['assault'],                 // 空中突进
  mixed:     ['guard', 'assault'],
};

/** 该兵种能否接该任务（引擎布置任务 / 队长拆任务共用） */
export function canTake(type: SquadType, m: Mission): boolean {
  return TYPE_MISSIONS[type].includes(m);
}

/** ★ 任务 → 队内执行参数（队长 `assignTasks` 读；引擎只写任务名） */
export interface MissionExec {
  /** 开火策略：施工禁火 / 护卫自由 / 驻守到位才打 */
  fire: 'free' | 'hold' | 'fireOnArrival';
  /** 限速乘子（施工小跑 / 护卫稳站） */
  speedMul: number;
}

export const MISSION_EXEC: Record<Mission, MissionExec> = {
  build:  { fire: 'hold',         speedMul: 1.05 },
  guard:  { fire: 'free',         speedMul: 0.9 },
  assault:{ fire: 'free',         speedMul: 1.0 },
  flank:  { fire: 'free',         speedMul: 1.0 },
  hold:   { fire: 'free',         speedMul: 0.85 },
  kite:   { fire: 'free',         speedMul: 1.0 },
  rear:   { fire: 'fireOnArrival',speedMul: 0.9 },
};

/** ★ 引擎大任务（**粘性**：只在落点/态势切换时重派；细节由队长动态调） */
export function engineMissionFor(
  type: SquadType,
  opts: { isBuilder: boolean; stage: string; posture: string },
): Mission {
  if (opts.isBuilder) {
    if (opts.stage === 'S1') return 'build';   // 施工（独有）：掩体+战壕；总攻期战壕已作废 → 只剩掩体
    return 'guard';                            // S2：护栏（总攻时 buildSite=最近远程小队 → 掩护射手）
  }
  if (opts.stage === 'S1' && canTake(type, 'guard')) return 'guard';   // 施工期：近战护卫
  if (opts.posture === 'assault') {
    if (canTake(type, 'assault')) return 'assault';
    return canTake(type, 'kite') ? 'kite' : 'rear';
  }
  if (type === 'ranged') return 'hold';
  if (type === 'logistics') return 'rear';
  if (canTake(type, 'flank')) return 'flank';
  return 'guard';
}

/** 近战（共用"保护/突进"）：盾 / 突击 / 混编 */
export function isMelee(type: SquadType): boolean {
  const k = TYPE_KIND[type];
  return k === 'melee' || k === 'mixed';
}

/** 兵种共用/独有战术参数（一处调，全队生效） */
export interface UnitTacticParams {
  /** 护卫工地距离（米；站到工地→威胁方向的外侧） */
  guardDist: number;
  /** 接敌距离（米；进入后才允许脱离护卫去追） */
  engageDist: number;
  /** 施工属性独有：是否允许施工 */
  canBuild: boolean;
}

export const UNIT_TACTICS: Record<SquadType, UnitTacticParams> = {
  defense:  { guardDist: 6,  engageDist: 10, canBuild: false },
  assault:  { guardDist: 9,  engageDist: 14, canBuild: false },
  ranged:   { guardDist: 12, engageDist: 45, canBuild: false },
  logistics:{ guardDist: 8,  engageDist: 6,  canBuild: false },
  flyer:    { guardDist: 0,  engageDist: 0,  canBuild: false },
  mixed:    { guardDist: 8,  engageDist: 12, canBuild: false },
};

/** ★ 共用原语：护卫点（工地与威胁之间，距工地 dist 米，朝玩家一侧） */
export function guardPoint(
  siteX: number, siteZ: number, threatX: number, threatZ: number, dist: number,
): { x: number; z: number } {
  const dx = threatX - siteX, dz = threatZ - siteZ;
  const dl = Math.hypot(dx, dz) || 1;
  return { x: siteX + (dx / dl) * dist, z: siteZ + (dz / dl) * dist };
}
