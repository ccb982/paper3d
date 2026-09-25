// ============================================================
// squad/Decompose —— 队令 → 成员指令（默认矩阵；自 SquadTactics 归位）
// ============================================================
// 纯映射：命令 + 角色桶 + 使命/ROE → UnitDirective（kind/fire/speedMul/target）。
// 执行归属：由 `squad/SquadCore.drive` 调用（队长层）；SquadTactics 不再做分解。
// ============================================================

import type {
  DirectiveKind, DirectiveRoleBucket, MobTactics, SquadOrderKind, UnitDirective,
} from '../../../entity/SwarmUnit';
import type { Squad } from '../SquadTable';
import { DIRECTIVE_TTL, MEMBER_FALLBACK_HP, type SquadOrderState } from './State';

/** ★ 任务执行参数（唯一真源；自 UnitTactics 归位——队长层直接用） */
export const MISSION_EXEC: Record<string, { fire: 'hold' | 'fireOnArrival' | 'free'; speedMul: number }> = {
  build:  { fire: 'hold',         speedMul: 1.05 },
  guard:  { fire: 'free',         speedMul: 0.9 },
  assault:{ fire: 'free',         speedMul: 1.0 },
  flank:  { fire: 'free',         speedMul: 1.0 },
  hold:   { fire: 'free',         speedMul: 0.85 },
  kite:   { fire: 'free',         speedMul: 1.0 },
  rear:   { fire: 'fireOnArrival',speedMul: 0.9 },
  patrol: { fire: 'free',         speedMul: 0.9 },
};

/** 默认分解矩阵（队长未分配时的兜底） */
export const DEFAULT_DIRECTIVE: Record<SquadOrderKind, Record<DirectiveRoleBucket, DirectiveKind>> = {
  advance: { melee: 'push', ranged: 'suppress', shield: 'push', logistics: 'regroup' },
  retreat: { melee: 'boundBack', ranged: 'boundBack', shield: 'screen', logistics: 'fallback' },
  protect: { melee: 'intercept', ranged: 'guardWard', shield: 'block', logistics: 'guardWard' },
  garrison:{ melee: 'intercept', ranged: 'guardWard', shield: 'block', logistics: 'guardWard' },
  flank: { melee: 'strike', ranged: 'pin', shield: 'strike', logistics: 'fallback' },
  bound: { melee: 'bound', ranged: 'cover', shield: 'bound', logistics: 'cover' },
  focus: { melee: 'push', ranged: 'focusFire', shield: 'push', logistics: 'focusFire' },
  regroup: { melee: 'regroup', ranged: 'regroup', shield: 'regroup', logistics: 'regroup' },
};

/** 队内通用战术：低血（≤30%）行为 */
export interface UnitDoctrine {
  lowHp: 'fallback' | 'fight';
}

export const GENERIC_UNIT_DOCTRINE: UnitDoctrine = { lowHp: 'fallback' };

/** 兵种角色覆盖（缺省继承通用） */
export const UNIT_DOCTRINE: Record<DirectiveRoleBucket, Partial<UnitDoctrine>> = {
  melee: {},
  ranged: {},
  /** 盾卫：死守不退 */
  shield: { lowHp: 'fight' },
  logistics: {},
};

export function resolveUnitDoctrine(bucket: DirectiveRoleBucket, suicide: boolean, mob?: MobTactics | null): UnitDoctrine {
  const d: UnitDoctrine = { ...GENERIC_UNIT_DOCTRINE, ...(UNIT_DOCTRINE[bucket] ?? {}) };
  const u = mob?.unit;
  if (u?.lowHp !== undefined) d.lowHp = u.lowHp;
  if (suicide) d.lowHp = 'fight';
  return d;
}

/** 分解：命令 + 成员角色桶 → 个体指令（默认矩阵；稳定输出）。
 *  `target` = 队长锚点（由驱动端口解析；本函数不依赖地形/寻路模块）。 */
export function decompose(
  squad: Squad, state: SquadOrderState | null, bucket: DirectiveRoleBucket,
  now: number, memberHpRatio: number, nextSeq: () => number,
  target: { x: number; z: number } | null,
  mob?: MobTactics | null,
): UnitDirective {
  // 队质心（fireOnArrival 距离判定用）
  let cx = 0, cz = 0, n = 0;
  for (const m of squad.members.values()) { cx += m.x; cz += m.z; n++; }
  if (n > 0) { cx /= n; cz /= n; }
  const urgeMul = 1 + Math.min(0.5, Math.max(0, state?.order.urgency ?? 0) * 0.3);
  // 个体残血 → fallback 撤出（盾/自爆不吃）
  const ud = resolveUnitDoctrine(bucket, squad.suicide, mob);
  if (ud.lowHp === 'fallback' && memberHpRatio <= MEMBER_FALLBACK_HP && state?.order.kind !== 'retreat') {
    const dir: UnitDirective = {
      kind: 'fallback', until: now + DIRECTIVE_TTL, fire: 'hold',
      speedMul: 1.2 * urgeMul, seq: nextSeq(),
    };
    if (target) { dir.targetX = target.x; dir.targetZ = target.z; }
    return dir;
  }
  const kind: DirectiveKind = state ? DEFAULT_DIRECTIVE[state.order.kind][bucket] : 'regroup';
  const roe = state?.order.roe;
  let fire: 'free' | 'hold' | 'moving' =
    kind === 'sneak' || kind === 'fallback' ? 'hold' : 'free';
  const exec = state?.order.mission
    ? MISSION_EXEC[state.order.mission] : undefined;
  let speedMul = (kind === 'fallback' ? 1.2 : kind === 'boundBack' || kind === 'screen' ? 0.7 : 1) * urgeMul;
  if (exec) {
    if (exec.fire === 'hold') fire = 'hold';
    speedMul *= exec.speedMul;
  }
  if (roe === 'holdFire') fire = 'hold';
  else if (roe === 'fireOnArrival' && target) {
    const dist = Math.hypot(target.x - cx, target.z - cz);
    if (dist > 12) fire = 'hold';
  }
  const dir: UnitDirective = { kind, until: now + DIRECTIVE_TTL, fire, speedMul, seq: nextSeq() };
  if (target) { dir.targetX = target.x; dir.targetZ = target.z; }
  return dir;
}
