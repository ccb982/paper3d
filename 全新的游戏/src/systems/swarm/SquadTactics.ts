// ============================================================
// SquadTactics —— 小队黑板 + 命令分解（《实体架构.md》§5.11；步骤 9b）
// ============================================================
// 职责：
//   · SquadBlackboard：每队一份命令状态（引擎/队长下发；TTL）
//   · SquadTactics：命令 + 成员角色 → 个体指令（默认分解矩阵；稳定输出）
//   · 参数校验 + 缺参降级（绝不发“无法执行”的命令）
// 说明：本层只做“命令 → 指令”的编译；指令 → 原子（概率表）在执行层（后续步骤）。
// ============================================================

import type {
  DirectiveKind, SquadOrderKind, TacticalOrder, UnitDirective,
} from '../../entity/SwarmUnit';
import { FIRE_FREE, type DirectiveRoleBucket, roleBucket, squadBucket } from '../../entity/SwarmUnit';
import type { Squad, SquadType } from './SquadTable';

// 契约层已上移：本文件保留再导出（兼容旧引用）
export { type DirectiveRoleBucket, roleBucket, squadBucket };

/** 默认分解矩阵（队长未分配时的兜底；《实体架构.md》§5.11） */
export const DEFAULT_DIRECTIVE: Record<SquadOrderKind, Record<DirectiveRoleBucket, DirectiveKind>> = {
  advance: { melee: 'push', ranged: 'suppress', shield: 'push', logistics: 'regroup' },
  retreat: { melee: 'boundBack', ranged: 'boundBack', shield: 'screen', logistics: 'fallback' },
  protect: { melee: 'intercept', ranged: 'guardWard', shield: 'block', logistics: 'guardWard' },
  flank: { melee: 'strike', ranged: 'pin', shield: 'strike', logistics: 'fallback' },
  bound: { melee: 'bound', ranged: 'cover', shield: 'bound', logistics: 'cover' },
  focus: { melee: 'push', ranged: 'focusFire', shield: 'push', logistics: 'focusFire' },
  regroup: { melee: 'regroup', ranged: 'regroup', shield: 'regroup', logistics: 'regroup' },
};

/** 小队命令状态（黑板；镜像到载体的是 kind/target/until/seq） */
export interface SquadOrderState {
  squadId: number;
  order: TacticalOrder;
  issuedAt: number;
  /** 截止（秒；到期回落本地自主） */
  until: number;
  /** ★ 命令来源（引擎命令优先；队长只在无引擎命令时自主发令） */
  source: 'engine' | 'leader';
}

/** 命令 TTL（默认；大队任务更长，覆盖命令更短） */
export const ORDER_TTL_DEFAULT = 30;
/** 个体指令 TTL（弱权限：短 TTL） */
export const DIRECTIVE_TTL = 6;

export class SquadBlackboard {
  private orders = new Map<number, SquadOrderState>();

  issue(state: SquadOrderState): void {
    this.orders.set(state.squadId, state);
  }

  get(squadId: number): SquadOrderState | null {
    return this.orders.get(squadId) ?? null;
  }

  /** 小队注销（全灭）→ 黑板同步清 */
  dropSquad(squadId: number): void {
    this.orders.delete(squadId);
  }

  clear(): void {
    this.orders.clear();
  }
}

export class SquadTactics {
  readonly board = new SquadBlackboard();
  private seq = 1;

  /**
   * 发令（引擎/测试入口）：参数校验 + 缺参降级（《实体架构.md》§5.11）。
   * 保护缺护卫对象、偷袭缺路径都不会发生——降级为可执行命令。
   */
  issue(squadId: number, order: TacticalOrder, now: number, ttl = ORDER_TTL_DEFAULT, source: 'engine' | 'leader' = 'engine'): void {
    const normalized = SquadTactics.normalize(order);
    this.board.issue({ squadId, order: normalized, issuedAt: now, until: now + ttl, source });
  }

  /** 缺参降级：绝不发无法执行的命令 */
  static normalize(order: TacticalOrder): TacticalOrder {
    const o: TacticalOrder = { ...order, seq: order.seq || 1 };
    switch (o.kind) {
      case 'protect':
        if (!o.target && !o.subTargets?.length) o.kind = 'regroup';
        break;
      case 'flank':
        if (!o.path && !o.target) o.kind = 'advance';
        break;
      case 'focus':
        if (!o.target) o.kind = 'advance';
        break;
      case 'advance':
      case 'bound':
        if (!o.target && !o.path) o.kind = 'regroup';
        break;
      case 'retreat':
        if (!o.target) o.kind = 'regroup';
        break;
      case 'regroup':
      default:
        break;
    }
    return o;
  }

  /**
   * 分解：命令 + 成员角色桶 → 个体指令（默认矩阵；稳定输出）。
   * 目标点：命令 target → 指令 target（路径滚动由后续执行层按 corridorIdx 推进）。
   */
  decompose(squad: Squad, bucket: DirectiveRoleBucket, now: number): UnitDirective {
    const state = this.board.get(squad.id);
    const kind: DirectiveKind = state ? DEFAULT_DIRECTIVE[state.order.kind][bucket] : 'regroup';
    const target = state?.order.target;
    const dir: UnitDirective = {
      kind,
      until: now + DIRECTIVE_TTL,
      fire: kind === 'sneak' ? 'hold' : kind === 'fallback' ? 'hold' : 'free',
      speedMul: kind === 'fallback' ? 1.2 : kind === 'boundBack' || kind === 'screen' ? 0.7 : 1,
      seq: this.seq++,
    };
    if (target) { dir.targetX = target.x; dir.targetZ = target.z; }
    return dir;
  }

  clear(): void {
    this.board.clear();
    this.seq = 1;
  }
}

/** 指令的“开火策略”默认值（执行层消费；避免魔法字符串） */
export const DIRECTIVE_FIRE_DEFAULT = FIRE_FREE;

// ============================================================
// ★ 队长自主发令（9d；《实体架构.md》§5.11）
// ============================================================

/** ★ 队长策略（按小队属性；2026-09-19 用户定调：不同属性不同策略） */
export interface LeaderStrategy {
  /** 接敌半径（米；队质心距玩家 → 进入策略） */
  engageR: number;
  /** 压迫式进攻（true = 直扑玩家；false = 站到射程环上保持距离） */
  press: boolean;
  /** 非压迫档的站位距离（米；玩家 → 队伍方向，保持此距） */
  standoff: number;
  /** 残血撤退阈值（hpRatio；0 = 不撤，如自爆） */
  retreatHp: number;
  /** 撤退集结距离（米；背离玩家） */
  retreatDist: number;
}

/** ★ 队长策略表（后续战术重写只改本表 / SquadLeaderAI） */
export const LEADER_STRATEGY: Record<SquadType | 'suicide', LeaderStrategy> = {
  /** 突击：直扑贴身 */
  assault:   { engageR: 22, press: true,  standoff: 0,  retreatHp: 0.30, retreatDist: 18 },
  /** 防御：稳推进（接敌略近、残血更晚撤） */
  defense:   { engageR: 18, press: true,  standoff: 2,  retreatHp: 0.22, retreatDist: 14 },
  /** 远程：远距开火 + 保持射程环（不追脸） */
  ranged:    { engageR: 28, press: false, standoff: 20, retreatHp: 0.35, retreatDist: 22 },
  /** 后勤：缩后（不接敌，保持更远站位） */
  logistics: { engageR: 18, press: false, standoff: 10, retreatHp: 0.55, retreatDist: 24 },
  /** 飞行：直扑 */
  flyer:     { engageR: 24, press: true,  standoff: 0,  retreatHp: 0.30, retreatDist: 18 },
  /** 混编：折中 */
  mixed:     { engageR: 20, press: true,  standoff: 0,  retreatHp: 0.30, retreatDist: 18 },
  /** 自爆：冲锋（不撤；冲得最积极） */
  suicide:   { engageR: 34, press: true,  standoff: 0,  retreatHp: 0,    retreatDist: 0 },
};

/** 命令 TTL（秒） */
export const LEADER_TTL = 4;

/** ★ 队长自主发令器（1Hz）：按**小队属性**选策略（引擎命令优先，不抢）。 */
export class SquadLeaderAI {
  private accum = 0;

  tick(
    dt: number,
    squads: {
      all(): IterableIterator<Squad>;
      ratingOf(id: number, now: number): { hpRatio: number; cx: number; cz: number } | null;
    },
    tactics: SquadTactics,
    px: number,
    pz: number,
    now: number,
  ): void {
    this.accum += dt;
    if (this.accum < 1) return;
    this.accum = 0;
    for (const s of squads.all()) {
      const cur = tactics.board.get(s.id);
      // 引擎命令优先：未过期的引擎命令 → 队长不抢
      if (cur && cur.source === 'engine' && now < cur.until) continue;
      const r = squads.ratingOf(s.id, now);
      if (!r) continue;
      const strat = s.suicide ? LEADER_STRATEGY.suicide : LEADER_STRATEGY[s.type];
      const d = Math.hypot(r.cx - px, r.cz - pz);
      // ① 残血撤退（自爆档不撤）
      if (strat.retreatHp > 0 && r.hpRatio <= strat.retreatHp && d < 40) {
        const ax = r.cx - px, az = r.cz - pz;
        const len = Math.hypot(ax, az) || 1;
        tactics.issue(s.id, {
          kind: 'retreat',
          target: { x: r.cx + (ax / len) * strat.retreatDist, z: r.cz + (az / len) * strat.retreatDist },
          seq: 0,
        }, now, LEADER_TTL, 'leader');
        continue;
      }
      // ② 接敌
      if (d >= strat.engageR) continue;
      if (strat.press) {
        // 压迫式：直扑玩家（突击/防御/飞行/自爆）
        tactics.issue(s.id, { kind: 'advance', target: { x: px, z: pz }, seq: 0 }, now, LEADER_TTL, 'leader');
      } else {
        // 保持距离：站到“射程环”上（玩家 → 队伍方向 × standoff）
        const ax = r.cx - px, az = r.cz - pz;
        const len = Math.hypot(ax, az) || 1;
        tactics.issue(s.id, {
          kind: 'advance',
          target: { x: px + (ax / len) * strat.standoff, z: pz + (az / len) * strat.standoff },
          seq: 0,
        }, now, LEADER_TTL, 'leader');
      }
    }
  }

  clear(): void {
    this.accum = 0;
  }
}
