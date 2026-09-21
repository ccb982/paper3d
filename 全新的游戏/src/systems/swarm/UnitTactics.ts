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
export type Mission = 'build' | 'guard' | 'assault' | 'flank' | 'hold' | 'kite' | 'rear' | 'patrol';

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
  defense:   ['guard', 'assault', 'patrol'],        // 共用：护卫/突进/巡逻
  assault:   ['guard', 'assault', 'flank', 'patrol'],
  ranged:    ['hold', 'kite', 'patrol'],            // 远程专用打法
  logistics: ['rear', 'patrol'],                    // 后勤不能施工（canBuild 与 role 解耦）
  flyer:     ['assault'],                           // 空中突进
  mixed:     ['guard', 'assault', 'patrol'],
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
  patrol: { fire: 'free',         speedMul: 0.9 },
};

/** ★ 引擎大任务（**粘性**：只在落点/态势切换时重派；细节由队长动态调） */
export function engineMissionFor(
  type: SquadType,
  opts: { isBuilder: boolean; stage: string; posture: string },
): Mission {
  if (opts.isBuilder) {
    if (opts.stage === 'S1') return 'build';   // 施工（独有）：掩体+战壕；总攻期战壕仅暂停开挖
    return 'guard';                            // S2：护栏（总攻时引擎把保护对象配为射手 → 掩护射手）
  }
  if (opts.stage === 'S1') {
    if (type === 'logistics') return 'rear';   // 后勤缩后（不护工）
    return 'guard';                            // ★ 施工期全员护工：锚=工程队（近战贴身、远程守望）
  }
  if (opts.posture === 'assault') {
    if (canTake(type, 'assault')) return 'assault';
    return canTake(type, 'kite') ? 'kite' : 'rear';
  }
  // ★ 游弋期（守成）：近战转巡逻（保护位滑动 + 接触规则；远程仍驻守、后勤仍后置）
  if (opts.posture === 'patrol' && isMelee(type) && canTake(type, 'patrol')) return 'patrol';
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
  /** 护卫距离（米；站到"保护对象→威胁"连线上，距保护对象 dist 米） */
  guardDist: number;
  /** 接敌距离（米；玩家/威胁进入后才允许脱离保护位反击） */
  engageDist: number;
  /** ★ 追敌缰绳（米；反击目标最多离保护锚这么远 → "撤退了不去追"） */
  leash: number;
  /** ★ 巡逻半径（米；无威胁时在保护位左右游弋的幅度） */
  patrolR: number;
  /** 施工属性独有：是否允许施工 */
  canBuild: boolean;
}

export const UNIT_TACTICS: Record<SquadType, UnitTacticParams> = {
  defense:  { guardDist: 6,  engageDist: 10, leash: 10, patrolR: 6, canBuild: false },
  assault:  { guardDist: 9,  engageDist: 14, leash: 14, patrolR: 8, canBuild: false },
  ranged:   { guardDist: 12, engageDist: 45, leash: 8,  patrolR: 6, canBuild: false },
  logistics:{ guardDist: 8,  engageDist: 6,  leash: 6,  patrolR: 4, canBuild: false },
  flyer:    { guardDist: 0,  engageDist: 0,  leash: 0,  patrolR: 0, canBuild: false },
  mixed:    { guardDist: 8,  engageDist: 12, leash: 12, patrolR: 6, canBuild: false },
};

/** ★ 保护状态下的行动手段（各小队不同；工兵 = 造工事，由 builders 覆写） */
export type ProtectAction = 'build' | 'block' | 'intercept' | 'ward' | 'rear' | 'none';

export const PROTECT_ACTION: Record<SquadType, ProtectAction> = {
  defense:   'block',       // 盾：卡位挡线
  assault:   'intercept',   // 突击：拦截反击
  ranged:    'ward',        // 远程：原地守望/火力掩护
  logistics: 'rear',        // 后勤：缩后
  flyer:     'none',
  mixed:     'intercept',
};

/** 保护动作解析：施工兵种优先 = 造工事（《工兵架构.md》§8） */
export function protectActionFor(type: SquadType, isBuilder: boolean): ProtectAction {
  return isBuilder ? 'build' : PROTECT_ACTION[type];
}

/** ★ 掩体背威胁侧站位距离（米；驻守掩体：站到掩体后侧，让掩体挡住威胁方向） */
export const COVER_STAND = 1.7;

/** ★ 共用原语：掩体背威胁站位（掩体中心沿"远离威胁"方向 COVER_STAND 米） */
export function coverStandPoint(
  coverX: number, coverZ: number, threatX: number, threatZ: number,
): { x: number; z: number } {
  const dx = coverX - threatX, dz = coverZ - threatZ;
  const dl = Math.hypot(dx, dz) || 1;
  return { x: coverX + (dx / dl) * COVER_STAND, z: coverZ + (dz / dl) * COVER_STAND };
}

/** ★ 共用原语：护卫点（工地与威胁之间，距工地 dist 米，朝玩家一侧） */
export function guardPoint(
  siteX: number, siteZ: number, threatX: number, threatZ: number, dist: number,
): { x: number; z: number } {
  const dx = threatX - siteX, dz = threatZ - siteZ;
  const dl = Math.hypot(dx, dz) || 1;
  return { x: siteX + (dx / dl) * dist, z: siteZ + (dz / dl) * dist };
}
