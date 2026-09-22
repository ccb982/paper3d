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
  DirectiveKind, SquadOrderKind, TacticalOrder, UnitDirective, MobTactics, SquadIntent,
} from '../../entity/SwarmUnit';
import { type DirectiveRoleBucket, roleBucket, squadBucket } from '../../entity/SwarmUnit';
import type { Squad, SquadType } from './SquadTable';
import {
  MISSION_EXEC as MISSION_EXEC_TABLE, guardPoint, UNIT_TACTICS,
  ensureCovered, standBehindCover, type TerrainCover,
} from './UnitTactics';
import { CommandLedger } from './CommandLedger';

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

/** ★ P4 意图推导（命令三件套之一；使命名优先，其次 kind）——与 anchor 同在 issue() 落值 */
export function intentOfOrder(kind: SquadOrderKind, mission?: string): SquadIntent {
  switch (mission) {
    case 'build': return 'build';
    case 'guard': case 'hold': return 'hold';
    case 'rear': return 'withdraw';
    case 'assault': case 'flank': return 'attack';
    case 'patrol': return 'patrol';
    default: break;
  }
  switch (kind) {
    case 'advance': case 'flank': case 'focus': case 'bound': return 'attack';
    case 'retreat': return 'withdraw';
    case 'protect': case 'garrison': return 'guard';
    default: return 'regroup';
  }
}

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
  /** ★ P4 寻路轨（队长拆步令）：已完成步数 k / 预计总步数 N（仅步令携带；命令轨不写） */
  stepK?: number;
  stepN?: number;
  /** ★ 寻路轨走廊（覆盖式；ensurePath/拆步产出）——**命令对象只读，路径只覆盖不改令** */
  corridor?: { x: number; z: number }[];
  /** ★ 寻路轨：最近一次求解时的质心位（位移 >12m → 从当前位置重算；"目标不变、路径常新"） */
  pathFromX?: number;
  pathFromZ?: number;
  /** ★ 阶段二：求解时的代价代次（TerrainScore.scoreStamp；掩体增删 → 代次变 → 重算一次偏好） */
  costStamp?: number;
}

/** 命令 TTL（默认；大队任务更长，覆盖命令更短） */
export const ORDER_TTL_DEFAULT = 30;
/** ★ 使命化 TTL 下限（重构总纲 P3-1；2026-09-22）：分钟级使命/驻守令寿命下限。
 *  基线观测（seed 4242）：正常 2s 决策拍下到期回落=0——"闪烁"主因是重发噪声（P3-3 节流），
 *  本下限是**断供保险**：决策拍断供/帧抖动 >3s 也不掉令，使命寿命与使命匹配。 */
export const MISSION_TTL_FLOOR = 30;
/** 驻守型（分钟级）使命：build/guard/patrol/rear + 默认 hold（含掩体驻守/岗位） */
const LONG_LIVED_MISSIONS = new Set(['build', 'guard', 'patrol', 'rear', 'hold']);
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
  /** ★ P4 寻路轨（小队自治）：队长拆步令（覆盖式；与命令轨分开存，互不覆盖） */
  private paths = new Map<number, SquadOrderState>();
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

  /** ★ P4 寻路轨写口（队长拆步；覆盖式——旧步令被新步令覆盖） */
  issuePath(state: SquadOrderState): void {
    this.paths.set(state.squadId, state);
  }

  getPath(squadId: number): SquadOrderState | null {
    return this.paths.get(squadId) ?? null;
  }

  /** ★ 撤步令（中断/完成/大目标变更；覆盖权在小队） */
  dropPath(squadId: number): void {
    this.paths.delete(squadId);
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
    this.paths.delete(squadId);
    this.messages = this.messages.filter((m) => m.fromSquadId !== squadId && m.toSquadId !== squadId);
  }

  clear(): void {
    this.orders.clear();
    this.paths.clear();
    this.messages.length = 0;
    this.signals.clear();
  }
}

export class SquadTactics {
  readonly board = new SquadBlackboard();
  /** ★ 命令台账（唯一写口 = issue()；回答"大规模操作是不是引擎下的命令"） */
  readonly ledger = new CommandLedger();
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
    // ★ P4 命令三件套（目标锚 + 战术意图）：引擎未显式给 → 由目标/kind+mission 推导
    if (!o.anchor) {
      const base = o.target ?? (o.path && o.path.length > 0 ? o.path[o.path.length - 1] : undefined);
      if (base) o.anchor = { x: base.x, z: base.z };
    }
    if (!o.intent) o.intent = intentOfOrder(o.kind, o.mission);
    const normalized = SquadTactics.normalize(o);
    const notBefore = now + Math.max(0, normalized.startAfter ?? 0);
    const prev = this.board.get(squadId);
    // ★ 使命化 TTL（P3-1）：驻守型使命/garrison 给寿命下限；推进/队形等瞬时令仍走调用方短 TTL
    const longLived = normalized.kind === 'garrison'
      || (normalized.mission !== undefined && LONG_LIVED_MISSIONS.has(normalized.mission));
    const effTtl = longLived ? Math.max(ttl, MISSION_TTL_FLOOR) : ttl;
    // ★ P3-3 同签名保活节流（重构总纲 §2.5）：签名不变（kind/mission/roe/urgency/signal/startAfter/
    //   目标≤2m/威胁≤1m/无新路径）且寿命充足 → **只续命、不重登记**（不进台账）。
    //   治"2s 决策拍 + 1Hz 掩体重发"刷屏；玩家动 = 威胁变 = 新情报 → 照常重发（不算刷屏）。
    if (prev && prev.source === source
      && prev.order.kind === normalized.kind
      && (prev.order.mission ?? '') === (normalized.mission ?? '')
      && (prev.order.roe ?? '') === (normalized.roe ?? '')
      && (prev.order.urgency ?? 0) === (normalized.urgency ?? 0)
      && (prev.order.signal ?? -1) === (normalized.signal ?? -1)
      && (prev.order.startAfter ?? 0) === (normalized.startAfter ?? 0)
      && !normalized.path
      && sameTarget(prev.order.target, normalized.target, 2)
      && sameTarget(
        prev.order.threatX !== undefined ? { x: prev.order.threatX, z: prev.order.threatZ ?? 0 } : undefined,
        normalized.threatX !== undefined ? { x: normalized.threatX, z: normalized.threatZ ?? 0 } : undefined,
        1,
      )
      && now < prev.until - 5) {
      prev.until = now + effTtl;   // 在身续期：applyOrders 不 drop（到期-重派归零）
      return;
    }
    const state: SquadOrderState = {
      squadId, order: normalized, issuedAt: now, until: now + effTtl, source,
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
      state.corridor = prev.corridor;   // ★ 寻路轨走廊随命令延续（覆盖式；命令对象不自带细路径）
      state.pathFromX = prev.pathFromX;
      state.pathFromZ = prev.pathFromZ;
      if (!normalized.path && prev.order.path) normalized.path = prev.order.path;
    }
    this.board.issue(state);
    // ★ P4：引擎命令实质变更（kind/mission/锚位）→ 作废旧步令（寻路轨重拆；k 归零）
    if (prev && source === 'engine' && (prev.order.kind !== normalized.kind
      || (prev.order.mission ?? '') !== (normalized.mission ?? '')
      || !sameTarget(prev.order.anchor, normalized.anchor, 12))) {
      this.board.dropPath(squadId);
    }
    // ★ 命令台账：唯一写口记录（引擎 = mass；队长 = 局部协同；ttl = 生效寿命）
    this.ledger.record(now, squadId, normalized.kind, source,
      o.target?.x ?? 0, o.target?.z ?? 0, normalized.mission, effTtl);
  }

  /** ★ 五轴「路径」：取当前应赴的路点（队质心前方第一个 >4m 的点；都近 = 末点） */
  static currentTargetOf(state: SquadOrderState, cx: number, cz: number): { x: number; z: number } | null {
    const path = state.corridor ?? state.order.path;
    if (path && path.length > 0) {
      // ★ 先定位最近点（已走过的点不回头），再从其后取第一个 >8m 的前瞻点
      let near = 0, nd = Infinity;
      for (let i = 0; i < path.length; i++) {
        const d2 = (path[i].x - cx) * (path[i].x - cx) + (path[i].z - cz) * (path[i].z - cz);
        if (d2 < nd) { nd = d2; near = i; }
      }
      for (let i = near; i < path.length; i++) {
        const d2 = (path[i].x - cx) * (path[i].x - cx) + (path[i].z - cz) * (path[i].z - cz);
        if (d2 > 64) return path[i];
      }
      return path[path.length - 1];
    }
    return state.order.target ?? null;
  }

  /** ★ 命令锚（队长算具体站位）：
   *  防守（protect）= 护卫点 + 游弋 → ensureCovered 掩体复核（能躲则贴掩体侧，躲不了保持护卫位）；
   *  驻守（garrison）= target 掩体中心 → 背威胁侧站位 + LOS 复核 + 不挡绕掩体（《敌人管线设计.md》§3.2.1）；
   *  其余 = 路径/目标原样。 */
  static resolveAnchor(
    state: SquadOrderState, cx: number, cz: number, type?: SquadType, now = 0,
    cover?: TerrainCover | null,
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
      const swung = { x: g.x + ux * swing, z: g.z + uz * swing };
      // ★ 掩体校验（防守）：护卫点真被挡住才站；不挡 → 小半径找贴掩体侧；都没有 → 保持护卫位
      return ensureCovered(swung, tx, tz, cover);
    }
    if (o.kind === 'garrison' && o.target) {
      const tx = o.threatX, tz = o.threatZ;
      // ★ 驻守（队长）：target = 掩体中心（引擎只选保护对象）→ 站位由队长绕掩体自算并复核
      if (tx === undefined || tz === undefined) return o.target;
      return standBehindCover(o.target.x, o.target.z, tx, tz, cover);
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
  decompose(squad: Squad, bucket: DirectiveRoleBucket, now: number, memberHpRatio = 1, mob?: MobTactics | null, cover?: TerrainCover | null): UnitDirective {
    const state = this.board.get(squad.id);
    // ★ 五轴。路径：目标沿 path 滚动（队质心前方路点）
    let cx = 0, cz = 0, n = 0;
    for (const m of squad.members.values()) { cx += m.x; cz += m.z; n++; }
    if (n > 0) { cx /= n; cz /= n; }
    const target = state ? SquadTactics.resolveAnchor(state, cx, cz, squad.type, now, cover) : null;
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

/** ★ 队长自主发令器（1Hz）：引擎命令优先（不抢命令轨）；★ P4：引擎命令在身时走拆步（寻路轨）。 */
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
    /** ★ P4 拆步打分（L3 兵种分；commander.scoreForType 透传） */
    scoreStep?: (type: SquadType, x: number, z: number) => number,
  ): void {
    this.accum += dt;
    if (this.accum < 1) return;
    this.accum = 0;
    for (const s of squads.all()) {
      const cur = tactics.board.get(s.id);
      // 引擎命令优先：未过期的引擎命令 → 队长不抢命令轨；但按意图拆步（寻路轨）推进
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
