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
import type { Squad } from './SquadTable';
import {
  MISSION_EXEC as MISSION_EXEC_TABLE, guardPoint, UNIT_TACTICS,
  ensureCovered, standBehindCover, type TerrainCover,
} from './UnitTactics';
import { CommandLedger } from './CommandLedger';
import { resolveAnchor } from './squad/Anchor';
import { GAME_MIN } from './SwarmConfig';

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
  /** ★ 命令来源（引擎命令优先；队长只在无引擎命令时自主发令；玩家令经 OrderBus 同链） */
  source: 'engine' | 'leader' | 'player';
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
  corridor?: { x: number; z: number; climb?: boolean }[];
  /** ★ 寻路轨：最近一次求解时的质心位（位移 >12m → 从当前位置重算；"目标不变、路径常新"） */
  pathFromX?: number;
  pathFromZ?: number;
  /** ★ 阶段二：求解时的代价代次（TerrainScore.scoreStamp；掩体增删 → 代次变 → 重算一次偏好） */
  costStamp?: number;
  /** ★ 锚点滞回（用户定 2026-09-25）：上一前瞻锚点；新锚点 <6m 抖动 → 沿用旧锚（防振荡） */
  anchorX?: number;
  /** ★ 锚点的爬坡标记（用户定：锚点滞回时 climb 必须一起带——否则爬坡态永不触发） */
  anchorClimb?: boolean;
  anchorZ?: number;
}

/** 命令 TTL（默认，**游戏分钟**；大队任务更长，覆盖命令更短） */
export const ORDER_TTL_DEFAULT = 30 * GAME_MIN;
/** ★ 使命化 TTL 下限（重构总纲 P3-1；2026-09-22）：分钟级使命/驻守令寿命下限。
 *  基线观测（seed 4242）：正常 2s 决策拍下到期回落=0——"闪烁"主因是重发噪声（P3-3 节流），
 *  本下限是**断供保险**：决策拍断供/帧抖动 >3s 也不掉令，使命寿命与使命匹配。 */
export const MISSION_TTL_FLOOR = 30 * GAME_MIN;
/** 驻守型（分钟级）使命：build/guard/patrol/rear + 默认 hold（含掩体驻守/岗位） */
const LONG_LIVED_MISSIONS = new Set(['build', 'guard', 'patrol', 'rear', 'hold']);
/** 个体指令 TTL（弱权限：短 TTL；**游戏分钟**） */
export const DIRECTIVE_TTL = 6 * GAME_MIN;

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
  /** ★ 事态环形夹取（模式层注入；引擎令与队长令同门）——撤退/rear 由注入方豁免 */
  ringClamp: ((x: number, z: number) => { x: number; z: number }) | null = null;
  /** ★ 目标落水修正（模式层注入；与引擎同门） */

  /** ★ 命令台账（唯一写口 = issue()；回答"大规模操作是不是引擎下的命令"） */
  readonly ledger = new CommandLedger();
  private seq = 1;

  /**
   * 发令（引擎/测试入口）：参数校验 + 缺参降级（《实体架构.md》§5.11）。
   * 保护缺护卫对象、偷袭缺路径都不会发生——降级为可执行命令。
   */
  issue(squadId: number, order: TacticalOrder, now: number, ttl = ORDER_TTL_DEFAULT, source: 'engine' | 'leader' | 'player' = 'engine'): void {
    const o: TacticalOrder = { ...order };
    // ★ 五轴「分工」：子目标按 squadId 分派（比总目标优先）
    const sub = o.subTargets?.find((t) => t.squadId === squadId);
    if (sub) o.target = { x: sub.x, z: sub.z };
    // ★ 事态环形夹取（模式层注入；引擎令与**队长自主令**同门）：撤退/rear 豁免
    if (this.ringClamp && o.target && o.kind !== 'retreat' && o.mission !== 'rear') {
      const c = this.ringClamp(o.target.x, o.target.z);
      o.target = { x: c.x, z: c.z };
    }

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


  /** ★ 五轴「路径」：取当前应赴的路点（前方第一个 >8m 的点；都近 = 末点；带锚点滞回） */

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
    const target = state ? resolveAnchor(state, cx, cz, squad.type, now, cover) : null;
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

// ★ 队长自主发令（旧链）已删（用户定 2026-09-25）：队长只导航 + 汇报（squad/SquadCore）；
//   战斗队决策唯一来源 = 新引擎（engine/OrderWriter）。

