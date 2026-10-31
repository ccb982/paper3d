// ============================================================
// engine/EngineBridge —— 蜂群引擎（命令侧；用户定稿九条）：**唯一指挥源**，每拍一队一标签 + 数据载荷。
//   标签 protect/hold/patrol/march/assault（march 到点换 hold；hold/patrol/protect 持续）；
//   四源：① 玩家令 ② 总攻（舰旁可站点）③ 工兵活源（件数据）④ 唯一兜底=行军↔巡逻交替。
//   其余机制不存在；管理器只编成/补兵；开火独立（AttackQueues/TimerManager）。
// ============================================================

import type { MobRole, SquadOrder } from './contracts';
import { Positions } from './Positions';
import { SquadManager } from './SquadManager';
import { MeleeManager } from './MeleeManager';
import { RangedManager } from './RangedManager';
import { FlyerManager } from './FlyerManager';
import { EngineerManager, type EngineerPort } from './EngineerManager';
import { OrderWriter, SquadOrderStore } from './OrderWriter';
import { releaseAt } from '../PostureFn';
import { coverPoint, threePoint, THREAT_NEAR, type Pt } from '../CoverGeom';
import { Protect } from './Protect';
import { rangedStep } from './RangedDeploy';
import { AttackQueues } from './AttackQueues';
import { TimerManager } from './TimerManager';
import { EngineCore } from './EngineCore';

export interface LiveSquad {
  id: number;
  leaderUid?: number;
  role: MobRole;
  x: number;
  z: number;
  alive: number;
  /** 整队血量比（HUD/账本用；命令侧不消费） */
  hpRatio?: number;
  /** ★ 满编人数（§3.G 存活占比判据） */
  full?: number;
  /** 队长核执行状态（HUD/判官用；命令侧只读不改） */
  phase?: string;
  atom?: string;
  progress?: number;
  stillS?: number;
}

export interface LiveView {
  player(): { x: number; z: number } | null;
  ship(): { x: number; z: number } | null;
  squads(): LiveSquad[];
  /** 下发回调（实机：队长核 accept；影子模式不调） */
  emit?(squadId: number, order: SquadOrder, now: number): void;
  /** 全体敌方单位（含代理）——攻击队列/统一计时；缺省 → 不跑 */
  enemies?(): { uid: number; x: number; z: number }[];
  /** 可攻击单位（排除工兵） */
  attackables?(): { uid: number; x: number; z: number; range?: number }[];
  /** 工兵数据/落地端口（活源目标） */
  engineer?(): EngineerPort | null;
  /** 创建端口（四管理器共用） */
  creation?: () => import('./SquadCreation').CreationPort | null;
  /** 事态进度（补兵节拍变量） */
  posture?(): number;
  /** 总攻 */
  assault?(): boolean;
  /** 硬通行（总攻目标吸附用） */
  blockedAt?(x: number, z: number): boolean;
  /** ★ 附近已建掩体（账本；常驻驻守门用——有"更靠舰"的掩体才驻守，否则先随前进循环走） */
  coversNear?(x: number, z: number, r: number): readonly { x: number; z: number }[];
  /** ★ 飞行支援驻位（缺省=被支援队位） */
  flyerSpot?(squadId: number, x: number, z: number): { x: number; z: number };
  /** ★ 远程部署位（用户定 2026-09-30）：找"高地+岗哨"驻守位（可达优先；forced=近位强爬；缺省 = 未接） */
  garrisonSpot?(squadId: number, x: number, z: number): { x: number; z: number; forced: boolean } | null;
  /** 池代理位置（卡死判官在册） */
  agents?(): readonly { uid: number; x: number; z: number }[];
  /** 卡死豁免（驻守/交战…） */
  exemptOf?(uid: number): string | null;
  /** ★ §3.G：该队是否近期被击（命中窗 = squad alert 窗） */
  underAttack?(squadId: number): boolean;
  /** ★ §3.G：后撤点夹环（单源 SwarmData.clampToRing） */
  clampRing?(x: number, z: number): { x: number; z: number };
  /** ★ §0.3 防区锁：非总攻 + 队长在环带内 → 目标夹进本扇区；带外（溢出）→ 原样 */
  sectorLock?(squadId: number, x: number, z: number): { x: number; z: number };
  /** ★ 保护队放宽逃逸阈值：真跟到被保护对象旁才放宽；缺省 = 全局 STUCK.BBOX_R */
  stuckR?(uid: number): number | undefined;
  /** ★ 发令门：该目标从该队出发真的可达吗（只认可达点，不然接令后必站桩；缺省=不校验）。 */
  canReach?(squadId: number, x: number, z: number): boolean;
  /** 计时销毁/卡死回收落地 */
  retire?(uid: number, why: string): boolean;
  /** 归一当日进度 0~1 */
  t01?(): number;
  /** 兵力计划总数（账本） */
  ledgerTotal?(): number;
  /** 写兵力放行上限（账本闸门真源仍在账本） */
  setReleaseCap?(cap: number): void;
}

export class EngineBridge {
  readonly pos = new Positions();
  readonly squads = new SquadManager();
  readonly melee: MeleeManager;
  readonly ranged: RangedManager;
  readonly flyer: FlyerManager;
  readonly engineer: EngineerManager;
  readonly writer = new OrderWriter(new SquadOrderStore());
  readonly protect = new Protect();
  readonly queues = new AttackQueues();
  readonly timers: TimerManager;
  /** 开火射程（米；canFire 判定缺省） */
  fireRange = 25;
  private lastSlow = -1e9;
  /** 池代理 uid 集合（判官名册：live.enemies() 含代理 → 用 agents() 剔除） */
  private readonly poolAgentUids = new Set<number>();

  /** ★★ 唯一兜底：每队一条"行军↔巡逻交替"计划（用户定稿第 8 条） */
  private readonly plan = new Map<number, { mode: 'move' | 'patrol'; x: number; z: number; until: number }>();
  private static readonly PLAN_ADV = 30;          // 每段向舰推进距离（米）
  private static readonly PLAN_NEAR = 10;         // 距舰这么近就不再推进（就地巡逻）
  private static readonly PLAN_PATROL_S = 10;     // 每段之间的巡逻时长（秒）
  private static readonly PLAN_ROAM = 36;         // ★ 近战游荡半径（用户定 2026-09-30：到处游荡）
  private static readonly PLAN_MOVE_TIMEOUT = 25; // 单段安全超时（秒）
  private static readonly HOLD_R = 8;             // 到达判定（=队长到位口径）

  /** ★ §3.C 总攻掩护施工（用户定 2026-09-29）：工兵 → 保护对象（远程队）/ 动态建造点 / 已建点 */
  private readonly engineerWard = new Map<number, number>();
  private readonly wardSpot = new Map<number, { x: number; z: number }>();
  /** ★ 远程部署位缓存（D7；粘性 10s 防抖；总攻清空） */
  private readonly rangedSpots = new Map<number, { x: number; z: number; at: number }>();
  private readonly wardBuilt = new Map<number, { x: number; z: number }>();

  /** ★ 飞行支援：非飞行队被打 → 调最近飞行队赶来（支援点=被支援队实时位置，漂移>8m 重发；8s 归建）。 */
  private readonly flyerSupport = new Map<number, { atkId: number; x: number; z: number; hitAt: number }>();
  /** ★ §3.G 工兵保护-支援（用户定 2026-09-29；第一波之后启用） */
  private readonly protectorOf = new Map<number, number>();          // 工兵队 → 保护队
  private readonly supportOf = new Map<number, number>();            // 工兵队 → 支援队
  private readonly switchAt = new Map<number, number>();             // 换保护滞回
  private readonly protG = new Map<number, { x: number; z: number }>();  // 保护点已发位置
  private readonly woundAt = new Map<number, number>();              // 最近被打时刻
  private readonly retreatT = new Map<number, { x: number; z: number }>(); // 后撤目标缓存
  private static readonly PROTECT_SWITCH_S = 5;    // 换保护冷却（秒）
  private static readonly PROTECT_G_MOVE = 8;      // 保护点重发阈值（米）
  private static readonly RETREAT_DIST = 30;       // 后撤距离（米）
  private static readonly RETREAT_REFRESH_D = 6;   // 后撤目标漂移重算阈值（米）
  private static readonly SUPPORT_RELEASE_S = 8;   // 威胁解除后支援归建（秒）

  /** 波次/放行（决策源状态；releaseCap 仍走账本） */
  private wave1Sent = false;
  private finalSent = false;
  private lastT01 = -1;
  readonly dbg = { ticks: 0, shadow: false, ringMin: 0, ringMax: 0, issued: 0, refreshed: 0, spread: 0, last: '' };
  /** 影子模式：只算不发（仅调试用） */
  shadow = false;
  /** 直控模式：关引擎 decide/write（只执行玩家指令） */
  directMode = false;

  private readonly core: EngineCore;

  constructor(private readonly live: LiveView) {
    this.timers = new TimerManager({
      // 判官在册：只判 L3 实体（live.enemies() 含代理 → 用 agents() 剔除）
      roster: () => {
        const out: number[] = [];
        for (const e of this.live.enemies?.() ?? []) if (!this.poolAgentUids.has(e.uid)) out.push(e.uid);
        return out;
      },
      posOf: (uid) => {
        const e = (this.live.enemies?.() ?? []).find((x) => x.uid === uid);
        if (e) return { x: e.x, z: e.z };
        const a = (this.live.agents?.() ?? []).find((x) => x.uid === uid);
        return a ? { x: a.x, z: a.z } : null;
      },
      exemptOf: (uid) => this.live.exemptOf?.(uid) ?? null,
      bboxR: (uid) => this.live.stuckR?.(uid),
      onExpire: (uid, why) => {
        const hit = this.live.retire?.(uid, why) ?? false;
        this.dbg.last = `expire#${uid}:${why}${hit ? '' : '(gone)'}`;
      },
    });
    const creationOf = () => this.live.creation?.() ?? null;
    this.melee = new MeleeManager(this.squads, creationOf);
    this.ranged = new RangedManager(this.squads, creationOf);
    this.flyer = new FlyerManager(this.squads, creationOf);
    this.engineer = new EngineerManager(this.squads, () => {
      const p = this.live.engineer?.() ?? null;
      if (!p) return null;
      // ★ §3.C：给工兵管理器接上"保护对象建造点"（引擎查询；非保护态返回 null → 走原查询）
      return { ...p, wardSpot: (id: number) => this.wardSpotOf(id), wardCoverDone: (id: number, x: number, z: number) => this.wardCoverDone(id, x, z), playerOf: () => this.pos.player() };
    });
    this.core = new EngineCore({
      perceive: (now) => this.perceive(now),
      situation: (now) => this.situation(now),
      decide: (now) => this.decide(now),
      write: (now) => this.write(now),
      debug: () => this.debug(),
    });
  }

  private nowS = 0;

  tick(dt: number, now: number): void {
    this.nowS = now;
    this.core.tick(dt, now);
  }

  /** ★ 玩家命令入口：玩家 → 唯一发令器（player 旁路，无 TTL，直到被新命令覆盖） */
  playerOrder(squadId: number, kind: SquadOrder['kind'], target: { x: number; z: number }): boolean {
    const order: SquadOrder = {
      kind,
      source: 'player',
      target,
      state: EngineBridge.labelOf(kind),
      threat: this.pos.player() ?? undefined,
      seq: 0,
      ttl: 0,
    };
    const ok = this.writer.issue(squadId, order, { now: this.nowS, player: true });
    if (ok && !this.shadow) this.live.emit?.(squadId, order, this.nowS);
    return ok;
  }

  playerOrderAll(kind: SquadOrder['kind'], target: { x: number; z: number }): number {
    let n = 0;
    for (const rec of [...this.squads.all()]) if (this.playerOrder(rec.id, kind, target)) n++;
    this.dbg.last = `playerAll ${kind} →${n}队`;
    return n;
  }

  playerOrderNear(kind: SquadOrder['kind'], target: { x: number; z: number }, r: number): number {
    let n = 0;
    for (const rec of [...this.squads.all()]) {
      const p = this.pos.squad(rec.id);
      if (!p) continue;
      if (Math.hypot(p.x - target.x, p.z - target.z) <= r && this.playerOrder(rec.id, kind, target)) n++;
    }
    this.dbg.last = `playerNear ${kind} r=${r} →${n}队`;
    return n;
  }

  /** 玩家 kind → 标签（唯一映射；缺省行军） */
  private static labelOf(kind: SquadOrder['kind']): SquadOrder['state'] {
    switch (kind) {
      case 'protect': return 'protect';
      case 'defend': case 'garrison': return 'hold';
      case 'patrol': return 'patrol';
      default: return 'march';
    }
  }

  private perceive(now: number): void {
    const p = this.live.player();
    if (p) this.pos.setPlayer(p.x, p.z);
    const s = this.live.ship();
    if (s) this.pos.setShip(s.x, s.z);
    this.poolAgentUids.clear();
    for (const a of this.live.agents?.() ?? []) this.poolAgentUids.add(a.uid);
    // 阵亡清册：不在世的旧记录即删
    const liveIds = new Set<number>();
    for (const sq of this.live.squads()) liveIds.add(sq.id);
    for (const rec of [...this.squads.all()]) if (!liveIds.has(rec.id)) this.squads.remove(rec.id);
    for (const sq of this.live.squads()) {
      if (!this.squads.get(sq.id)) this.squads.register(sq.id, sq.role, sq.alive, now);
      this.pos.setSquad(sq.id, sq.x, sq.z);
      this.squads.report(
        { squadId: sq.id, x: sq.x, z: sq.z, alive: sq.alive,
          atom: (sq.atom ?? 'act') as never, phase: (sq.phase ?? 'executing') as never,
          hpRatio: sq.hpRatio, progress: sq.progress, stillS: sq.stillS },
        now,
      );
      // ★ 队长自报进度/静止 → 发令器稳定门（引擎只记录，不逐拍指挥）
      const rec = this.squads.get(sq.id);
      if (rec) this.writer.advance(sq.id, rec.progress ?? 0, rec.stillS ?? 0);
    }
    // 1Hz 慢拍：攻击队列 + 统一计时（开火子系统的数据面）
    if (now - this.lastSlow >= 1) {
      this.lastSlow = now;
      const p = this.pos.player();
      if (p) this.queues.setOwner('player', p.x, p.z);
      const sh = this.pos.ship();
      if (sh) this.queues.setOwner('ship', sh.x, sh.z);
      const attack = this.live.attackables?.() ?? this.live.enemies?.() ?? [];
      this.queues.update(attack, (uid) => this.canFire(uid, attack), this.timers);
      this.timers.tick(now);
    }
  }

  /** 开火许可查询（判官豁免：站桩射击 ≠ 发呆） */
  hasFirePermit(uid: number): boolean {
    return this.timers.canFire(uid);
  }

  /** ★ 舰旁可站点：以舰为中心 8 向 ≤40m 圆环 → 离舰最近 ∧ 本队真可达（发令门）的可站点；缓存 2s 复检。 */
  private readonly assaultSpot = new Map<number, { x: number; z: number; at: number }>();
  /** 负缓存（找不到可达点的时刻；2s 内不重扫——扫描含 BFS，防每拍重算） */
  private readonly assaultNoSpot = new Map<number, number>();

  private shipSidePoint(squadId: number, sx: number, sz: number, now: number): { x: number; z: number } | null {
    const cached = this.assaultSpot.get(squadId);
    if (cached && now - cached.at < 2 && (this.live.canReach?.(squadId, cached.x, cached.z) ?? true)) {
      return { x: cached.x, z: cached.z };
    }
    const noAt = this.assaultNoSpot.get(squadId);
    if (noAt !== undefined && now - noAt < 2) return null;
    for (let r = 2; r <= 40; r += 2) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const qx = sx + Math.cos(a) * r, qz = sz + Math.sin(a) * r;
        if (this.live.blockedAt?.(qx, qz) ?? false) continue;
        if (this.live.canReach && !this.live.canReach(squadId, qx, qz)) continue;
        this.assaultSpot.set(squadId, { x: qx, z: qz, at: now });
        this.assaultNoSpot.delete(squadId);
        return { x: qx, z: qz };
      }
    }
    this.assaultNoSpot.set(squadId, now);
    return null;   // 40m 内没有本队可达的点 → 交 ② 兜底（常规巡逻前进循环）
  }

  /** 下一段推进点：朝舰 PLAN_ADV 米（不越带缘）；可行性由队长核长/短寻路负责。 */
  /** ★ 游荡点：非保护近战到处游荡——绕舰 8 向大半径取**可达**点；未接/全不可达 → 退回朝舰推进 */
  private wanderPoint(sp: { x: number; z: number }, id: number): { x: number; z: number } | null {
    if (!this.live.canReach) return this.advancePoint(sp, id);
    const ship = this.pos.ship() ?? this.pos.player();
    const base = ship ? Math.atan2(sp.z - ship.z, sp.x - ship.x) : 0;
    const dir = id % 2 === 0 ? 1 : -1, R = EngineBridge.PLAN_ROAM;
    for (let k = 1; k <= 8; k++) {
      const a = base + dir * k * (Math.PI / 4);
      const x = sp.x + Math.cos(a) * R, z = sp.z + Math.sin(a) * R;
      if (this.live.canReach(id, x, z)) return { x, z };
    }
    return this.advancePoint(sp, id);
  }

  /** ★ 前进点（**可行性校验**）：朝舰 3 距离 × 5 角度取首个可达点；全不可达 → null（回巡逻） */
  private advancePoint(sp: { x: number; z: number }, id: number): { x: number; z: number } | null {
    const ship = this.pos.ship() ?? this.pos.player();
    if (!ship) return null;
    const front = Math.max(EngineBridge.PLAN_NEAR, this.dbg.ringMin > 0 ? this.dbg.ringMin : 0);
    const dx = ship.x - sp.x, dz = ship.z - sp.z;
    const d = Math.hypot(dx, dz);
    if (d <= front) return null;
    const step0 = Math.min(EngineBridge.PLAN_ADV, d - front);
    if (step0 <= 1) return null;
    const base = Math.atan2(dz, dx);
    const reach = (x: number, z: number): boolean => !this.live.canReach || this.live.canReach(id, x, z);
    for (const k of [1, 0.6, 0.3]) {
      for (const a of [0, 0.45, -0.45, 0.9, -0.9]) {
        const s = step0 * k;
        const x = sp.x + Math.cos(base + a) * s, z = sp.z + Math.sin(base + a) * s;
        if (reach(x, z)) return { x, z };
      }
    }
    return null;
  }

  /** 开火检验（射程；单位自身射程优先） */
  private canFire(uid: number, ents: readonly { uid: number; x: number; z: number; range?: number }[]): boolean {
    let e: { uid: number; x: number; z: number; range?: number } | null = null;
    for (const x of ents) if (x.uid === uid) { e = x; break; }
    if (!e) return false;
    const p = this.pos.player();
    const s = this.pos.ship();
    const dp = p ? Math.hypot(e.x - p.x, e.z - p.z) : Infinity;
    const ds = s ? Math.hypot(e.x - s.x, e.z - s.z) : Infinity;
    return Math.min(dp, ds) <= (e.range ?? this.fireRange);
  }

  private situation(_now: number): void {
    const p = this.pos.player();
    if (!p) return;
    if (this.live.assault?.()) this.rangedSpots.clear();   // 总攻：部署位作废（回压舰/掩体逻辑）
    this.protect.refresh(this.pos.squadOf, p.x, p.z);
    const t01 = this.live.t01?.() ?? 0;
    if (t01 < this.lastT01 - 0.2) { this.wave1Sent = false; this.finalSent = false; }
    this.lastT01 = t01;
    const total = this.live.ledgerTotal?.() ?? 0;
    const p01 = Math.max(0, Math.min(1, this.live.posture?.() ?? 0));
    this.live.setReleaseCap?.(Math.ceil(total * releaseAt(p01)));
    if (!this.wave1Sent && p01 >= 0.45) { this.wave1Sent = true; this.dbg.last = 'wave1'; }
    if (!this.finalSent && p01 >= 0.80) { this.finalSent = true; this.dbg.last = 'final'; }
  }

  /** 管理器只编成/补兵（架构第 9 条；ctx = 只读输入） */
  private decide(now: number): void {
    if (this.directMode) return;
    this.updateWards();   // §3.C：先算保护对象建造点（管理器本拍取用）
    const ctx = { pos: this.pos, now };
    this.melee.sync();
    this.ranged.sync();
    this.flyer.sync();
    this.engineer.sync();
    this.melee.assign(ctx);
    this.ranged.assign(ctx);
    this.flyer.assign(ctx);
    this.engineer.assign(ctx);
  }

  /** ★ 发令（唯一出口）：每队一个标签 + 载荷；段切换强制、稳态同签名去重（不打断执行腿）。 */
  private write(now: number): void {
    if (this.directMode) return;
    if (this.plan.size > 0) {
      const live = new Set<number>();
      for (const sq of this.live.squads()) live.add(sq.id);
      for (const id of [...this.plan.keys()]) if (!live.has(id)) this.plan.delete(id);
    }
    const ship = this.pos.ship() ?? this.pos.player();
    if (!ship) return;
    const assault = this.live.assault?.() === true;
    if (!assault && (this.assaultSpot.size > 0 || this.assaultNoSpot.size > 0)) {
      this.assaultSpot.clear(); this.assaultNoSpot.clear();   // 总攻结束 → 清目标/负缓存
    }
    const tactical = this.tacticalPlan(now);
    let issued = 0;

    for (const rec of [...this.squads.all()]) {
      const sp = this.pos.squad(rec.id);
      if (!sp) continue;
      const cur = this.writer.store.get(rec.id);

      // ① 玩家令：原样执行到被新命令覆盖；**march 短时效**（到达→引擎换标 hold）。总攻阶段无例外（被②覆盖）。
      if (!assault && cur && cur.order.source === 'player') {
        const label = cur.order.state ?? EngineBridge.labelOf(cur.order.kind);
        if (label === 'march'
          && Math.hypot(cur.order.target.x - sp.x, cur.order.target.z - sp.z) <= EngineBridge.HOLD_R) {
          if (this.send(rec.id, 'hold', { x: cur.order.target.x, z: cur.order.target.z }, now, { kind: 'defend', force: true })) issued++;
        }
        continue;
      }

      // ★ 远程兵种（用户定 2026-09-29/30）：非总攻=常驻驻守（RangedDeploy：部署位→行军/驻守；无→掩体门；再无→④）。
      if (rec.role === 'ranged' && !assault) {
        const step = rangedStep({
          squadId: rec.id, from: sp, ship, now,
          cached: this.rangedSpots.get(rec.id) ?? null,
          garrisonSpot: this.live.garrisonSpot ?? null,
          coversNear: this.live.coversNear ?? null,
          holdR: EngineBridge.HOLD_R,
        });
        if (step.spot === null) this.rangedSpots.delete(rec.id);
        else if (step.spot) this.rangedSpots.set(rec.id, step.spot);
        if (step.action === 'hold') {
          const sameH = cur && cur.order.state === 'hold' && cur.order.kind === 'defend';
          if (!sameH && this.send(rec.id, 'hold', { x: sp.x, z: sp.z }, now, { kind: 'defend', force: true })) issued++;
          continue;
        }
        if (step.action === 'march' && step.target) {
          // ★ 不可达且近位 → 强制攀爬（mission='force'；远位已在部署位选择时放弃）
          const mission = step.forced ? 'force' : undefined;
          const sameT = !!cur && cur.order.mission === mission && Math.hypot(cur.order.target.x - step.target.x, cur.order.target.z - step.target.z) <= 4;
          if (!sameT && this.send(rec.id, 'march', step.target, now, { kind: 'march', force: true, mission })) issued++;
          continue;
        }
      }
      // ② 总攻：全体到舰旁可站点（同签名去重）；工兵系豁免；远程不压舰（驻守躲掩体）。
      if (assault && !tactical.has(rec.id) && rec.role !== 'engineer') {
        // ★ 目标=**以舰为中心、从本队真的可达的最近可站点**（每队各算各的；2s 缓存复检）
        const at = this.shipSidePoint(rec.id, ship.x, ship.z, now);
        if (at) {
          // ★ 到点转驻守：近战/飞天到点后改发 hold（判官豁免；开火独立）。
          const arrived = Math.hypot(at.x - sp.x, at.z - sp.z) <= EngineBridge.HOLD_R;
          if (arrived) {
            const sameH = cur && cur.order.state === 'hold' && cur.order.kind === 'defend';
            if (!sameH) {
              if (this.send(rec.id, 'hold', { x: sp.x, z: sp.z }, now, { kind: 'defend', force: true })) issued++;
            }
            continue;
          }
          const same = cur && cur.order.state === 'assault' && cur.order.kind === 'patrol'
            && Math.hypot(cur.order.target.x - at.x, cur.order.target.z - at.z) <= 1;
          if (!same) {
            if (this.send(rec.id, 'assault', at, now, { kind: 'patrol', force: true })) issued++;
          }
          continue;
        }
        // ★ 兜底（用户定 2026-09-29）：寻路不到舰 → 常规巡逻前进循环（④：行军段↔巡逻段交替、朝舰前缘推）。
      }

      // ②.5 ★ §3.G 保护/支援/后撤（只产标签；优先于工活与兜底）
      const tac = tactical.get(rec.id);
      if (tac) {
        if (!tac.keep && this.send(rec.id, tac.state, tac.target, now, { kind: tac.kind, force: tac.force })) issued++;
        continue;
      }
      const stale = cur?.order.kind === 'protect' || cur?.order.mission === 'build';

      // ③ 工兵活源（纯数据）：有件→march 到件（施工计时独立）；无件→不发兜底（永不参与 ④）。
      if (rec.role === 'engineer') {
        const t = this.engineer.targets.get(rec.id);
        if (t) {
          const same = cur && cur.order.mission === 'build'
            && Math.hypot(cur.order.target.x - t.x, cur.order.target.z - t.z) <= 2;
          if (!same) {
            if (this.send(rec.id, 'march', { x: t.x, z: t.z }, now, { kind: 'act', mission: 'build', force: true })) issued++;
          }
        }
        continue;
      }

      // ④ 唯一兜底 = 行军 ↔ 巡逻交替（定稿第 8 条）
      if (stale) this.plan.delete(rec.id);   // 旧保护/施工令 → 重置计划，首段强制接管
      let pl = this.plan.get(rec.id);
      if (!pl) { pl = { mode: 'patrol', x: sp.x, z: sp.z, until: now }; this.plan.set(rec.id, pl); }
      if (pl.mode === 'move') {
        const reached = Math.hypot(pl.x - sp.x, pl.z - sp.z) <= EngineBridge.HOLD_R || now >= pl.until;
        if (reached) {
          // 到位 → 巡一段（锚点=当前位置）
          pl.mode = 'patrol'; pl.x = sp.x; pl.z = sp.z; pl.until = now + EngineBridge.PLAN_PATROL_S;
          if (this.send(rec.id, 'patrol', { x: pl.x, z: pl.z }, now, { kind: 'patrol', force: true })) issued++;
        } else {
          const same = cur && cur.order.state === 'march'
            && Math.hypot(cur.order.target.x - pl.x, cur.order.target.z - pl.z) <= 1;
          if (!same) {
            if (this.send(rec.id, 'march', { x: pl.x, z: pl.z }, now, { kind: 'act' })) issued++;
          }
        }
      } else {
        if (now >= pl.until) {
          // ★ 本体口径（2026-09-30 用户定）：**严格跟随事态曲线**——推进不另设硬门，
          //   节奏由"环内界锚落点 + p 驱动收缩"唯一决定（低 p 时 advancePoint 在环缘自然停住）。
          const np = rec.role === 'melee' ? this.wanderPoint(sp, rec.id) : this.advancePoint(sp, rec.id);
          if (np) {
            // 巡完 → 再推进一段
            pl.mode = 'move'; pl.x = np.x; pl.z = np.z; pl.until = now + EngineBridge.PLAN_MOVE_TIMEOUT;
            if (this.send(rec.id, 'march', { x: pl.x, z: pl.z }, now, { kind: 'act', force: true })) issued++;
          } else {
            pl.until = now + EngineBridge.PLAN_PATROL_S;   // 已到舰边 → 持续巡逻
          }
        }
        if (pl.mode === 'patrol') {
          const same = cur && cur.order.state === 'patrol'
            && Math.hypot(cur.order.target.x - pl.x, cur.order.target.z - pl.z) <= 1;
          if (!same) {
            if (this.send(rec.id, 'patrol', { x: pl.x, z: pl.z }, now, { kind: 'patrol', force: stale })) issued++;
          }
        }
      }
    }
    this.dbg.issued = issued;
    this.dbg.refreshed = 0;
  }

  /** ★ §3.C 总攻掩护施工：工兵配对最近远程（sticky）+ 产出建造点；非总攻清空。 */
  private updateWards(): void {
    const assault = this.live.assault?.() === true;
    if (!assault) {
      if (this.engineerWard.size > 0) { this.engineerWard.clear(); this.wardSpot.clear(); this.wardBuilt.clear(); }
      return;
    }
    const lv = this.live.squads();
    const byId = new Map<number, LiveSquad>();
    for (const r of lv) byId.set(r.id, r);
    for (const r of lv) {
      if (r.role !== 'engineer') continue;
      let w = this.engineerWard.get(r.id);
      if (w !== undefined && !byId.get(w)) w = undefined;
      if (w === undefined) {
        let best: number | undefined;
        let bd = Infinity;
        for (const q of lv) {
          if (q.role !== 'ranged') continue;
          const d = Math.hypot(q.x - r.x, q.z - r.z);
          if (d < bd - 1e-9 || (Math.abs(d - bd) < 1e-9 && best !== undefined && q.id < best)) { bd = d; best = q.id; }
        }
        if (best !== undefined) {
          w = best;
          this.engineerWard.set(r.id, w);
          this.wardSpot.delete(r.id);
          this.wardBuilt.delete(r.id);
        }
      }
      if (w === undefined) { this.wardSpot.delete(r.id); continue; }
      const ward = byId.get(w) as LiveSquad;
      const built = this.wardBuilt.get(r.id);
      if (built && Math.hypot(ward.x - built.x, ward.z - built.z) <= 6) { this.wardSpot.delete(r.id); continue; }
      const p = this.wardBuildPoint(r, ward);
      // ★ 同点不重建：与落成点 ≤2.5m 一律不产点（防原地刷件被回收）。
      if (p && built && Math.hypot(p.x - built.x, p.z - built.z) <= 2.5) { this.wardSpot.delete(r.id); continue; }
      if (p) this.wardSpot.set(r.id, p); else this.wardSpot.delete(r.id);
    }
  }

  /** 建造点（与舰共线）：威胁=舰（无舰退玩家）；受护=工兵/保护对象中更靠舰者；落点=受护点朝舰 1.6~3.2m 首可站点。 */
  private wardBuildPoint(eng: LiveSquad, ward: LiveSquad): Pt | null {
    // ★ 参照（用户定 2026-09-29）：玩家进到 THREAT_NEAR 内 → 玩家；否则舰
    const player = this.pos.player();
    const near = player && Math.hypot(player.x - eng.x, player.z - eng.z) <= THREAT_NEAR;
    const threat = near ? player : (this.pos.ship() ?? player);
    if (!threat) return null;
    const dEng = Math.hypot(eng.x - threat.x, eng.z - threat.z);
    const dWard = Math.hypot(ward.x - threat.x, ward.z - threat.z);
    const unit: Pt = dEng < dWard ? { x: eng.x, z: eng.z } : { x: ward.x, z: ward.z };
    for (const off of [1.6, 2.4, 3.2]) {
      const p = coverPoint(threat, unit, off);
      if (!threePoint(threat, unit, p)) continue;
      if (this.live.blockedAt?.(p.x, p.z) ?? false) continue;
      return p;
    }
    return null;
  }

  /** 工兵管理器查询口：本拍建造点（null = 非保护状态 → 原查询机制） */
  wardSpotOf(id: number): { x: number; z: number } | null {
    return this.wardSpot.get(id) ?? null;
  }

  /** 掩护掩体落成回执：抑制同点重复产点（直到保护对象移动 >6m） */
  wardCoverDone(id: number, x: number, z: number): void {
    this.wardBuilt.set(id, { x, z });
    this.wardSpot.delete(id);
  }

  /** ★ §3.G 工兵保护-支援：只产标签（protect/march）；第一波后启用。 */
  private tacticalPlan(now: number): Map<number, {
    state: 'protect' | 'march'; target: { x: number; z: number };
    kind: SquadOrder['kind']; force: boolean; keep?: boolean;
  }> {
    const out = new Map<number, { state: 'protect' | 'march'; target: { x: number; z: number };
      kind: SquadOrder['kind']; force: boolean; keep?: boolean }>();
    if (!this.wave1Sent) return out;
    const byId = new Map<number, LiveSquad>();
    for (const r of this.live.squads()) byId.set(r.id, r);
    // ★★ 飞行支援：非飞行队被打 → 调最近健康未占用飞行队赶来（漂移>8m 重发）；威胁解除 8s 归建。
    {
      const flyers: LiveSquad[] = [];
      for (const r of byId.values()) if (r.role === 'flyer' && r.alive > 0) flyers.push(r);
      // 清理：支援者/被支援者不在场，或威胁解除
      for (const [fid, s] of [...this.flyerSupport]) {
        if (!byId.has(fid) || !byId.has(s.atkId) || now - s.hitAt >= EngineBridge.SUPPORT_RELEASE_S) this.flyerSupport.delete(fid);
      }
      const supported = new Set<number>();
      for (const s of this.flyerSupport.values()) supported.add(s.atkId);
      for (const r of byId.values()) {
        if (r.role === 'flyer') continue;
        if (this.live.underAttack?.(r.id) !== true) continue;
        // 已有飞行队来援 → 只刷新支援点/时刻
        let has = false;
        for (const s of this.flyerSupport.values()) {
          if (s.atkId !== r.id) continue;
          s.hitAt = now; s.x = r.x; s.z = r.z; has = true;
        }
        if (has) continue;
        // 选最近可用飞行队
        const used = new Set(this.flyerSupport.keys());
        let best: LiveSquad | undefined;
        let bd = Infinity;
        for (const f of flyers) {
          if (used.has(f.id)) continue;
          const d = Math.hypot(f.x - r.x, f.z - r.z);
          if (d < bd) { bd = d; best = f; }
        }
        if (best) {
          this.flyerSupport.set(best.id, { atkId: r.id, x: r.x, z: r.z, hitAt: now });
          supported.add(r.id);
        }
      }
      for (const [fid, s] of this.flyerSupport) {
        const dst = this.live.flyerSpot ? this.live.flyerSpot(fid, s.x, s.z) : { x: s.x, z: s.z };
        const cur = this.writer.store.get(fid);
        const same = cur && cur.order.state === 'march'
          && Math.hypot(cur.order.target.x - dst.x, cur.order.target.z - dst.z) <= 8;
        out.set(fid, {
          state: 'march', target: dst, kind: 'act',
          force: !same, keep: same,
        });
      }
    }
    // 死队清关系（I14）
    for (const eng of [...this.protectorOf.keys()]) {
      if (!byId.has(eng)) {
        this.protectorOf.delete(eng); this.protG.delete(eng); this.switchAt.delete(eng);
        this.woundAt.delete(eng); this.retreatT.delete(eng); this.supportOf.delete(eng);
      }
    }
    for (const eng of [...this.supportOf.keys()]) if (!byId.has(eng)) this.supportOf.delete(eng);
    for (const eng of byId.values()) {
      if (eng.role !== 'engineer') continue;
      // 配对/换队：保护队残（存活≤50% 或 血比<0.5）→ 5s 滞回后换最近健康未占用近战
      let prot = this.protectorOf.get(eng.id);
      let protLive = prot !== undefined ? byId.get(prot) : undefined;
      if ((!protLive || this.worn(protLive))
        && now - (this.switchAt.get(eng.id) ?? -1e9) >= EngineBridge.PROTECT_SWITCH_S) {
        const used = new Set<number>();
        for (const [e2, p2] of this.protectorOf) if (e2 !== eng.id) used.add(p2);
        for (const p2 of this.supportOf.values()) used.add(p2);
        const pick = this.pickMelee(eng, byId, used);
        if (pick !== undefined) {
          this.protectorOf.set(eng.id, pick);
          this.switchAt.set(eng.id, now);
          this.protG.delete(eng.id);
          prot = pick; protLive = byId.get(pick);
        }
      }
      // 保护令（G=工兵位；漂移 >8m 才重发，稳态 keep）
      if (prot !== undefined && protLive) {
        const G = { x: eng.x, z: eng.z };
        const last = this.protG.get(eng.id);
        if (!last || Math.hypot(G.x - last.x, G.z - last.z) > EngineBridge.PROTECT_G_MOVE) {
          this.protG.set(eng.id, G);
          out.set(prot, { state: 'protect', target: G, kind: 'protect', force: true });
        } else {
          out.set(prot, { state: 'protect', target: G, kind: 'protect', force: false, keep: true });
        }
      }
      // 被打（工兵或其保护队）：工兵后撤 + 近战赶来支援
      const wounded = this.live.underAttack?.(eng.id) === true
        || (protLive ? this.live.underAttack?.(protLive.id) === true : false);
      if (wounded) {
        this.woundAt.set(eng.id, now);
        const t = this.retreatPoint(eng);
        if (t) {
          const cur = this.writer.store.get(eng.id);
          const same = cur && cur.order.state === 'march'
            && Math.hypot(cur.order.target.x - t.x, cur.order.target.z - t.z) <= 2;
          out.set(eng.id, same
            ? { state: 'march', target: t, kind: 'act', force: false, keep: true }
            : { state: 'march', target: t, kind: 'act', force: true });
        }
        let sup = this.supportOf.get(eng.id);
        if (sup !== undefined && (!byId.get(sup) || this.worn(byId.get(sup)!))) { this.supportOf.delete(eng.id); sup = undefined; }
        if (sup === undefined) {
          const used2 = new Set<number>();
          for (const p2 of this.protectorOf.values()) used2.add(p2);
          for (const p2 of this.supportOf.values()) used2.add(p2);
          const pick2 = this.pickMelee(eng, byId, used2);
          if (pick2 !== undefined) { this.supportOf.set(eng.id, pick2); sup = pick2; }
        }
        if (sup !== undefined) {
          const t2 = { x: eng.x, z: eng.z };
          const cur2 = this.writer.store.get(sup);
          const same2 = cur2 && cur2.order.state === 'march'
            && Math.hypot(cur2.order.target.x - t2.x, cur2.order.target.z - t2.z) <= 2;
          out.set(sup, same2
            ? { state: 'march', target: t2, kind: 'act', force: false, keep: true }
            : { state: 'march', target: t2, kind: 'act', force: true });
        }
      } else if (now - (this.woundAt.get(eng.id) ?? -1e9) >= EngineBridge.SUPPORT_RELEASE_S) {
        this.supportOf.delete(eng.id);   // 威胁解除 → 支援归建
      }
    }
    return out;
  }

  /** 残（§3.G）：存活 ≤50% 或 整队血比 <0.5 */
  private worn(r: LiveSquad): boolean {
    const full = r.full ?? 0;
    const aliveRatio = full > 0 ? r.alive / full : 1;
    return aliveRatio <= 0.5 || (r.hpRatio ?? 1) < 0.5;
  }

  /** 挑最近、健康、未占用近战（等距取 id 小者；确定性） */
  private pickMelee(eng: LiveSquad, byId: Map<number, LiveSquad>, used: Set<number>): number | undefined {
    let best: number | undefined;
    let bd = Infinity;
    for (const r of byId.values()) {
      if (r.role !== 'melee' || used.has(r.id) || this.worn(r)) continue;
      const d = Math.hypot(r.x - eng.x, r.z - eng.z);
      if (d < bd - 1e-9 || (Math.abs(d - bd) < 1e-9 && best !== undefined && r.id < best)) { bd = d; best = r.id; }
    }
    return best;
  }

  /** 后撤点：沿 袭击者→工兵 外推 30m（夹环）；漂移 <6m 用缓存 */
  private retreatPoint(eng: LiveSquad): { x: number; z: number } | null {
    const p = this.pos.player() ?? this.pos.ship();
    if (!p) return null;
    const dx = eng.x - p.x, dz = eng.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    let t = { x: eng.x + (dx / d) * EngineBridge.RETREAT_DIST, z: eng.z + (dz / d) * EngineBridge.RETREAT_DIST };
    const c = this.live.clampRing?.(t.x, t.z);
    if (c) t = { x: c.x, z: c.z };
    const old = this.retreatT.get(eng.id);
    if (old && Math.hypot(t.x - old.x, t.z - old.z) <= EngineBridge.RETREAT_REFRESH_D) return { x: old.x, z: old.z };
    this.retreatT.set(eng.id, t);
    return t;
  }

  /** 唯一发令路径：标签+载荷 → OrderWriter → 队长核（ok=false 表示同签名被去重/被稳定门 keep，不重发） */
  private send(
    id: number,
    state: NonNullable<SquadOrder['state']>,
    target: { x: number; z: number },
    now: number,
    opt?: { kind?: SquadOrder['kind']; mission?: string; force?: boolean },
  ): boolean {
    // ★ §0.3 防区锁（2026-09-30）：非总攻 → 引擎令目标夹进该队扇区（环带外的兵不受锁）
    if (!(this.live.assault?.() ?? false) && this.live.sectorLock) target = this.live.sectorLock(id, target.x, target.z);
    const order: SquadOrder = {
      kind: opt?.kind ?? 'act',
      source: 'engine',
      target: { x: target.x, z: target.z },
      state,
      threat: { x: this.pos.player()?.x ?? target.x, z: this.pos.player()?.z ?? target.z },
      seq: 0,
      ttl: 0,
      mission: opt?.mission,
    };
    const ok = this.writer.issue(id, order, { now, force: opt?.force === true });
    if (ok && !this.shadow) this.live.emit?.(id, order, now);
    return ok;
  }

  private debug(): void {
    this.dbg.ticks++;
    this.dbg.shadow = this.shadow;
    this.dbg.last = `t#${this.dbg.ticks} squads=${this.squads.dbg.count} issued=${this.dbg.issued}`;
  }
}
