// ============================================================
// engine/EngineBridge.ts —— 实机接线桥（重写 P3；影子模式先行）
// ============================================================
// 把新引擎接到实机（**不破坏旧路径**）：
//   · 影子模式（shadow=true，默认）：新引擎**只读 + 只算 + 只记**——用 dbg 与旧路径对照
//   · 实机模式（shadow=false）：write 相位经 OrderWriter 真下发（emit 回调 → 队长核 accept）
// 实机状态由 LiveView 注入（main.ts 适配；引擎不直读世界，G4）；
// 发令唯一出口 OrderWriter（G1），汇报唯一接收器 SquadManager（铁律 7）。
// ============================================================

import type { MobRole, OrderState, SquadOrder } from './contracts';
import {} from '../SwarmConfig';
import { Positions } from './Positions';
import { SquadManager } from './SquadManager';
import { SectorManager } from './SectorManager';
import { MeleeManager } from './MeleeManager';
import { RangedManager } from './RangedManager';
import { FlyerManager } from './FlyerManager';
import { EngineerManager, type EngineerPort } from './EngineerManager';
import { OrderWriter, SquadOrderStore } from './OrderWriter';
import { validateOrder } from './OrderValidator';
import { decideChain, type Decision } from './DecisionChain';
import type { SpreadPt } from './Spread';
import { releaseAt } from '../PostureFn';
import { wellFormed, interpretEngine } from './CommandLang';
import { Protect } from './Protect';
import { AttackQueues } from './AttackQueues';
import { TimerManager } from './TimerManager';
import { EngineCore } from './EngineCore';

/** 玩家令寿命（游戏分钟；《RTS架构.md》§5：玩家令 TTL 30 游戏分钟） */

/** 工兵施工令的固定决策（不进战术决策链；目标由 EngineerManager 给） */
const ENGINEER_DECISION: Decision = { source: 'routine', kind: 'act', target: null, reason: 'build' };

export interface LiveSquad {
  id: number;
  /** ★ 队长 uid（用户定 2026-09-27：兜底闸门——只给 L3 实体队长的队跑兜底） */
  leaderUid?: number;
  role: MobRole;
  x: number;
  z: number;
  alive: number;
  /** 整队血量比 Σhp/ΣmaxHp（重伤撤回判定用） */
  hpRatio?: number;
  /** ★ M4：队长核执行状态（到达/原子/进度/静止）——引擎只读，不自算 */
  phase?: string;
  atom?: string;
  progress?: number;
  stillS?: number;
}

export interface LiveView {
  /** 玩家位置（无 → null） */
  player(): { x: number; z: number } | null;
  /** 舰船位置（无 → null） */
  ship(): { x: number; z: number } | null;
  /** 各小队（队长位置 + 兵种 + 存活） */
  squads(): LiveSquad[];
  /** 长寻路可达检测（实机注入；无 → 跳过 ③） */
  /** 可达核验（发令 ③；用户定 2026-09-25：带队 id——长途 BFS / 短程 LOS） */
  canReach?(id: number, x: number, z: number): boolean;
  /** 下发回调（实机模式用：交给旧执行链；影子模式不调）——带 squadId（哪队）+ now（实秒） */
  emit?(squadId: number, order: SquadOrder, now: number): void;
  /** 玩家是否在打某小队（被打反应：引擎告知队长玩家位置；0 = 无） */
  /** 全体敌方单位（含代理；uid/位置）——攻击队列 + 统一计时消费；缺省 → 不跑 */
  enemies?(): { uid: number; x: number; z: number }[];
  /** ★ 可攻击单位（排除工兵）：仅攻击队列入队口径；缺省 → 用 enemies() */
  attackables?(): { uid: number; x: number; z: number; range?: number }[];   // range = 该单位自身射程（远程豁免用）
  /** ★ 工兵数据/落地端口（建造位置查询/施工落地）：缺省 → 工兵保持站位 */
  engineer?(): EngineerPort | null;
  /** ★ 创建端口（四管理器共用；接线层注入） */
  creation?: () => import('./SquadCreation').CreationPort | null;
  /** ★ 事态进度（下令变量；可选） */
  posture?(): number;
  /** ★ 总攻（可选）：强制全体到舰，去掉其他指令/寻路 */
  assault?(): boolean;
  /** 硬通行（可选）：总攻目标吸附用 */
  blockedAt?(x: number, z: number): boolean;
  /** 池代理位置（可选；卡死判官在册用——缺它则代理永不回收） */
  agents?(): readonly { uid: number; x: number; z: number }[];
  /** ★ 敌方掩体（可选；远程躲掩体用） */
  covers?(): readonly { x: number; z: number }[];
  /** ★ 按队给防区**前沿推进点**（可选） */
  frontOfSquad?(id: number): { x: number; z: number } | null;
  /** ★ 兜底（用户定 2026-09-27）：强制重寻路（传给队长核） */
  forceRepath?(id: number): void;
  /** ★ 兜底：本队防区锚点（可达优先候选） */
  anchorOf?(id: number): { x: number; z: number } | null;
  /** ★ 卡死豁免（驻守/交战…）：返回原因或 null */
  exemptOf?(uid: number): string | null;
  /** ★ 计时销毁/卡死回收落地（实体 retire / 代理回收）；返回是否找到 */
  retire?(uid: number, why: string): boolean;
  /** ★ 第一波已发（波次决策源：抵舰驻留） */
  wave1?(): boolean;
  /** ★ 归一当日进度 0~1（落地起算；指挥官数据面提供） */
  t01?(): number;
  /** ★ 兵力计划总数（账本；放行闸门用） */
  ledgerTotal?(): number;
  /** ★ 写兵力放行上限（账本闸门真源仍在账本） */
  setReleaseCap?(cap: number): void;
  /** ★ 生成大队（波次执行口；instant=整编一次性压上） */
}

export class EngineBridge {
  readonly pos = new Positions();
  readonly squads = new SquadManager();
  readonly sectors = new SectorManager();
  readonly melee: MeleeManager;
  readonly ranged: RangedManager;
  readonly flyer: FlyerManager;
  readonly engineer: EngineerManager;
  readonly writer = new OrderWriter(new SquadOrderStore());
  readonly protect = new Protect();
  readonly queues = new AttackQueues();
  readonly timers: TimerManager;
  /** 开火射程（米；canFire 判定） */
  fireRange = 25;
  private lastSlow = -1e9;
  /** ★ 驻留窗口（第一波抵舰） */
  /** ★ 池代理 uid 集合（判官名册：live.enemies() 含代理 → 用 agents() 剔除） */
  private readonly poolAgentUids = new Set<number>();
  private readonly holdUntil = new Map<number, number>();
  /** ★★ 目标驻留锁存（M2-lite；用户定 2026-09-27）：routine 令目标在**到达前**锁存 GOAL_DWELL_S 秒，防重算跳变。 */
  private readonly goalHold = new Map<number, { x: number; z: number; at: number; kind: string }>();
  private static readonly GOAL_DWELL_S = 6;
  /** ★★ 段进循环（用户定 2026-09-27）：推进一段 → 巡逻 → 再推进（队长不再"几乎不发令"）。 */
  private readonly plan = new Map<number, { mode: 'move' | 'patrol'; until: number; x: number; z: number }>();
  private static readonly PLAN_ADV = 30;        // 每段向舰推进距离（米）
  private static readonly PLAN_NEAR = 10;       // 距舰这么近就不再推进（驻边巡逻）
  private static readonly PLAN_PATROL_S = 10;   // 每段之间的巡逻时长（秒）
  private static readonly PLAN_MOVE_TIMEOUT = 25; // 单段安全超时

  /** ★★ 兜底命令状态（用户定 2026-09-27）：各队上次救援时刻 */

  /** ★ 波次/放行（决策源；用户定 2026-09-25 自指挥官迁入） */
  private wave1Sent = false;
  private finalSent = false;
  private lastT01 = -1;
  readonly dbg = { ticks: 0, shadow: false, ringMin: 0, ringMax: 0, issued: 0, refreshed: 0, spread: 0, stall: 0, last: '' };
  /** 影子模式：只算不发（默认 false = 真下发；旧链已删，影子仅调试用） */
  shadow = false;
  /** ★ 直控模式（用户定 2026-09-26）：**关蜂群引擎 decide/write**——只执行玩家指令、
   *  无否定权（不校验/不夹环/不重决策；玩家令本就旁路）。登高等纯寻路验收专用。 */
  directMode = false;

  private readonly core: EngineCore;

  constructor(private readonly live: LiveView) {
    this.sectors.build(4);   // 默认四扇区（引擎初始化）
    this.timers = new TimerManager({
      // ★ 判官在册（用户定 2026-09-27）：**只判 L3 实体**——远场池无实体成本、无"回收"意义
      //   （此前池也判收 → "回收→退款→补兵"churn）；池的卡死由**progress 停滞 → 救援 +
      //   池执行令**闭环负责（《移动执行重写.md》§7.4）。实体保留判官：近处卡死占预算/堵路。
      //   ⚠️ `live.enemies()` 含代理（索敌口径）——用 `agents()` 的 uid 集合剔除，只留真实体。
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
      onExpire: (uid, why) => {
        // ★ 消费（用户定）：计时销毁/卡死判决 → 真回收/退役（实体 retire / 代理回收）
        const hit = this.live.retire?.(uid, why) ?? false;
        this.dbg.last = `expire#${uid}:${why}${hit ? '' : '(gone)'}`;
      },
    });
    // ★ 创建只走四管理器（用户定 2026-09-26：管理器自有兵种创建接口）
    const creationOf = () => this.live.creation?.() ?? null;
    this.melee = new MeleeManager(this.squads, creationOf);
    this.ranged = new RangedManager(this.squads, creationOf);
    this.flyer = new FlyerManager(this.squads, creationOf);
    this.engineer = new EngineerManager(this.squads, () => this.live.engineer?.() ?? null);
    this.core = new EngineCore({
      perceive: (now) => this.perceive(now),
      situation: (now) => this.situation(now),
      decide: (now) => this.decide(now),
      write: (now) => this.write(now),
      debug: () => this.debug(),
    });
  }


  /** 当前实秒（emit 给旧板写 TTL 用；每帧刷新） */
  private nowS = 0;

  /** 每帧（dt/now 实秒） */
  tick(dt: number, now: number): void {
    this.nowS = now;
    this.core.tick(dt, now);
  }

  /** ★ 玩家命令入口（用户定）：玩家 → **唯一发令器**（player 旁路）→ **只给队长**。
   *  成员由队长自行组织（铁律 1：引擎/玩家都只指挥队长）。
   *  玩家令 TTL = 30 游戏分钟（《RTS架构.md》§5）；到期由 write() 释放、交回引擎。 */
  playerOrder(squadId: number, kind: SquadOrder['kind'], target: { x: number; z: number }): boolean {
    const order: SquadOrder = {
      kind,
      source: 'player',
      target,
      state: kind === 'protect' ? 'protect' : kind === 'defend' ? 'hold'
        : kind === 'patrol' ? 'patrol' : 'march',
      threat: this.pos.player() ?? undefined,
      seq: 0,
      ttl: 0,   // ★ 无 TTL（用户定）
    };
    const ok = this.writer.issue(squadId, order, { now: this.nowS, player: true });
    if (ok && !this.shadow) this.live.emit?.(squadId, order, this.nowS);
    return ok;
  }

  /** ★ 玩家**引擎级命令**（用户定）：对全体在册小队下同一令（如"全体防御此点"）。
   *  仍只给队长（铁律 1）；每队独立过唯一发令器（player 旁路）。返回成功队数。 */
  playerOrderAll(kind: SquadOrder['kind'], target: { x: number; z: number }): number {
    let n = 0;
    for (const rec of [...this.squads.all()]) {
      if (this.playerOrder(rec.id, kind, target)) n++;
    }
    this.dbg.last = `playerAll ${kind} →${n}队`;
    return n;
  }

  /** ★ 玩家**范围命令**（用户定）：对 target 半径 r 内的小队下令（圈选/点区域）。 */
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

  private perceive(now: number): void {
    const p = this.live.player();
    if (p) this.pos.setPlayer(p.x, p.z);
    const s = this.live.ship();
    if (s) this.pos.setShip(s.x, s.z);
    // ★ 池代理 uid 集合（兜底/判官闸门用）：live.enemies() 含代理 → 用 agents() 剔除
    this.poolAgentUids.clear();
    for (const a of this.live.agents?.() ?? []) this.poolAgentUids.add(a.uid);
    // ★ 阵亡清册（用户定 2026-09-26）：不在世（SquadTable 已无）的旧记录即删——
    //   防止僵尸记录占编制/占面板（队死后无人 report → 永远挂着）。
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
      // ★ 队长自报进度/静止 → 稳定门（引擎只记录，不逐拍指挥）
      const rec = this.squads.get(sq.id);
      if (rec) this.writer.advance(sq.id, rec.progress, rec.stillS);
    }
    // 防区归位（队长位置单源）
    this.sectors.tick((id) => this.pos.squad(id), this.pos.player()?.x ?? 0, this.pos.player()?.z ?? 0, [...this.squads.all()].map((r) => r.id));
    // ★ 1Hz 慢拍：攻击队列（最近实体入队/去重/开火检验+闩锁）+ 统一计时（卡死窗口/计时销毁）
    if (now - this.lastSlow >= 1) {
      this.lastSlow = now;
      const p = this.pos.player();
      if (p) this.queues.setOwner('player', p.x, p.z);
      const sh = this.pos.ship();
      if (sh) this.queues.setOwner('ship', sh.x, sh.z);
      const ents = this.live.enemies?.() ?? [];
      // ★ 工兵不入攻击队列（用户定 2026-09-25）；统一计时仍看全体
      const attack = this.live.attackables?.() ?? ents;
      this.queues.update(attack, (uid) => this.canFire(uid, attack), this.timers);
      this.timers.tick(now);
    }
  }

  /** ★ 开火许可查询（用户定 2026-09-27）：拿到许可的远程站桩射击 ≠ 发呆 → 判官豁免（main.exemptOf 消费） */
  hasFirePermit(uid: number): boolean {
    return this.timers.canFire(uid);
  }

  /** ★ 下一段推进点（用户定 2026-09-27）：从当前位置朝舰 PLAN_ADV 米；可达优先（30→15→8），都不行 → null。
   *  ★ 事态活动带前缘（用户定 2026-09-27，**与 p 值无关、只看范围**）：再向前（朝舰）越过内缘 `ringMin`
   *    就超出本阶段允许活动的范围 → 停止推进（返回 null → 上层转"就地维持巡逻"）。 */
  private advancePoint(id: number, sp: { x: number; z: number }): { x: number; z: number } | null {
    // ★ 方位单源（用户定 2026-09-27）：优先真实舰船；舰向全部不可达 → 退玩家锚再试（方位错了/没检验的修正）
    const anchors: { x: number; z: number }[] = [];
    const ship = this.pos.ship();
    const player = this.pos.player();
    if (ship) anchors.push(ship);
    if (player && (!ship || Math.hypot(player.x - ship.x, player.z - ship.z) > 2)) anchors.push(player);
    if (anchors.length === 0) return null;
    const front = Math.max(EngineBridge.PLAN_NEAR, this.dbg.ringMin > 0 ? this.dbg.ringMin : 0);
    const can = this.live.canReach;
    for (let ai = 0; ai < anchors.length; ai++) {
      const p = anchors[ai] as { x: number; z: number };
      const dx = p.x - sp.x, dz = p.z - sp.z;
      const d = Math.hypot(dx, dz);
      // 舰锚到带缘 = 到位就地巡逻（return null）；玩家锚到缘则跳过
      if (d <= front) { if (ai === 0) return null; continue; }
      let tried = false;
      for (const s of [EngineBridge.PLAN_ADV, 15, 8]) {
        const step = Math.min(s, d - front);   // ★ 不越活动带前缘（ringMin）
        if (step <= 1) continue;
        tried = true;
        const q = { x: sp.x + (dx / d) * step, z: sp.z + (dz / d) * step };
        if (!can || can(id, q.x, q.z)) return q;   // ★ 可行性检验（不可达候选逐个降距）
      }
      // 舰锚全部不可达 → 试玩家锚；贴着带缘没得走 → 停
      if (!tried) return null;
    }
    return null;
  }

  /** ★ 兜底目标（用户定 2026-09-27）：可达优先：① 环内同方位点（朝舰夹到 ringMax） → ② 本队防区锚点；都不行 → null。 */

  /** 开火检验（射程/ROE；影子模式只判距离） */
  private canFire(uid: number, ents: readonly { uid: number; x: number; z: number; range?: number }[]): boolean {
    let e: { uid: number; x: number; z: number; range?: number } | null = null;
    for (const x of ents) if (x.uid === uid) { e = x; break; }
    if (!e) return false;
    const p = this.pos.player();
    const s = this.pos.ship();
    const dp = p ? Math.hypot(e.x - p.x, e.z - p.z) : Infinity;
    const ds = s ? Math.hypot(e.x - s.x, e.z - s.z) : Infinity;
    // ★ 许可射程 = **单位自身射程**（用户定 2026-09-27）：远程 50/55m，固定 25m 闸门会让远射手拿不到许可
    //   → 判官当"发呆"收掉（"隔着老远射箭被回收"）。range 缺省退回 fireRange。
    return Math.min(dp, ds) <= (e.range ?? this.fireRange);
  }

  private situation(_now: number): void {
    const p = this.pos.player();
    if (!p) return;
    this.protect.refresh(this.pos.squadOf, p.x, p.z);
    // ★ 波次/兵力放行（决策源；自指挥官迁入）：t01 回退（换落点/新一日）→ 波次复位
    const t01 = this.live.t01?.() ?? 0;
    if (t01 < this.lastT01 - 0.2) { this.wave1Sent = false; this.finalSent = false; }
    this.lastT01 = t01;
    const total = this.live.ledgerTotal?.() ?? 0;
    // ★★ 上限挂**事态函数 p**（用户定 2026-09-26）：releaseCap = total · releaseAt(p)。
    //   与四管理器的补兵间隔（port.posture()）同源——改事态函数
    //   （SCHEDULE_ANCHORS/挑衅）就**同时**改上限/刷兵间隔/行为姿态；击杀挑衅 → p 升 → 增援加快。
    const p01 = Math.max(0, Math.min(1, this.live.posture?.() ?? 0));
    this.live.setReleaseCap?.(Math.ceil(total * releaseAt(p01)));
    if (!this.wave1Sent && p01 >= 0.45) {
      this.wave1Sent = true;
      this.dbg.last = 'wave1';
    }
    if (!this.finalSent && p01 >= 0.80) {
      this.finalSent = true;
      this.dbg.last = 'final';
    }
  }

  /** ★ 第一波已发（波次决策源状态；main → LiveView.wave1） */
  get wave1Active(): boolean {
    return this.wave1Sent;
  }

  private decide(now: number): void {
    if (this.directMode) return;   // ★ 直控模式：不决策
    // ★ 下令变量（用户定）：事态进度 + 工兵友军位置（近战护卫/高事态冲锋）
    const engs = [...this.squads.all()].filter((r) => r.role === 'engineer' && r.alive > 0).map((r) => ({ x: r.x, z: r.z }));
    const ctx = { pos: this.pos, ringMin: this.dbg.ringMin, ringMax: this.dbg.ringMax, now,
      posture: this.live.posture?.() ?? 0, engineers: engs, covers: this.live.covers?.() ?? [],
      frontOf: (id: number) => this.live.frontOfSquad?.(id) ?? null };
    this.melee.sync();
    this.ranged.sync();
    this.flyer.sync();
    this.engineer.sync();
    this.melee.assign(ctx);
    this.ranged.assign(ctx);
    this.flyer.assign(ctx);
    this.engineer.assign(ctx);
  }

  /** write —— 发令。★ 命令使用设计（《RTS架构.md》§0.3 / 方案 §4.4.2）：引擎**少发令**——
   *  只在 ①事态变更且不在范围（长寻路）②危机回撤 ③扎堆拉开 三类时刻介入；
   *  同签名重发被 kept 去重；非必要不打断（重规划仅 4 事件，S3b）。 */
  private write(now: number): void {
    if (this.directMode) return;   // ★ 直控模式：不发令/不校验/不释放 TTL
    // ★ 清理已消失小队的段进计划项（用户定 2026-09-27）：防陈旧锚点残留/泄漏
    if (this.plan.size > 0) {
      const live = new Set<number>();
      for (const sq of this.live.squads()) live.add(sq.id);
      for (const id of [...this.plan.keys()]) if (!live.has(id)) this.plan.delete(id);
    }
    const p = this.pos.ship() ?? this.pos.player();   // ★ 命令参照舰船（用户定 2026-09-26）
    if (!p) return;
    // ★★ 总攻（用户定 2026-09-26）：**去掉所有其他寻路与指令**——
    //   全体（全兵种）强制令 march 到舰；强制令走玩家同路径（绕稳定门）；
    //   对局不再经 decideChain/管理器目标下令。玩家手动令保留最高优先。
    if (this.live.assault?.() === true) {
      // ★ 目标吸附（用户定 2026-09-26）：舰船精确点可能不可走（舰体/坑）→ 吸附到舰旁最近可行点
      // ★ 目标吸附（用户定 2026-09-27 修）：**无条件**吸到舰旁可站点——
      //   舰本体点不可作为地面路径终点（BFS 到舰点失败 → 无走廊 → 全体站着 = "总攻有令不走"根因）；
      //   原实现只在 blockedAt(坑) 时吸附，舰点不是坑 → 不吸附。现在恒吸附（过滤坑）。
      let tx = p.x, tz = p.z;
      {
        let found = false;
        outer: for (let r = 2; r <= 10 && !found; r += 2) {
          for (let k = 0; k < 8; k++) {
            const a2 = (k / 8) * Math.PI * 2;
            const qx = p.x + Math.cos(a2) * r, qz = p.z + Math.sin(a2) * r;
            if (!(this.live.blockedAt?.(qx, qz) ?? false)) { tx = qx; tz = qz; found = true; break outer; }
          }
        }
      }
      for (const rec of [...this.squads.all()]) {
        // ★ 强制覆盖所有人（用户定 2026-09-26：含玩家手动令）——总攻阶段无例外
        // ★★ 到顶后维持巡逻：kind=patrol → 到锚（舰）后队长自维持 18m 跨腿。
        const order: SquadOrder = {
          kind: 'patrol', source: 'engine', target: { x: tx, z: tz }, mission: 'patrol',
          state: 'assault',   // ★ 总攻=标签（用户定 2026-09-27）
          threat: { x: tx, z: tz }, seq: 0, ttl: 0,
        };
        // ★★ 同签名不重发（用户定 2026-09-27，总攻也适用）——
        //   旧写法每帧 force 重发 → 把 progress/stillS 清零 → 卡住的单位**永远不触发兜底救援**（发呆被收→重放=闪抖）。
        const prev = this.writer.store.get(rec.id);
        if (prev && prev.order.kind === order.kind && (prev.order.mission ?? '') === 'patrol'
          && prev.order.state === 'assault'
          && Math.hypot(prev.order.target.x - tx, prev.order.target.z - tz) <= 1) continue;
        const ok = this.writer.issue(rec.id, order, { now, force: true });
        if (ok && !this.shadow) this.live.emit?.(rec.id, order, now);
      }
      this.dbg.last = 'assault:force-to-ship';
      return;
    }
    const hitId = 0;   // 玩家攻击信号未接线（旧接口已删）
    interface Pending { rec: LiveSquad; cur?: OrderState; dec: Decision; tx: number; tz: number; mission?: string; force?: boolean;
      /** ★ 引擎给的状态标签（用户定 2026-09-27） */ state: 'march' | 'hold' | 'patrol' | 'protect' | 'assault'; }
    const pending: Pending[] = [];
    /** 无决策队（玩家令/无目标）的现令目标：作同兵种间距的**固定约束**（不随本拍调整） */
    const held = new Map<number, { x: number; z: number }>();
    // ---- pass ①：单源决策（不写令）——先算出本拍**真实目标**（含 defend=守原地） ----
    for (const rec of [...this.squads.all()]) {
      // ★ 玩家令生命周期（《RTS架构.md》§5）：TTL 到期 → 释放，交回引擎决策（工兵也适用——防旧板目标锁死）
      const cur0 = this.writer.store.get(rec.id);
      // ★ 命令无 TTL（用户定）：玩家令不再自动到期释放（直到被新令替换）
      // ★ 工兵 = 新引擎全权（用户定 2026-09-25）：目标 = 建造位置查询结果；
      //   不参与战术决策链（重伤撤退/保护由管理器施工优先），不入攻击队列（接线层过滤）。
      let engineerFallback = false;
      if (rec.role === 'engineer') {
        const curE = this.writer.store.get(rec.id);
        if (curE && curE.order.source === 'player') { held.set(rec.id, curE.order.target); continue; }
        const tE = this.engineer.targets.get(rec.id);
        const spE = this.pos.squad(rec.id);
        // ★ 没件判定（用户定 2026-09-27）：管理器无目标、或目标≈自身（"没件就地待命"）都算**没活**
        //   ——否则"目标=自身"被当成 build 令 → 站桩到判官收（真被收原因）。
        const idleTgt = !tE || !spE || Math.hypot(tE.x - spE.x, tE.z - spE.z) < 3;
        if (!idleTgt) {
          // 真有活：现令不是 build（还在兜底/巡逻）→ **强制切回施工**（别被稳定门拖 25s）
          const needForce = !curE || (curE.order.mission ?? '') !== 'build';
          pending.push({ rec, cur: curE, dec: ENGINEER_DECISION, tx: tE!.x, tz: tE!.z, mission: 'build', force: needForce, state: 'march' });
          continue;
        }
        // 没活：**落进唯一兜底（行军/巡逻交替）**——所有载体同口径。
        engineerFallback = true;
      }
      const cur = this.writer.store.get(rec.id);
      const mgr = rec.role === 'melee' ? this.melee : rec.role === 'ranged' ? this.ranged : rec.role === 'flyer' ? this.flyer : this.engineer;
      // ★ 战斗兵种不消费管理器目标（用户定 2026-09-27：**选位/风筝/抑制/射程环都不是本设计**）——
      //   移动只走 命令标签 / 唯一兜底（行军↔巡逻交替）；开火独立。管理器只保留编成（工兵施工目标除外，走前面分支）。
      //   否则管理器目标一变，稳定门把换令 keep 掉 → 旧令不动新令不发（"新命令不执行/一直发呆"根因）。
      const t = null;
      const sp = this.pos.squad(rec.id);
      // ★ 显式优先链（单源决策）：玩家>重伤>事态>干预>常规（不靠调用顺序）
      // ★ 后撤点（用户定：撤退=向后远离战场）：本队扇区中心 + 事态上限外 20m
      const sec = this.sectors.sectorOf(rec.id);
      const ringC = this.pos.ship() ?? p;
      const retreat = sec >= 0
        ? this.sectors.centerOf(sec, ringC.x, ringC.z, Math.max(this.dbg.ringMax, 120) + 20)
        : null;
      const dec = decideChain({
        playerOrder: cur !== undefined && cur.order.source === 'player',
        hpRatio: rec.hpRatio,   // ★ 整队血量比（Σhp/ΣmaxHp）：整队危急才重伤撤回（用户定）
        atRingMax: this.dbg.ringMax > 0 && sp !== null && Math.hypot(sp.x - p.x, sp.z - p.z) >= this.dbg.ringMax,
        underAttack: hitId === rec.id || this.protect.linkOf(rec.id) !== undefined,
        routine: t ?? null,
        retreat,
      });
      // ★ 第一波抵舰驻留（波次决策源；用户定 2026-09-25 迁入）：抵舰 70m 内进攻令 → 驻守 45s；
      //   期间血比 <0.45 → 后撤；到期交回常规。玩家令在身不覆盖。
      let force: Decision | null = null;
      const playerOwned = cur !== undefined && cur.order.source === 'player';
      if (!playerOwned && (this.live.wave1?.() ?? false)) {
        const sh = this.pos.ship();
        const dShip = sh && sp ? Math.hypot(sp.x - sh.x, sp.z - sh.z) : Infinity;
        const hold = this.holdUntil.get(rec.id) ?? 0;
        const curKind = cur?.order.kind;
        const attacking = curKind === 'act' || curKind === 'march';
        if (attacking && dShip < 70 && now >= hold) {
          this.holdUntil.set(rec.id, now + 45);
          force = { source: 'situation', kind: 'defend', target: null, reason: '抵舰驻留' };
        } else if (curKind === 'defend' && hold > 0) {
          if ((rec.hpRatio ?? 1) < 0.45) {
            this.holdUntil.delete(rec.id);
            if (retreat) force = { source: 'wounded', kind: 'march', target: retreat, reason: '驻留被打退' };
          } else if (now >= hold) {
            this.holdUntil.delete(rec.id);   // 到期 → 交回常规决策
          }
        }
      }
      let final = engineerFallback
        ? ({ source: 'routine', kind: 'act', target: null, reason: '工兵无件→兜底' } as Decision)
        : (force ?? dec);
      if (!final) {
        // ★ 只有**玩家令**才"续期保留"（用户定 2026-09-27）：引擎旧令且管理器无目标
        //   （飞行/池队常见）时若继续 held → **段进-巡逻兜底永远进不来** → 挂着旧令发呆
        //   （"有令不走/偶尔一动"的引擎侧根因）。引擎旧令 → 合成 standby 交兜底。
        if (cur && cur.order.source === 'player') { held.set(rec.id, cur.order.target); continue; }
        final = { source: 'routine', kind: 'act', target: null, reason: '无决策→兜底' };
      }
      // ★★ 段进循环（用户定 2026-09-27）：管理器**没有实质目标**（空 / 目标≈原地，<6m）时接管——
      //   推进一段（朝舰）→ 到达/超时 → 巡逻 PLAN_PATROL_S → 再推进；距舰 ≤PLAN_NEAR 则常驻巡逻。
      //   有明确目标（护卫工兵/躲掩体/射程环等）时**不接管**（尊重管理器策略）。
      let planMission = false;
      let planSwitch = false;
      let planDriving = false;
      // ★★ 唯一兜底（用户定 2026-09-27）：**行军与巡逻交替**——行进一段 → 巡一段 → 再行进…
      //   所有载体（L2/L3）同口径；没有其他兜底手段（停滞救援/专用兜底目标已删）。
      //   触发（用户定 2026-09-27）：**非玩家令** 且（已到点 或 无目标）即进兜底——
      //   此前只认 `source==='routine'`，精英/无决策队到达后不触发（"行军完成后新命令不执行"根因）。
      if (!playerOwned && sp) {
        const tgt = final.target;
        const arrivedHere = rec.phase === 'done'
          || (!!tgt && Math.hypot(tgt.x - sp.x, tgt.z - sp.z) <= 8);
        const standby = arrivedHere || !tgt || Math.hypot(tgt.x - sp.x, tgt.z - sp.z) < 6;
        if (!standby) this.plan.delete(rec.id);
        if (standby) {
          planDriving = true;
          let pl = this.plan.get(rec.id);
          if (!pl) { pl = { mode: 'patrol', until: 0, x: sp.x, z: sp.z }; this.plan.set(rec.id, pl); }
          if (pl.mode === 'move') {
            const reached = rec.phase === 'done' || Math.hypot(pl.x - sp.x, pl.z - sp.z) <= 5 || now >= pl.until;
            if (reached) { pl.mode = 'patrol'; pl.until = now + EngineBridge.PLAN_PATROL_S; pl.x = sp.x; pl.z = sp.z; planSwitch = true; }
          } else if (now >= pl.until) {
            const np = this.advancePoint(rec.id, sp);
            if (np) { pl.mode = 'move'; pl.x = np.x; pl.z = np.z; pl.until = now + EngineBridge.PLAN_MOVE_TIMEOUT; planSwitch = true; }
            else { pl.until = now + EngineBridge.PLAN_PATROL_S; }   // 已到舰边 → 持续巡逻
          }
          // ★ 巡逻期**锚点冻结**（用户定 2026-09-27）：目标用切段时记下的锚点，
          //   **不再取当前位置**（否则每帧都算换令 → 巡腿目标每帧重选 = 拖抽）。
          if (pl.mode === 'move') final = { ...final, target: { x: pl.x, z: pl.z } };
          else { final = { ...final, target: { x: pl.x, z: pl.z } }; planMission = true; }

        }
      }
      // ★★ 目标驻留锁存（M2-lite：只有一个命令、不随重算跳）——
      //   routine 令：旧目标仍在驻留期且**未到达** → 沿用旧目标（直到到达/超时/换类）。
      if (!planDriving && final.source === 'routine' && sp) {   // ★ 兜底循环期间不过锁存
        const old = this.goalHold.get(rec.id);
        const arriveOld = old ? Math.hypot(sp.x - old.x, sp.z - old.z) <= 8 : false;
        if (old && now - old.at < EngineBridge.GOAL_DWELL_S && !arriveOld && old.kind === final.kind
          && final.target && Math.hypot(final.target.x - old.x, final.target.z - old.z) > 4) {
          final = { ...final, target: { x: old.x, z: old.z } };
        } else if (final.target && (!old || arriveOld || now - old.at >= EngineBridge.GOAL_DWELL_S || old.kind !== final.kind)) {
          this.goalHold.set(rec.id, { x: final.target.x, z: final.target.z, at: now, kind: final.kind });
        }
      }
      // 防御=守原地（target 为空时用**该队自身位置**；不是玩家位置——否则多队叠在同一目标=间距 0）
      let tx = final.target ? final.target.x : sp?.x ?? rec.x;
      let tz = final.target ? final.target.z : sp?.z ?? rec.z;
      // ★ 环外的"守原地"改为**回环内**（用户定 2026-09-27）：`atRingMax` 的队若在环上限之外，
      //   守原地=永远站死（判官必收）；改成朝舰方向夹回 ringMax 的点，先回到作战带再谈其余。
      if (final.source === 'situation' && final.kind === 'defend' && sp && this.dbg.ringMax > 0) {
        const dr = Math.hypot(sp.x - p.x, sp.z - p.z);
        if (dr > this.dbg.ringMax + 4) {
          const k = this.dbg.ringMax / dr;
          tx = p.x + (sp.x - p.x) * k;
          tz = p.z + (sp.z - p.z) * k;
        }
      }
      // ★ 巡逻（用户定 2026-09-25）：**引擎只发一条**——常规部署且**已到岗**、无威胁 → mission='patrol'，
      //   之后小队自维持巡逻（引擎不逐拍指挥；同签名重发被 kept 去重）
      // ★ 到位判定（用户定 2026-09-27）：**队长核 done（1.5m）或 距令目标 ≤ HOLD_R(8m)**——
      //   池队/飞行常在目标 2~6m 处被 L2 执行器交回游走，核心永远不到 1.5m → phase 永不 done
      //   → 引擎永不转 patrol（"一直发呆偶尔一动"的根因）。8m 与 RoleManager.HOLD_R 同口径。
      const spArr = this.pos.squad(rec.id);
      const tArr = final.target;
      const arrived = rec.phase === 'done'
        || (!!spArr && !!tArr && Math.hypot(tArr.x - spArr.x, tArr.z - spArr.z) <= 8);
      // ★ 到事态上限的"守原地"改为**就地巡逻**（用户定 2026-09-27）：decideChain 到上限给 situation/defend
      //   （守原地=站着不动）→ 判官按净位移收掉——**这才是"没命令"的真相**。给 patrol 令后队长核自维持巡腿。
      const atLimitDefend = force === null && final.source === 'situation' && final.kind === 'defend';
      // ★ 标签（用户定 2026-09-27）：`patrol` 只来自——计划段（唯一兜底的巡逻段）或"到上限巡逻"。
      const patrol = planMission || atLimitDefend;
      // ★ 入巡过渡强制（用户定 2026-09-27）：从旧令切到"到上限巡逻"要立刻生效（否则被稳定门压着站桩 25s）；
      //   就位后走常规同签名去重，不再每拍强制。
      const curIsLimitPatrol = cur !== undefined && cur.order.kind === 'defend'
        && (cur.order.mission ?? '') === 'patrol';
      // ★ 到位转巡逻 = 必要切换（用户定 2026-09-27）：首次转 patrol **强制发令**——
      //   否则 mission 变更被稳定门 kept（progress<0.5 且 stillS<25）→ 永远不转 patrol（飞行发呆根因）。
      const patrolFirst = patrol && cur !== undefined && (cur.order.mission ?? '') !== 'patrol';
      // ★ 引擎给标签（用户定 2026-09-27；唯一来源）：按决策/计划定状态，队长核只执行。
      const label = final.kind === 'protect' ? 'protect'
        : final.kind === 'garrison' ? 'hold'
        : (patrol || atLimitDefend || planMission) ? 'patrol'
        : 'march';
      pending.push({ rec, cur, dec: final, tx, tz, mission: patrol ? 'patrol' : undefined,
        state: label,
        // ★ 发令口径（用户定 2026-09-27）：**仅在段切换/首次入巡**强制；
        //   巡逻稳态不再每拍 force（否则每拍把队长核的腿覆盖成锚点 → 飞向自己 → 发呆）。
        force: planSwitch || (atLimitDefend && !curIsLimitPatrol) || patrolFirst });
    }
    // ---- pass ②：统一校验链（①环 ②同兵种密度=本拍真实目标全局解 ③可达）→ 唯一发令器 ----
    let issued = 0, refreshed = 0;
    for (const q of pending) {
      // ★ 兄弟目标 = 本拍**决策目标**（含 defend 的自身位置）+ 无决策队的现令目标；
      //   全部同一输入集 + id 定序 → 各队各解也收敛到同一全局解（不再"对称挪到重合"）。
      //   工兵不参与同兵种间距（施工点不需要 40m 散开 → 防切向挪动把件挪出水/崖）。
      const siblings: SpreadPt[] = [];
      if (q.rec.role !== 'engineer') {
        for (const o of pending) {
          if (o === q || o.rec.role !== q.rec.role) continue;
          siblings.push({ id: o.rec.id, role: o.rec.role, x: o.tx, z: o.tz });
        }
        for (const [id, t] of held) {
          if (this.squads.get(id)?.role !== q.rec.role) continue;
          siblings.push({ id, role: q.rec.role, x: t.x, z: t.z });
        }
      }
      // ★ 事态环 = 全场硬约束（所有兵种都在环内；工兵也不例外——件在带内、目标夹环）
      const v = validateOrder(q.rec.id, q.tx, q.tz, {
        px: p.x, pz: p.z, ringMin: this.dbg.ringMin, ringMax: this.dbg.ringMax,
        role: q.rec.role, siblings,
        canReach: this.live.canReach ? (x2, z2) => this.live.canReach!(q.rec.id, x2, z2) : undefined,
      });
      if (v.spread) this.dbg.spread++;
      if (!v.ok && q.cur) {
        // 校验不过：保留现令（稳定门语义）
        if (!this.shadow) { this.live.emit?.(q.rec.id, q.cur.order, now); refreshed++; }
        continue;
      }
      // ★ 校验不过且**没有现令**（用户定 2026-09-27）：**照样发**——绝不留下"无令站死"的队；
      //   远置单位靠这条兜底令先行军入场（步行不依赖可达判定），入场后自然恢复常规校验。
      const link = this.protect.linkOf(q.rec.id);
      // ★ 引擎命令语言：复合句（语法）→ 良构校验 → 解释器 → 唯一发令器（用户定 2026-09-25）
      const sentence: SquadOrder = {
        kind: q.dec.kind, source: 'engine', target: { x: v.x, z: v.z },
        state: q.state,
        anchor: q.dec.kind === 'protect' ? (link?.anchor ?? { x: v.x, z: v.z }) : undefined,
        threat: { x: p.x, z: p.z },   // ★ P 点（引擎单源）：队长算阻挡/掩体站位用
        seq: 0, ttl: 0,
        mission: q.mission,
      };
      const bad = wellFormed(sentence);
      if (bad) { this.dbg.last = `bad:${bad}`; continue; }
      const it = interpretEngine(sentence);
      const order: SquadOrder = {
        kind: it.kind, source: 'engine', target: it.target,
        state: q.state,
        anchor: it.anchor, threat: it.threat,
        seq: 0, ttl: 0,
        mission: q.mission,
      };
      // ★ 执行板续期（重写 P4；用户定）：旧指挥链已删——唯一发令器每拍把**当前令**同步到执行板，
      //   否则旧板 TTL 到期 → 执行层丢令。新令/被拦都续。
      if (this.writer.issue(q.rec.id, order, { now, force: q.force === true })) {   // ★ 段切换：必要性发令（过稳定门）
        issued++;
        if (!this.shadow) this.live.emit?.(q.rec.id, order, now);
      } else {
        const kept = this.writer.store.get(q.rec.id);
        if (kept && !this.shadow) { this.live.emit?.(q.rec.id, kept.order, now); refreshed++; }
      }
    }
    // 无决策队（玩家令在身/无目标）：执行板续期现令
    for (const [id] of held) {
      const cur = this.writer.store.get(id);
      if (cur && !this.shadow) { this.live.emit?.(id, cur.order, now); refreshed++; }
    }
    this.dbg.issued = issued;
    this.dbg.refreshed = refreshed;
  }

  private debug(): void {
    this.dbg.ticks++;
    this.dbg.shadow = this.shadow;
    this.dbg.last = `t#${this.dbg.ticks} squads=${this.squads.dbg.count} issued=${this.dbg.issued}`;
  }
}
