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
  DirectiveKind, SquadOrderKind, TacticalOrder, UnitDirective, MobTactics,
} from '../../entity/SwarmUnit';
import { type DirectiveRoleBucket, roleBucket, squadBucket } from '../../entity/SwarmUnit';
import type { Squad, SquadType } from './SquadTable';
import { MISSION_EXEC as MISSION_EXEC_TABLE, guardPoint, UNIT_TACTICS } from './UnitTactics';

// 契约层已上移：本文件保留再导出（兼容旧引用）
export { type DirectiveRoleBucket, roleBucket, squadBucket };

/** 默认分解矩阵（队长未分配时的兜底；《实体架构.md》§5.11） */
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

/** 小队命令状态（黑板；镜像到载体的是 kind/target/until/seq） */
export interface SquadOrderState {
  squadId: number;
  order: TacticalOrder;
  issuedAt: number;
  /** 截止（秒；到期回落本地自主） */
  until: number;
  /** ★ 命令来源（引擎命令优先；队长只在无引擎命令时自主发令） */
  source: 'engine' | 'leader';
  /** ★ 五轴「时序」：生效时刻（秒；startAfter 延迟发动） */
  notBefore: number;
  /** ★ 五轴「信号」：需等信号 id（undefined = 无需） */
  signal?: number;
  // ---- ★ 小队路径缓存（SquadPath 产出；currentTargetOf 沿线滚动） ----
  /** 路径求解时的目标点（位移 > RETARGET_DIST → 重算） */
  pathGoalX: number;
  pathGoalZ: number;
  /** 最近一次求解时刻（秒；超时刷新） */
  pathAt: number;
  /** 最近一次求解失败时刻（秒；失败冷却，防每拍重试） */
  pathFailedAt: number;
}

/** 命令 TTL（默认；大队任务更长，覆盖命令更短） */
export const ORDER_TTL_DEFAULT = 30;
/** 个体指令 TTL（弱权限：短 TTL） */
export const DIRECTIVE_TTL = 6;

/** 两个目标点是否近似同点（路径缓存沿用判据） */
function sameTarget(
  a: { x: number; z: number } | undefined,
  b: { x: number; z: number } | undefined,
  r: number,
): boolean {
  if (!a || !b) return !a && !b;
  return Math.hypot(a.x - b.x, a.z - b.z) <= r;
}

/** ★ 队内保命线（个体 hpRatio）：低于此值 → 队长给该员下 `fallback`（撤出战斗） */
export const MEMBER_FALLBACK_HP = 0.3;

// ============================================================
// ★ 队内战术表（通用 + 角色/标签覆盖；《敌人管线设计.md》§3.3）
// ============================================================
/** 队内通用战术（所有兵种默认；低血后撤属于通用战术） */
export interface UnitDoctrine {
  /** 低血（≤30%）行为：fallback=撤出（通用）/ fight=继续战斗（盾、自爆） */
  lowHp: 'fallback' | 'fight';
}

export const GENERIC_UNIT_DOCTRINE: UnitDoctrine = { lowHp: 'fallback' };

/** ★ 兵种角色覆盖（缺省继承通用） */
export const UNIT_DOCTRINE: Record<DirectiveRoleBucket, Partial<UnitDoctrine>> = {
  melee: {},
  ranged: {},
  /** 盾卫：死守不退（用户定调：通用后撤不适用于盾） */
  shield: { lowHp: 'fight' },
  logistics: {},
};

/** 解析：通用 ← 角色覆盖 ← **逐兵种队内侧覆盖**；自爆标签强制 fight */
export function resolveUnitDoctrine(
  bucket: DirectiveRoleBucket, suicide: boolean, mob?: MobTactics | null,
): UnitDoctrine {
  const d: UnitDoctrine = { ...GENERIC_UNIT_DOCTRINE, ...(UNIT_DOCTRINE[bucket] ?? {}) };
  const u = mob?.unit;
  if (u?.lowHp !== undefined) d.lowHp = u.lowHp;
  if (suicide) d.lowHp = 'fight';
  return d;
}

export class SquadBlackboard {
  private orders = new Map<number, SquadOrderState>();
  /** ★ 小队间消息（引擎中转；收件队取走即消） */
  private messages: SquadMessage[] = [];
  /** ★ 五轴「信号」：已发出的信号 id（等信号的命令到点后才生效） */
  private signals = new Set<number>();

  issue(state: SquadOrderState): void {
    this.orders.set(state.squadId, state);
  }

  get(squadId: number): SquadOrderState | null {
    return this.orders.get(squadId) ?? null;
  }

  /** ★ 小队间发消息（同 kind+from+to 覆盖旧件，避免堆积） */
  send(msg: SquadMessage): void {
    if (msg.toSquadId < 0 || msg.toSquadId === msg.fromSquadId) return;
    const i = this.messages.findIndex(
      (m) => m.kind === msg.kind && m.fromSquadId === msg.fromSquadId && m.toSquadId === msg.toSquadId,
    );
    if (i >= 0) this.messages[i] = msg;
    else this.messages.push(msg);
  }

  /** ★ 发信号（五轴时序：等信号的命令到点后生效） */
  emitSignal(id: number): void {
    this.signals.add(id);
  }

  /** ★ 命令是否已到生效时刻（notBefore + signal） */
  isActive(state: SquadOrderState, now: number): boolean {
    if (now < state.notBefore) return false;
    if (state.signal !== undefined && !this.signals.has(state.signal)) return false;
    return true;
  }

  /** ★ 取走发给本队的消息（过期自动丢弃） */
  takeFor(squadId: number, now: number): SquadMessage[] {
    if (this.messages.length === 0) return [];
    const out: SquadMessage[] = [];
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.until <= now) {
        this.messages.splice(i, 1);
        continue;
      }
      if (m.toSquadId === squadId) {
        out.push(m);
        this.messages.splice(i, 1);
      }
    }
    return out;
  }

  /** 小队注销（全灭）→ 黑板同步清 */
  dropSquad(squadId: number): void {
    this.orders.delete(squadId);
    this.messages = this.messages.filter((m) => m.fromSquadId !== squadId && m.toSquadId !== squadId);
  }

  clear(): void {
    this.orders.clear();
    this.messages.length = 0;
    this.signals.clear();
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
    const o: TacticalOrder = { ...order };
    // ★ 五轴「分工」：子目标按 squadId 分派（比总目标优先）
    const sub = o.subTargets?.find((t) => t.squadId === squadId);
    if (sub) o.target = { x: sub.x, z: sub.z };
    const normalized = SquadTactics.normalize(o);
    const notBefore = now + Math.max(0, normalized.startAfter ?? 0);
    const prev = this.board.get(squadId);
    const state: SquadOrderState = {
      squadId, order: normalized, issuedAt: now, until: now + ttl, source,
      notBefore, signal: normalized.signal,
      pathGoalX: 0, pathGoalZ: 0, pathAt: 0, pathFailedAt: 0,
    };
    // ★ 同命令延续：路径缓存 / 计时随行（指挥层每 2~10s 重发，不冲掉寻路成果）
    if (prev && prev.order.kind === normalized.kind
      && sameTarget(prev.order.target, normalized.target, 12)) {
      state.pathGoalX = prev.pathGoalX;
      state.pathGoalZ = prev.pathGoalZ;
      state.pathAt = prev.pathAt;
      state.pathFailedAt = prev.pathFailedAt;
      if (!normalized.path && prev.order.path) normalized.path = prev.order.path;
    }
    this.board.issue(state);
  }

  /** ★ 五轴「路径」：取当前应赴的路点（队质心前方第一个 >4m 的点；都近 = 末点） */
  static currentTargetOf(state: SquadOrderState, cx: number, cz: number): { x: number; z: number } | null {
    const path = state.order.path;
    if (path && path.length > 0) {
      for (const p of path) {
        const d2 = (p.x - cx) * (p.x - cx) + (p.z - cz) * (p.z - cz);
        if (d2 > 16) return p;
      }
      return path[path.length - 1];
    }
    return state.order.target ?? null;
  }

  /** ★ 命令锚（含驻守掩体的**本地站位计算**）：命令提供掩体 + 玩家位置，单位自行绕掩体。
   *  非 garrison 命令 = 路径/目标原样；garrison = 掩体背玩家侧站位，
   *  若该点不被遮蔽则沿切线搜索绕掩体，确保掩体真能保护自己。 */
  static resolveAnchor(
    state: SquadOrderState, cx: number, cz: number, type?: SquadType, now = 0,
  ): { x: number; z: number } | null {
    const o = state.order;
    // ★ 保护令（队长站位）：命令只给"被保护对象 + 玩家位置" → 队长算护卫点 + 巡逻游弋
    if (o.kind === 'protect' && o.target) {
      const tx = o.threatX, tz = o.threatZ;
      if (tx === undefined || tz === undefined) return o.target;
      const p = type ? UNIT_TACTICS[type] : null;
      const g = guardPoint(o.target.x, o.target.z, tx, tz, p?.guardDist ?? 8);
      const dx = tx - o.target.x, dz = tz - o.target.z;
      const dl = Math.hypot(dx, dz) || 1;
      const ux = -dz / dl, uz = dx / dl;   // 切向（防线横向）
      const swing = Math.sin(now * 0.5 + state.squadId * 1.3) * (p?.patrolR ?? 4);
      return { x: g.x + ux * swing, z: g.z + uz * swing };
    }
    if (o.kind === 'garrison' && o.target) {
      // ★ 驻守掩体后的**战壕位**：引擎直接给站位（掩体外侧 5m）；个体只执行，不再按玩家绕掩体
      return o.target;
    }
    return SquadTactics.currentTargetOf(state, cx, cz);
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
      case 'garrison':
        if (!o.target) o.kind = 'regroup';
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
  decompose(squad: Squad, bucket: DirectiveRoleBucket, now: number, memberHpRatio = 1, mob?: MobTactics | null): UnitDirective {
    const state = this.board.get(squad.id);
    // ★ 五轴。路径：目标沿 path 滚动（队质心前方路点）
    let cx = 0, cz = 0, n = 0;
    for (const m of squad.members.values()) { cx += m.x; cz += m.z; n++; }
    if (n > 0) { cx /= n; cz /= n; }
    const target = state ? SquadTactics.resolveAnchor(state, cx, cz, squad.type, now) : null;
    // ★ 五轴「紧急度」：限速乘子（1 + urgency·0.3，上限 1.5）
    const urgeMul = 1 + Math.min(0.5, Math.max(0, state?.order.urgency ?? 0) * 0.3);
    // ★ 队长管队内（用户定调）：个体残血 → 不跟大队硬拼，自主 `fallback` 撤出（引擎不管、队长管）。
    //   ★ 通用战术；盾卫/自爆兵不吃（`UNIT_DOCTRINE` 覆盖）；队整体已在撤退档时不重复下发。
    const ud = resolveUnitDoctrine(bucket, squad.suicide, mob);
    if (ud.lowHp === 'fallback' && memberHpRatio <= MEMBER_FALLBACK_HP && state?.order.kind !== 'retreat') {
      const dir: UnitDirective = {
        kind: 'fallback',
        until: now + DIRECTIVE_TTL,
        fire: 'hold',
        speedMul: 1.2 * urgeMul,
        seq: this.seq++,
      };
      if (target) { dir.targetX = target.x; dir.targetZ = target.z; }
      return dir;
    }
    const kind: DirectiveKind = state ? DEFAULT_DIRECTIVE[state.order.kind][bucket] : 'regroup';
    // ★ 五轴 ROE → 开火策略（此前 roe 被忽略：holdFire 照打、fireOnArrival 无效）
    const roe = state?.order.roe;
    let fire: 'free' | 'hold' | 'moving' =
      kind === 'sneak' || kind === 'fallback' ? 'hold' : 'free';
    // ★ 任务表（引擎布置 → 队内执行参数）：施工禁火、护卫自由、驻守稳站（UnitTactics.MISSION_EXEC）
    const exec = state?.order.mission
      ? MISSION_EXEC_TABLE[state.order.mission as keyof typeof MISSION_EXEC_TABLE] : undefined;
    let speedMul = (kind === 'fallback' ? 1.2 : kind === 'boundBack' || kind === 'screen' ? 0.7 : 1) * urgeMul;
    if (exec) {
      if (exec.fire === 'hold') fire = 'hold';
      speedMul *= exec.speedMul;
    }
    if (roe === 'holdFire') fire = 'hold';
    else if (roe === 'fireOnArrival' && target) {
      const dist = Math.hypot(target.x - cx, target.z - cz);
      if (dist > 12) fire = 'hold';   // 到位（≤12m）才自由开火
    }
    const dir: UnitDirective = {
      kind,
      until: now + DIRECTIVE_TTL,
      fire,
      speedMul,
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


// ============================================================
// ★ 队长自主发令（9d；《实体架构.md》§5.11）
// ============================================================

/** ★ 上报（队员→队长；《实体架构.md》§5.11；当前实现 contact/underAttack/lowHp/needSupport，其余预留） */
export type SwarmReportKind = 'contact' | 'underAttack' | 'casualty' | 'lowHp' | 'blocked' | 'arrived' | 'needSupport';

/** ★ 小队间消息（队长↔队长，经引擎中转；当前实现 requestSupport/shareContact，其余预留） */
export type SquadMessageKind = 'shareContact' | 'requestSupport' | 'warn' | 'regroupWith' | 'flankCall';

export interface SquadMessage {
  kind: SquadMessageKind;
  fromSquadId: number;
  toSquadId: number;
  /** 位置（求援点 / 共享的目击点） */
  x: number;
  z: number;
  /** 截止（秒；过期丢弃） */
  until: number;
}

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
  /** 防御：稳推进（接敌略近、**死守不退**：通用低血后撤不适用） */
  defense:   { engageR: 18, press: true,  standoff: 2,  retreatHp: 0,    retreatDist: 14 },
  /** 远程：远距开火 + 保持射程环（不追脸；射程 50m+ → 站 45m 环） */
  ranged:    { engageR: 55, press: false, standoff: 45, retreatHp: 0.35, retreatDist: 22 },
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

/** ★ 队长 AI 需要的评级面（结构化最小子集；避免引入 SquadRating 全量字段） */
export type LeaderRating = {
  hpRatio: number; cx: number; cz: number;
  lastSeenX?: number; lastSeenZ?: number; lastSeenAt?: number;
};

/** ★ 队长自主发令器（1Hz）：按**小队属性**选策略（引擎命令优先，不抢）。 */
export class SquadLeaderAI {
  private accum = 0;
  /** ★ 接敌滞回（squadId → 上一拍是否已接敌）：避免在 engageR 边界来回切 → 左右摆 */
  private readonly engaged = new Map<number, boolean>();

  tick(
    dt: number,
    squads: {
      all(): IterableIterator<Squad>;
      ratingOf(id: number, now: number): LeaderRating | null;
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
      // ★ 2026-09-21：跨队决策**上收大队**——队长不再消费/响应小队间消息
      //   （求援/共享目击由 SwarmCommander.tacticalTick 裁决并改派；此处只管本队）
      // ★ 队长看队内具体状态：过半成员残血 → 全队撤（即使队均血量还行）
      let low = 0, alive = 0;
      for (const m of s.members.values()) {
        alive++;
        if (m.maxHp > 0 && m.hp / m.maxHp <= MEMBER_FALLBACK_HP) low++;
      }
      const squadBroken = alive > 0 && low * 2 >= alive;
      // ① 残血撤退（自爆档不撤；队均低血 或 过半残血）
      if (strat.retreatHp > 0 && d < 40 && (r.hpRatio <= strat.retreatHp || squadBroken)) {
        // ★ 步骤 9e：危急 → 向最近的其他小队发 `requestSupport`（引擎中转）
        this.requestSupport(s.id, r.cx, r.cz, squads, tactics, now);
        const ax = r.cx - px, az = r.cz - pz;
        const len = Math.hypot(ax, az) || 1;
        tactics.issue(s.id, {
          kind: 'retreat',
          target: { x: r.cx + (ax / len) * strat.retreatDist, z: r.cz + (az / len) * strat.retreatDist },
          seq: 0,
        }, now, LEADER_TTL, 'leader');
        continue;
      }
      // ② 接敌（★ 滞回：进入用 0.85×R、退出用 1.15×R，防边界来回切）
      const engaged = this.engaged.get(s.id) === true;
      if (d >= strat.engageR * (engaged ? 1.15 : 0.85)) { this.engaged.set(s.id, false); continue; }
      this.engaged.set(s.id, true);
      // ★ 步骤 9e：有新鲜目击 → 向最近的其他小队共享（shareContact）
      if (r.lastSeenAt !== undefined && now - r.lastSeenAt <= 3 && r.lastSeenX !== undefined && r.lastSeenZ !== undefined) {
        const near = this.nearestOther(s.id, r.cx, r.cz, squads);
        if (near >= 0) {
          tactics.board.send({
            kind: 'shareContact', fromSquadId: s.id, toSquadId: near,
            x: r.lastSeenX, z: r.lastSeenZ, until: now + 3,
          });
        }
      }
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

  /** ★ 步骤 9e：向最近的其他小队发求援（引擎中转；同 from+to 自动去重） */
  private requestSupport(
    squadId: number, cx: number, cz: number,
    squads: { all(): IterableIterator<Squad>; ratingOf(id: number, now: number): { hpRatio: number; cx: number; cz: number } | null },
    tactics: SquadTactics,
    now: number,
  ): void {
    const near = this.nearestOther(squadId, cx, cz, squads);
    if (near < 0) return;
    tactics.board.send({
      kind: 'requestSupport', fromSquadId: squadId, toSquadId: near,
      x: cx, z: cz, until: now + 4,
    });
  }

  /** 最近的其他小队 id（无 = -1） */
  private nearestOther(
    squadId: number, cx: number, cz: number,
    squads: { all(): IterableIterator<Squad>; ratingOf(id: number, now: number): { hpRatio: number; cx: number; cz: number } | null },
  ): number {
    let best = -1;
    let bestD2 = Infinity;
    for (const o of squads.all()) {
      if (o.id === squadId) continue;
      let ox = 0, oz = 0, n = 0;
      for (const m of o.members.values()) { ox += m.x; oz += m.z; n++; }
      if (n === 0) continue;
      ox /= n; oz /= n;
      const d2 = (ox - cx) * (ox - cx) + (oz - cz) * (oz - cz);
      if (d2 < bestD2) { bestD2 = d2; best = o.id; }
    }
    return best;
  }

  clear(): void {
    this.accum = 0;
  }
}
