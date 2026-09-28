// ============================================================
// engine/EngineBridge —— 蜂群引擎（命令侧重写 2026-09-27；用户定稿九条）
// ============================================================
// ★ 蜂群引擎 = **唯一指挥源**：每一拍给每支小队**一个状态标签 + 数据载荷**
//   （唯一发令口 OrderWriter；队长核只读标签）。
//
//   标签：protect / hold / patrol / march / assault（总攻=标签）
//     · march 短时效：**到达 → 引擎换标**（换 hold）；
//     · hold / patrol / protect：**在没有新命令覆盖前一直执行**。
//
//   命令来源（仅四源）：
//     ① 玩家令（原样执行、无 TTL；引擎不覆盖——直到新命令）
//     ② 总攻（assault）：全体到**舰旁可站点**
//     ③ 工兵活源（纯数据）：march 到施工点
//     ④ **唯一兜底 = 行军 ↔ 巡逻交替**（推进一段 → 巡一段 → 再推进…）
//
//   其余一切机制不存在（决策链/校验链/切向间距/驻留锁存/救援重发/自动转巡… 均已删）。
//   管理器只编成/补兵（架构第 9 条）；开火独立（AttackQueues/TimerManager）。
// ============================================================

import type { MobRole, SquadOrder } from './contracts';
import { Positions } from './Positions';
import { SquadManager } from './SquadManager';
import { SectorManager } from './SectorManager';
import { MeleeManager } from './MeleeManager';
import { RangedManager } from './RangedManager';
import { FlyerManager } from './FlyerManager';
import { EngineerManager, type EngineerPort } from './EngineerManager';
import { OrderWriter, SquadOrderStore } from './OrderWriter';
import { releaseAt } from '../PostureFn';
import { Protect } from './Protect';
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
  /** 池代理位置（卡死判官在册） */
  agents?(): readonly { uid: number; x: number; z: number }[];
  /** 卡死豁免（驻守/交战…） */
  exemptOf?(uid: number): string | null;
  /** 计时销毁/卡死回收落地 */
  retire?(uid: number, why: string): boolean;
  /** 第一波已发（波次状态） */
  wave1?(): boolean;
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
  readonly sectors = new SectorManager();
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
  private static readonly PLAN_MOVE_TIMEOUT = 25; // 单段安全超时（秒）
  private static readonly HOLD_R = 8;             // 到达判定（=队长到位口径）

  /** 波次/放行（决策源状态；releaseCap 仍走账本） */
  private wave1Sent = false;
  private finalSent = false;
  private lastT01 = -1;
  readonly dbg = { ticks: 0, shadow: false, ringMin: 0, ringMax: 0, issued: 0, refreshed: 0, spread: 0, stall: 0, last: '' };
  /** 影子模式：只算不发（仅调试用） */
  shadow = false;
  /** 直控模式：关引擎 decide/write（只执行玩家指令） */
  directMode = false;

  private readonly core: EngineCore;

  constructor(private readonly live: LiveView) {
    this.sectors.build(4);
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
      onExpire: (uid, why) => {
        const hit = this.live.retire?.(uid, why) ?? false;
        this.dbg.last = `expire#${uid}:${why}${hit ? '' : '(gone)'}`;
      },
    });
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
    }
    this.sectors.tick((id) => this.pos.squad(id), this.pos.player()?.x ?? 0, this.pos.player()?.z ?? 0, [...this.squads.all()].map((r) => r.id));
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

  /** 舰旁可站点（总攻吸附；过滤不可走/坑） */
  private shipSidePoint(sx: number, sz: number): { x: number; z: number } {
    let tx = sx, tz = sz, found = false;
    outer: for (let r = 2; r <= 10 && !found; r += 2) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const qx = sx + Math.cos(a) * r, qz = sz + Math.sin(a) * r;
        if (!(this.live.blockedAt?.(qx, qz) ?? false)) { tx = qx; tz = qz; found = true; break outer; }
      }
    }
    return { x: tx, z: tz };
  }

  /** 下一段推进点：从当前位置朝舰 PLAN_ADV 米（不越活动带前缘）；到带缘 → null。
   *  ★ 寻路可行性由**队长核**负责（长/短寻路）；引擎只给目标（定稿第 4 条）。 */
  private advancePoint(sp: { x: number; z: number }): { x: number; z: number } | null {
    const ship = this.pos.ship() ?? this.pos.player();
    if (!ship) return null;
    const front = Math.max(EngineBridge.PLAN_NEAR, this.dbg.ringMin > 0 ? this.dbg.ringMin : 0);
    const dx = ship.x - sp.x, dz = ship.z - sp.z;
    const d = Math.hypot(dx, dz);
    if (d <= front) return null;
    const step = Math.min(EngineBridge.PLAN_ADV, d - front);
    if (step <= 1) return null;
    return { x: sp.x + (dx / d) * step, z: sp.z + (dz / d) * step };
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

  get wave1Active(): boolean {
    return this.wave1Sent;
  }

  /** 管理器只编成/补兵（架构第 9 条；ctx = 只读输入） */
  private decide(now: number): void {
    if (this.directMode) return;
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
    const assaultT = assault ? this.shipSidePoint(ship.x, ship.z) : null;
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

      // ② 总攻（标签 assault）：全体到舰旁可站点（同签名去重）
      if (assault && assaultT) {
        const same = cur && cur.order.state === 'assault' && cur.order.kind === 'patrol'
          && Math.hypot(cur.order.target.x - assaultT.x, cur.order.target.z - assaultT.z) <= 1;
        if (!same) {
          if (this.send(rec.id, 'assault', assaultT, now, { kind: 'patrol', force: true })) issued++;
        }
        continue;
      }

      // ③ 工兵活源（纯数据）：march 到施工点；到点/无活 → 落唯一兜底
      if (rec.role === 'engineer') {
        const t = this.engineer.targets.get(rec.id);
        if (t && Math.hypot(t.x - sp.x, t.z - sp.z) >= 3) {
          const same = cur && cur.order.mission === 'build'
            && Math.hypot(cur.order.target.x - t.x, cur.order.target.z - t.z) <= 2;
          if (!same) {
            if (this.send(rec.id, 'march', { x: t.x, z: t.z }, now, { kind: 'act', mission: 'build', force: true })) issued++;
          }
          continue;
        }
      }

      // ④ 唯一兜底 = 行军 ↔ 巡逻交替（定稿第 8 条）
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
          const np = this.advancePoint(sp);
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
            if (this.send(rec.id, 'patrol', { x: pl.x, z: pl.z }, now, { kind: 'patrol' })) issued++;
          }
        }
      }
    }
    this.dbg.issued = issued;
    this.dbg.refreshed = 0;
  }

  /** 唯一发令路径：标签+载荷 → OrderWriter → 队长核（ok=false 表示同签名被去重/被稳定门 keep，不重发） */
  private send(
    id: number,
    state: NonNullable<SquadOrder['state']>,
    target: { x: number; z: number },
    now: number,
    opt?: { kind?: SquadOrder['kind']; mission?: string; force?: boolean },
  ): boolean {
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
