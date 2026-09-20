// ============================================================
// SwarmCommander —— 蜂群指挥器（引擎侧：大队任务 / 小队覆盖 / BattalionView）
// ============================================================
// 《实体架构.md》§5.11 命令层级：
//   大队任务 BattalionMission（path + target，全队基线）
//   → 小队覆盖 SquadOrder（引擎可对特定小队覆盖；subTargets 按 squadId 分派）
//   → 队长个体指令（SquadTactics 分解 → 原子执行）
// 输入面 BattalionView（各队评级 + 全局玩家/舰船位置）；战术决策（F3+）后续消费本层。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import type { SwarmSystem } from './SwarmSystem';
import { analyzeLandingTerrain, type DefensePlan } from './LandingTerrain';
import type { SquadRating } from './SquadTable';
import type { TacticalOrder, UnitRole } from '../../entity/SwarmUnit';

/** ★ 引擎侧信息面（《蜂群架构.md》§16.6）：战术决策的输入 */
export interface BattalionView {
  squads: SquadRating[];
  playerX: number;
  playerZ: number;
  shipX: number;
  shipZ: number;
  now: number;
}

export class SwarmCommander {
  /** 大队任务（基线；周期重发保持存活，队长不抢） */
  private mission: TacticalOrder | null = null;
  /** ★ S0 勘察：地形检测产出的防守布置 */
  private plan: DefensePlan | null = null;
  /** ★ 工程阶段（S1）：造掩体端口（模式层注入；生成 CoverEntity(owner:'enemy', poster:false)） */
  buildCover: ((x: number, z: number, variant: 'cover' | 'wall') => void) | null = null;
  /** ★ S1：挖战壕端口（模式层注入；每次一块 4×4m、1 层） */
  digTrench: ((x: number, z: number) => void) | null = null;
  /** ★ 兵力创建端口（模式层注入：按角色在 (x,z) 生成一只；**全权在本层**） */
  spawnMob: ((x: number, z: number, role: UnitRole, elite?: boolean) => void) | null = null;
  /** ★ 大队：一队 30 怪；一局多个 */
  private battalionCount = 0;
  private reinforceAccum = 0;
  /** ★ 待登场队列（**逐步登场**；总攻可一次性整编队） */
  private spawnQueue: { x: number; z: number; role: UnitRole; elite: boolean }[] = [];
  private spawnAccum = 0;
  /** 登场间隔（秒/只） */
  private static readonly SPAWN_INTERVAL = 1.5;
  private static readonly BATTALION_SIZE = 30;
  private static readonly BATTALION_MAX = 4;
  private static readonly REINFORCE_S = 180;
  /** ★ 战术阶段（S0 勘察 → S1 工程 → S2 防线就绪） */
  stage: 'S0' | 'S1' | 'S2' = 'S0';
  /** ★ 待建工事块（逐步拼装：掩体每块 4m，战壕每块 4m；外环 → 内环） */
  private buildPieces: { kind: 'cover' | 'trench'; x: number; z: number; ring: 0 | 1 | 2 }[] = [];
  private readonly builtSlots = new Set<string>();
  private engAccum = 0;
  private buildCd = 0;
  private resendAccum = 0;
  private static readonly RESEND_S = 10;

  constructor(private readonly swarm: SwarmSystem) {}

  /** ★ 大队任务（路径 + 目标；`subTargets` 按 squadId 分派到各队） */
  setMission(order: TacticalOrder | null): void {
    this.mission = order;
    this.resendAccum = 0;
    this.dispatchMission();
  }

  /** ★ 对特定小队下覆盖命令（引擎优先级最高，队长不抢） */
  orderSquad(squadId: number, order: TacticalOrder, ttl = 30): void {
    this.swarm.issueOrder(squadId, order, ttl);
  }

  /** ★ 发信号（五轴「时序」：等 signal 的命令到点生效） */
  emitSignal(id: number): void {
    this.swarm.tactics.board.emitSignal(id);
  }

  /** ★ S0 勘察：舰船落地周边地形检测 → DefensePlan（高地/掩体位/来向/三环） */
  planDefense(cx: number, cz: number, radius = 80): DefensePlan | null {
    const raster = RasterMap.current;
    if (!raster) return null;
    this.plan = analyzeLandingTerrain(raster, cx, cz, radius);
    // ★ 建造顺序：外环（≈56m）50m 开外）→ 中环 → 内环（≈24m ≈ 远程覆盖线）
    //   每环：**掩体先行**（每个掩位 3 块，沿切线 ±4m → 12m 宽）→ **战壕跟进**（该环弧上每 4m 一块）
    const ringOrder: (0 | 1 | 2)[] = [2, 1, 0];
    this.buildPieces = [];
    for (const r of ringOrder) {
      const tx = -this.plan.approachZ, tz = this.plan.approachX;   // 环的切线方向
      for (const slot of this.plan.coverSlots.filter((s) => s.ring === r)) {
        for (const off of [-4, 0, 4]) {
          this.buildPieces.push({ kind: 'cover', x: slot.x + tx * off, z: slot.z + tz * off, ring: r });
        }
      }
      const line = this.plan.trenchLines[r] ?? [];
      for (const p of line) this.buildPieces.push({ kind: 'trench', x: p.x, z: p.z, ring: r });
    }
    this.builtSlots.clear();
    this.stage = 'S1';
    // ★ 兵力创建（全权在本层）：首批驻防大队（S0）
    this.spawnBattalion();
    return this.plan;
  }

  /** ★ 生成一个大队（30 怪；按角色配比 · 沿外环弧部署；后续大队更远列阵）
   *  @param instant 总攻用：true = 一次性上整编队；false = **逐步登场**（队列滴灌） */
  spawnBattalion(instant = false): boolean {
    const plan = this.plan;
    if (!plan || !this.spawnMob || this.battalionCount >= SwarmCommander.BATTALION_MAX) return false;
    this.battalionCount++;
    // ★ 配比（基准 30；2026-09-19 用户定调）：盾 6 / 突击 10 / 远程 6 / 后勤 4 / 飞行 4
    //   每类 ±2 随机浮动（下限 1）；另概率额外带 1~2 只精英怪
    const base: [UnitRole, number][] = [
      ['shield', 6], ['assault', 10], ['ranged', 6], ['logistics', 4], ['flyer', 4],
    ];
    const comp = base.map(([role, n]) => [role, Math.max(1, n + Math.round((Math.random() - 0.5) * 4))] as [UnitRole, number]);
    const baseA = Math.atan2(plan.approachZ, plan.approachX);
    // ★ 集结区（正面楔形：±30°、≈96m 起）——从来向远处进场，**不围圈**
    const ringR = 96 + (this.battalionCount - 1) * 8;
    // 精英：50% 额外 1 只，20% 再多 1 只（沿环布置，比例不计入基准 30）
    const eliteN = (Math.random() < 0.5 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0);
    let total = comp.reduce((s, [, n]) => s + n, 0) + eliteN;
    let k = 0;
    const push = (role: UnitRole, elite: boolean): void => {
      const a = baseA + (-1 + (2 * k) / total) * (Math.PI / 6);   // 来向 ±30°（正面楔形）
      const rr = ringR + (Math.random() - 0.5) * 10;              // 小幅纵深抖动
      const x = plan.cx + Math.cos(a) * rr;
      const z = plan.cz + Math.sin(a) * rr;
      k++;
      if (instant) this.spawnMob?.(x, z, role, elite);
      else this.spawnQueue.push({ x, z, role, elite });   // ★ 逐步登场
    };
    for (const [role, n] of comp) {
      for (let i = 0; i < n; i++) push(role, false);
    }
    for (let i = 0; i < eliteN; i++) push('assault', true);
    return true;
  }

  /** ★ 防守布置（读；阶段机 S0~S6 消费） */
  get defensePlan(): DefensePlan | null {
    return this.plan;
  }

  /** ★ 取离 (x,z) 最近的高地（半径内；无 = null）——远程队占顶用 */
  private pickHighGroundNear(
    plan: DefensePlan, x: number, z: number, radius: number,
  ): { x: number; z: number; h: number } | null {
    let best: { x: number; z: number; h: number } | null = null;
    let bestD2 = radius * radius;
    for (const g of plan.highGround) {
      const d2 = (g.x - x) ** 2 + (g.z - z) ** 2;
      if (d2 <= bestD2) { bestD2 = d2; best = g; }
    }
    return best;
  }

  setDefensePlan(plan: DefensePlan | null): void {
    this.plan = plan;
  }

  /** ★ 引擎侧信息面（战术决策的输入；每拍现取，零缓存） */
  view(playerX: number, playerZ: number, shipX: number, shipZ: number): BattalionView {
    return {
      squads: this.swarm.ratings(),
      playerX,
      playerZ,
      shipX,
      shipZ,
      now: performance.now() / 1000,
    };
  }

  /** ★ 每帧：大队任务周期重发（TTL 保持）+ S1 工程 */
  tick(dt: number, playerX = 0, playerZ = 0): void {
    if (this.mission) {
      this.resendAccum += dt;
      if (this.resendAccum >= SwarmCommander.RESEND_S) {
        this.resendAccum = 0;
        this.dispatchMission();
      }
    }
    this.engineeringTick(dt, playerX, playerZ);
    // ★ 逐步登场：队列滴灌（每 SPAWN_INTERVAL 出一只；总攻走 instant 不入队）
    if (this.spawnQueue.length > 0) {
      this.spawnAccum += dt;
      while (this.spawnAccum >= SwarmCommander.SPAWN_INTERVAL && this.spawnQueue.length > 0) {
        this.spawnAccum -= SwarmCommander.SPAWN_INTERVAL;
        const u = this.spawnQueue.shift()!;
        this.spawnMob?.(u.x, u.z, u.role, u.elite);
      }
    }
    // ★ 增援：战术启动后每 REINFORCE_S 再来一个大队（上限 BATTALION_MAX）
    if (this.plan && this.stage !== 'S0') {
      this.reinforceAccum += dt;
      if (this.reinforceAccum >= SwarmCommander.REINFORCE_S) {
        this.reinforceAccum = 0;
        this.spawnBattalion();
      }
    }
  }

  /** ★ S1 工程（2s 决策拍）：掩护队先行 → 工程兵小步跟进 →
   *  在掩护下造防线；**远程队提供火力支援**（protect 施工点）；其余队向防线后集结。 */
  private engineeringTick(dt: number, playerX: number, playerZ: number): void {
    if (this.stage !== 'S1' || !this.plan || !this.buildCover) return;
    this.buildCd -= dt;
    const squads = [...this.swarm.squads.all()];
    const builders = squads.filter((s) => s.type === 'logistics');
    if (builders.length === 0) return;
    this.engAccum += dt;
    if (this.engAccum < 2) return;   // 2s 决策拍
    this.engAccum = 0;
    const slot = this.buildPieces.find((s) => !this.builtSlots.has(`${s.x},${s.z}`));
    if (!slot) { this.stage = 'S2'; return; }
    // 玩家跌进施工点 30m：暂停施工（转防御；队长自主交战接管）
    if (Math.hypot(playerX - slot.x, playerZ - slot.z) < 30) return;
    const plan = this.plan;
    // ① 掩护队（盾/突击，最多 2 队）先行到防线前方
    for (const s of squads.filter((q) => q.type === 'defense' || q.type === 'assault').slice(0, 2)) {
      this.swarm.issueOrder(s.id, {
        kind: 'advance',
        target: { x: slot.x + plan.approachX * 10, z: slot.z + plan.approachZ * 10 },
        roe: 'engage',
        seq: 0,
      }, 6);
    }
    // ①b ★ 隘口据守（地形分析产物）：防御队各领一个隘口（有则驻守，无则跳过）
    if (plan.chokepoints.length > 0) {
      const guards = squads.filter((q) => q.type === 'defense').slice(0, plan.chokepoints.length);
      for (let i = 0; i < guards.length; i++) {
        const c = plan.chokepoints[i];
        this.swarm.issueOrder(guards[i].id, {
          kind: 'protect',
          target: { x: c.x, z: c.z },
          roe: 'engage',
          seq: 0,
        }, 8);
      }
    }
    // ② 工程兵小步跟进（到待建位；holdFire 行军）
    for (let i = 0; i < builders.length; i++) {
      const t = this.buildPieces.find((q, idx) => idx >= i && !this.builtSlots.has(`${q.x},${q.z}`)) ?? slot;
      this.swarm.issueOrder(builders[i].id, { kind: 'advance', target: { x: t.x, z: t.z }, roe: 'holdFire', seq: 0 }, 6);
    }
    // ③ ★ 远程队：优先占据高地（地形分析产物；取离施工点最近的一处），
    //    无可占高地 → 火力支援施工点（protect）
    const highPick = this.pickHighGroundNear(plan, slot.x, slot.z, 48);
    for (const s of squads.filter((q) => q.type === 'ranged')) {
      if (highPick) {
        this.swarm.issueOrder(s.id, {
          kind: 'advance',
          target: { x: highPick.x, z: highPick.z },
          roe: 'fireOnArrival',
          seq: 0,
        }, 8);
      } else {
        this.swarm.issueOrder(s.id, {
          kind: 'protect',
          target: { x: slot.x, z: slot.z },
          roe: 'engage',
          seq: 0,
        }, 6);
      }
    }
    // ④ 其余队：向已建防线后集结
    for (const s of squads.filter((q) => q.type !== 'logistics' && q.type !== 'defense' && q.type !== 'assault' && q.type !== 'ranged')) {
      this.swarm.issueOrder(s.id, {
        kind: 'regroup',
        target: { x: slot.x - plan.approachX * 8, z: slot.z - plan.approachZ * 8 },
        seq: 0,
      }, 6);
    }
    // ⑤ 施工（**逐步拼装**）：工程兵到达待建块 ≤4m →
    //   掩体块（每块 4m，每 8s 一块）/ 战壕块（每块 4×4m、1 层，每 10s 一块）
    if (this.buildCd <= 0) {
      for (const s of builders) {
        let cx = 0, cz = 0, n = 0;
        for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
        if (n === 0) continue;
        cx /= n; cz /= n;
        if (Math.hypot(cx - slot.x, cz - slot.z) <= 4) {
          if (slot.kind === 'cover') {
            this.buildCover(slot.x, slot.z, 'cover');
            this.buildCd = 8;            // 慢工：掩体 8s/块（3 块 = 12m ≈ 24s）
          } else {
            this.digTrench?.(slot.x, slot.z);
            this.buildCd = 10;           // 慢挖：战壕 10s/块（3 块 = 12m ≈ 30s）
          }
          this.builtSlots.add(`${slot.x},${slot.z}`);
          break;
        }
      }
    }
  }

  /** 清理（退出模式） */
  clear(): void {
    this.mission = null;
    this.plan = null;
    this.stage = 'S0';
    this.battalionCount = 0;
    this.reinforceAccum = 0;
    this.spawnQueue = [];
    this.spawnAccum = 0;
    this.buildPieces = [];
    this.builtSlots.clear();
    this.engAccum = 0;
    this.buildCd = 0;
    this.resendAccum = 0;
  }

  private dispatchMission(): void {
    const m = this.mission;
    if (!m) return;
    for (const s of this.swarm.squads.all()) {
      this.swarm.issueOrder(s.id, m, SwarmCommander.RESEND_S + 5);
    }
  }
}
