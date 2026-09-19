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
import type { TacticalOrder } from '../../entity/SwarmUnit';

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
  /** ★ 战术阶段（S0 勘察 → S1 工程 → S2 防线就绪） */
  stage: 'S0' | 'S1' | 'S2' = 'S0';
  /** 待建掩体位（排序：外环 → 中环 → 内环；50m 开外先起线） */
  private buildQueue: DefensePlan['coverSlots'] = [];
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
    this.buildQueue = [...this.plan.coverSlots].sort((a, b) => b.ring - a.ring);
    this.builtSlots.clear();
    this.stage = 'S1';
    return this.plan;
  }

  /** ★ 防守布置（读；阶段机 S0~S6 消费） */
  get defensePlan(): DefensePlan | null {
    return this.plan;
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
    // 玩家跌进 30m：暂停施工（转防御；队长自主交战接管）
    if (Math.hypot(playerX - this.plan.cx, playerZ - this.plan.cz) < 30) return;
    const slot = this.buildQueue.find((s) => !this.builtSlots.has(`${s.x},${s.z}`));
    if (!slot) { this.stage = 'S2'; return; }
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
    // ② 工程兵小步跟进（到待建位；holdFire 行军）
    for (let i = 0; i < builders.length; i++) {
      const t = this.buildQueue.find((q, idx) => idx >= i && !this.builtSlots.has(`${q.x},${q.z}`)) ?? slot;
      this.swarm.issueOrder(builders[i].id, { kind: 'advance', target: { x: t.x, z: t.z }, roe: 'holdFire', seq: 0 }, 6);
    }
    // ③ 远程队：**火力支援**（protect 施工点；站射程环对接近威胁输出）
    for (const s of squads.filter((q) => q.type === 'ranged')) {
      this.swarm.issueOrder(s.id, {
        kind: 'protect',
        target: { x: slot.x, z: slot.z },
        roe: 'engage',
        seq: 0,
      }, 6);
    }
    // ④ 其余队：向已建防线后集结
    for (const s of squads.filter((q) => q.type !== 'logistics' && q.type !== 'defense' && q.type !== 'assault' && q.type !== 'ranged')) {
      this.swarm.issueOrder(s.id, {
        kind: 'regroup',
        target: { x: slot.x - plan.approachX * 8, z: slot.z - plan.approachZ * 8 },
        seq: 0,
      }, 6);
    }
    // ⑤ 施工：工程兵到达待建位 ≤4m → 生成掩体（带施工插值）
    if (this.buildCd <= 0) {
      for (const s of builders) {
        let cx = 0, cz = 0, n = 0;
        for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
        if (n === 0) continue;
        cx /= n; cz /= n;
        if (Math.hypot(cx - slot.x, cz - slot.z) <= 4) {
          this.buildCover(slot.x, slot.z, 'cover');
          this.builtSlots.add(`${slot.x},${slot.z}`);
          this.buildCd = 3;
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
    this.buildQueue = [];
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
