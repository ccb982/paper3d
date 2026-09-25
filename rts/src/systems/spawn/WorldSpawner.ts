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
import { RasterMap, chunkKeyOf } from '../../services/map/RasterMap';
import { CHUNK_SIZE } from '../../services/map/ChunkGenerator';
import { ChunkManager } from '../../services/map/ChunkManager';
import { LOD_MAX_DIST } from '../../services/lod';
import { BOSS_AI, type AIConfig } from '../../systems/ai/aiconfig';
import { SwarmSystem, SWARM } from '../../systems/swarm/SwarmSystem';
import { Director, INTENT_NONE, INTENT_SHIP, type SpawnOrder } from '../../systems/swarm/Director';
import {
  computeEnemyScale, computeThreat, threatTier,
  type EnemyScale, type ThreatProfile,
} from '../../systems/swarm/EnemyScaling';
import {
  AGENT_TARGET_SENTINEL, AGENT_TARGET_SHIP, AGENT_TIER_FAR, type AgentSnapshot,
} from '../../systems/swarm/AgentPool';
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
  // ---- 共享可变状态（WorldMode 持有；Spawner 读写同一份）----
  enemies: EnemyBase[];
  enemyDefs: WeakMap<EnemyBase, MobDef>;
  mobDefs: MobDef[];
  bossEntity: EnemyBase | null;
  bossRun: boolean;
  threat: ThreatProfile | null;
  spawnChunkKey: number;
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
  /** ★ 环境刷怪预铺闸（扫描式波次只批量预铺到 ambientTarget 的一半；
   *  其余由导演低频补至 threat.ambientTarget。前期 target=6 → 只预铺 3 只，
   *  场间几乎无扰，给足发育时间；中后期随威胁度增长铺满） */
  static readonly AMBIENT_PRELOAD_RATIO = 0.5;
  /** ★ 刷怪环上限（米）：波次/扫描刷怪点约束在此环内（代理 L1 回收半径 190m 的预留带）。
   *  ★ 2026-09-21：LOD 显示半径 90→140m 后同步 120→180m */
  static readonly ENEMY_CULL_RADIUS = 180;
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
  /** ★ 意图通道触发：≥ 此数蜂群代理**明确扑向舰船**（INTENT_SHIP）→ 快速播报（不论远近） */
  static readonly SHIP_INTENT_COUNT = 4;
  /** 意图通道迟滞：扑向舰船的代理 ≤ 此数 才可清除 */
  static readonly SHIP_INTENT_HIDE = 2;
  /** 意图通道持续时长（秒；比近距更快，扑舰波次换位期间不错过） */
  static readonly SHIP_INTENT_SUSTAIN = 0.3;


  /** 已完成波次的 chunk（避免重复铺；换局由 reset() 清空） */
  private spawnedChunks = new Set<number>();
  /** 祖宗嘲讽查询的复用对象（零分配） */
  private _tauntScratch = { x: 0, z: 0 };
  /** ★ 「今日敌军已全部投入」是否已播报（每局一次；reset 清） */
  private forceExhaustedShown = false;
  /** 判定延迟计时（进图后 1.5s 再判，避开落地动画） */
  private forceExhaustedAccum = 0;

  constructor(private deps: SpawnDeps) {}

  /** ★ 换局清理（WorldMode.enter 调用） */
  reset(): void {
    this.spawnedChunks.clear();
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
    const out: { mobIndex: number; role: UnitRole; count: number }[] = [];
    for (const [mobIndex, r] of roster) out.push({ mobIndex, role: r.role, count: r.count });
    this.deps.swarm.data.setRecalledRoster(out);
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

  scanAndSpawnWaves(px: number, pz: number, budget: number): void {
    if (this.deps.testChunk || this.deps.mobDefs.length === 0) return;
    // ★ 引擎账本生成闸门已满 → 整段跳过（省掉每帧 24 个 chunk 的扫描）
    if (!this.deps.swarm.ledger.canSpawn()) return;
    if (this.deps.chunks.isBoss4D) return; // 四维空间（最终 Boss 战地图）不刷杂兵
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    let placedTotal = 0;
    // ★ 从内环到外环扫（保证离玩家近的 chunk 优先铺满）
    for (let ring = 1; ring <= 2 && placedTotal < budget; ring++) {
      for (let dz = -ring; dz <= ring && placedTotal < budget; dz++) {
        for (let dx = -ring; dx <= ring && placedTotal < budget; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue; // 只在环上
          const cx = pcx + dx, cz = pcz + dz;
          const key = chunkKeyOf(cx, cz);
          if (key === this.deps.spawnChunkKey) continue;  // 出生 chunk 不刷
          if (this.spawnedChunks.has(key)) continue; // 已完成波次的 chunk 跳过
          // ★ chunk 地形已就绪（有数据环）才可落点
          if (!this.deps.raster.getChunkData(cx, cz)) continue;
          // ★ 回收环约束（2026-09-12 狠缩环配套）：chunk 最近点超过回收环 −10m
          //   → 整块不刷【且不标记完成】（靠近后转内环再补），避免刷出即被销毁
          const nxp = Math.max(cx * CHUNK_SIZE, Math.min(px, (cx + 1) * CHUNK_SIZE));
          const nzp = Math.max(cz * CHUNK_SIZE, Math.min(pz, (cz + 1) * CHUNK_SIZE));
          const nd = Math.hypot(nxp - px, nzp - pz);
          if (nd > WorldSpawner.ENEMY_CULL_RADIUS - 10) continue;
          // ★ 每 chunk 一波 1~2 个（2026-09-13 二次定调：预铺只做保底，密度减半）
          const want = 1 + Math.floor(Math.random() * 2);
          let placed = 0;
          let attempts = 0;
          for (; attempts < want * 10 && placed < want && placedTotal < budget; attempts++) {
            if (this.spawnAtRandomPointInChunk(cx, cz)) placed++;
          }
          placedTotal += placed;
          // ★ 放满 / 尝试耗尽（地形基本没位置）才算完成；预算截断 → 下帧继续
          if (placed >= want || attempts >= want * 10) {
            this.spawnedChunks.add(key);
          }
        }
      }
    }
  }

  /** ★ 随机在 chunk 内找一个可站立点并生成一个杂兵（不可站立点返回 false） */
  spawnAtRandomPointInChunk(cx: number, cz: number): boolean {
    if (this.deps.mobDefs.length === 0 || !this.deps.scene || !this.deps.camera) return false;
    // ★ 存活上限（实体 + 代理合计；防无限世界累积）+ 环境预铺闸
    //   （预铺 = ambientTarget 的一半，其余交给导演按 ambientInterval 低频补）
    if (this.deps.enemies.length + this.deps.swarm.count >= WorldSpawner.MAX_ALIVE) return false;
    const ambientTarget = this.deps.threat?.ambientTarget ?? 10;
    const preloadCap = Math.max(2, Math.ceil(ambientTarget * WorldSpawner.AMBIENT_PRELOAD_RATIO));
    if (this.deps.enemies.length + this.deps.swarm.count >= preloadCap) return false;
    const x = cx * CHUNK_SIZE + 4 + Math.random() * (CHUNK_SIZE - 8);
    const z = cz * CHUNK_SIZE + 4 + Math.random() * (CHUNK_SIZE - 8);
    // ★ 玩家近旁不刷（防贴脸 pop-in；出生 chunk 自身已整体排除，
    //   邻 chunk 允许到 12m——初始密度够又不出现在脚边）
    const p = this.deps.player?.position;
    if (p) {
      const ddx = x - p.x, ddz = z - p.z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < 12 * 12) return false;
      // ★ 回收环约束（配套狠缩环）：超出 回收环−10m 的点不刷——否则 0.25s 后即被清
      const maxR = WorldSpawner.ENEMY_CULL_RADIUS - 10;
      if (d2 > maxR * maxR) return false;
    }
    // ★ 坑/水/虚空/未生成：不站（isDepression 包含坑洞与水）
    const role = this.deps.raster.tileDefAt(x, z).genRole;
    if (role === 'pit' || role === 'liquid') return false;
    // ★ 洞顶优先（浮空洞顶第二层）：不把杂兵刷进洞里
    const y = this.deps.raster.surfaceHeightAtFor(x, z, 1e9);
    // ★ 落点过低（挖坑后的深坑区）不生成
    if (y < -1.2) return false;
    return this.spawnOne(this.pickMob(), x, y, z);
  }

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

  /** ★ P4：执行导演订单（大波集中）：每次事件 1~2 波、每波一个方向扇区，
   *  两波之间方向明显错开（双面夹击），但每面都是"一团人"而非全向散兵 */
  spawnDirectorWave(order: SpawnOrder): void {
    // ★ 袭击订单带主攻扇区（整场固定的一个方向）；环境散兵随机
    let sector = order.sector ?? Math.random() * Math.PI * 2;
    for (let w = 0; w < order.waves; w++) {
      this.spawnWaveNear(order.anchorX, order.anchorZ, {
        count: order.count,
        intent: order.intent,
        preferPack: order.preferPack,
        sector,
        spread: 0.5,
        assaultIndex: order.assaultIndex ?? -1,
      });
      sector += Math.PI * (0.6 + Math.random() * 0.6);
    }
  }

  /** ★ 波次生成（导演订单 / 调试用）：
   *  在指定焦点的 LOD 外环（94~130m 纵深带，chunk 数据环内）铺 count 只代理。
   *  sector 给定则整波集中在 ±spread 扇区（集中大波，便于防守）。
   *  ⚠️ 无论焦点是谁，都避开 玩家 12m / 舰船 15m 的安全圈。 */
  spawnWaveNear(
    fx: number, fz: number,
    opts: {
      count: number; intent: number; preferPack: boolean;
      sector?: number; spread?: number; assaultIndex?: number;
    },
  ): void {
    if (this.deps.testChunk || this.deps.mobDefs.length === 0) return;
    if (this.deps.chunks.isBoss4D) return; // 四维空间不补杂兵
    const want = Math.max(1, opts.count);
    let placed = 0;
    const pp = this.deps.player?.position;
    const sp = this.deps.ship?.position;
    // ★ 方向：整波集中在 [sector ± spread] 扇区（默认全向；导演订单必带扇区）
    const baseAng = opts.sector ?? Math.random() * Math.PI * 2;
    const spread = opts.spread ?? Math.PI;
    const lo = LOD_MAX_DIST + 4;
    // ★ 波内纵深带：lo ~ SPAWN_BAND_HI（扩 LOD 后 lo 变远，带上限同步外扩）
    const span = WorldSpawner.SPAWN_BAND_HI - lo;
    // ★ count = 个体数（2026-09-13 三次修正：原按"窝"计数——原石虫一窝 4 只，
    //   导演"每波 5~8"实际最多刷 32 只；现按个体扣减，窝仍是刷怪单位）
    for (let i = 0; i < want * 10 && placed < want; i++) {
      const ang = baseAng + (Math.random() - 0.5) * 2 * spread;
      const dist = lo + Math.random() * span;
      const x = fx + Math.cos(ang) * dist;
      const z = fz + Math.sin(ang) * dist;
      // 安全圈：不在玩家/舰船近旁生成（焦点波次也不贴脸）
      if (pp && (x - pp.x) ** 2 + (z - pp.z) ** 2 < 12 * 12) continue;
      if (sp && (x - sp.x) ** 2 + (z - sp.z) ** 2 < 15 * 15) continue;
      // 目标 chunk 必须已有地形数据（未生成的世界区域不刷）
      const cx = Math.floor(x / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      if (chunkKeyOf(cx, cz) === this.deps.spawnChunkKey) continue;
      if (!this.deps.raster.getChunkData(cx, cz)) continue;
      const role = this.deps.raster.tileDefAt(x, z).genRole;
      if (role === 'pit' || role === 'liquid') continue;
      const y = this.deps.raster.surfaceHeightAtFor(x, z, 1e9); // 洞顶优先（不刷进洞里）
      if (y < -1.2) continue;
      const def = this.pickMob(opts.preferPack);
      if (this.spawnOne(def, x, y, z, opts.intent, opts.assaultIndex ?? -1)) placed += def.pack;
    }
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
      e.retire('recycled');
      if (idx >= 0) this.deps.enemies.splice(idx, 1);
      return;
    }
    const stats = this.mobAgentStats(def);
    this.deps.swarm.demote({
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
    // ★ 步骤 5/9：注销 uid 映射（队长标记不再指向该实体）
    this.forgetEntity(e);
    // ★ 降格 = 实体销毁但"人还活着"（回代理池）→ 不算击杀；
    //   用 retire('demoted') 表达原因（取代 killedByCombat 布尔，2026-09-18）
    e.retire('demoted');
    if (idx >= 0) this.deps.enemies.splice(idx, 1);
  }

  /** ★ 步骤 8：升格（SwarmTierPort.promote；委托 promoteAgent） */
  promote(snap: AgentSnapshot): void {
    this.promoteAgent(snap);
  }

  /** ★ 舰船遇围警示播报（**无条件开启**：探索期照常盯，航行期舰船活着也盯，
   *  跟大规模进攻节奏零耦合；舰内/舰毁才停）。双通道，谁触发取谁计数：
   *   ① 近距通道：舰船 ≤SHIP_GROUP_RADIUS 内敌军（L3 实体 + 蜂群代理）≥SHIP_GROUP_COUNT
   *      且持续 SHIP_GROUP_SUSTAIN 秒 —— 团已扎到船边；
   *   ② 意图通道：≥SHIP_INTENT_COUNT 个代理明确扑向舰船（池 intent=INTENT_SHIP）持续
   *      SHIP_INTENT_SUSTAIN 秒 —— 波次刚刷、还在路上就报，灵敏度更高。
   *   横幅显示 max(近距, 扑舰) 计数并实时刷新；双双回落到各自 HIDE 才清除。 */
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
    let intentShip = 0;
    for (let i = 0; i < pool.count; i++) {
      const dx = pool.x[i] - sx, dz = pool.z[i] - sz;
      if (dx * dx + dz * dz <= r2) dist++;
      if (pool.intent[i] === INTENT_SHIP) intentShip++;
    }
    const proxHit = dist >= WorldSpawner.SHIP_GROUP_COUNT;
    const intentHit = intentShip >= WorldSpawner.SHIP_INTENT_COUNT;
    if (proxHit || intentHit) {
      // 意图通道更快响应；已显示则持续刷新计数
      const need = intentHit
        ? WorldSpawner.SHIP_INTENT_SUSTAIN
        : WorldSpawner.SHIP_GROUP_SUSTAIN;
      this.groupWarnAccum = Math.min(need, this.groupWarnAccum + dt);
      if (this.groupWarnShown) {
        this.deps.worldUIManager.showEnemyGroupWarning(Math.max(dist, intentShip));
      } else if (this.groupWarnAccum >= need) {
        this.groupWarnShown = true;
        this.deps.worldUIManager.showEnemyGroupWarning(Math.max(dist, intentShip));
        this.deps.syncSceneBgm();   // ★ 大举入侵成立 → 战斗曲交叉淡入
      }
    } else if (
      dist <= WorldSpawner.SHIP_GROUP_HIDE_COUNT &&
      intentShip <= WorldSpawner.SHIP_INTENT_HIDE
    ) {
      this.groupWarnAccum = 0;
      if (this.groupWarnShown) {
        this.groupWarnShown = false;
        this.deps.worldUIManager.clearEnemyGroupWarning();
        this.deps.syncSceneBgm();   // ★ 威胁解除 → 淡回环境音 / 舰船曲
      }
    } else if (this.groupWarnShown) {
      // 迟滞带（已触发但未落到清除线）：维持并刷新计数
      this.deps.worldUIManager.showEnemyGroupWarning(Math.max(dist, intentShip));
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
    intent: number = INTENT_NONE,
    assaultIndex = -1,
    /** ★ 手动放置接口（调试）：true = 忽略"水/坑不可站"与存活上限（可放水里） */
    force = false,
  ): boolean {
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
      if (this.spawnSingle(def, sx, _y, sz, intent, assaultIndex, force)) any = true;
    }
    return any;
  }

  /** ★ 生成**单只**（精确编成/起飞回收名单重放用；不含窝散布） */
  spawnSingle(
    def: MobDef,
    x: number, _y: number, z: number,
    intent: number = INTENT_NONE,
    assaultIndex = -1,
    force = false,
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
    const hp = Math.max(Math.round(def.hp * sc.hp), Math.round(sc.hpFloor));
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
      tier: AGENT_TIER_FAR, // 由 SwarmSystem 每帧按距离重算
      aggro: stats.aggro * (this.deps.threat?.aggroMul ?? 1),
      wanderSpeed: stats.wanderSpeed,
      bias: this.deps.threat?.biasMul ?? 0.12,
      intent,
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
    return idx >= 0;   // ★ 账本由引擎 spawn() 自增（唯一生成口）
  }

  /** ★ 步骤 5：uid → L3 实体（队长标记镜像用；降格时移除） */
  private readonly byUid = new Map<number, EnemyBase>();

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
