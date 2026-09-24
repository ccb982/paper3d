// ============================================================
// engine/EngineBridge.ts —— 实机接线桥（重写 P3；影子模式先行）
// ============================================================
// 把新引擎接到实机（**不破坏旧路径**）：
//   · 影子模式（shadow=true，默认）：新引擎**只读 + 只算 + 只记**——用 dbg 与旧路径对照
//   · 实机模式（shadow=false）：write 相位经 OrderWriter 真下发（emit 回调交给旧 OrderBus）
// 实机状态由 LiveView 注入（main.ts 适配；引擎不直读世界，G4）；
// 发令唯一出口 OrderWriter（G1），汇报唯一接收器 SquadManager（铁律 7）。
// ============================================================

import type { MobRole, SquadOrder } from './contracts';
import { Positions } from './Positions';
import { SquadManager } from './SquadManager';
import { SectorManager } from './SectorManager';
import { MeleeManager } from './MeleeManager';
import { RangedManager } from './RangedManager';
import { FlyerManager } from './FlyerManager';
import { EngineerManager } from './EngineerManager';
import { OrderWriter, SquadOrderStore } from './OrderWriter';
import { validateOrder } from './OrderValidator';
import { decideChain } from './DecisionChain';
import { Protect } from './Protect';
import { AttackQueues } from './AttackQueues';
import { TimerManager } from './TimerManager';
import { EngineCore } from './EngineCore';

export interface LiveSquad {
  id: number;
  role: MobRole;
  x: number;
  z: number;
  alive: number;
}

export interface LiveView {
  /** 玩家位置（无 → null） */
  player(): { x: number; z: number } | null;
  /** 舰船位置（无 → null） */
  ship(): { x: number; z: number } | null;
  /** 各小队（队长位置 + 兵种 + 存活） */
  squads(): LiveSquad[];
  /** 长寻路可达检测（实机注入；无 → 跳过 ③） */
  canReach?(x: number, z: number): boolean;
  /** 下发回调（实机模式用：交给旧执行链；影子模式不调）——带 squadId（哪队） */
  emit?(squadId: number, order: SquadOrder): void;
  /** 玩家是否在打某小队（被打反应：引擎告知队长玩家位置；0 = 无） */
  playerAttacking?(): number;
  /** 全体敌方单位（含代理；uid/位置）——攻击队列 + 统一计时消费；缺省 → 不跑 */
  enemies?(): { uid: number; x: number; z: number }[];
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
  readonly dbg = { ticks: 0, shadow: true, ringMin: 0, ringMax: 60, issued: 0, last: '' };
  /** 影子模式：只算不发（默认 true；`?swarm=new` 实机时可关） */
  shadow = true;

  private readonly core: EngineCore;

  constructor(private readonly live: LiveView) {
    this.sectors.build(4);   // 默认四扇区（引擎初始化）
    this.timers = new TimerManager({
      roster: () => (this.live.enemies?.() ?? []).map((e) => e.uid),
      posOf: (uid) => {
        const e = (this.live.enemies?.() ?? []).find((x) => x.uid === uid);
        return e ? { x: e.x, z: e.z } : null;
      },
      exemptOf: () => null,
      onExpire: (uid, why) => {
        // 影子模式只记账；实机由引擎 removeAgent 接管（接线时替换）
        this.dbg.last = `expire#${uid}:${why}`;
      },
    });
    this.melee = new MeleeManager(this.squads);
    this.ranged = new RangedManager(this.squads);
    this.flyer = new FlyerManager(this.squads);
    this.engineer = new EngineerManager(this.squads);
    this.core = new EngineCore({
      perceive: (now) => this.perceive(now),
      situation: () => this.situation(),
      decide: () => this.decide(),
      write: (now) => this.write(now),
      debug: () => this.debug(),
    });
  }

  /** 每帧（dt/now 实秒） */
  tick(dt: number, now: number): void {
    this.core.tick(dt, now);
  }

  /** ★ 玩家命令入口（用户定）：玩家 → **唯一发令器**（player 旁路）→ **只给队长**。
   *  成员由队长自行组织（铁律 1：引擎/玩家都只指挥队长）。 */
  playerOrder(squadId: number, kind: SquadOrder['kind'], target: { x: number; z: number }): boolean {
    const order: SquadOrder = {
      kind,
      source: 'player',
      target,
      roe: 'engage',
      seq: 0,
      ttl: 0,
    };
    const ok = this.writer.issue(squadId, order, { now: this.dbg.ticks, player: true });
    if (ok && !this.shadow) this.live.emit?.(squadId, order);
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
        { squadId: sq.id, x: sq.x, z: sq.z, alive: sq.alive, atom: 'act', phase: 'executing' },
        now,
      );
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
      this.queues.update(ents, (uid) => this.canFire(uid, ents), this.timers);
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

  private situation(): void {
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
  }

  private decide(): void {
    const ctx = { pos: this.pos, ringMin: this.dbg.ringMin, ringMax: this.dbg.ringMax, now: 0 };
    this.melee.sync();
    this.ranged.sync();
    this.flyer.sync();
    this.engineer.sync();
    this.melee.assign(ctx);
    this.ranged.assign(ctx);
    this.flyer.assign(ctx);
    this.engineer.assign(ctx);
  }

  private write(now: number): void {
    const p = this.pos.player();
    if (!p) return;
    const hitId = this.live.playerAttacking?.() ?? 0;
    const sibsOf = (role: MobRole, self: number) => {
      const out: { id: number; role: string; x: number; z: number }[] = [];
      const mgr = role === 'melee' ? this.melee : role === 'ranged' ? this.ranged : role === 'flyer' ? this.flyer : this.engineer;
      for (const [id, t] of mgr.targets) if (id !== self) out.push({ id, role, x: t.x, z: t.z });
      return out;
    };
    let issued = 0;
    for (const rec of [...this.squads.all()]) {
      // ★ 工兵暂不接管（用户定：先保证正常）：工事/派件仍走旧指挥官路径，
      //   否则新引擎的"保持站位"令会盖掉派件（实测工事建成 0）
      if (rec.role === 'engineer') continue;
      const mgr = rec.role === 'melee' ? this.melee : rec.role === 'ranged' ? this.ranged : rec.role === 'flyer' ? this.flyer : this.engineer;
      const t = mgr.targets.get(rec.id);
      const sp = this.pos.squad(rec.id);
      // ★ 显式优先链（单源决策）：玩家>重伤>事态>干预>常规（不靠调用顺序）
      const cur = this.writer.store.get(rec.id);
      const dec = decideChain({
        playerOrder: cur !== undefined && cur.order.source === 'player',
        hpRatio: 1,
        atRingMax: this.dbg.ringMax > 0 && sp !== null && Math.hypot(sp.x - p.x, sp.z - p.z) >= this.dbg.ringMax,
        underAttack: hitId === rec.id || this.protect.linkOf(rec.id) !== undefined,
        intervention: null,
        routine: t ?? null,
        px: p.x,
        pz: p.z,
      });
      if (!dec) continue;   // 玩家令在身 / 无决策 → 引擎不产令
      // 防御=守原地（target 为空时用当前位置）
      const tx = dec.target ? dec.target.x : sp?.x ?? p.x;
      const tz = dec.target ? dec.target.z : sp?.z ?? p.z;
      const v = validateOrder(rec.id, tx, tz, {
        px: p.x, pz: p.z, ringMin: this.dbg.ringMin, ringMax: this.dbg.ringMax,
        role: rec.role, siblings: sibsOf(rec.role, rec.id), canReach: this.live.canReach,
      });
      if (!v.ok) continue;
      const order: SquadOrder = {
        kind: dec.kind, source: 'engine', target: { x: v.x, z: v.z },
        anchor: this.protect.linkOf(rec.id)?.anchor,
        roe: 'engage', seq: 0, ttl: 0,
      };
      // 唯一发令器（G1）：影子模式也走（只写本地 store，不发实机）
      if (this.writer.issue(rec.id, order, { now })) {
        issued++;
        if (!this.shadow) this.live.emit?.(rec.id, order);
      }
    }
    this.dbg.issued = issued;
  }

  private debug(): void {
    this.dbg.ticks++;
    this.dbg.shadow = this.shadow;
    this.dbg.last = `t#${this.dbg.ticks} squads=${this.squads.dbg.count} issued=${this.dbg.issued}`;
  }
}
