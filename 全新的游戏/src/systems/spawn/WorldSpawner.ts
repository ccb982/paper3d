// ============================================================
// WorldSpawner —— 刷怪 / 波次 / LOD 升降格 / 舰船威胁告警
// ============================================================
// ★ 2026-09-18 从 WorldMode 整段迁出（P1 拆分）。
//   迁出原因：WorldMode 曾 4129 行 / 91 方法，是"新功能默认往里塞"的垃圾桶；
//   而这一簇（18 个方法）职责完整、外部零引用，且**即将大改蜂群引擎** ——
//   刷怪逻辑必须独立于蜂群实现，否则改引擎会连带改玩法。
//
// ★ 为什么放在 systems/spawn 而不是 systems/swarm：
//   swarm = 蜂群**引擎**（代理池/LOD/流场），spawn = **玩法层**（刷什么/刷多少/刷哪）。
//   两者解耦后改引擎不动刷怪。
//
// 依赖注入：WorldMode 持有世界状态，通过 `SpawnDeps` 传给本类（getter/setter 桥接，
//   保证读到的永远是实时值、写入直接反映到 WorldMode 的字段）。
//   ★ 不要在 Spawner 里缓存 deps 的引用字段（player/ship 等会随局重建）。
// ============================================================

import * as THREE from 'three';
import type { GameSession } from '../../core/Session';
import { computeRelicModifiers } from '../../core/Session';
import { RELIC_ITEM_CONFIG } from '../../config/relics';
import { FtxAsset } from '../../vendor/player/FtxAsset';
import type { Asset } from '../../vendor/player';
import { EntityManager } from '../../entity/EntityManager';
import type { EntityBase } from '../../entity/EntityBase';
import { Player } from '../../entity/player/Player';
import type { UnitRole, UnitAttackType, MobTactics } from '../../entity/SwarmUnit';
import { ShipEntity } from '../../entity/ShipEntity';
import { EnemyBase } from '../../entity/EnemyBase';
import type { SwarmTierPort } from '../swarm/SwarmTierPort';
import { fireCode, roleFromCode, type TacticalOrder, type UnitDirective } from '../../entity/SwarmUnit';
import type { AllyBase } from '../../entity/ally/AllyBase';
import { resolveDockSpawn } from '../../services/ship/DockResolver';
import { damageShip, isShipDestroyed } from '../../systems/ship/ShipState';
import { applyDamage } from '../../services/combat/DamagePipeline';
import { RasterMap } from '../../services/map/RasterMap';
import { ChunkManager } from '../../services/map/ChunkManager';
import { LOD_MAX_DIST } from '../../services/lod';
import { BOSS_AI, type AIConfig } from '../../systems/ai/aiconfig';
import { SwarmSystem, SWARM } from '../../systems/swarm/SwarmSystem';
import { Director } from '../../systems/swarm/Director';
import {
  computeEnemyScale, computeThreat, threatTier,
  type EnemyScale, type ThreatProfile,
} from '../../systems/swarm/EnemyScaling';
import {
  AGENT_TARGET_SENTINEL, AGENT_TARGET_SHIP, AGENT_TIER_FAR, type AgentSnapshot,
} from '../../systems/swarm/AgentPool';
import { tierForDistance, tierHandover } from '../../systems/swarm/tiers/Flux';   // ★ 创建分档阈值单源 + 交接编排（用户定 2026-09-27）
import { agentTierAt } from '../../systems/swarm/tiers/policy';   // ★ 公共分档口径（舰心/玩家/相机，取最大；用户定 2026-09-27）
import type { TierCarry, TierCarryMember } from '../../systems/swarm/tiers/contracts';
import { WorldUIManager } from '../../ui/world/WorldUIManager';
// ★ 贴片接地补偿（底部透明余量 → 下沉；与 L2 代理同口径）
import { footSinkRatioOf } from '../../services/fx/FootAnchor';

// ============================================================
// ★ 杂兵配置条目（原 WorldMode 内部类型，随迁出改为 export）
// ============================================================
export interface MobDef {
  /** ★ 名册稳定键（config/enemyRoster.ts 的 id）；调试/日志/陈列标签用 */
  id: string;
  /** ★ 显示名（陈列标签 / 击杀播报） */
  name: string;
  asset: FtxAsset;
  ai: AIConfig;
  hp: number;
  /** 防御（减法减伤） */
  defense: number;
  /** 攻击力加成（叠加在 AI 近战伤害上） */
  attackPower: number;
  scale: number;
  collisionScale: number;
  /** 集群规模（一次落点生成几只；原石虫成群用） */
  pack: number;
  /** 随机抽取权重（原石虫权重大 → 成队出现） */
  weight: number;
  /** ★ 击杀掉落规则（每项独立掷概率） */
  drops: { itemId: string; chance: number; min: number; max: number }[];
  /** ★ 接地补偿（世界单位；= 纹理底部透明余量比例 × scale + 名册手调量）。
   *  见 services/fx/FootAnchor.ts —— 底边留白的素材靠它压回地面。 */
  groundSink: number;
  /** ★ 空中层（2026-09-18）：飞行单位（悬停、不参与地面寻路/不吃坑水、不掉坑判死）。
   *  来源：名册 `EnemySpec.isAir`。 */
  isAir: boolean;
  /** 悬停高度（米，相对地表）；`isAir` 为假时无意义 */
  airAltitude: number;
  /** ★ v2 兵种角色（大编队配比依据；缺省 = grunt，行为不变；《RTS架构.md》§5.3） */
  role?: UnitRole;
  /** ★ v2 攻击类型（缺省 = melee，行为不变） */
  attackType?: UnitAttackType;
  /** ★ 始终面对相机（缺省 = 自动：素材无「后」帧 → billboard；见 EnemyBase 构造） */
  billboard?: boolean;
  /** ★ 自爆标签（爆炸飞行怪；基类字段） */
  suicide?: boolean;
  /** ★ 编制模式（singleton = 1 单位 1 小队） */
  squadMode?: 'normal' | 'singleton';
  /** ★ 施工能力（与 role 解耦：后勤不一定能施工、杂兵也可以兼任；2026-09-20） */
  canBuild?: boolean;
  /** ★ 逐兵种战术配置（名册透传；2026-09-21） */
  tactics?: MobTactics;
  /** ★ 精英（大队概率额外携带） */
  elite?: boolean;
  /** ★ 不降格（Boss：永保 active） */
  noDemote?: boolean;
}

/** ★ 代理近战伤害源占位（伤害管线只读 camp/attackPower/critRate/critMult；
 *  代理没有 EntityBase 实体，数值全部由 dmg 直接给出） */
/** ★ 代理近战伤害源占位（伤害管线只读 camp/attackPower/critRate/critMult；
 *  代理没有 EntityBase 实体，数值全部由 dmg 直接给出） */
export const AGENT_SOURCE = {
  camp: 'enemy',
  attackPower: 0,
  critRate: 0,
  critMult: 1.5,
} as unknown as EntityBase;

/** ★ 祖宗吸仇恨半径（米）：敌人与祖宗在此范围内时，索敌优先级压过玩家 */
/** ★ 祖宗吸仇恨半径（米）：敌人与祖宗在此范围内时，索敌优先级压过玩家 */
export const SENTINEL_TAUNT_RADIUS = 40;

// ============================================================
// ★ SpawnDeps —— WorldMode 提供给 Spawner 的一切（含共享可变状态）
// ============================================================
export interface SpawnDeps {
  /** 兼容本体存档分块键（rts 未用；可选） */
  readonly spawnChunkKey?: number;
  // ---- 共享可变状态（WorldMode 持有；Spawner 读写同一份）----
  enemies: EnemyBase[];
  enemyDefs: WeakMap<EnemyBase, MobDef>;
  mobDefs: MobDef[];
  bossEntity: EnemyBase | null;
  bossRun: boolean;
  threat: ThreatProfile | null;
  scalingInputs: { day: number; totalPulls: number; refHp: number; refAtk: number; refDef: number } | null;
  enemyScale: EnemyScale;
  // ---- 世界引用（实时）----
  player: Player;
  ship: ShipEntity;
  entities: EntityManager;
  swarm: SwarmSystem;
  swarmDirector: Director;
  chunks: ChunkManager;
  raster: RasterMap;
  session: GameSession | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  drones: AllyBase[];
  worldUIManager: WorldUIManager;
  testChunk: boolean;
  shipDestroyed: boolean;
  bossAsset: FtxAsset | Asset | null;
  // ---- 回调（Spawner 不该知道的 WorldMode 内部事）----
  showFloatingAt(x: number, y: number, z: number, text: string,
    type: 'normal' | 'crit' | 'heal' | 'miss' | 'pickup'): void;
  syncSceneBgm(): void;
  returnToBase(): void;
}

export class WorldSpawner implements SwarmTierPort {
  static readonly MAX_ALIVE = 200;
  /** ★ 波次纵深带上限（米；lo = LOD_MAX_DIST+4 ~ 此值，且 ≤ 回收环预留带） */
  static readonly SPAWN_BAND_HI = 170;
  /** ★ 远距实体降格节拍（0.25s 一拍；超出 DEMOTE_RADIUS → 回代理池） */
  static readonly ENEMY_CULL_INTERVAL = 0.25;
  private cullAccum = 0;
  /** ★ 舰船遇围警示（顶部红色横幅）：近舰敌军持续超标才播报 */
  private groupWarnAccum = 0;
  private groupWarnShown = false;
  /** 近舰敌军统计半径（米；圈"贴身"敌军；比舰船雷达 120m 聚焦） */
  static readonly SHIP_GROUP_RADIUS = 65;
  /** ★ 近距通道触发：舰船这圈内敌军（实体 + 代理）≥ 此数 且持续 SHIP_GROUP_SUSTAIN 秒 */
  static readonly SHIP_GROUP_COUNT = 5;
  /** 迟滞：近距数降到 ≤ 此数 才可清除（防临界抖动反复播/消） */
  static readonly SHIP_GROUP_HIDE_COUNT = 3;
  /** 近距通道持续时长（秒）：一群怪路过闪一瞬不报，扎住才报 */
  static readonly SHIP_GROUP_SUSTAIN = 0.6;
  /** 意图通道迟滞：扑向舰船的代理 ≤ 此数 才可清除 */
  /** 意图通道持续时长（秒；比近距更快，扑舰波次换位期间不错过） */


  /** 已完成波次的 chunk（避免重复铺；换局由 reset() 清空） */
  /** 祖宗嘲讽查询的复用对象（零分配） */
  private _tauntScratch = { x: 0, z: 0 };
  /** ★ 「今日敌军已全部投入」是否已播报（每局一次；reset 清） */
  private forceExhaustedShown = false;
  /** 判定延迟计时（进图后 1.5s 再判，避开落地动画） */
  private forceExhaustedAccum = 0;

  constructor(private deps: SpawnDeps) {}

  /** ★ 换局清理（WorldMode.enter 调用） */
  reset(): void {
    this.cullAccum = 0;
    this.groupWarnAccum = 0;
    this.groupWarnShown = false;
    this.forceExhaustedShown = false;
    this.forceExhaustedAccum = 0;
  }

  /** ★ 今日是否已肃清（引擎账本口径）：**击杀数 == 今日上限** */
  private forceExhausted(): boolean {
    const L = this.deps.swarm.ledger;
    return L.total > 0 && L.kills >= L.total;
  }

  /**
   * ★ 「今日敌军已肃清」提示（WorldMode.update 每帧调，explore 段）。
   *
   * 判定 = 击杀数打满今日上限（引擎账本）；打满后生成闸门关闭 → 玩家在野外
   * 一只敌人都遇不到，**看起来跟"敌人不生成"的 bug 完全一样**（2026-09-18
   * 就在这上面白查了一轮）。这里做一次性播报 + 常驻标签，让状态可见。
   *
   * 一次性：每局只播一次（reset 清）；进图后延迟 1.5s 再判（避开落地动画）。
   */
  notifyForceExhausted(dt: number): void {
    if (this.forceExhaustedShown) return;
    this.forceExhaustedAccum += dt;
    if (this.forceExhaustedAccum < 1.5) return;
    if (!this.forceExhausted()) return;
    this.forceExhaustedShown = true;
    // ① 常驻：顶部档位标签改口径（玩家随时能看到"为什么没敌人"）
    this.deps.worldUIManager.setThreatLabel('敌军攻势：已肃清', '#9fe6b0');
    // ② 一次性横幅
    this.deps.worldUIManager.showNotice('今日敌军已肃清 · 可返回基地', 9);
    // ③ 头顶浮空字（就在玩家眼前，不会看漏）
    const p = this.deps.player;
    if (p) this.deps.showFloatingAt(p.position.x, p.position.y + 2.8, p.position.z, '今日敌军已肃清', 'heal');
  }

  /** ★ 舰船起飞：统一回收全部存活敌人（实体 retire('recycled') → 账本存活 −1；
   *  代理池 `swarm.recallAll()` → recalled）。**不算击杀**、不结算掉落；
   *  ★ 同时把本批**编成名单**交给指挥层：落地原样重放（回收数 = 放置数）。 */
  recallAllEnemies(): void {
    const list = this.deps.enemies;
    const roster = new Map<number, { role: UnitRole; count: number }>();
    const add = (mi: number, role: UnitRole): void => {
      const r = roster.get(mi);
      if (r) r.count++;
      else roster.set(mi, { role, count: 1 });
    };
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const def = this.deps.enemyDefs.get(e);
      const mi = def ? this.deps.mobDefs.indexOf(def) : -1;
      if (def && mi >= 0) add(mi, def.isAir ? 'flyer' : (def.role ?? 'grunt'));
      this.forgetEntity(e);
      e.retire('recycled');
    }
    list.length = 0;
    this.deps.bossEntity = null;
    const pool = this.deps.swarm.pool;
    for (let i = 0; i < pool.count; i++) add(pool.mobIndex[i], roleFromCode(pool.role[i]));
    this.deps.swarm.recallAll();
    // ★ 回收名单重放已删（用户定 2026-09-26）：落地后由**四兵种管理器**按防区缺口重建
  }

  /** ★ 远距实体降格节拍（WorldMode.update 每帧调用；0.25s 一拍才真正跑一次降格） */
  tickDemote(dt: number, px: number, pz: number): void {
    this.cullAccum += dt;
    if (this.cullAccum < WorldSpawner.ENEMY_CULL_INTERVAL) return;
    this.cullAccum = 0;
    this.demoteFarEnemies(px, pz);
  }

  /** ★ 舰船被围横幅是否已展示（WorldMode.syncSceneBgm 据此切战斗曲；只读） */
  get warnShown(): boolean { return this.groupWarnShown; }

  /** ★ 当日兵力计划已接入的天数（同日重刷不重置账本） */
  private plannedDay = 0;

  /** ★ 重算当日敌强（出击开始）——参考属性 = 玩家基础 + 遗物，**不含装备**；
   *  生成/升格共用同一口径（含硬下限：血量 ≥ 角色攻击/2、攻击 ≥ 角色攻击/10） */
  refreshEnemyScale(): void {
    if (!this.deps.session || !this.deps.player || !this.deps.worldUIManager) return;
    const base = this.deps.session.player;
    const mods = computeRelicModifiers(this.deps.session, RELIC_ITEM_CONFIG);
    const inputs = {
      day: this.deps.session.meta.day ?? 1,
      totalPulls: this.deps.session.gacha?.totalPulls ?? 0,
      refHp: base.maxHp * mods.mulHp + mods.bonusHp,
      refAtk: base.attackPower * mods.mulAtk + mods.bonusAtk,
      refDef: base.defense * mods.mulDef + mods.bonusDef,
    };
    this.deps.scalingInputs = inputs;
    this.deps.enemyScale = computeEnemyScale(inputs);
    // ★ 威胁度（波次/数量/攻击欲望）与敌强同源；注入导演后再开局
    this.deps.threat = computeThreat(inputs);
    this.deps.swarmDirector.setThreat(this.deps.threat);
    // ★ 日兵力计划（用户定 2026-09-26）：总数 = 威胁预估；上限由指挥器按
    //   releaseAt(t01) 每拍放开（早间少、第一波大增兵、总攻全军投放）。
    //   同一天重刷（遗物/数值变动）不清零进度；换日/首次 → 重算。
    if (this.plannedDay !== inputs.day || this.deps.swarm.ledger.total <= 0) {
      this.plannedDay = inputs.day;
      const aliveNow = this.deps.enemies.length + this.deps.swarm.count;
      this.deps.swarm.ledger.beginDay(this.deps.threat, 12, aliveNow);
    }
    // ★ HUD 只给档位（低/较低/中/较高/极高），不给精确数值
    const tier = threatTier(this.deps.threat.index);
    this.deps.worldUIManager.setThreatLabel(`敌军攻势：${tier.label}`, tier.color);
  }

  /** ★ 生成终局 Boss（普瑞赛斯）：**只在四维空间（终局战）生成**，常规图绝不出现。
   *  数值吃当日敌强，体型 4×。小 Boss / 精英（singleton / elite）不走这里 ——
   *  它们走常规 `spawnOne` → 蜂群引擎 `spawn()`，正常入账（引擎只看 uid>0）。 */
  spawnBoss(x: number, z: number): void {
    if (!this.deps.chunks.isBoss4D) return;   // ★ 常规地图不生成终局 Boss
    const asset = this.deps.bossAsset;
    if (!asset || !this.deps.scene || !this.deps.camera) return;
    const safe = resolveDockSpawn(this.deps.raster, x + 30, z);
    const sc = this.deps.enemyScale;
    const ai = BOSS_AI;
    const hp = Math.max(1200, Math.round(2500 * sc.hp));
    const atkPower = Math.round(30 * sc.atk);
    const dfs = 8 + sc.def;
    const bossScale = 4;
    // ★ 接地补偿（与杂兵同口径；Boss 素材读不到 alpha 时为 0 → 行为不变）
    const bossSink = footSinkRatioOf(asset) * bossScale;
    const enemy = new EnemyBase(this.deps.entities, this.deps.scene, asset, {
      x: safe.x, y: safe.y, z: safe.z,
      animMap: {
        states: {
          idle: { 前: ['前'], 后: ['后'] },
          walk: { 前: ['前'], 后: ['后'] },
          attack: { 前: ['前'], 后: ['后'] },
        },
        fps: { idle: 1, walk: 1, attack: 1 },
      },
      facing: '前',
      aiConfig: ai,
      hp,
      defense: dfs,
      attackPower: atkPower,
      scale: bossScale,
      collisionScale: 2.2,
      groundSink: bossSink,
    }, this.deps.camera);
    // ★ 不再强制 billboard=false：由 EnemyBase 按素材「后」帧自动判定
    //   （Boss 有前/后帧 → 仍为双向；无背面素材 → 始终面向相机）
    const def: MobDef = {
      // ★ Boss 不在名册里（独立资产/独立路径），这里给稳定键与显示名，
      //   方便日志与"名册陈列"的排除判据（陈列只遍历 mobDefs，Boss 天然不在其中）
      id: 'priestess', name: '普瑞赛斯',
      asset: asset as unknown as FtxAsset,
      ai,
      hp,
      defense: dfs,
      attackPower: atkPower,
      scale: bossScale,
      collisionScale: 2.2,
      pack: 1,
      weight: 0,
      drops: [],
      groundSink: bossSink,
      // Boss 是地面单位（空中层只给名册里 isAir 的兵种）
      isAir: false,
      airAltitude: 0,
    };
    this.deps.enemyDefs.set(enemy, def);
    this.deps.enemies.push(enemy);
    this.deps.bossEntity = enemy;
    // ★ Boss 是计划外直建实体（swarmUid=0）：不进蜂群账本（总数不会越过今日上限）
    this.deps.showFloatingAt(safe.x, safe.y + 4, safe.z, '普瑞赛斯', 'crit');
  }

  /** ★ 击败普瑞赛斯：通关（四维空间结束；之后恢复常规出击） */
  onBossDefeated(): void {
    if (!this.deps.session) return;
    this.deps.session.meta.bossCleared = true;
    this.deps.bossRun = false;
    this.deps.chunks.setStyle(false);
    this.deps.player.controller.requireRealLanding = this.deps.chunks.isBoss4D;
    this.deps.worldUIManager?.showVictoryPanel(() => this.deps.returnToBase());
  }

  /** ★ 随机取一条杂兵配置（按 weight 加权：原石虫权重大 → 成群出现）；
   *  preferPack = 突涌期偏成群（洪流感） */
  pickMob(preferPack = false): MobDef {
    let total = 0;
    for (const d of this.deps.mobDefs) total += d.weight * (preferPack && d.pack > 1 ? 4 : 1);
    let r = Math.random() * total;
    for (const d of this.deps.mobDefs) {
      r -= d.weight * (preferPack && d.pack > 1 ? 4 : 1);
      if (r <= 0) return d;
    }
    return this.deps.mobDefs[this.deps.mobDefs.length - 1];
  }

  /** ★ 远距实体降格（《RTS架构.md》§6）：实体超出 DEMOTE_RADIUS →
   *  数据快照回代理池 + 销毁实体（远层继续用廉价代理维护，不再硬销毁）。
   *  远距硬回收由 SwarmSystem 的 L1_RADIUS 统一执行（代理池侧）。 */
  demoteFarEnemies(px: number, pz: number): void {
    const r2 = SWARM.DEMOTE_RADIUS ** 2;
    for (let i = this.deps.enemies.length - 1; i >= 0; i--) {
      const e = this.deps.enemies[i];
      // ★ 步骤 9：实体成员状态喂给小队表（0.25s 节拍；评级/选举/目击用）
      if (e.swarmUid > 0) {
        this.deps.swarm.syncMember(e.swarmUid, e.hp, e.maxHp, e.position.x, e.position.z, e.lastSeenAt);
      }
      const dx = e.position.x - px, dz = e.position.z - pz;
      if (dx * dx + dz * dz <= r2) continue;
      if (e.dead) continue;
      // ★ 步骤 7：Boss/单例 noDemote → 永不降格
      const eDef = this.deps.enemyDefs.get(e);
      if (eDef?.noDemote) continue;
      // ★ 步骤 10：被击 / 小队警觉 / 倾盆而出期间不降格（交火中的不许降频）
      const now10 = performance.now() / 1000;
      if (e.noDemoteUntil > now10 || this.deps.swarm.holdDemote(e.squadId, now10)) continue;
      this.demote(e);
    }
  }

  /** ★ 步骤 8：单实体降格（SwarmTierPort.demote；数据回池 + 实体退役，不算击杀） */
  demote(enemy: EnemyBase): void {
    const e = enemy;
    const def = this.deps.enemyDefs.get(e);
    const idx = this.deps.enemies.indexOf(e);
    const mobIndex = def ? this.deps.mobDefs.indexOf(def) : -1;
    if (!def || mobIndex < 0) {
      // ★ 非战斗清理（无定义可回池）→ 不算击杀（retire 原因收口，2026-09-18）
      //   ★ 2026-09-29：retire 会发 enemy_removed → 离场订阅已摘除该实体；
      //   此处**按当前下标复查**再摘（防用陈旧 idx 双删、踢掉列表里的无辜实体）。
      e.retire('recycled');
      const i2 = this.deps.enemies.indexOf(e);
      if (i2 >= 0) this.deps.enemies.splice(i2, 1);
      return;
    }
    const stats = this.mobAgentStats(def);
    const ok = this.deps.swarm.demote({
      mobIndex,
      x: e.position.x, y: e.position.y, z: e.position.z,
      hp: e.hp, maxHp: e.maxHp,
      defense: e.defense, attackPower: e.attackPower,
      speed: e.moveSpeed > 0 ? e.moveSpeed : stats.speed, meleeDamage: stats.damage, meleeRange: stats.range,
      scale: def.scale,
      tier: AGENT_TIER_FAR,
      yaw: 0,
      aggro: stats.aggro, wanderSpeed: stats.wanderSpeed,
      // ★ 空中层（2026-09-18）：飞行标记必须跟着降格实体回池，否则回池即落地
      isAir: def.isAir,
      altitude: def.airAltitude,
      suicide: def.suicide === true,
      ranged: stats.ranged,
      skin: stats.skin,
      shotSpeed: stats.shotSpeed,
      shotLife: stats.shotLife,
      singleton: def.squadMode === 'singleton',
      // ★ v2：实体侧编队/uid/移动目标抽干回池（def 派生项仍按上面名册口径）
      ...e.drain(),
    });
    // ★ 池满（AGENT_CAPACITY）→ 未入池：保持实体在场（注册/可见/刚体全不动），下拍重试。
    //   否则"先收纳再摘除"会把单位弄丢，对象仓里留个永远回不来的孤儿。
    if (!ok) return;
    // ★ 步骤 5/9：注销 uid 映射（队长标记不再指向该实体）
    this.forgetEntity(e);
    // ★ 降格 = 实体销毁但"人还活着"（回代理池）→ 不算击杀；
    //   用 retire('demoted') 表达原因（取代 killedByCombat 布尔，2026-09-18）
    // ★ 懒加载（用户定 2026-09-27）：**不销毁**——冻结并收纳进对象仓（纹理/血条保留、停更）；
    //   回 L3 由 promoteAgent 直接取出复用（不重建）。
    e.tierStash();
    if (idx >= 0) this.deps.enemies.splice(idx, 1);
    if (e.swarmUid > 0) {
      this.tierStash.set(e.swarmUid, e);
      this.reuseDbg.stash++;
    }
  }

  /** ★ 步骤 8：升格（SwarmTierPort.promote；委托 promoteAgent） */
  promote(snap: AgentSnapshot): void {
    this.promoteAgent(snap);
  }

  private reservedAccum = 0;

  /** ★ P-L1 预留物化（用户定 2026-09-27；1s 拍）：预留队**走近（≤L2_RADIUS）**→
   *  按名册在队长旁物化成员代理（就近并入本队）；未走近 → 维持队长单点。 */
  tickReserved(dt: number, px: number, pz: number): void {
    this.reservedAccum += dt;
    if (this.reservedAccum < 1) return;
    this.reservedAccum = 0;
    const pool = this.deps.swarm.pool;
    for (const s of this.deps.swarm.squads.all()) {
      const r = s.reserved ?? 0;
      if (r <= 0) continue;
      let lx = 0, lz = 0, leaderIdx = -1;
      for (let i = 0; i < pool.count; i++) {
        if (pool.swarmUid[i] !== s.leaderUid) continue;
        lx = pool.x[i]; lz = pool.z[i]; leaderIdx = i; break;
      }
      if (leaderIdx < 0) continue;                              // 队长不在池（实体/已亡）：等下一拍
      if (Math.hypot(lx - px, lz - pz) > SWARM.L2_RADIUS) continue;   // 仍在 L1 → 保持预留
      const { n, hp } = this.deps.swarm.squads.takeReserved(s.id);
      if (n <= 0) continue;
      // ★ Flux 收单源（用户定 2026-09-27）：L1→L2 物化走 **TierHandover.expandFromL1**——
      //   按预留槽位出人（对象仓取出复用优先）；失败 → **回补预留**（下拍再试，绝不半途丢人）。
      const h = tierHandover();
      const leadSnap = pool.snapshot(leaderIdx);
      const members: TierCarryMember[] = [
        { uid: s.leaderUid, hp: leadSnap.hp, maxHp: leadSnap.maxHp, slotRank: 0 },
      ];
      for (let k = 0; k < n; k++) {
        const mh = hp > 0 ? hp : leadSnap.maxHp;
        members.push({ uid: 0, hp: mh, maxHp: mh, slotRank: k + 1 });
      }
      const role = s.builders ? 'engineer' : s.type === 'ranged' ? 'ranged' : s.type === 'flyer' ? 'flyer' : 'melee';
      const carry: TierCarry = { squadId: s.id, role, squadType: s.type, mobIndex: s.mobKind, alive: n + 1, leader: leadSnap, members };
      if (!h || !h.expandFromL1(carry)) {
        this.deps.swarm.squads.reserve(s.id, n, hp);   // 回补：下拍重试
        continue;
      }
    }
  }

  /** ★ 舰船遇围警示播报（**无条件开启**：探索期照常盯，航行期舰船活着也盯，
   *  跟大规模进攻节奏零耦合；舰内/舰毁才停）。
   *  近距通道：舰船 ≤SHIP_GROUP_RADIUS 内敌军（L3 实体 + 蜂群代理）≥SHIP_GROUP_COUNT
   *  且持续 SHIP_GROUP_SUSTAIN 秒 —— 团已扎到船边。
   *  横幅实时刷新计数，回落到 HIDE 才清除。（旧“扑舰意图”通道已删） */
  updateShipGroupWarning(dt: number): void {
    if (!this.deps.ship || this.deps.shipDestroyed) {
      this.groupWarnAccum = 0;
      if (this.groupWarnShown) {
        this.groupWarnShown = false;
        this.deps.worldUIManager.clearEnemyGroupWarning();
        this.deps.syncSceneBgm();   // ★ 舰没了 → 战斗曲淡出，回常态
      }
      return;
    }
    const sx = this.deps.ship.position.x;
    const sz = this.deps.ship.position.z;
    const r2 = WorldSpawner.SHIP_GROUP_RADIUS ** 2;
    let dist = 0;
    for (const e of this.deps.enemies) {
      const dx = e.position.x - sx, dz = e.position.z - sz;
      if (dx * dx + dz * dz <= r2) dist++;
    }
    const pool = this.deps.swarm.pool;
    for (let i = 0; i < pool.count; i++) {
      const dx = pool.x[i] - sx, dz = pool.z[i] - sz;
      if (dx * dx + dz * dz <= r2) dist++;
    }
    const proxHit = dist >= WorldSpawner.SHIP_GROUP_COUNT;
    if (proxHit) {
      const need = WorldSpawner.SHIP_GROUP_SUSTAIN;
      this.groupWarnAccum = Math.min(need, this.groupWarnAccum + dt);
      if (this.groupWarnShown) {
        this.deps.worldUIManager.showEnemyGroupWarning(dist);
      } else if (this.groupWarnAccum >= need) {
        this.groupWarnShown = true;
        this.deps.worldUIManager.showEnemyGroupWarning(dist);
        this.deps.syncSceneBgm();
      }
    } else if (dist <= WorldSpawner.SHIP_GROUP_HIDE_COUNT) {
      this.groupWarnAccum = 0;
      if (this.groupWarnShown) {
        this.groupWarnShown = false;
        this.deps.worldUIManager.clearEnemyGroupWarning();
        this.deps.syncSceneBgm();
      }
    } else if (this.groupWarnShown) {
      this.deps.worldUIManager.showEnemyGroupWarning(dist);
    }
  }

  /** ★ 代理近战结算（伤害管线同源；source = 代理占位源，数值全由 dmg 给出） */
  agentMelee(targetKind: number, dmg: number, x: number, z: number): void {
    // ★ 祖宗：代理思考侧已在贴身距离判定 → 取近旁存活祖宗（取最近者兜底 3m）
    if (targetKind === AGENT_TARGET_SENTINEL) {
      let best: AllyBase | null = null;
      let bestD2 = 3 * 3;
      for (const d of this.deps.drones) {
        if (!d.stationary || d.hp <= 0) continue;
        const dx = d.position.x - x, dz = d.position.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= bestD2) { bestD2 = d2; best = d; }
      }
      // ★ 命中点：横向取代理位置（代理侧只给了 x/z）；纵向问目标自己（别写死 +1.0）
      if (best) applyDamage(dmg, AGENT_SOURCE, best, {
        hitPoint: { x, y: best.hitAnchorY(), z },
      });
      return;
    }
    const s = this.deps.session;
    if (!s) return;
    if (targetKind === AGENT_TARGET_SHIP) {
      if (!isShipDestroyed(s)) damageShip(s, dmg);
      return;
    }
    if (!this.deps.player.dead) applyDamage(dmg, AGENT_SOURCE, this.deps.player, {
      hitPoint: { x, y: this.deps.player.hitAnchorY(), z },
    });
  }

  /** ★ 祖宗嘲讽查询（蜂群代理）：(x,z) 嘲讽圈内最近存活祖宗；对象复用零分配 */
  nearestTauntSentinel(x: number, z: number): { x: number; z: number } | null {
    let best: AllyBase | null = null;
    let bestD2 = SENTINEL_TAUNT_RADIUS * SENTINEL_TAUNT_RADIUS;
    for (const d of this.deps.drones) {
      if (!d.stationary || d.hp <= 0) continue;
      const dx = d.position.x - x, dz = d.position.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bestD2) { bestD2 = d2; best = d; }
    }
    if (!best) return null;
    this._tauntScratch.x = best.position.x;
    this._tauntScratch.z = best.position.z;
    return this._tauntScratch;
  }

  /** ★ P0 压测：在玩家周围 40~120m 铺 N 只代理（?enemies=N；近处会自动升格为实体） */
  spawnStressAgents(n: number): void {
    if (!this.deps.scene || this.deps.mobDefs.length === 0) return;
    const pp = this.deps.player?.position;
    if (!pp) return;
    let placed = 0;
    for (let guard = 0; guard < n * 20 && placed < n; guard++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 80;
      const x = pp.x + Math.cos(ang) * dist;
      const z = pp.z + Math.sin(ang) * dist;
      const role = this.deps.raster.tileDefAt(x, z).genRole;
      const def = this.pickMob();
      // ★ 空中层（2026-09-18）：飞行兵可以铺在水/坑上方（它不落地）；地面兵照旧排除
      const air = def.isAir === true;
      if (!air && (role === 'pit' || role === 'liquid')) continue;
      // ★ 2026-09-19 修正：地面单位必须落真实地表（surfaceHeightAt）——
      //   原“洞顶优先（hint=1e9）”会把波次地面代理铺在洞顶/浮空岛上层，
      //   且批量跟随又用自身 y 做层提示 → 永远“站”在洞顶（玩家看=浮空）。
      const y = air
        ? this.deps.raster.surfaceHeightAtFor(x, z, 1e9) + def.airAltitude
        : this.deps.raster.surfaceHeightAt(x, z);
      if (!air && y < -1.2) continue;
      const mobIndex = this.deps.mobDefs.indexOf(def);
      if (mobIndex < 0) return;
      const stats = this.mobAgentStats(def);
      const sc = this.deps.enemyScale;
      const hp = Math.max(Math.round(def.hp * sc.hp), Math.round(sc.hpFloor));
      const meleeTotal = Math.max((stats.damage + def.attackPower) * sc.atk, sc.atkFloor);
      const idx = this.deps.swarm.spawn({
        mobIndex,
        x, y, z,
        hp, maxHp: hp,
        defense: def.defense + sc.def, attackPower: 0,
        speed: stats.speed,
        meleeDamage: meleeTotal, meleeRange: stats.range,
        scale: def.scale,
        tier: AGENT_TIER_FAR,
        aggro: stats.aggro * (this.deps.threat?.aggroMul ?? 1),
        wanderSpeed: stats.wanderSpeed,
        bias: this.deps.threat?.biasMul ?? 0.12,
        isAir: air,
        altitude: air ? def.airAltitude : 0,
        suicide: def.suicide === true,
        canBuild: def.canBuild === true,
        // ★ 兵种画像透传到代理（此前漏传 → 所有代理被当 grunt/melee：小队类型/分工全错）
        role: def.role ?? (air ? 'flyer' : 'grunt'),
        attackType: def.attackType ?? (stats.ranged ? 'ranged' : 'melee'),
        ranged: stats.ranged,
        skin: stats.skin,
        shotSpeed: stats.shotSpeed,
        shotLife: stats.shotLife,
        singleton: def.squadMode === 'singleton',
      }, true);   // ★ 压测：绕过账本闸门（调试专用）
      if (idx >= 0) placed++;
      if (this.deps.enemies.length + this.deps.swarm.count >= WorldSpawner.MAX_ALIVE) break;
    }
  }

  /** ★ 从 MobDef 的 AI 配置提取代理所需的移动/近战/仇恨参数（缺省与 behaviors 默认一致） */
  mobAgentStats(def: MobDef): {
    speed: number; damage: number; range: number;
    wanderSpeed: number; aggro: number;
    /** ★ 远程档（2026-09-19）：代理真弹道射击（马手/术士不再追脸近战） */
    ranged: boolean; skin: number; shotSpeed: number; shotLife: number;
  } {
    let speed = 2.5, damage = 8, range = 1.8;
    let wanderSpeed = 2, aggro = 8;
    let ranged = false, skin = 0, shotSpeed = 26, shotLife = 2.4;
    // ① 行为扫描：移动/游走/近战/远程参数（远程兵以 rangedShot 为准）
    for (const st of Object.values(def.ai.states)) {
      for (const b of st.behaviors) {
        if (b.name === 'moveToTarget' && b.params?.speed !== undefined) speed = Number(b.params.speed);
        if (b.name === 'wander' && b.params?.speed !== undefined) wanderSpeed = Number(b.params.speed);
        if (b.name === 'meleeSwing') {
          if (b.params?.damage !== undefined) damage = Number(b.params.damage);
          if (b.params?.range !== undefined) range = Number(b.params.range);
        }
        if (b.name === 'rangedShot') {
          ranged = true;
          if (b.params?.damage !== undefined) damage = Number(b.params.damage);
          if (b.params?.speed !== undefined) shotSpeed = Number(b.params.speed);
          if (b.params?.lifetime !== undefined) shotLife = Number(b.params.lifetime);
          skin = b.params?.skin === 'fireball' ? 1 : 0;
        }
      }
    }
    // ② 转移扫描：索敌半径 + 远程开火距离（inRange = attackRadius，如 9~10m）
    for (const st of Object.values(def.ai.states)) {
      for (const tr of st.transitions) {
        if (tr.cond === 'seePlayer' && tr.params?.radius !== undefined) aggro = Number(tr.params.radius);
        if (ranged && tr.cond === 'inRange' && tr.params?.radius !== undefined) range = Number(tr.params.radius);
      }
    }
    return { speed, damage, range, wanderSpeed, aggro, ranged, skin, shotSpeed, shotLife };
  }


  /** ★ 生成一"窝"杂兵（《RTS架构.md》：全部先入蜂群代理池，近处自动升格为实体）。
   *   以落点为中心放 def.pack 只（原石虫 = 一整窝），同伴围绕中心 ±1.6m 散布。
   *   ★ 当日兵力计划（引擎账本 total）在此消耗；额度满 → spawn 返回 -1，本窝停止。
   *   ★ 小 Boss / 精英（singleton / elite）与杂兵同路（正常入账）。 */
  spawnOne(
    def: MobDef,
    x: number, _y: number, z: number,
    assaultIndex = -1,
    /** ★ 手动放置接口（调试）：true = 忽略"水/坑不可站"与存活上限（可放水里） */
    force = false,
  ): boolean {
    // ★ P-L1（用户定 2026-09-27）：**L1 档只放队长**——落点在 L2 半径外时，
    //   其余成员记**预留名册**（不物化、不占算力）；走近（≤L2_RADIUS）由 tickReserved 物化。
    const sp0 = this.deps.ship?.position;
    const farL1 = !force && !!sp0 && tierForDistance(Math.hypot(x - sp0.x, z - sp0.z)) === 'L1';   // ★ 舰心口径
    let any = false;
    for (let k = 0; k < def.pack; k++) {
      let sx = x, sz = z;
      if (k > 0) {
        // ★ 同伴散布（k=0 中心；其余绕圈小偏移）
        const ang = (k / def.pack) * Math.PI * 2 + Math.random() * 0.8;
        const dist = 1.2 + Math.random() * 1.6;
        sx = x + Math.cos(ang) * dist;
        sz = z + Math.sin(ang) * dist;
      }
      if (this.spawnSingle(def, sx, _y, sz, assaultIndex, force)) {
        any = true;
        if (farL1 && k === 0 && this.lastAgentIdx >= 0) {
          const sid = this.deps.swarm.pool.squadId[this.lastAgentIdx];
          const hp = this.deps.swarm.pool.hp[this.lastAgentIdx];
          this.deps.swarm.squads.reserve(sid, def.pack - 1, hp);
          break;   // L1：只放队长
        }
      }
    }
    return any;
  }

  /** ★ 生成**单只**（精确编成/起飞回收名单重放用；不含窝散布） */
  spawnSingle(
    def: MobDef,
    x: number, _y: number, z: number,
    assaultIndex = -1,
    force = false,
    /** ★ 原始血量覆盖（用户定 2026-09-27：特殊兵种卡死重放要**原血量**）；≤0 = 用名册推算 */
    hpOverride = 0,
  ): boolean {
    if (!this.deps.scene || !this.deps.camera || this.deps.mobDefs.length === 0) return false;
    const mobIndex = this.deps.mobDefs.indexOf(def);
    if (mobIndex < 0) return false;
    // ★ 上限检查（每只都查；实体 + 代理合计）；手动放置（force）不受上限
    if (!force && this.deps.enemies.length + this.deps.swarm.count >= WorldSpawner.MAX_ALIVE) return false;
    const stats = this.mobAgentStats(def);
    // ★ 敌人数值增强（EnemyScaling：基础随角色增强 + 天数/抽卡；硬下限防一下秒）
    const base = this.deps.scalingInputs ?? { day: 1, totalPulls: 0, refHp: 100, refAtk: 10, refDef: 2 };
    const sc = assaultIndex > 0
      ? computeEnemyScale({ ...base, assaultIndex })
      : this.deps.enemyScale;
    const hp = hpOverride > 0
      ? Math.round(hpOverride)
      : Math.max(Math.round(def.hp * sc.hp), Math.round(sc.hpFloor));
    // 近战总量 =（AI 挥击 + 攻击力加成）× 攻击倍率，且不低于攻击下限；代理统一记在 meleeDamage
    const meleeTotal = Math.max((stats.damage + def.attackPower) * sc.atk, sc.atkFloor);
    const dfs = def.defense + sc.def;
    // ★ 落点可站（坑/水/过低跳过）；空中层豁免（悬停）
    const air = def.isAir === true;
    const role = this.deps.raster.tileDefAt(x, z).genRole;
    if (!force && !air && (role === 'pit' || role === 'liquid')) return false;
    const sy = air
      ? this.deps.raster.surfaceHeightAtFor(x, z, 1e9)
      : this.deps.raster.surfaceHeightAt(x, z);
    if (!force && !air && sy < -1.2) return false;
    const idx = this.deps.swarm.spawn({
      mobIndex,
      x, y: air ? sy + def.airAltitude : sy, z,
      hp, maxHp: hp,
      defense: dfs, attackPower: 0,
      speed: stats.speed,
      meleeDamage: meleeTotal, meleeRange: stats.range,
      scale: def.scale,
      // ★ 生成即定档（用户定 2026-09-27）：**同时检查舰心/玩家**，取半径内等级最大者
      tier: agentTierAt(x, z, [this.deps.ship ? { x: this.deps.ship.position.x, z: this.deps.ship.position.z } : null, this.deps.player ? { x: this.deps.player.position.x, z: this.deps.player.position.z } : null]),
      aggro: stats.aggro * (this.deps.threat?.aggroMul ?? 1),
      wanderSpeed: stats.wanderSpeed,
      bias: this.deps.threat?.biasMul ?? 0.12,
      isAir: air,
      altitude: air ? def.airAltitude : 0,
      suicide: def.suicide === true,
      canBuild: def.canBuild === true,
      // ★ 兵种画像透传到代理（此前漏传 → 所有代理被当 grunt/melee：小队类型/分工全错）
      role: def.role ?? (air ? 'flyer' : 'grunt'),
      attackType: def.attackType ?? (stats.ranged ? 'ranged' : 'melee'),
      ranged: stats.ranged,
      skin: stats.skin,
      shotSpeed: stats.shotSpeed,
      shotLife: stats.shotLife,
      singleton: def.squadMode === 'singleton',
    }, force);
    this.lastAgentIdx = idx;
    return idx >= 0;   // ★ 账本由引擎 spawn() 自增（唯一生成口）
  }

  /** ★ 步骤 5：uid → L3 实体（队长标记镜像用；降格时移除） */
  private readonly byUid = new Map<number, EnemyBase>();

  /** ★ 档位隐藏/收纳（用户定 2026-09-27；《移动执行重写.md》§7.4）：
   *  L2/L3 **不销毁**——纹理/血条等实体对象保留，隐藏/显示复用；L1 收纳进对象仓（对象保留）。 */
  private readonly tierStash = new Map<number, EnemyBase>();
  /** 懒加载探针：stash = 收纳次数 / reuse = 取出复用次数（reuse>0 = 确实没重建）/ drop = 孤儿清仓次数 */
  readonly reuseDbg = { stash: 0, reuse: 0, drop: 0 };
  /** 最近一次 spawnSingle 落池下标（P-L1 预留名册归属用；-1 = 无） */
  private lastAgentIdx = -1;

  /** 彻底移除：对象仓同 uid 一并丢弃（真死/清场；防漏对象；副本静默退役不记账） */
  dropStashByUid(uid: number): void {
    const e = this.tierStash.get(uid);
    if (!e) return;
    this.tierStash.delete(uid);
    this.reuseDbg.drop++;
    e.retire('recycled');
  }

  /** ★ 模式退出清仓（2026-10-01）：收纳实体已 `em.unregister`，`entities.clear()` 遍历不到——
   *  不清理会在共享场景里留下隐形对象/网格跨局累积。退役全部并清空。 */
  disposeStash(): void {
    for (const e of this.tierStash.values()) e.retire('mode_cleanup');
    this.reuseDbg.drop += this.tierStash.size;
    this.tierStash.clear();
  }

  /** 实体查询（uid；判官/交接用） */
  entityByUid(uid: number): EnemyBase | null {
    return this.byUid.get(uid) ?? null;
  }

  /** L3→L2：隐藏（停渲染，不销毁不搬池） */
  hideByUid(uid: number): boolean {
    const e = this.byUid.get(uid);
    if (!e) return false;
    e.visible = false;
    return true;
  }

  /** L2→L3：显示（复用既有对象，不重建） */
  showByUid(uid: number): boolean {
    const e = this.byUid.get(uid);
    if (!e) return false;
    e.visible = true;
    return true;
  }

  /** L1 收纳：移出在场名单、存进对象仓（纹理/血条保留）；返回血量供名册回填。
   *  ★ 必须走 `tierStash()`（2026-10-01）：冻结模拟 + **停用刚体**——
   *  否则停车位留下看不见的实心刚体，子弹被它挡下（命中按静态世界结算）。 */
  stashByUid(uid: number): { hp: number; maxHp: number } | null {
    const e = this.byUid.get(uid);
    if (!e) return null;
    const idx = this.deps.enemies.indexOf(e);
    if (idx >= 0) this.deps.enemies.splice(idx, 1);
    e.tierStash();
    this.tierStash.set(uid, e);
    return { hp: e.hp, maxHp: e.maxHp };
  }

  /** 离开 L1：取出复用（原地复活；无 → false，调用方物化）。
   *  ★ 走 `tierRestore()`：恢复模拟 + 重新启用刚体（与收纳成对）。 */
  unstashByUid(uid: number): boolean {
    const e = this.tierStash.get(uid);
    if (!e) return false;
    this.tierStash.delete(uid);
    this.deps.enemies.push(e);
    e.tierRestore();
    if (e.swarmUid > 0) this.byUid.set(e.swarmUid, e);
    return true;
  }

  /** ★ 步骤 9：实体销毁 → 注销 uid 映射（阵亡/降格；小队注销由 swarm.onEntityKilled 负责） */
  forgetEntity(e: EnemyBase): void {
    if (e.swarmUid > 0) this.byUid.delete(e.swarmUid);
  }

  /** ★ 步骤 9b：命令/指令推送到 L3 实体（池侧写列；实体不在池内，走 uid 映射） */
  applyOrderToEntity(uid: number, order: TacticalOrder, directive: UnitDirective, until: number): void {
    const e = this.byUid.get(uid);
    if (!e || e.dead) return;
    e.applyOrder(
      {
        kind: order.kind,
        targetX: order.target?.x ?? 0,
        targetZ: order.target?.z ?? 0,
        until,
        seq: order.seq,
      },
      {
        kind: directive.kind,
        targetX: directive.targetX ?? 0,
        targetZ: directive.targetZ ?? 0,
        wardUid: directive.wardUid ?? 0,
        until: directive.until,
        fire: fireCode(directive.fire),
        speedMul: directive.speedMul,
        seq: directive.seq,
      },
    );
  }

  /** ★ 步骤 5：队长标记镜像（池侧选举/接任 → 实体；仅存活实体） */
  setLeaderFlag(uid: number, isLeader: boolean): void {
    const e = this.byUid.get(uid);
    if (!e || e.dead) return;
    e.isLeader = isLeader;
  }

  /** ★ 升格：代理 → L3 实体（蜂群 hooks.promote；同步创建 EnemyBase） */
  promoteAgent(snap: AgentSnapshot): void {
    if (!this.deps.scene || !this.deps.camera) return;
    const def = this.deps.mobDefs[snap.mobIndex];
    if (!def) return;
    // ★ 懒加载（用户定 2026-09-27）：对象仓有 → **取出复用**（纹理/血条不重建），快照回灌后复活
    const uid0 = snap.uid ?? 0;
    const stashed = uid0 > 0 ? this.tierStash.get(uid0) : undefined;
    if (stashed && stashed.lifeState === 'active') {
      this.tierStash.delete(uid0);
      this.reuseDbg.reuse++;
      this.deps.enemies.push(stashed);
      stashed.position.x = snap.x; stashed.position.y = snap.y; stashed.position.z = snap.z;
      stashed.hp = Math.min(snap.hp, snap.maxHp);
      stashed.hydrate(snap);
      stashed.tierRestore();   // 显示 + 重新注册（模拟/渲染恢复）
      this.byUid.set(uid0, stashed);
      return;
    }
    const enemy = this.createEnemyEntity(def, snap.x, snap.y, snap.z, snap.hp, snap.maxHp);
    if (!enemy) return;
    const stats = this.mobAgentStats(def);
    enemy.defense = snap.defense;
    // ★ 实体近战 = AI 基础挥击（behavior.damage）+ attackPower → 反推 attackPower 保持同口径
    enemy.attackPower = Math.max(0, Math.round(snap.meleeDamage - stats.damage));
    enemy.hp = Math.min(snap.hp, snap.maxHp);
    // ★ v2：编队/uid/移动目标等随快照回灌（缺省字段不动，行为不变）
    enemy.hydrate(snap);
    // ★ 步骤 5：注册 uid → 实体（队长标记镜像用）
    if (enemy.swarmUid > 0) this.byUid.set(enemy.swarmUid, enemy);
  }

  /** ★ 创建 L3 实体（升格路径；统一在此维护 animMap/掉落映射） */
  createEnemyEntity(
    def: MobDef,
    x: number, y: number, z: number,
    hp: number, maxHp: number,
  ): EnemyBase | null {
    if (!this.deps.scene || !this.deps.camera) return null;
    const enemy = new EnemyBase(this.deps.entities, this.deps.scene, def.asset, {
      x, y, z,
      animMap: {
        states: {
          idle: { 前: ['前'], 后: ['后'] },
          walk: { 前: ['前'], 后: ['后'] },
          attack: { 前: ['前'], 后: ['后'] },
        },
        fps: { idle: 1, walk: 1, attack: 1 },
      },
      facing: Math.random() < 0.5 ? '前' : '后',
      aiConfig: def.ai,
      hp,
      defense: def.defense,
      attackPower: def.attackPower,
      scale: def.scale,
      collisionScale: def.collisionScale,
      groundSink: def.groundSink,
      // ★ 空中层（2026-09-18）：升格后的 L3 实体也悬停（与代理层同一高度口径）
      airborne: def.isAir,
      airAltitude: def.airAltitude,
      // ★ 自爆标签（基类字段）
      suicide: def.suicide === true,
      // ★ 施工能力（与 role 解耦）
      canBuild: def.canBuild === true,
      // ★ v2 蜂群预留字段（缺省值 = 行为不变）
      role: def.role,
      attackType: def.attackType,
      // ★ E4a：编队移动速度（steer 下发速度；与代理层 stats.speed 同源）
      moveSpeed: this.mobAgentStats(def).speed,
      // ★ 贴片朝向（缺省自动判定：无「后」帧 → billboard）
      billboard: def.billboard,
    }, this.deps.camera);
    enemy.maxHp = maxHp;
    enemy.hp = Math.min(hp, maxHp);
    // ★ 不再强制 billboard=false：由 EnemyBase 按素材「后」帧自动判定（见其构造）
    this.deps.enemyDefs.set(enemy, def);
    this.deps.enemies.push(enemy);
    return enemy;
  }
}
