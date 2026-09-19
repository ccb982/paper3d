// ============================================================
// SquadTable —— 小队注册表 + 队长 + 状态评级（《实体架构.md》§5.5/§5.8 步骤 5/9）
// ============================================================
// 职责：
//   · 生成时按“同质就近”分配小队（一队一兵种，上限 12；Boss 单例后续由 squadMode 接入）
//   · 队长唯一：首员即队长；队长阵亡/回收 → 本队接任（最新情报 > 血量 > 靠队心）
//   · 成员信息（hp/位置/目击）低频同步；**状态评级以血量为主要因素**
//   · 阵亡：单人只下调评分（不改事件）；**只有全灭才上报**（一次，随后注销）
// 说明：本表只做数据/选举/评级，不含战术；战术（SquadTactics）后续消费评级。
// ============================================================

import type { UnitRole } from '../../entity/SwarmUnit';

/** 小队属性（同质编队由成员角色派生；《实体架构.md》§5.11 评级字段） */
export type SquadType = 'defense' | 'assault' | 'ranged' | 'logistics' | 'flyer' | 'mixed';

/** 角色 → 小队属性（grunt 归突击；mixed 仅异常兜底） */
export function squadTypeOf(role: UnitRole): SquadType {
  switch (role) {
    case 'shield': return 'defense';
    case 'ranged': return 'ranged';
    case 'logistics': return 'logistics';
    case 'flyer': return 'flyer';
    case 'assault':
    case 'grunt':
    default: return 'assault';
  }
}

/** 小队容量上限（同质编队 4~12；《蜂群架构.md》§16.1） */
export const SQUAD_MAX = 12;
/** 就近并入半径（米）：同质小队质心超出此距离 → 新建 */
export const SQUAD_JOIN_R = 30;

/** 评级参数（2026-09-19 用户定调：评级主要与队内血量有关） */
export const RATING = {
  /** 残血线：全队血量比低于此值 → 无力再战（必须回撤；总攻期由战术层改为“靠后站”） */
  RETREAT_HP_RATIO: 0.3,
  /** 崩溃线：低于此值 → broken（基本丧失战力） */
  BROKEN_HP_RATIO: 0.12,
  /** 每次阵亡对士气的扣减 */
  CASUALTY_MORALE_PENALTY: 0.08,
} as const;

interface MemberInfo {
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  /** 最后目击玩家时间（秒；0 = 无情报；步骤 9 通信接线填值） */
  lastSeenAt: number;
}

export interface Squad {
  id: number;
  /** 大编队（当前 = 小队自身；大队合并后续做） */
  battalionId: number;
  leaderUid: number;
  type: SquadType;
  members: Map<number, MemberInfo>;
  /** 累计阵亡数（士气扣减用；单人不外报） */
  casualties: number;
}

export interface LeaderChange {
  uid: number;
  isLeader: boolean;
}

/** 小队状态评级（引擎侧信息面；《蜂群架构.md》§16.6 BattalionView） */
export interface SquadRating {
  squadId: number;
  battalionId: number;
  at: number;
  type: SquadType;
  /** 综合评级 0~1（血量为主） */
  grade: number;
  /** ★ 评级主因：全队血量比（Σhp / ΣmaxHp） */
  hpRatio: number;
  /** 战力（人数 × 血量比） */
  power: number;
  /** 士气/压力（血量比 − 阵亡扣减） */
  morale: number;
  status: 'idle' | 'contact' | 'pursuing' | 'retreating' | 'broken';
  cx: number; cz: number; heading: number;
  lastSeenX?: number; lastSeenZ?: number; lastSeenAt?: number;
  threats: number;
  /** 存活人数（0 = 已全灭 → 小队已注销，不会出现在评级表） */
  alive: number;
}

export class SquadTable {
  private squads = new Map<number, Squad>();
  private ofUid = new Map<number, number>();
  private nextId = 1;

  get size(): number { return this.squads.size; }

  get(id: number): Squad | null {
    return this.squads.get(id) ?? null;
  }

  /** 生成时分配：同质就近并入（< SQUAD_MAX），否则新建；首员即队长 */
  assign(uid: number, role: UnitRole, x: number, z: number): Squad {
    const existing = this.ofUid.get(uid);
    if (existing !== undefined) return this.squads.get(existing)!;
    const type = squadTypeOf(role);
    let best: Squad | null = null;
    let bestD2 = SQUAD_JOIN_R * SQUAD_JOIN_R;
    for (const s of this.squads.values()) {
      if (s.type !== type || s.members.size >= SQUAD_MAX) continue;
      const c = this.centroid(s);
      const d2 = (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z);
      if (d2 < bestD2) { bestD2 = d2; best = s; }
    }
    const squad = best ?? this.create(type);
    squad.members.set(uid, { hp: 0, maxHp: 0, x, z, lastSeenAt: 0 });
    this.ofUid.set(uid, squad.id);
    if (squad.leaderUid === 0) squad.leaderUid = uid;
    return squad;
  }

  /** 降格回池兜底：按快照里的原 squadId 重建归属（表丢失/跨模式时用） */
  adopt(uid: number, squadId: number, battalionId: number, role: UnitRole, x: number, z: number): Squad {
    const existing = this.ofUid.get(uid);
    if (existing !== undefined) return this.squads.get(existing)!;
    let squad = this.squads.get(squadId);
    if (!squad) {
      squad = { id: squadId, battalionId, leaderUid: 0, type: squadTypeOf(role), members: new Map(), casualties: 0 };
      this.squads.set(squadId, squad);
      if (squadId >= this.nextId) this.nextId = squadId + 1;
    }
    squad.members.set(uid, { hp: 0, maxHp: 0, x, z, lastSeenAt: 0 });
    this.ofUid.set(uid, squad.id);
    if (squad.leaderUid === 0) squad.leaderUid = uid;
    return squad;
  }

  /** 成员信息低频同步（hp/位置/目击；选举与评级用） */
  syncMember(uid: number, hp: number, maxHp: number, x: number, z: number, lastSeenAt: number): void {
    const m = this.squadOf(uid)?.members.get(uid);
    if (!m) return;
    m.hp = hp; m.maxHp = maxHp; m.x = x; m.z = z;
    if (lastSeenAt > m.lastSeenAt) m.lastSeenAt = lastSeenAt;
  }

  /** 移除成员（阵亡 killed=true / 回收 killed=false）；队长空缺 → 本队接任；
   *  返回 wiped=true 表示**全灭**（唯一需要上报的阵亡事件） */
  remove(uid: number, killed = false): { squadId: number; changes: LeaderChange[]; wiped: boolean } | null {
    const squad = this.squadOf(uid);
    if (!squad) return null;
    squad.members.delete(uid);
    this.ofUid.delete(uid);
    if (killed) squad.casualties++;   // ★ 单人阵亡：只下调评分（不改事件）
    const changes: LeaderChange[] = [];
    if (squad.members.size === 0) {
      this.squads.delete(squad.id);
      if (squad.leaderUid === uid) changes.push({ uid, isLeader: false });
      return { squadId: squad.id, changes, wiped: true };
    }
    if (squad.leaderUid === uid) {
      changes.push({ uid, isLeader: false });
      squad.leaderUid = this.electLeader(squad);
      changes.push({ uid: squad.leaderUid, isLeader: true });
    }
    return { squadId: squad.id, changes, wiped: false };
  }

  /** ★ 状态评级（血量为主；全灭的小队已注销，不会出现在这里） */
  ratingOf(squadId: number, now: number): SquadRating | null {
    const squad = this.squads.get(squadId);
    if (!squad || squad.members.size === 0) return null;
    let hp = 0, maxHp = 0;
    for (const m of squad.members.values()) { hp += m.hp; maxHp += m.maxHp; }
    const hpRatio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    const alive = squad.members.size;
    const morale = Math.max(0, Math.min(1, hpRatio - squad.casualties * RATING.CASUALTY_MORALE_PENALTY));
    const status: SquadRating['status'] =
      hpRatio <= RATING.BROKEN_HP_RATIO ? 'broken'
      : hpRatio <= RATING.RETREAT_HP_RATIO ? 'retreating'
      : 'idle';
    const c = this.centroid(squad);
    // 目击情报（全队最新）
    let lastSeenAt = 0, lsx: number | undefined, lsz: number | undefined;
    for (const m of squad.members.values()) {
      if (m.lastSeenAt > lastSeenAt) { lastSeenAt = m.lastSeenAt; lsx = m.x; lsz = m.z; }
    }
    const rating: SquadRating = {
      squadId: squad.id,
      battalionId: squad.battalionId,
      at: now,
      type: squad.type,
      grade: hpRatio * 0.7 + morale * 0.3,   // ★ 血量为主（士气同源）
      hpRatio,
      power: alive * hpRatio,
      morale,
      status,
      cx: c.x, cz: c.z, heading: 0,
      threats: 0,
      alive,
    };
    if (lastSeenAt > 0) { rating.lastSeenX = lsx; rating.lastSeenZ = lsz; rating.lastSeenAt = lastSeenAt; }
    return rating;
  }

  /** 全部小队评级（引擎侧 BattalionView 的 squads 面） */
  ratings(now: number): SquadRating[] {
    const out: SquadRating[] = [];
    for (const s of this.squads.values()) {
      const r = this.ratingOf(s.id, now);
      if (r) out.push(r);
    }
    return out;
  }

  /** 选举：最新情报 > 血量 > 靠队心（《实体架构.md》§5.5） */
  private electLeader(squad: Squad): number {
    const c = this.centroid(squad);
    let bestUid = 0;
    let bestScore = -Infinity;
    for (const [uid, m] of squad.members) {
      const hasIntel = m.lastSeenAt > 0 ? 1 : 0;
      const d2 = (m.x - c.x) * (m.x - c.x) + (m.z - c.z) * (m.z - c.z);
      const score = hasIntel * 1e6 + m.hp * 100 - d2;
      if (score > bestScore) { bestScore = score; bestUid = uid; }
    }
    return bestUid;
  }

  private centroid(squad: Squad): { x: number; z: number } {
    let x = 0, z = 0, n = 0;
    for (const m of squad.members.values()) { x += m.x; z += m.z; n++; }
    return n > 0 ? { x: x / n, z: z / n } : { x: 0, z: 0 };
  }

  private create(type: SquadType): Squad {
    const id = this.nextId++;
    const squad: Squad = { id, battalionId: id, leaderUid: 0, type, members: new Map(), casualties: 0 };
    this.squads.set(id, squad);
    return squad;
  }

  squadOf(uid: number): Squad | null {
    const id = this.ofUid.get(uid);
    return id !== undefined ? this.squads.get(id) ?? null : null;
  }

  isLeader(uid: number): boolean {
    return this.squadOf(uid)?.leaderUid === uid;
  }

  leaderUidOf(uid: number): number {
    return this.squadOf(uid)?.leaderUid ?? 0;
  }

  all(): IterableIterator<Squad> { return this.squads.values(); }

  clear(): void {
    this.squads.clear();
    this.ofUid.clear();
    this.nextId = 1;
  }
}
