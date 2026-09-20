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
import { resolveDoctrine, type MobTactics } from './SquadDoctrine';
import { applyPosture, PostureMachine, type BattlePosture } from './Posture';
import { BattleLine, type LineUnit } from './BattleLine';
import { RANGED } from './RangedTactics';
import { TerrainScore } from './TerrainScore';
import { coverBlocksLine } from '../../entity/CoverEntity';
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
  /** ★ 按 mobIndex 生成一只（名单重放用；模式层注入） */
  spawnMobIndex: ((x: number, z: number, mobIndex: number) => void) | null = null;
  /** ★ 逐兵种战术表（名册 `EnemySpec.tactics`；模式层按 mobIndex 提供） */
  mobTactics: ((mobIndex: number) => MobTactics | null) | null = null;
  /** ★ 当前态势（引擎内部变量；驱动各编队命令强度） */
  battlePosture: BattlePosture = 'fortify';
  /** ★ 态势机（转移条件集中在 Posture.ts） */
  private readonly postureMachine = new PostureMachine();
  /** 进入总攻时的兵力（撤退判定基准） */
  private aliveAtPosture = 0;
  /** ★ 战役级闭环（1Hz）：小队评级/求援/受阻 → 大队改派（自下而上的反馈闭环） */
  private tacticalAccum = 0;
  /** ★ 进攻队列调控（前/中/后排 + 车道；进攻态势时生效） */
  private readonly battleLine = new BattleLine();
  /** ★ 地块有利位置评分表（全兵种共用；掩体/态势变化即重建） */
  private readonly terrainScore = new TerrainScore();
  /** 评分表触发戳（换落点 +1） */
  private scoreStamp = 0;
  /** 态势代次（切换 → 触发整队） */
  private postureEpoch = 0;
  private readonly progress = new Map<number, { d: number; at: number; stall: number }>();
  private readonly supportCd = new Map<number, number>();
  /** 最近一次大队决策（调试/测试读取） */
  lastDecision: { squad: number; kind: string; at: number } | null = null;
  /** ★ 已建成的掩体（远程驻守点；换落点 planDefense 时清空） */
  private readonly builtCovers: { x: number; z: number }[] = [];
  /** ★ 起飞回收名单（兵种属性 + 数量；放置由本层决定） */
  private recalledRoster: { mobIndex: number; role: UnitRole; count: number }[] | null = null;
  /** ★ 大队：一队 30 怪；一局多个 */
  private battalionCount = 0;
  private reinforceAccum = 0;
  /** ★ 待登场队列（**逐步登场**；总攻可一次性整编队） */
  private spawnQueue: { x: number; z: number; role: UnitRole; elite: boolean; mobIndex: number }[] = [];
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

  /** ★ S0 勘察：舰船落地周边地形检测 → DefensePlan（高地/掩体位/来向/三环）
   *  @param playerX,playerZ 玩家位置：**参与战术轴**（玩家从哪边来，防线朝哪边摆） */
  planDefense(cx: number, cz: number, radius = 80, playerX?: number, playerZ?: number): DefensePlan | null {
    const raster = RasterMap.current;
    if (!raster) return null;
    // ★ 战术轴偏好 = 舰船 → 玩家（玩家在附近 15~140m 时；否则用扫描的最可走方向）
    let px: number | undefined, pz: number | undefined;
    if (playerX !== undefined && playerZ !== undefined) {
      const dx = playerX - cx, dz = playerZ - cz;
      const d = Math.hypot(dx, dz);
      if (d > 15 && d < 140) { px = dx / d; pz = dz / d; }
    }
    this.plan = analyzeLandingTerrain(raster, cx, cz, radius, px, pz);
    // ★ 建造顺序：外环（≈56m）50m 开外）→ 中环 → 内环（≈24m ≈ 远程覆盖线）
    //   每环：**掩体先行**（每个掩位 3 块，沿切线 ±4m → 12m 宽）→ **战壕跟进**（该环弧上每 4m 一块）
    const ringOrder: (0 | 1 | 2)[] = [2, 1, 0];
    this.buildPieces = [];
    // ★ 工程兵优先在**有利位置**（扫描产物评分）施工：同环内按 post 分排序
    const postScore = new Map<string, number>();
    for (const p of this.plan.posts) postScore.set(`${p.x.toFixed(1)},${p.z.toFixed(1)}`, p.score);
    const scoreOf = (x: number, z: number): number => postScore.get(`${x.toFixed(1)},${z.toFixed(1)}`) ?? 0;
    for (const r of ringOrder) {
      const tx = -this.plan.approachZ, tz = this.plan.approachX;   // 环的切线方向
      const slots = this.plan.coverSlots.filter((s) => s.ring === r)
        .sort((a, b) => scoreOf(b.x, b.z) - scoreOf(a.x, a.z));
      for (const slot of slots) {
        for (const off of [-4, 0, 4]) {
          this.buildPieces.push({ kind: 'cover', x: slot.x + tx * off, z: slot.z + tz * off, ring: r });
        }
      }
      const line = this.plan.trenchLines[r] ?? [];
      for (const p of line) this.buildPieces.push({ kind: 'trench', x: p.x, z: p.z, ring: r });
    }
    // ★ 兜底：地形分析没给出可用点位（开阔地/全被拒）→ 沿来向弧线自造掩体位
    if (this.buildPieces.length === 0) {
      const raster = RasterMap.current;
      const a0 = Math.atan2(this.plan.approachZ, this.plan.approachX);
      for (const r of [2, 1, 0] as const) {
        for (const k of [-2, 0, 2]) {
          const a = a0 + k * 0.35;
          const x = this.plan.cx + Math.cos(a) * [40, 60, 80][r];
          const z = this.plan.cz + Math.sin(a) * [40, 60, 80][r];
          const role = raster?.tileDefAt(x, z).genRole;
          if (role === 'pit' || role === 'liquid') continue;
          if (raster && raster.surfaceHeightAt(x, z) < -1.2) continue;
          this.buildPieces.push({ kind: 'cover', x, z, ring: r });
        }
      }
    }
    this.builtSlots.clear();
    this.progress.clear();      // ★ 换落点：战役级闭环状态复位
    this.supportCd.clear();
    this.battleLine.clear();    // ★ 换落点：进攻队列复位
    this.postCache.clear();     // ★ 现场有利位置缓存复位
    this.scoreStamp++;          // ★ 评分表触发戳（换落点重算）
    this.terrainScore.clear();
    this.stage = 'S1';
    // ★ 换登陆点 = 重新部署：取消上一落点排队的兵力，本落点重新起一个大队
    //   （舰船会不断移动换登陆点；每次落地都要有自己的防御布置）
    this.spawnQueue.length = 0;
    this.spawnAccum = 0;
    this.battalionCount = 0;
    // ★ 兵力创建（全权在本层）：起飞回收过 → 用**回收名单**做编成（数量/兵种照旧），
    //   放置位置仍由本层战术逻辑（来向楔形 + 落点环）决定；否则起全新驻防大队
    this.spawnBattalion(true);
    return this.plan;
  }

  /** ★ 起飞回收：只交**名单**（兵种属性 + 数量）——怎么布置由本层决定 */
  setRecalledRoster(roster: { mobIndex: number; role: UnitRole; count: number }[]): void {
    this.recalledRoster = roster.length > 0 ? roster : null;
  }

  /** ★ 生成一个大队（30 怪；按角色配比 · 沿外环弧部署；后续大队更远列阵）
   *  编成来源：优先**起飞回收名单**（兵种/数量照旧；放置仍按本层战术布置），
   *  否则标准配比（±2 随机 + 概率精英）。
   *  @param instant 总攻/落地用：true = 一次性上整编队；false = **逐步登场**（队列滴灌） */
  spawnBattalion(instant = false): boolean {
    const plan = this.plan;
    if (!plan || this.battalionCount >= SwarmCommander.BATTALION_MAX) return false;
    const roster = this.recalledRoster;
    const useRoster = !!roster && !!this.spawnMobIndex;
    if (!useRoster && !this.spawnMob) return false;
    this.battalionCount++;
    const entries: { role: UnitRole; elite: boolean; mobIndex: number }[] = [];
    if (useRoster) {
      this.recalledRoster = null;
      for (const r of roster!) {
        for (let i = 0; i < r.count; i++) entries.push({ role: r.role, elite: false, mobIndex: r.mobIndex });
      }
    } else {
      // ★ 配比（基准 30）：盾 6 / 突击 10 / 远程 6 / 后勤 4 / 飞行 4；每类 ±2；精英 0~2
      const base: [UnitRole, number][] = [
        ['shield', 6], ['assault', 10], ['ranged', 6], ['logistics', 4], ['flyer', 4],
      ];
      const comp = base.map(([role, n]) => [role, Math.max(1, n + Math.round((Math.random() - 0.5) * 4))] as [UnitRole, number]);
      for (const [role, n] of comp) for (let i = 0; i < n; i++) entries.push({ role, elite: false, mobIndex: -1 });
      const eliteN = (Math.random() < 0.5 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0);
      for (let i = 0; i < eliteN; i++) entries.push({ role: 'assault', elite: true, mobIndex: -1 });
    }
    if (entries.length === 0) return false;
    const baseA = Math.atan2(plan.approachZ, plan.approachX);
    // ★ 集结区（正面楔形：±30°、≈96m 起）——从来向远处进场，**不围圈**
    const ringR = 96 + (this.battalionCount - 1) * 8;
    const total = entries.length;
    // ★ 部署锚点：**优先用自身地形分析产出的可站点**（掩体位/高地/战壕线）——
    //   保证所有兵都落在可达陆地上（此前盲投 96m 环：施工队掉湖里 → 永远开不了工）；
    //   锚点不足时才退回来向楔形环。
    const anchors = this.placementAnchors(plan);
    let k = 0;
    for (const e of entries) {
      let x: number, z: number;
      if (anchors && anchors.length > 0) {
        const a = anchors[k % anchors.length];
        x = a.x + (Math.random() - 0.5) * 2;
        z = a.z + (Math.random() - 0.5) * 2;
      } else {
        const a = baseA + (-1 + (2 * k) / total) * (Math.PI / 6);
        const rr = ringR + (Math.random() - 0.5) * 10;
        x = plan.cx + Math.cos(a) * rr;
        z = plan.cz + Math.sin(a) * rr;
      }
      k++;
      if (instant) {
        if (e.mobIndex >= 0 && this.spawnMobIndex) this.spawnMobIndex(x, z, e.mobIndex);
        else this.spawnMob?.(x, z, e.role, e.elite);
      } else {
        this.spawnQueue.push({ x, z, role: e.role, elite: e.elite, mobIndex: e.mobIndex });
      }
    }
    return true;
  }

  /** ★ 可站部署锚点（地形分析产物：掩体位 + 高地 + 战壕线；空 = 无可用点） */
  private placementAnchors(plan: DefensePlan): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const c of plan.coverSlots) out.push({ x: c.x, z: c.z });
    for (const g of plan.highGround) out.push({ x: g.x, z: g.z });
    for (const line of plan.trenchLines) for (const p of line) out.push(p);
    return out;
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

  /** ★ 远程驻守点（掩体后侧）：已建掩体 > 规划掩体位；点在"掩体背向来向"一侧 1.2m。
   *  requireInRange = 只取距玩家 ≤48m 的（保证驻守点能射到玩家）；按距玩家近→远排序。 */
  private garrisonCovers(
    plan: DefensePlan, playerX: number, playerZ: number, requireInRange: boolean,
  ): { x: number; z: number }[] {
    const out: { x: number; z: number; d2: number }[] = [];
    const add = (x: number, z: number): void => {
      const bx = x - plan.approachX * 1.2;
      const bz = z - plan.approachZ * 1.2;
      const d2 = (bx - playerX) ** 2 + (bz - playerZ) ** 2;
      if (requireInRange && d2 > 48 * 48) return;
      out.push({ x: bx, z: bz, d2 });
    };
    for (const c of this.builtCovers) add(c.x, c.z);
    // ★ 扫描产物（有利位置）优先作为驻守点；coverSlots 兜底
    for (const p of plan.posts) add(p.x, p.z);
    for (const c of plan.coverSlots) add(c.x, c.z);
    out.sort((a, b) => a.d2 - b.d2);
    return out.map((o) => ({ x: o.x, z: o.z }));
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

  /** ★ 每帧：大队任务周期重发（TTL 保持）+ 部署维护 */
  tick(dt: number, playerX = 0, playerZ = 0): void {
    // ★ 态势更新（开局 fortify → patrol → advance → mass → assault → withdraw）
    const now = performance.now() / 1000;
    const builtRatio = this.buildPieces.length > 0
      ? this.builtSlots.size / this.buildPieces.length : 0;
    let contact = false;
    for (const [, t] of this.swarm.recentHits) {
      if (now - t <= 8) { contact = true; break; }
    }
    const next = this.postureMachine.update(now, {
      playerDist: this.plan ? Math.hypot(playerX - this.plan.cx, playerZ - this.plan.cz) : 9999,
      builtRatio,
      contact,
      aliveRatio: this.aliveAtPosture > 0
        ? this.swarm.ledger.alive / this.aliveAtPosture : 1,
    });
    if (next !== this.battlePosture) {
      this.battlePosture = next;
      this.postureEpoch++;   // ★ 态势切换 → 进攻队列重新整队
      if (next === 'assault') this.aliveAtPosture = this.swarm.ledger.alive;
      this.engAccum = 2;   // 态势切换 → 下一拍立即重发部署
    }
    // ★ 地块评分表重建（换落点/掩体数/态势变化才真正重算）
    if (this.plan) {
      const raster = RasterMap.current;
      if (raster) {
        this.terrainScore.rebuild(raster, this.plan, this.builtCovers, this.battlePosture,
          this.scoreStamp + this.postureEpoch * 100000 + this.builtCovers.length * 100);
      }
    }
    if (this.mission) {
      this.resendAccum += dt;
      if (this.resendAccum >= SwarmCommander.RESEND_S) {
        this.resendAccum = 0;
        this.dispatchMission();
      }
    }
    this.engineeringTick(dt, playerX, playerZ);
    // ★ 战役级闭环（1Hz，晚于工程拍 → 反馈决策可覆盖基础部署）
    this.tacticalTick(dt, playerX, playerZ);
    // ★ 逐步登场：队列滴灌（每 SPAWN_INTERVAL 出一只；总攻走 instant 不入队）
    if (this.spawnQueue.length > 0) {
      this.spawnAccum += dt;
      while (this.spawnAccum >= SwarmCommander.SPAWN_INTERVAL && this.spawnQueue.length > 0) {
        this.spawnAccum -= SwarmCommander.SPAWN_INTERVAL;
        const u = this.spawnQueue.shift()!;
        if (u.mobIndex >= 0 && this.spawnMobIndex) this.spawnMobIndex(u.x, u.z, u.mobIndex);
        else this.spawnMob?.(u.x, u.z, u.role, u.elite);
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

  /** ★ 部署维护（2s 决策拍）——**按兵种分工 + 对玩家移动的敏感度不同**：
   *  · 近战（盾/突击）：**追玩家**（玩家在附近时直接压上去；否则推进到防线）
   *  · 施工队（canBuild）：守着自己的工位/工事，不因玩家跑动被拉走
   *  · 远程队：占住高地/火力点，**不追脸**
   *  · 后勤等：向防线后集结
   *  S1 = 边打边施工；S2 = 只维护部署（不再施工）。 */
  private engineeringTick(dt: number, playerX: number, playerZ: number): void {
    if (!this.plan) return;
    this.buildCd -= dt;
    const squads = [...this.swarm.squads.all()];
    // ★ 施工队 = **具备施工能力的兵种**（后勤不一定能施工；杂兵可兼任）；
    //   兜底：名册里一个施工兵种都没有（缺素材/未加载）→ 杂兵（assault）兼任
    let builders = squads.filter((s) => s.builders);
    if (builders.length === 0) builders = squads.filter((s) => s.type === 'assault');
    this.engAccum += dt;
    if (this.engAccum < 2) return;   // 2s 决策拍
    this.engAccum = 0;
    const slot = this.buildPieces.find((s) => !this.builtSlots.has(`${s.x},${s.z}`));
    const plan = this.plan;
    if (!slot && this.stage === 'S1') this.stage = 'S2';   // 无待建块 → 就绪
    // ★ 施工优先：施工队只受"玩家正踩在待建块上"（≤6m）影响，其余情况一律继续施工
    const nearPlayer = slot ? Math.hypot(playerX - slot.x, playerZ - slot.z) < 6 : false;
    const buildSlot = this.stage === 'S1' && slot && !nearPlayer ? slot : null;
    // 正面基准：有工事点用工事点；否则落点前方 40m
    const front = buildSlot ?? { x: plan.cx + plan.approachX * 40, z: plan.cz + plan.approachZ * 40 };
    // ★ 近战类目标：按**姿态 × 兵种配置**的追击开关决定打玩家还是守正面；
    //   施工期盾队前出掩护工事（screen 分支单独处理）
    const chase = Math.hypot(playerX - plan.cx, playerZ - plan.cz) < 90;
    const meleeAt = (doctrineChase: boolean): { x: number; z: number } => (
      doctrineChase && chase
        ? { x: playerX, z: playerZ }
        : { x: front.x + plan.approachX * 10, z: front.z + plan.approachZ * 10 }
    );
    // ★ 按小队属性部署（`SquadDoctrine`：通用兜底 + 属性覆盖 + 逐兵种 + 施工 override）→ 再叠态势
    const highPick = this.pickHighGroundNear(plan, front.x, front.z, 48);
    const covers = this.garrisonCovers(plan, playerX, playerZ, chase);
    // ★ 进攻队列调控（advance/mass/assault 时生效；前/中/后排 + 横向车道，8s 整队一次）
    const lineActive = this.battlePosture === 'advance'
      || this.battlePosture === 'mass' || this.battlePosture === 'assault';
    if (lineActive) {
      let fx = plan.approachX, fz = plan.approachZ;
      const ax = playerX - plan.cx, az = playerZ - plan.cz;
      const al = Math.hypot(ax, az);
      if (al > 12) { fx = ax / al; fz = az / al; }
      const units: LineUnit[] = [];
      for (const s of squads) {
        let cx = 0, cz = 0, n = 0;
        for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
        if (n > 0) { cx /= n; cz /= n; }
        units.push({ id: s.id, type: s.type, builders: s.builders, cx, cz });
      }
      this.battleLine.update(performance.now() / 1000, playerX, playerZ, fx, fz, units,
        this.battlePosture === 'assault', this.postureEpoch);
    }
    let coverIdx = 0;
    let assaultIdx = 0;
    let screenIdx = 0;
    let flyerIdx = 0;
    for (const s of squads) {
      const d = applyPosture(
        resolveDoctrine(s.type, s.builders, this.mobTactics?.(s.mobKind) ?? null),
        this.battlePosture,
      );
      const lineSlot = lineActive ? this.battleLine.get(s.id) : null;
      let kind: TacticalOrder['kind'] = 'advance';
      let target = meleeAt(d.chase);
      let roe: TacticalOrder['roe'] = 'engage';
      let ttl = 6;
      let urgency = 0;
      switch (d.mode) {
        case 'build': {
          if (buildSlot) {
            const bi = builders.indexOf(s);
            const t = this.buildPieces.find((q, idx) => idx >= bi && !this.builtSlots.has(`${q.x},${q.z}`)) ?? buildSlot;
            target = { x: t.x, z: t.z };
            roe = 'holdFire';
          } else {
            const hold = slot ?? front;
            kind = 'protect';
            target = { x: hold.x, z: hold.z };
            roe = 'holdFire';
            ttl = 8;
          }
          break;
        }
        case 'garrison': {
          let cx = 0, cz = 0, n = 0;
          for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
          if (n > 0) { cx /= n; cz /= n; }
          const cov = d.preferCover && covers.length > 0 && !lineSlot
            ? covers[coverIdx++ % covers.length] : null;
          let hx: number, hz: number;
          if (cov) {
            hx = cov.x; hz = cov.z;
          } else if (lineSlot) {
            // ★ 进攻队列：后排线位（层深已含射程站距）
            hx = lineSlot.x; hz = lineSlot.z;
          } else if (chase && n > 0) {
            const ax = cx - playerX, az = cz - playerZ;
            const al = Math.hypot(ax, az) || 1;
            const sd = d.standoff || 45;
            hx = playerX + (ax / al) * sd;
            hz = playerZ + (az / al) * sd;
          } else {
            const hold = highPick ?? front;
            hx = hold.x; hz = hold.z;
          }
          const far = n === 0 || Math.hypot(cx - hx, cz - hz) > 4;
          kind = far ? 'advance' : 'protect';
          target = { x: hx, z: hz };
          urgency = far ? 1 : 0;
          ttl = far ? 8 : 6;
          break;
        }
        case 'flank': {
          const side = assaultIdx++ % 2 === 0 ? 1 : -1;
          const base = lineSlot ?? meleeAt(d.chase);
          kind = 'flank';
          target = { x: base.x - plan.approachZ * side * 6, z: base.z + plan.approachX * side * 6 };
          break;
        }
        case 'screen': {
          const si = screenIdx++;
          if (buildSlot && d.screenDist > 0) {
            const dx = playerX - buildSlot.x, dz = playerZ - buildSlot.z;
            const dl = Math.hypot(dx, dz) || 1;
            target = { x: buildSlot.x + (dx / dl) * d.screenDist, z: buildSlot.z + (dz / dl) * d.screenDist };
          } else if (!chase && plan.chokepoints.length > 0 && !lineSlot) {
            const c = plan.chokepoints[si % plan.chokepoints.length];
            kind = 'protect';
            target = { x: c.x, z: c.z };
            ttl = 8;
          } else {
            target = lineSlot ?? meleeAt(d.chase);
          }
          break;
        }
        case 'regroup': {
          kind = 'regroup';
          target = { x: front.x - plan.approachX * 8, z: front.z - plan.approachZ * 8 };
          break;
        }
        case 'press':
        default:
          if (s.type === 'flyer' && !lineSlot) {
            // 飞行不排队，但也别叠在同一格：左右错开 9m
            const side = flyerIdx++ % 2 === 0 ? 1 : -1;
            const base = meleeAt(d.chase);
            target = { x: base.x - plan.approachZ * side * 9, z: base.z + plan.approachX * side * 9 };
          } else {
            target = lineSlot ?? meleeAt(d.chase);
          }
          break;
      }
      this.swarm.issueOrder(s.id, { kind, target, roe, urgency, seq: 0 }, ttl);
    }
    // ⑤ 施工（**逐步拼装**，仅 S1）：施工队**任一成员**到达待建块 ≤5m →
    //   掩体块（每块 4m，每 8s 一块）/ 战壕块（每块 4×4m、1 层，每 10s 一块）
    if (buildSlot && this.buildCover && this.buildCd <= 0) {
      let atSite = false;
      for (const s of builders) {
        for (const m of s.members.values()) {
          if (Math.hypot(m.x - buildSlot.x, m.z - buildSlot.z) <= 5) { atSite = true; break; }
        }
        if (atSite) break;
      }
      if (atSite) {
        if (buildSlot.kind === 'cover') {
          this.buildCover(buildSlot.x, buildSlot.z, 'cover');
          this.builtCovers.push({ x: buildSlot.x, z: buildSlot.z });   // ★ 远程驻守点
          this.buildCd = 3;            // 掩体 3s/块（3 块 = 12m ≈ 9s）
        } else {
          this.digTrench?.(buildSlot.x, buildSlot.z);
          this.buildCd = 4;            // 战壕 4s/块（3 块 = 12m ≈ 12s）
        }
        this.builtSlots.add(`${buildSlot.x},${buildSlot.z}`);
      }
    }
  }

  /** ★ 战役级闭环（1Hz）：**自下而上的反馈 → 大队重新决策**
   *  读：小队评级（血量/接敌/存活）+ 队长上报（求援/共享目击）+ 推进进度（受阻）
   *  写：覆盖该队的引擎命令（改派抽援 / 重算路径 / 换目标 / 残血撤离）
   *  规则集中在此；态势与兵种配置仍作兜底。 */
  private tacticalTick(dt: number, playerX: number, playerZ: number): void {
    if (!this.plan) return;
    this.tacticalAccum += dt;
    if (this.tacticalAccum < 1) return;
    this.tacticalAccum = 0;
    const now = performance.now() / 1000;
    const ratings = this.swarm.ratings();
    // ① 队长上报 → 大队裁决（跨队决策上收：队长不再私聊响应）
    for (const r of ratings) {
      const msgs = this.swarm.tactics.board.takeFor(r.squadId, now);
      for (const m of msgs) {
        if (m.kind !== 'requestSupport' && m.kind !== 'shareContact') continue;
        const helper = this.pickHelper(ratings, m.x, m.z, r.squadId, now);
        if (!helper) continue;
        this.swarm.issueOrder(helper.squadId, {
          kind: 'advance', target: { x: m.x, z: m.z }, roe: 'engage', seq: 0,
        }, 6);
        this.supportCd.set(helper.squadId, now + 10);
        this.lastDecision = { squad: helper.squadId, kind: m.kind === 'requestSupport' ? 'support' : 'scout', at: now };
      }
    }
    // ② 逐队：受阻重试/换目标 + 残血撤离（按逐兵种 retreatHp）
    for (const r of ratings) {
      const squad = this.swarm.squads.get(r.squadId);
      const st = this.swarm.tactics.board.get(r.squadId);
      const tgt = st?.order.target;
      if (tgt) {
        const d = Math.hypot(r.cx - tgt.x, r.cz - tgt.z);
        const pr = this.progress.get(r.squadId);
        if (!pr || d < pr.d - 1.5) {
          this.progress.set(r.squadId, { d, at: now, stall: 0 });
        } else if (now - pr.at > 8 && d > 8) {
          pr.stall++;
          if (pr.stall <= 1 && st) {
            st.pathAt = 0; st.pathFailedAt = 0; st.order.path = undefined;   // 重算路径重试
            this.lastDecision = { squad: r.squadId, kind: 'retry', at: now };
          } else {
            const alt = this.alternateTarget(r.cx, r.cz, tgt);
            this.swarm.issueOrder(r.squadId, { kind: 'advance', target: alt, roe: 'engage', seq: 0 }, 8);
            this.lastDecision = { squad: r.squadId, kind: 'retarget', at: now };
          }
          pr.at = now; pr.d = d;
        }
      }
      const dct = resolveDoctrine(r.type, squad?.builders === true,
        squad ? this.mobTactics?.(squad.mobKind) ?? null : null);
      if (dct.retreatHp > 0 && r.hpRatio <= dct.retreatHp && st?.order.kind !== 'retreat') {
        const ax = r.cx - playerX, az = r.cz - playerZ;
        const al = Math.hypot(ax, az) || 1;
        this.swarm.issueOrder(r.squadId, {
          kind: 'retreat',
          target: { x: r.cx + (ax / al) * 18, z: r.cz + (az / al) * 18 },
          seq: 0,
        }, 6);
        this.lastDecision = { squad: r.squadId, kind: 'withdraw', at: now };
      }
    }
  }

  /** 抽援对象：最近的空闲健康队（同队除外；10s 冷却防连环抽调） */
  private pickHelper(
    ratings: SquadRating[], x: number, z: number, exclude: number, now: number,
  ): SquadRating | null {
    let best: SquadRating | null = null;
    let bestD2 = Infinity;
    for (const r of ratings) {
      if (r.squadId === exclude || r.status !== 'idle' || r.hpRatio < 0.5) continue;
      if ((this.supportCd.get(r.squadId) ?? 0) > now) continue;
      const d2 = (r.cx - x) ** 2 + (r.cz - z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = r; }
    }
    return best;
  }

  /** 受阻换目标：取最近的高地/掩体位；无地形点 → 原目标横向偏移 12m */
  private alternateTarget(cx: number, cz: number, tgt: { x: number; z: number }): { x: number; z: number } {
    const plan = this.plan;
    if (!plan) return tgt;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const g of plan.highGround) {
      const d = (g.x - cx) ** 2 + (g.z - cz) ** 2;
      if (d < bestD) { bestD = d; best = { x: g.x, z: g.z }; }
    }
    for (const c of plan.coverSlots) {
      const d = (c.x - cx) ** 2 + (c.z - cz) ** 2;
      if (d < bestD) { bestD = d; best = { x: c.x, z: c.z }; }
    }
    if (best) return best;
    return { x: tgt.x - plan.approachZ * 12, z: tgt.z + plan.approachX * 12 };
  }

  /** ★ 远程有利位置（制高点 / 掩体后；含"掩体真的挡子弹"校验）。
   *  规则：距离在 [0.5R, 1.05R]（能射到且不贴脸）且 **≥ minDist**（边撤边打时要求更远）；
   *  掩体挡住玩家视线加分；越接近理想站位（0.8R）越好；无合适点 → null（原地射击）。 */
  rangedPost(px: number, pz: number, range: number, minDist = 0): { x: number; z: number } | null {
    const plan = this.plan;
    if (!plan || range <= 0) return null;
    const ideal = range * RANGED.PREFER_RATIO;
    let best: { x: number; z: number } | null = null;
    let bestScore = -Infinity;
    const consider = (x: number, z: number, high: boolean, base = 0): void => {
      const d = Math.hypot(x - px, z - pz);
      if (d < range * 0.5 || d > range * 1.05 || d < minDist) return;
      const blocked = coverBlocksLine(px, pz, x, z);   // 玩家 → 该点：掩体挡不挡
      let score = base + -Math.abs(d - ideal) * 0.08;
      if (blocked) score += 3;
      if (high) score += 0.8;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    };
    // ★ 优先用**落地扫描产物**（posts：一次算好的制高/掩体位）；已建掩体实时补入
    for (const p of plan.posts) {
      if (p.kind === 'cover') consider(p.x - plan.approachX * 1.2, p.z - plan.approachZ * 1.2, false, p.score);
      else consider(p.x, p.z, true, p.score);
    }
    for (const c of this.builtCovers) {
      consider(c.x - plan.approachX * 1.2, c.z - plan.approachZ * 1.2, false, 3.5);
    }
    if (best) return best;
    // ★ 扫描产物/掩体都不在射程带内（玩家跑远了）→ **现场找位**：
    //   以玩家为圆心、0.8R 为半径环采样（高地优先 / 掩体加成 / 可站）
    return this.terrainPost(px, pz, range);
  }

  /** ★ 现场有利位置（无扫描产物时）：玩家周围射程环采样 + 1.5s 缓存（多小队共用） */
  private readonly postCache = new Map<string, { x: number; z: number; at: number }>();
  private terrainPost(px: number, pz: number, range: number): { x: number; z: number } | null {
    const raster = RasterMap.current;
    if (!raster) return null;
    const key = `${Math.floor(px / 16)},${Math.floor(pz / 16)},${Math.round(range)}`;
    const nowMs = performance.now();
    const hit = this.postCache.get(key);
    if (hit && nowMs - hit.at < 1500) return { x: hit.x, z: hit.z };
    const r = range * RANGED.PREFER_RATIO;
    let best: { x: number; z: number } | null = null;
    let bestScore = -Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = px + Math.cos(a) * r;
      const z = pz + Math.sin(a) * r;
      const role = raster.tileDefAt(x, z).genRole;
      const h = raster.surfaceHeightAt(x, z);
      if (role === 'pit' || (role === 'liquid' && h < -0.8) || h < -1.2) continue;
      // 高地加成：相对周边 5m 的抬升
      const elev = h - (raster.surfaceHeightAt(x + 5, z) + raster.surfaceHeightAt(x - 5, z)
        + raster.surfaceHeightAt(x, z + 5) + raster.surfaceHeightAt(x, z - 5)) / 4;
      // ★ 优先读地块评分表（全兵种共用；掩体/态势权重已在表内）；表未就绪回落高程探针
      let score = this.terrainScore.scoreAt(x, z) ?? (elev * 0.5);
      if (score <= -1e8) continue;
      if (coverBlocksLine(px, pz, x, z)) score += 3;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    if (best) this.postCache.set(key, { x: best.x, z: best.z, at: nowMs });
    return best;
  }

  /** ★ 调试/测试：强制切态势（覆盖态势机自动转移） */
  setPosture(p: BattlePosture): void {
    this.postureMachine.set(p, performance.now() / 1000);
    this.battlePosture = p;
    if (p === 'assault') this.aliveAtPosture = this.swarm.ledger.alive;
    this.engAccum = 2;   // 下一拍立即重发部署
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
    this.builtCovers.length = 0;
    this.engAccum = 0;
    this.buildCd = 0;
    this.resendAccum = 0;
    this.recalledRoster = null;
    this.postureMachine.reset();
    this.battlePosture = 'fortify';
    this.aliveAtPosture = 0;
    this.tacticalAccum = 0;
    this.progress.clear();
    this.supportCd.clear();
    this.battleLine.clear();
    this.postCache.clear();
    this.terrainScore.clear();
  }

  private dispatchMission(): void {
    const m = this.mission;
    if (!m) return;
    for (const s of this.swarm.squads.all()) {
      this.swarm.issueOrder(s.id, m, SwarmCommander.RESEND_S + 5);
    }
  }
}
