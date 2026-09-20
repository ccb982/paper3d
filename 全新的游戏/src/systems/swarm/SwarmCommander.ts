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
  /** ★ 按 mobIndex 生成一只（名单重放用；模式层注入） */
  spawnMobIndex: ((x: number, z: number, mobIndex: number) => void) | null = null;
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
    // ★ 近战目标：**施工期前出掩护工事**（在工位朝玩家方向 15m）；施工完 → 玩家近则追玩家
    const chase = Math.hypot(playerX - plan.cx, playerZ - plan.cz) < 90;
    let meleeX: number, meleeZ: number;
    if (buildSlot) {
      const dx = playerX - buildSlot.x, dz = playerZ - buildSlot.z;
      const dl = Math.hypot(dx, dz) || 1;
      meleeX = buildSlot.x + (dx / dl) * 15;
      meleeZ = buildSlot.z + (dz / dl) * 15;
    } else if (chase) {
      meleeX = playerX;
      meleeZ = playerZ;
    } else {
      meleeX = front.x + plan.approachX * 10;
      meleeZ = front.z + plan.approachZ * 10;
    }
    // ① 盾队守正面/追玩家（最多 2 队，不含施工队）
    for (const s of squads.filter((q) => q.type === 'defense' && !q.builders).slice(0, 2)) {
      this.swarm.issueOrder(s.id, {
        kind: 'advance',
        target: { x: meleeX, z: meleeZ },
        roe: 'engage',
        seq: 0,
      }, 6);
    }
    // ①a 突击队两翼错开（不抢中线；来向左右各一）
    const assaults = squads.filter((q) => q.type === 'assault' && !q.builders).slice(0, 2);
    for (let i = 0; i < assaults.length; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      this.swarm.issueOrder(assaults[i].id, {
        kind: 'flank',
        target: {
          x: meleeX - plan.approachZ * side * 14,
          z: meleeZ + plan.approachX * side * 14,
        },
        roe: 'engage',
        seq: 0,
      }, 6);
    }
    // ①b ★ 隘口据守（地形分析产物）：**不追击时**盾队各领一个隘口
    if (!chase && plan.chokepoints.length > 0) {
      const guards = squads.filter((q) => q.type === 'defense' && !q.builders).slice(0, plan.chokepoints.length);
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
    // ①c ★ 飞行队（轰炸）：直扑玩家（独立空中层，不参与地面寻路）
    for (const s of squads.filter((q) => q.type === 'flyer')) {
      this.swarm.issueOrder(s.id, {
        kind: 'advance',
        target: { x: meleeX, z: meleeZ },
        roe: 'engage',
        seq: 0,
      }, 6);
    }
    // ② 施工队：**施工优先**——有工位就去工位（holdFire）；暂停/完工时守在工区（不追玩家）
    for (let i = 0; i < builders.length; i++) {
      if (buildSlot) {
        const t = this.buildPieces.find((q, idx) => idx >= i && !this.builtSlots.has(`${q.x},${q.z}`)) ?? buildSlot;
        this.swarm.issueOrder(builders[i].id, { kind: 'advance', target: { x: t.x, z: t.z }, roe: 'holdFire', seq: 0 }, 6);
      } else {
        const hold = slot ?? front;
        this.swarm.issueOrder(builders[i].id, { kind: 'protect', target: { x: hold.x, z: hold.z }, roe: 'holdFire', seq: 0 }, 8);
      }
    }
    // ③ ★ 远程队：**优先驻守掩体后**（已建掩体 > 规划掩体位；取掩体背向来向一侧）——
    //    掩体距玩家 ≤48m（射程内）才算驻守点；无可用掩体 → 交战站射程环 45m / 非交战占高地
    const highPick = this.pickHighGroundNear(plan, front.x, front.z, 48);
    const covers = this.garrisonCovers(plan, playerX, playerZ, chase);
    let coverIdx = 0;
    for (const s of squads.filter((q) => q.type === 'ranged')) {
      let cx = 0, cz = 0, n = 0;
      for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
      if (n > 0) { cx /= n; cz /= n; }
      const cov = covers.length > 0 ? covers[coverIdx++ % covers.length] : null;
      let holdX: number, holdZ: number;
      if (cov) {
        holdX = cov.x;
        holdZ = cov.z;
      } else if (chase && n > 0) {
        const ax = cx - playerX, az = cz - playerZ;
        const al = Math.hypot(ax, az) || 1;
        // ★ 射程环 45m（射程 50m+ → 留余量；远距输出、不追脸）
        holdX = playerX + (ax / al) * 45;
        holdZ = playerZ + (az / al) * 45;
      } else {
        const hold = highPick ?? front;
        holdX = hold.x;
        holdZ = hold.z;
      }
      const far = n === 0 || Math.hypot(cx - holdX, cz - holdZ) > 4;   // 收紧：站上驻守点才算到位
      this.swarm.issueOrder(s.id, {
        kind: far ? 'advance' : 'protect',
        target: { x: holdX, z: holdZ },
        // ★ 一进射程就开火（不再 fireOnArrival 等到位；<20m 自动转精准）
        roe: 'engage',
        urgency: far ? 1 : 0,          // 远程赶路加急（射程环到位才能输出）
        seq: 0,
      }, far ? 8 : 6);
    }
    // ④ 其余队（后勤等，不含施工/盾/突击/远程/飞行）：向防线后集结
    for (const s of squads.filter((q) => !q.builders && q.type !== 'defense' && q.type !== 'assault' && q.type !== 'ranged' && q.type !== 'flyer')) {
      this.swarm.issueOrder(s.id, {
        kind: 'regroup',
        target: { x: front.x - plan.approachX * 8, z: front.z - plan.approachZ * 8 },
        seq: 0,
      }, 6);
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
  }

  private dispatchMission(): void {
    const m = this.mission;
    if (!m) return;
    for (const s of this.swarm.squads.all()) {
      this.swarm.issueOrder(s.id, m, SwarmCommander.RESEND_S + 5);
    }
  }
}
