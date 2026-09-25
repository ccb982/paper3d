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
import { GAME_MIN } from '../SwarmConfig';
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
const PLAYER_ORDER_TTL = 30 * GAME_MIN;

/** 工兵施工令的固定决策（不进战术决策链；目标由 EngineerManager 给） */
const ENGINEER_DECISION: Decision = { source: 'routine', kind: 'act', target: null, reason: 'build' };

export interface LiveSquad {
  id: number;
  role: MobRole;
  x: number;
  z: number;
  alive: number;
  /** 整队血量比 Σhp/ΣmaxHp（重伤撤回判定用） */
  hpRatio?: number;
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
  playerAttacking?(): number;
  /** 全体敌方单位（含代理；uid/位置）——攻击队列 + 统一计时消费；缺省 → 不跑 */
  enemies?(): { uid: number; x: number; z: number }[];
  /** ★ 可攻击单位（排除工兵）：仅攻击队列入队口径；缺省 → 用 enemies() */
  attackables?(): { uid: number; x: number; z: number }[];
  /** ★ 工兵数据/落地端口（建造位置查询/施工落地）：缺省 → 工兵保持站位 */
  engineer?(): EngineerPort | null;
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
  spawnBattalion?(instant: boolean): boolean;
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
  private readonly holdUntil = new Map<number, number>();
  /** ★ 波次/放行（决策源；用户定 2026-09-25 自指挥官迁入） */
  private wave1Sent = false;
  private finalSent = false;
  private lastT01 = -1;
  readonly dbg = { ticks: 0, shadow: false, ringMin: 0, ringMax: 0, issued: 0, refreshed: 0, spread: 0, last: '' };
  /** 影子模式：只算不发（默认 false = 真下发；旧链已删，影子仅调试用） */
  shadow = false;

  private readonly core: EngineCore;

  constructor(private readonly live: LiveView) {
    this.sectors.build(4);   // 默认四扇区（引擎初始化）
    this.timers = new TimerManager({
      roster: () => (this.live.enemies?.() ?? []).map((e) => e.uid),
      posOf: (uid) => {
        const e = (this.live.enemies?.() ?? []).find((x) => x.uid === uid);
        return e ? { x: e.x, z: e.z } : null;
      },
      exemptOf: (uid) => this.live.exemptOf?.(uid) ?? null,
      onExpire: (uid, why) => {
        // ★ 消费（用户定）：计时销毁/卡死判决 → 真回收/退役（实体 retire / 代理回收）
        const hit = this.live.retire?.(uid, why) ?? false;
        this.dbg.last = `expire#${uid}:${why}${hit ? '' : '(gone)'}`;
      },
    });
    this.melee = new MeleeManager(this.squads);
    this.ranged = new RangedManager(this.squads);
    this.flyer = new FlyerManager(this.squads);
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
      threat: this.pos.player() ?? undefined,
      seq: 0,
      ttl: PLAYER_ORDER_TTL,
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
    for (const sq of this.live.squads()) {
      if (!this.squads.get(sq.id)) this.squads.register(sq.id, sq.role, sq.alive, now);
      this.pos.setSquad(sq.id, sq.x, sq.z);
      this.squads.report(
        { squadId: sq.id, x: sq.x, z: sq.z, alive: sq.alive, atom: 'act', phase: 'executing', hpRatio: sq.hpRatio },
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

  /** 开火检验（射程/ROE；影子模式只判距离） */
  private canFire(uid: number, ents: readonly { uid: number; x: number; z: number }[]): boolean {
    let e: { uid: number; x: number; z: number } | null = null;
    for (const x of ents) if (x.uid === uid) { e = x; break; }
    if (!e) return false;
    const p = this.pos.player();
    const s = this.pos.ship();
    const dp = p ? Math.hypot(e.x - p.x, e.z - p.z) : Infinity;
    const ds = s ? Math.hypot(e.x - s.x, e.z - s.z) : Infinity;
    return Math.min(dp, ds) <= this.fireRange;
  }

  private situation(now: number): void {
    const p = this.pos.player();
    if (!p) return;
    // 保护关系：玩家打某小队 → 登记保护（用最近的其他队当保护者）
    const hit = this.live.playerAttacking?.() ?? 0;
    if (hit > 0) {
      const g = this.pos.squad(hit);
      if (g) {
        const protector = this.pos.nearestSquad(g.x, g.z, new Set([hit]));
        if (protector >= 0) this.protect.assign(protector, hit, g.x, g.z);
      }
    }
    this.protect.refresh(this.pos.squadOf, p.x, p.z);
    // ★ 波次/兵力放行（决策源；自指挥官迁入）：t01 回退（换落点/新一日）→ 波次复位
    const t01 = this.live.t01?.() ?? 0;
    if (t01 < this.lastT01 - 0.2) { this.wave1Sent = false; this.finalSent = false; }
    this.lastT01 = t01;
    const total = this.live.ledgerTotal?.() ?? 0;
    this.live.setReleaseCap?.(Math.ceil(total * releaseAt(t01)));
    if (!this.wave1Sent && t01 >= 0.45) {
      this.wave1Sent = true;
      this.live.spawnBattalion?.(false);
      this.dbg.last = 'wave1';
    }
    if (!this.finalSent && t01 >= 0.80) {
      this.finalSent = true;
      this.live.spawnBattalion?.(true);
      this.dbg.last = 'final';
    }
  }

  /** ★ 第一波已发（波次决策源状态；main → LiveView.wave1） */
  get wave1Active(): boolean {
    return this.wave1Sent;
  }

  private decide(now: number): void {
    const ctx = { pos: this.pos, ringMin: this.dbg.ringMin, ringMax: this.dbg.ringMax, now };
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
    const p = this.pos.player();
    if (!p) return;
    const hitId = this.live.playerAttacking?.() ?? 0;
    interface Pending { rec: LiveSquad; cur?: OrderState; dec: Decision; tx: number; tz: number; mission?: string; }
    const pending: Pending[] = [];
    /** 无决策队（玩家令/无目标）的现令目标：作同兵种间距的**固定约束**（不随本拍调整） */
    const held = new Map<number, { x: number; z: number }>();
    // ---- pass ①：单源决策（不写令）——先算出本拍**真实目标**（含 defend=守原地） ----
    for (const rec of [...this.squads.all()]) {
      // ★ 玩家令生命周期（《RTS架构.md》§5）：TTL 到期 → 释放，交回引擎决策（工兵也适用——防旧板目标锁死）
      const cur0 = this.writer.store.get(rec.id);
      if (cur0 && cur0.order.source === 'player' && cur0.order.ttl > 0
        && now - cur0.issuedAt >= cur0.order.ttl) {
        this.writer.release(rec.id);
      }
      // ★ 工兵 = 新引擎全权（用户定 2026-09-25）：目标 = 建造位置查询结果；
      //   不参与战术决策链（重伤撤退/保护由管理器施工优先），不入攻击队列（接线层过滤）。
      if (rec.role === 'engineer') {
        const curE = this.writer.store.get(rec.id);
        if (curE && curE.order.source === 'player') { held.set(rec.id, curE.order.target); continue; }
        const tE = this.engineer.targets.get(rec.id);
        if (!tE) { if (curE) held.set(rec.id, curE.order.target); continue; }
        pending.push({ rec, cur: curE, dec: ENGINEER_DECISION, tx: tE.x, tz: tE.z, mission: 'build' });
        continue;
      }
      const cur = this.writer.store.get(rec.id);
      const mgr = rec.role === 'melee' ? this.melee : rec.role === 'ranged' ? this.ranged : rec.role === 'flyer' ? this.flyer : this.engineer;
      const t = mgr.targets.get(rec.id);
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
      const final = force ?? dec;
      if (!final) {
        if (cur) held.set(rec.id, cur.order.target);
        continue;
      }
      // 防御=守原地（target 为空时用**该队自身位置**；不是玩家位置——否则多队叠在同一目标=间距 0）
      const tx = final.target ? final.target.x : sp?.x ?? rec.x;
      const tz = final.target ? final.target.z : sp?.z ?? rec.z;
      pending.push({ rec, cur, dec: final, tx, tz });
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
      if (!v.ok) {
        if (q.cur && !this.shadow) { this.live.emit?.(q.rec.id, q.cur.order, now); refreshed++; }
        continue;
      }
      const link = this.protect.linkOf(q.rec.id);
      // ★ 引擎命令语言：复合句（语法）→ 良构校验 → 解释器 → 唯一发令器（用户定 2026-09-25）
      const sentence: SquadOrder = {
        kind: q.dec.kind, source: 'engine', target: { x: v.x, z: v.z },
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
        anchor: it.anchor, threat: it.threat,
        seq: 0, ttl: 0,
        mission: q.mission,
      };
      // ★ 执行板续期（重写 P4；用户定）：旧指挥链已删——唯一发令器每拍把**当前令**同步到执行板，
      //   否则旧板 TTL 到期 → 执行层丢令。新令/被拦都续。
      if (this.writer.issue(q.rec.id, order, { now })) {
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
