// ============================================================
// WorldMode —— 大世界模式（完全自包含）
// ============================================================
// 组合职责（架构 2.2）：
//   - 拥有私有 PhysicsWorld、DesktopBinding、EntityManager
//   - 输入流：Binding(设备) → InputActions(语义) → 本模式 → 实体管线
//   - 进入战场时创建物理/输入，返回时完整清理
//
// 核心原则："谁创建，谁销毁；谁拥有，谁负责"
// ============================================================

import * as THREE from 'three';
import type { IGameMode, IGameModeContext } from '../core/IGameMode';
import type { GameSession } from '../core/Session';
import { SaveSystem } from '../core/SaveSystem';
import { FtxAsset } from '../vendor/player/FtxAsset';
import { CombatItemController } from '../systems/itemPlayback/CombatItemController';
import { allyPlaybackRegistry } from '../systems/itemPlayback/AllyPlayback';
import type { Asset } from '../vendor/player';
import type { FluidEffect } from '../vendor/player/fluid/FluidEffect';
import { compositeFrameToCanvas } from '../services/item/BasicMaterialsIcons';
import { SentinelProjectile } from '../services/fx/SentinelProjectile';
import { CoverEntity, COVER_DEPLOY_BUILD_TIME, coverTopAt, updateWallAuras, wallNear, snapshotCovers } from '../entity/CoverEntity';
import {
  loadWorldState, saveWorldState, pruneWorldStates,
  type WorldStateData, type AllyRec,
} from '../core/WorldStateCache';
import { coverBrickTexture, COVER_W, COVER_T } from '../services/render/CoverRenderer';
import { DeployPreview } from '../services/fx/DeployPreview';
import { stepFluidShared } from '../services/fx/FluidShared';
import { CharacterBase } from '../entity/CharacterBase';
import { EntityManager } from '../entity/EntityManager';
import type { EntityBase } from '../entity/EntityBase';
import { Player } from '../entity/player/Player';
import { PlayerPipeline } from '../systems/player/PlayerPipeline';
import { ShipEntity, SHIP_LANDED_HEIGHT } from '../entity/ShipEntity';
import { resolveDockSpawn } from '../services/ship/DockResolver';
import { applyShipDamage, damageShip, isShipDestroyed, reviveShip } from '../systems/ship/ShipState';
import travelConfig from '../config/travel.json';
import { EnemyBase } from '../entity/EnemyBase';
import type { AllyBase, AllyWorldPort } from '../entity/ally/AllyBase';
import { DroneAlly } from '../entity/ally/DroneAlly';
import { SentinelAlly } from '../entity/ally/SentinelAlly';
import { GroundStationaryAlly } from '../entity/ally/GroundStationaryAlly';
import { allySystem } from '../systems/ally/AllySystem';
import { WaterFx } from '../systems/world/WaterFx';
import { CharacterClamp } from '../systems/world/CharacterClamp';
import { CombatSystem } from '../systems/combat/CombatSystem';
import { BaseScene, type BaseStation } from '../ui/base/BaseScene';
import { RoomPostFx } from '../services/render/RoomPostFx';
import { CraftingOverlay } from '../ui/base/CraftingOverlay';
import { ItemIconRegistry } from '../services/item/ItemIconRegistry';
import { createButton } from '../ui/components/Button';
import baseRoomsJson from '../config/baseRooms.json';
// ★ 敌军名册（唯一真源）：mobDefs 按 id 从这里装配
import { ENEMY_BY_ID, ENEMY_FALLBACK, type EnemyAssetEntry } from '../config/enemyRoster';
import { CameraController } from '../services/camera/CameraController';
import { renderManager } from '../services/render/RenderManager';
import { PhysicsWorld } from '../services/physics/PhysicsWorld';
import { DesktopBinding } from '../platform/input/DesktopBinding';
import { playBgm, stopBgm } from '../services/audio/Bgm';
import { playSfx, playLoopSfx, stopLoopSfx } from '../services/audio/Sfx';
import { RasterMap, chunkKeyOf } from '../services/map/RasterMap';
import { CHUNK_SIZE } from '../services/map/ChunkGenerator';
import { ChunkManager, type ImpactReport, type DecorPropInstance } from '../services/map/ChunkManager';
import { collectibleDropOf, collectibleCapOf } from '../services/map/decor/CollectibleProps';
import { resolveTileLook } from '../services/map/TileMaterials';
import { LOD_MAX_DIST } from '../services/lod';
import { setPropAtlas, plantGustAt, plantDropTryClaim, tickPlantGust, PROP_GUST_RADIUS, type ChunkGroundHost } from '../services/map/decor/MapEntityDecorBase';
import { aiSystem } from '../systems/ai/AISystem';
import type { BehaviorContext, TargetCandidate } from '../systems/ai/behaviors';
import { SwarmSystem, SWARM, type SwarmHooks } from '../systems/swarm/SwarmSystem';
import { Director, INTENT_NONE, INTENT_SHIP, type DirectorHooks, type SpawnOrder } from '../systems/swarm/Director';
import { computeEnemyScale, computeThreat, threatTier, type EnemyScale, type ThreatProfile } from '../systems/swarm/EnemyScaling';
// ★ 击杀统计 + 每日敌人配额（2026-09-16）
//   口径：quota 预计算后**冻结**（当天总数不变）；远距清除**不算击杀**（只记 recalled）；
//   配额闸门依据 = quota − spawned（只增不减，不受回收影响）。
import {
  ensureDayQuota, resetDayQuota, recordKill, recordRecall, recordSpawn,
  queryKillProgress, remainingQuota,
} from '../systems/combat/KillCounter';
import { AGENT_TARGET_SENTINEL, AGENT_TARGET_SHIP, AGENT_TIER_FAR, AIR_ALTITUDE_DEFAULT, AIR_BOB_AMP, AIR_BOB_RATE, type AgentSnapshot } from '../systems/swarm/AgentPool';
import { entityPerf } from '../entity/EntityPerf';
import { NpcEntity } from '../entity/NpcEntity';
import { VisitorNpcBase } from '../entity/VisitorNpc';
import { VisitorManager } from '../systems/visitors/VisitorManager';
import type { VisitorBodyStyle } from '../services/render/VisitorBodyRenderer';
import type { VisitorModelStyle } from '../services/render/VisitorModelRenderer';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import {
  createSolidBulletAsset, createArrowAsset, ARROW_BASE_WIDTH,
  createFireballAsset, FIREBALL_BASE_WIDTH,
} from '../services/fx/SolidBulletAsset';
import { CharacterFxManager } from '../services/fx/CharacterFxManager';
// ★ 贴片接地补偿（量素材底部透明余量；详见该文件头注释）
import { footSinkRatioOf } from '../services/fx/FootAnchor';
import { aimRaycast, raySphereHit } from '../services/combat/Targeting';
import { BulletManager, type BulletHitPayload } from '../services/combat/BulletManager';
import { BULLET_HIT_RADIUS } from '../services/combat/BulletEntity';
import { applyDamage } from '../services/combat/DamagePipeline';
import { applyHeal } from '../services/combat/Healing';
import { effectSystem } from '../services/combat/EffectSystem';
import { queryFinalStats } from '../services/combat/FinalStats';
import { eventBus } from '../core/EventBus';
import { computeRelicModifiers, dailySpawnPoint } from '../core/Session';
import type { AmmoEntryView } from '../services/ui/AmmoPanel';
import { RELIC_ITEM_CONFIG } from '../config/relics';
import { relicGrantsFor, dispatchRelicEvent, relicTimedFor } from '../core/RelicEffects';
import { addStaticObstacle, removeStaticObstacle } from '../services/physics/StaticObstacleRegistry';
import { DialogueView } from '../ui/shared/DialogueView';
import { DialogueSystem, type DialogueGrant } from '../systems/dialogue/DialogueSystem';
import { EventSystem } from '../systems/events/EventSystem';
import { loadFtxCached } from '../services/fx/FtxAssetCache';
import { hash2 } from '../services/map/TerrainNoise';
import { sharedWaterMaterial } from '../services/map/WaterMaterial';
import { CombatDirector } from '../services/combat/CombatDirector';
import { executeAttack } from '../services/combat/Attack';
import { ItemManager } from '../systems/inventory/ItemManager';
import { CraftingManager } from '../systems/inventory/CraftingManager';
import { InteractionManager } from '../systems/interaction/InteractionManager';
import { WorldUIManager } from '../ui/world/WorldUIManager';
import { PickupGlowEffect } from '../services/fx/PickupGlowEffect';
import { rollDrops } from '../services/item/ItemDropPipeline';
import { startMiniGame, closeMiniGame } from '../minigames';
import { WorldSpawner, type SpawnDeps, type MobDef, SENTINEL_TAUNT_RADIUS } from '../systems/spawn/WorldSpawner';

/** ★ 友军物品 id：部署生成 / 损毁即彻底消失（不返还、不可维修） */
const DRONE_ITEM = 'kaltsit_drone';
// ---- ★ 载具（逻各斯的圆凳）：移速 / 爬坡 / 过坑 ----
/** 主角基础移速（m/s）；装备移速加成（VehicleRide.moveSpeedMul）在此之上乘算 */
const PLAYER_MOVE_SPEED = 5.0;
/** 过坑：贴地桥接采样半径（米）——脚下取邻域最高面，骑过坑洞不沉底 */
const VEHICLE_BRIDGE_RADIUS = 1.6;
/** 爬坡上行速度（m/s；普通角色 7.5） */
const VEHICLE_CLIMB_SPEED = 24;

/** ★ 玩家子弹伤害 = max(下限, 角色攻击力 × 系数)；遗物/装备加成的攻击力实时生效。
 *  （子弹 source = 子弹实体，attackPower 恒 0 → 管线只做减法防御，不会重复加攻击） */
const PLAYER_BULLET_MIN_DAMAGE = 10;
const PLAYER_BULLET_ATK_RATIO = 1.0;
/** ★ 主角基础攻击间隔（秒）：实际间隔 = 本值 × 100 / (100 + 攻击速度点数)（方舟攻速口径） */
const PLAYER_ATTACK_INTERVAL = 0.9;
/** ★ 主角子弹飞行参数：速度（m/s）/ 寿命（s）→ 射程 = 速度 × 寿命 */
const PLAYER_BULLET_SPEED = 50;
const PLAYER_BULLET_LIFETIME = 3.0;
/** ★ 主角子弹轻微弹道修正（自瞄）：只修正准星小偏角内的敌人，幅度很小不影响甩枪手感 */
const AIM_ASSIST_ANGLE = 0.05;    // 仅候选：偏角 ≤ ~2.9°
const AIM_ASSIST_MAX = 0.03;      // 单发最多修正 ~1.7°
const AIM_ASSIST_RANGE = 32;      // 只对 32m 内敌人生效（米）
const AIM_ASSIST_STRENGTH = 0.6;  // 修正比例（0=不修，1=完全指向）
/** ★ 经典 TPS 枪口→准星收敛：准星射线无命中（对天/虚空）时，
 *  取相机射线上此距离处作为虚拟落点 → 子弹仍与准星共点（不会与相机平行"各飞各的"） */
const CROSSHAIR_CONVERGE_DIST = 200;
/** ★ 可发射弹药 itemId（背包中有该类型即可在弹药栏切换；开火消耗 1） */
const FIREABLE_AMMO = new Set<string>(['zuzong', 'cover', 'tumu_laojie']);
/** ★ 祖宗弹（专属投影物）：速度（m/s）/ 寿命（s） */
const SENTINEL_SHOT_SPEED = 20;
const SENTINEL_SHOT_LIFETIME = 3.0;
/** ★ 掩体弹（玩家遗物部署）：速度/寿命/同时存在上限 */
const COVER_SHOT_SPEED = 18;
const MAX_COVER_PLAYER = 6;
/** ★ 祖宗弹命中伤害 = max(下限, 主角攻击力 × 系数)，结算后立即落地生成祖宗 */
const SENTINEL_IMPACT_MIN_DAMAGE = 8;
const SENTINEL_IMPACT_ATK_RATIO = 0.8;
/** ★ 祖宗弹伤害 = max(下限, 主角攻击力 × 系数)（与无人机同口径：友军随主角强度） */
const SENTINEL_MIN_DAMAGE = 8;
const SENTINEL_ATK_RATIO = 1.0;
/** ★ 祖宗自动挖矿：索矿半径（米；无敌人时随机打铁/水/地面） */
const SENTINEL_MINE_RANGE = 22;
/** ★ 留存祖宗唤醒：玩家接触半径（米；休眠祖宗被碰到 → 启用 + 入队友列表） */
const SENTINEL_WAKE_R = 2.2;
/** 挖矿采样次数上限（每类） */
const SENTINEL_MINE_SAMPLES = 16;
/** ★ 治疗转伤害（遥·幽隙栖萤）：累计治疗量 ≥ 该值才触发一次（避免每帧 1 点伤害刷屏/暴涨） */
const HEAL_PROC_MIN_HEAL = 1.0;
// ★ 复活倒计时阶梯 / 血量保底已下沉 systems/player/PlayerPipeline.ts（架构 §7）

// ============================================================
// WorldMode 进入上下文（扩展 IGameModeContext）
// ============================================================

export interface WorldModeEnterContext extends IGameModeContext {
  day: number;
  protagonistAsset: FtxAsset;
  bulletAsset?: Asset | FtxAsset;
  /** ★ 敌军素材（id 对应 `config/enemyRoster.ts` 名册；地图大量随机生成用） */
  enemyAssets?: EnemyAssetEntry[];
  /** ★ 普瑞赛斯（Boss 战实体素材；scene.zip） */
  bossAsset?: FtxAsset | Asset;
  hitEffectAsset?: Asset;
  /** ★ 可露希尔的无人机素材（特效包优先，回退纯纹理包） */
  droneAsset?: Asset | FtxAsset;
  /** ★ 祖宗素材（站桩友军；缺省回退无人机素材） */
  sentinelAsset?: Asset | FtxAsset;
  /** ★ 采集物纹理图集（key → FTX 包，每包 4 帧；每株随机抽 1 帧静态显示） */
  plantAssets?: Record<string, FtxAsset>;
  /** ★ 调试开关（main.ts 从 URL 参数解析；素材填充测试用） */
  debug?: {
    testChunk?: boolean;
    enemyStress?: number;
    /** ★ 落地名册陈列：舰船落地后把每种敌人各铺一只（见 WorldSpawner.spawnRosterShowcase）。
     *  `?roster=0` 可关（缺省开）。 */
    rosterOnLanding?: boolean;
  };
}

// ============================================================
// WorldMode 类
// ============================================================

/** ★ 每帧性能细分（毫秒；main.ts 的 FPS HUD 读取，定位更新耗时分布） */
export const worldPerf = {
  chunks: 0, ui: 0, combat: 0, ai: 0, entity: 0, post: 0, phys: 0, total: 0,
  drones: 0, ent: 0, water: 0, clamp: 0,
  nEnemies: 0, nDrones: 0, nEntities: 0, nBases: 0,
  /** ★ 蜂群代理数（L1+L2；P0 度量） */
  nAgents: 0,
  /** 记录构成（HUD 诊断）：地形 trimesh / 装饰与友军碰撞体 / 其他活体 */
  nGround: 0, nDecor: 0,
  /** ★ 本帧 chunk 装配耗时（ms；0=未装配） */
  assembly: 0,
};

// ★ 镜头调度临时量（follow 每帧刷新目标机位，零分配）
const _camMat = new THREE.Matrix4();
const _camEye = new THREE.Vector3();
const _camAt = new THREE.Vector3();
const _camUp = new THREE.Vector3(0, 1, 0);
const _arcV = new THREE.Vector3();

/** ★ 相机姿态插值（资料共识"绕注视点的球面弧"）：
 *  位置 = 相对 pivot 的球坐标 (r,θ,φ) 各分量插值（角度走最短路径）→ 折返弧线，
 *  不会直线穿过地形/目标；朝向独立 slerp。pivot 为空退化为线性。 */
function interpCamPose(
  fromPos: THREE.Vector3, fromQuat: THREE.Quaternion,
  toPos: THREE.Vector3, toQuat: THREE.Quaternion,
  e: number, pivot: THREE.Vector3 | null,
  outPos: THREE.Vector3, outQuat: THREE.Quaternion,
): void {
  if (!pivot) {
    outPos.lerpVectors(fromPos, toPos, e);
  } else {
    const fv = _arcV.copy(fromPos).sub(pivot);
    const rF = Math.max(fv.length(), 1e-3);
    const thF = Math.atan2(fv.z, fv.x);
    const phF = Math.asin(Math.max(-1, Math.min(1, fv.y / rF)));
    const tv = _arcV.copy(toPos).sub(pivot);
    const rT = Math.max(tv.length(), 1e-3);
    const thT = Math.atan2(tv.z, tv.x);
    const phT = Math.asin(Math.max(-1, Math.min(1, tv.y / rT)));
    let dTh = thT - thF;
    while (dTh > Math.PI) dTh -= Math.PI * 2;
    while (dTh < -Math.PI) dTh += Math.PI * 2;
    const r = rF + (rT - rF) * e;
    const th = thF + dTh * e;
    const ph = phF + (phT - phF) * e;
    const cp = Math.cos(ph);
    outPos.set(
      pivot.x + r * cp * Math.cos(th),
      pivot.y + r * Math.sin(ph),
      pivot.z + r * cp * Math.sin(th),
    );
  }
  outQuat.slerpQuaternions(fromQuat, toQuat, e);
}

export class WorldMode implements IGameMode {
  entities!: EntityManager;
  player!: Player;
  /** ★ 舰船实体（航行阶段可操控；停靠后静止，敌人索敌最优先） */
  ship!: ShipEntity;
  /** ★ 阶段：sail = 操控舰船航行（耗油/选停靠）；explore = 控制角色探索
   *  ★ 音乐只在「船内」响（用户定调 2026-09-17）：interior → 舰船曲；sail → 静音。
   *    explore（下机到野外）放的是**环境音**而不是音乐（低音量循环底噪，见 syncSceneBgm）。
   *    阶段每次赋值都必须跟一次 syncSceneBgm()（漏一处就有一段时间声音不对）。 */
  /** ★ 刷怪 / 波次 / LOD 升降格 / 威胁告警（2026-09-18 迁出 → systems/spawn/WorldSpawner） */
  private spawner!: WorldSpawner;
  private phase: 'sail' | 'explore' | 'interior' = 'sail';
  /**
   * ★ 当前环境（天空/云开关）：与 phase 绑定，由 `setPhase` 唯一维护。
   *   记录它是为了**幂等**——`renderManager.setEnvironment('world')` 会重置云场，
   *   不能每次 phase 赋值都无脑调一遍。
   */
  private envKind: 'ship' | 'world' = 'world';
  /** ★ 降落进近（按 F 后，2026-09-12 用户定调）：保留前进速度 + 低操控（25%）+
   *  只自动固定高度（不动角度/方向）；期间地形已切细化实时加载。
   *  approach → 触地 → settle（镜头仍跟随舰船，完整看到接地停稳）→ finishDock。 */
  private landing: {
    phase: 'approach' | 'settle';
    t: number;
    fromX: number; fromZ: number;
    toX: number; toZ: number;
    /** 玩家下机点（舰船侧旁，beginSettle 时解析） */
    exitX: number; exitY: number; exitZ: number;
    emergency: boolean;
  } | null = null;
  /** ★ 降落"观察机位"（2026-09-12 重写，按资料共识：固定镜头 + 一次性取景）：
   *  到起调高度后在**触发瞬间一次算好**机位/朝向/注视点（装下"飞机→预测落点"整段），
   *  用缓入缓出+绕注视点的球面弧移动过去，之后**保持不动**——飞机独立降入画面。
   *  全程无逐帧重算/无双重混合 → 不抖。 */
  private camShot: {
    t: number;
    fromPos: THREE.Vector3; fromQuat: THREE.Quaternion;
    shotPos: THREE.Vector3; shotQuat: THREE.Quaternion;
    /** 注视点（也是弧线插值中心） */
    pivot: THREE.Vector3;
  } | null = null;
  /** 观察机位起调高度（米）：高空段仍是追尾机 */
  private static readonly CAM_SHOT_START_ALT = 45;
  /** 追尾机位 → 观察机位 的过渡时长（秒；资料建议 0.5~1.5s 缓入缓出） */
  private static readonly CAM_SHOT_BLEND = 1.2;
  /** 玩家下机点：舰船侧旁偏移（米；避开翼展/机体——4× 模型翼展 ≈±10m） */
  private static readonly PLAYER_EXIT_OFFSET = 13;
  /** 本帧是否触地（landingStep 结果；实体段转落稳用） */
  private landingTouchdown = false;
  /** 落稳段时长（秒）：镜头保持追尾，看舰船贴地/滑到安全点 */
  private static readonly LAND_SETTLE_SECONDS = 1.8;
  /** ★ 起飞段（登船后自动爬升到最低净空；期间锁输入） */
  private takeoff = false;
  /** ★ 登船半径（米）：探索期靠近舰船按 F = 再次起飞（舰船当实体载具）
   *  （4× 模型船体 ≈26m 长，半径放宽） */
  private static readonly REBOARD_RADIUS = 18;
  /** ★ 镜头调度（落地下机 / 登机上机）：机位-朝向平滑过渡，无缝衔接控制权 */
  private camBlend: {
    t: number;
    dur: number;
    fromPos: THREE.Vector3;
    fromQuat: THREE.Quaternion;
    toPos: THREE.Vector3;
    toQuat: THREE.Quaternion;
    /** 弧线插值中心（非空 → 机位绕它走球面弧，避免直线穿地形；空 = 线性） */
    pivot: THREE.Vector3 | null;
    /** 每帧刷新目标机位（跟运动目标；如起飞时舰船仍在爬升） */
    follow?: () => void;
    onDone?: () => void;
  } | null = null;
  /** 登机上机镜头时长（秒；角色第三人称 → 追尾机位） */
  private static readonly CAM_BLEND_UP = 1.2;
  /** 飞行追尾相机首帧就位标记（防从舰内相机位缓慢飞入 → 黑屏感） */
  private flightCamInit = false;
  /** 舰船已毁（结算/复活等待：冻结玩法更新） */
  private shipDestroyed = false;
  /** 舰船状态 HUD 刷新节拍（0.1s） */
  private shipStatusAccum = 0;
  /** ★ 地图上所有杂兵（按 chunk 波次生成，逐个独立 AI） */
  enemies: EnemyBase[] = [];

  /** ★ 蜂群系统（《蜂群架构.md》P1）：远层代理 + 升/降格 + 批量渲染 */
  private swarm = new SwarmSystem();
  /** 蜂群每帧回调（复用对象，避免每帧分配） */
  private swarmHooks: SwarmHooks = {
    playerX: 0, playerZ: 0,
    shipX: 0, shipZ: 0,
    camForwardX: 0, camForwardZ: 1,
    entityCount: 0,
    promote: () => {},
    melee: () => {},
    // ★ 真击杀（代理侧）：记当日击杀数（掉落/遗物由 onAgentKilled 单独结算）
    onAgentKilled: () => { recordKill(this.session); },
    // ★ 远距回收（不算击杀）：只记 recalled —— **不动分母**（当天总数冻结）。
    //   配额闸门看 spawned（只增不减），所以回收后不会补刷（2026-09-16 修正）
    onAgentRecalled: (n) => { recordRecall(this.session, n); },
  };

  /** ★ 杂兵配置条目（由 enemyAssets 按 id 查 config/enemyRoster.ts 装配；生成时按权重随机取一条） */
  private mobDefs: MobDef[] = [];
  /** ★ 敌人实例 → 其 MobDef（击杀掉落结算用；WeakMap 不阻回收） */
  private enemyDefs = new WeakMap<EnemyBase, MobDef>();
  /** ★ 出生 chunk key（玩家安全区：自己不刷怪；敌人从他处生成） */
  private spawnChunkKey = -1;
  /** ★ P4→日节律：战斗节奏导演（平时少量游荡 / 每天 1~2 波大举进攻 + 预警 + 按天强化） */
  private swarmDirector = new Director();
  /** 导演播报钩子（复用对象；enter 时绑定 UI） */
  private directorHooks: DirectorHooks = {};
  /** ★ 敌人数值增强（每日系数；出击时按 天数/抽卡/玩家参考三维 重算） */
  private enemyScale: EnemyScale = { hp: 1, atk: 1, def: 0, hpFloor: 0, atkFloor: 0, total: 1 };
  /** 敌强计算输入快照（生成时按袭击序号现算；参考属性不含装备） */
  private scalingInputs: {
    day: number; totalPulls: number;
    refHp: number; refAtk: number; refDef: number;
  } | null = null;
  /** ★ 威胁度（波次/每波人数/攻击欲望；与敌强同一套输入） */
  private threat: ThreatProfile | null = null;
  /** ★ 遗物周期补给（祖宗发射器：进入战斗后每 interval 秒补 1；多件更快） */
  private timedRelics: { itemId: string; interval: number; timer: number }[] = [];
  /** ★ 舰内房间（E 进舰：起飞/回家/下船；世界冻结） */
  private shipInterior: BaseScene | null = null;
  /** ★ 舰内独立场景（不画世界：彻底隔离粗块/地形/雾/天空） */
  private interiorScene: THREE.Scene | null = null;
  /** ★ 舰内房间屏幕叠加（暗角；在场景直渲之后叠加） */
  private interiorFx: RoomPostFx | null = null;
  /** ★ 舰内操作按钮条（下船/起飞/返回罗德岛号/加工台/背包） */
  /** ★ 加工台覆盖层（舰内按钮打开；懒建）与共享图标服务 */
  private craftingOverlay: CraftingOverlay | null = null;
  private iconRegistry: ItemIconRegistry | null = null;

  // ★ 事件 / 对话（2026-09-14；基地与战斗共用系统，模式内各自装配）
  private eventSystem!: EventSystem;
  private dialogue!: DialogueSystem;
  private dialogueView: DialogueView | null = null;
  /** 探索期事件 NPC（走到近处 E 对话；走远回收） */
  private npcs: NpcEntity[] = [];
  /** 当前就近可交互 NPC（每帧判定；提示/E 键用） */
  private nearbyNpc: NpcEntity | null = null;
  /** ★ 采集物"接触即入包"节拍（0.1s 查询一次）与背包满提示冷却 */
  private autoPickAccum = 0;
  private autoPickToastCd = 0;
  /** 接触采集半径（米；碰到就自动入包，无需按键） */
  private static readonly COLLECT_TOUCH_RADIUS = 1.3;
  /** 正在对话的 NPC（结束后消失） */
  private pendingNpc: NpcEntity | null = null;
  /** 世界事件 NPC 同时存在上限 */
  private static readonly MAX_EVENT_NPCS = 2;
  // ★ 访客系统（每天 1~2 名；config/visitors.ts；抵达 → 进舰内房间）
  private visitorManager: VisitorManager | null = null;
  /** 当天是否已生成过访客（航行飞越不刷；首次探索帧生成） */
  private visitorsSpawned = false;
  /** 当前就近可交谈访客（途中 E 对话） */
  private nearbyVisitor: VisitorNpcBase | null = null;
  /** 正在对话的访客（结束统一收尾：途中续行 / 舰内离舰） */
  private pendingVisitor: VisitorNpcBase | null = null;
  /** 本次出击天数（访客按天生成） */
  private curDay = 1;
  /** ★ 舰内访客站位（房间本地坐标；按到舰顺序分配） */
  private static readonly VISITOR_ANCHORS = [
    { x: -7, z: 3 }, { x: 7, z: 3 }, { x: -7, z: -2 }, { x: 7, z: -2 }, { x: 0, z: 6 },
  ];
  private protagonistAssetRef: FtxAsset | null = null;
  /** ★ Boss 战（抽到普瑞赛斯 → 四维空间；击败 = 通关） */
  private bossRun = false;
  private bossEntity: EnemyBase | null = null;
  private bossAsset: FtxAsset | Asset | null = null;
  /** ★ 压测：?enemies=N 开局在玩家周围铺 N 只代理（P0 度量；0 = 关） */
  private debugEnemyStress = 0;

  // ★ 私有物理世界和输入绑定（外界不可见，exit 时完整清理）
  private physics: PhysicsWorld | null = null;
  private binding: DesktopBinding | null = null;

  // 共享资源引用
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private session: GameSession | null = null;
  private onReturn: (() => void) | null = null;

  private cameraCtrl!: CameraController;
  /** ★ 战斗导演（战斗手感编排：hitstop/镜头冲击；事件驱动，纯表现层） */
  private director!: CombatDirector;
  private raster!: RasterMap;
  /** ★ 地图流式管理器（chunk 扩张队列/异步烘焙/看门狗/风格切换，services/map） */
  private chunks!: ChunkManager;

  // ★ 业务逻辑层（共享模块）
  private itemManager!: ItemManager;
  private craftingManager!: CraftingManager;
  private interactionManager!: InteractionManager;

  // ★ 战斗道具播放（装备贴片；友军走 AllyPlaybackRegistry）
  private combatItems!: CombatItemController;
  /** ★ 穿戴同步节拍（战斗中使用装备道具 → 贴片 0.5s 内刷新） */
  private syncLoadoutAccum = 0;

  // ★ UI 层（世界专属）
  private worldUIManager!: WorldUIManager;

  private bullets!: BulletManager;
  /** ★ 敌方弹道池 · 箭（程序化箭矢：弩手） */
  private enemyBullets!: BulletManager;
  /** ★ 敌方弹道池 · 法球（程序化火球：扩音术士 / 战争术士） */
  private enemyBolts!: BulletManager;
  private bulletCooldown = 0;
  // （chunk 流式构建已下沉 services/map/ChunkManager；材质为每 chunk 独立 Canvas 外观）
  private aiCtx: BehaviorContext = {
    dt: 0, time: 0, target: null,
    findTarget: () => null,
    attack: () => undefined,
  };
  // ★ 出生点/召回兜底位（seed 12345, chunk(0,1)）
  private readonly spawnPoint = { x: 50.6, z: 101.6 };
  private acc = 0;
  private damageUnsub?: () => void;
  /** ★ killed 事件订阅：杂兵死亡 → 从 enemies 列表移除 */
  private killedUnsub?: () => void;
  /** ★ enemy_killed 事件订阅：真击杀 → 当日击杀数 +1（实体侧） */
  private enemyKilledUnsub?: () => void;
  private pickupGlows: PickupGlowEffect[] = [];
  /** ★ 可露希尔的无人机编队（可多架悬浮体；使用道具追加，退出时销毁）
   *  ★ 2026-09-18 起由 AllySystem 统一持有/驱动；此处只保留只读视图 */
  private get drones(): AllyBase[] { return allySystem.allies; }
  /** ★ 无人机素材（特效包/纯纹理包；enter 存入上下文引用） */
  private droneAsset: Asset | FtxAsset | null = null;
  /** ★ 祖宗素材（站桩友军；缺省回退无人机素材，美术到位后只换路径） */
  private sentinelAsset: Asset | FtxAsset | null = null;
  /** ★ 装备提供的友军每秒回血（黍姐的XX 等；refreshPlayerStats 汇总，无人机/祖宗每帧结算） */
  private allyRegen = 0;
  /** ★ 当前选择的快捷弹药（'default' = 普通弹药；其余 = 弹药 itemId）
   *  Q 切换 / 点击切换；攻击键发射。消耗品不进快捷栏，在背包内使用 */
  private selectedQuickItem = 'default';
  /** ★ 投送弹（祖宗弹 / 掩体弹；落地或寿命到 → 生成对应实体） */
  private sentinelShots: {
    proj: SentinelProjectile;
    /** 落地是否生成祖宗（玩家祖宗弹 true；祖宗自身攻击弹 false） */
    spawnOnLand: boolean;
    /** 命中伤害（<0 = 玩家祖宗弹：用 SENTINEL_IMPACT_* 公式现场结算） */
    damage: number;
    /** 伤害来源（伤害事件/遗物管线用） */
    source: EntityBase | null;
    /** ★ 弹种：sentinel = 祖宗弹；cover = 掩体/墙弹（不结算命中，落地生成） */
    kind: 'sentinel' | 'cover';
    /** ★ 掩体弹变体：cover = 带孔掩体；wall = 实心墙（土木老姐） */
    variant: 'cover' | 'wall';
    /** ★ 落地朝向（掩体弹：墙法线 = 发射方向） */
    heading: number;
    /** ★ 掩体/墙弹的**预定落点**（预览点 = 实际落点；飞行仅视觉） */
    targetX: number;
    targetY: number;
    targetZ: number;
    /** 剩余飞行时间（到点即落成） */
    flyLeft: number;
  }[] = [];
  /** 祖宗弹共享纹理（懒建；exit 释放） */
  private sentinelTex: THREE.CanvasTexture | null = null;
  /** ★ 祖宗共享流体（多个祖宗共用一份；每帧只步进一次，避免 N 倍求解卡顿） */
  private sentinelFluid: FluidEffect | null = null;
  /** ★ 祖宗流体步进蓄积（30Hz 节流：半速求解不可感，省 GPU 合成开销） */
  private sentinelFluidAccum = 0;
  /** ★ 治疗转伤害 proc 命中候选缓冲（复用防每帧分配） */
  private _healProcTargets: EnemyBase[] = [];
  /** ★ 玩家专属每帧管线（效果队列/属性刷新/复活倒计时；《实体架构.md》§7） */
  private playerPipeline!: PlayerPipeline;
  /** ★ 遗物属性脏标记（死亡/击杀等事件可能改变遗物结算；每帧最多重算一次） */
  private statsDirty = false;
  /** ★ 无人机召唤事件订阅（enter 注册 / exit 移除） */
  private droneSummonUnsub?: () => void;
  /** ★ 祖宗召唤事件订阅（enter 注册 / exit 移除） */
  private sentinelSummonUnsub?: () => void;
  /** ★ 掩体部署订阅（遗物/道具） */
  private coverSummonUnsub?: () => void;
  /** ★ 出击槽池变动订阅（部署/卸载/替换 → 友军生成/回收；enter 注册 / exit 移除） */
  private deploymentUnsub?: () => void;
  /** ★ 存档基础属性被永久改写订阅（「训练类」消耗品加上限 → 立即重算玩家实体） */
  private playerStatsUnsub?: () => void;
  /** ★ 舰船受击订阅（UI 明显报警：横幅+红屏+状态条闪红；天气来自 damageShip 事件） */
  private shipDamagedUnsub?: () => void;
  /** ★ 入水表现系统（入水波动 + 涉水循环轨；《实体架构.md》§9.5 模式层下沉） */
  private waterFx!: WaterFx;
  /** ★ 角色贴地 / 悬停 / 掉坑结算系统（同上） */
  private charClamp!: CharacterClamp;
  /** ★ 命中解析层（P5：子弹命中 / 代理命中唯一结算入口） */
  private combatSystem!: CombatSystem;
  /** ★ 投送落点预览（祖宗/掩体弹药选中时显示） */
  private deployPreview: DeployPreview | null = null;
  /** ★ 世界状态缓存（同种子不重建）：进入时读到的待恢复数据（地形在 chunk 生成前灌入） */
  private pendingWorldState: WorldStateData | null = null;
  /** ★ beforeunload 存档回调（刷新页面也保住世界状态） */
  private worldStateUnload: (() => void) | null = null;
  /** ★ 周期自动保存计时（15s；防崩溃/关页丢进度） */
  private worldSaveAccum = 0;
  /** ★ 测试地图（单 chunk 陈列馆；ctx.debug.testChunk） */
  private testChunk = false;
  /** ★ 落地名册陈列（?roster=1）：落地后每种敌人各铺一只 —— 兵种行为肉眼验收用 */
  private rosterOnLanding = false;
  /** ★ 调试：F9 颜色回读监听器（exit 时移除） */
  private _f9Handler: ((e: KeyboardEvent) => void) | null = null;
  /** ★ 调试：置位后本帧 render() 末尾立即回读（默认帧缓冲 swap 后读返回 0） */
  private _pendingReadback = false;

  // ============================================================
  // IGameMode 接口实现
  // ============================================================

  enter(ctx: WorldModeEnterContext): void {
    // ★ 刷怪子系统：依赖用 getter/setter 桥接（读到的一定是实时值，写入直接落到本类字段）
    const self = this;
    const deps: SpawnDeps = {
      get enemies() { return self.enemies; },
      get enemyDefs() { return self.enemyDefs; },
      get mobDefs() { return self.mobDefs; },
      get bossEntity() { return self.bossEntity; }, set bossEntity(v) { self.bossEntity = v; },
      get bossRun() { return self.bossRun; }, set bossRun(v) { self.bossRun = v; },
      get threat() { return self.threat; }, set threat(v) { self.threat = v; },
      get spawnChunkKey() { return self.spawnChunkKey; },
      get scalingInputs() { return self.scalingInputs; }, set scalingInputs(v) { self.scalingInputs = v; },
      get enemyScale() { return self.enemyScale; }, set enemyScale(v) { self.enemyScale = v; },
      get player() { return self.player; },
      get ship() { return self.ship; },
      get entities() { return self.entities; },
      get swarm() { return self.swarm; },
      get swarmDirector() { return self.swarmDirector; },
      get chunks() { return self.chunks; },
      get raster() { return self.raster; },
      get session() { return self.session; },
      get scene() { return self.scene; },
      get camera() { return self.camera; },
      get drones() { return self.drones; },
      get worldUIManager() { return self.worldUIManager; },
      get testChunk() { return self.testChunk; },
      get shipDestroyed() { return self.shipDestroyed; },
      get bossAsset() { return self.bossAsset; },
      showFloatingAt: (x, y, z, text, type) => self.showFloatingAt(x, y, z, text, type),
      syncSceneBgm: () => self.syncSceneBgm(),
      returnToBase: () => self.onReturn?.(),
    };
    this.spawner = new WorldSpawner(deps);
    this.spawner.reset();
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.renderer = ctx.renderer;
    this.session = ctx.session;
    this.onReturn = ctx.onReturn ?? null;

    // ---- ★ 创建私有物理世界 ----
    this.physics = new PhysicsWorld();

    // ---- ★ 创建私有输入绑定 ----
    this.binding = new DesktopBinding(window, document.querySelector('canvas')!);

    // ---- ★ 统一空间层（初始 3×3 chunk，玩家驱动扩张） ----
    // ★ 当天地图种子 = 主种子 × 天数（同局同天恒同图；换天/换局换图）
    // ★ 持久世界（2026-09-19）：地图 = 主种子（不随天换）；出生点每天随机（dailySpawnPoint）
    this.raster = new RasterMap(ctx.session.meta.seed);
    // ★ 世界状态缓存（同种子不重建）：把地形破坏/植被已采灌进 RasterMap（chunk 生成前）
    {
      const wst = loadWorldState(ctx.session.meta.seed);
      if (!wst) console.info(`[世界缓存] seed=${ctx.session.meta.seed} 无记录（首次进入或已清档）`);
      if (wst) {
        // ★ 恢复坑洞 + 地形记录（植被不入缓存：每天重建，资源可恢复）
        this.raster.importPersistState({ levels: wst.levels, mapRecords: wst.mapRecords });
        this.pendingWorldState = wst;
      }
    }
    this.entities = new EntityManager(this.physics, this.raster);

    // ---- ★ 地图流式管理器（地面刚体经 ChunkGroundHost 适配进实体系统） ----
    const groundHost: ChunkGroundHost = {
      createGround: (cx, cz, vertices, indices) => this.entities.create({
        kind: 'ground',
        x: cx * CHUNK_SIZE + CHUNK_SIZE / 2, y: 0, z: cz * CHUNK_SIZE + CHUNK_SIZE / 2,
        physics: {
          type: 'fixed',
          options: { shape: { type: 'trimesh', vertices, indices } },
        },
      }).id,
      destroyGround: (id) => {
        // ★ 装饰物 JS 空间索引同步注销（地面 trimesh 不在索引中 → no-op）
        removeStaticObstacle(id);
        this.entities.destroy(id);
      },
      // ★ 分区地面：首 cell 随实体创建（tileSlot 登记），其余分区挂同刚体（全同步）
      createGroundCells: (cx, cz, cells) => {
        if (cells.length === 0) return null;
        const first = cells[0];
        const e = this.entities.create({
          kind: 'ground',
          x: cx * CHUNK_SIZE + CHUNK_SIZE / 2, y: 0, z: cz * CHUNK_SIZE + CHUNK_SIZE / 2,
          physics: {
            type: 'fixed',
            options: {
              shape: { type: 'trimesh', vertices: first.vertices, indices: first.indices },
              tileSlot: first.slot,
            },
          },
        });
        const rb = e.rigidBody;
        if (rb) {
          for (let i = 1; i < cells.length; i++) {
            this.physics?.setTileCollider(rb.handle, cells[i].slot, cells[i].vertices, cells[i].indices);
          }
        }
        return e.id;
      },
      updateGroundCell: (id, slot, vertices, indices) => {
        const rb = this.entities.get(id)?.rigidBody;
        if (rb) this.physics?.setTileCollider(rb.handle, slot, vertices, indices);
      },
      // ★ 远处 chunk 封存：停用/恢复刚体（保留对象，回程零重建）
      setBodyEnabled: (id, enabled) => this.physics?.setBodyEnabled(id, enabled),
      // ★ 装饰物碰撞体：fixed cuboid（挡住玩家/子弹；y 为体积中心）
      //   ★ 同步登记 JS 空间索引（角色静态推挤不再走 rapier 查询）
      createPropBody: (x, y, z, r, h) => {
        const id = this.entities.create({
          kind: 'decoration',
          x, y, z,
          physics: {
            type: 'fixed',
            options: { shape: { type: 'cuboid', hx: r, hy: h / 2, hz: r } },
          },
        }).id;
        addStaticObstacle(id, x, y, z, r, h / 2);
        return id;
      },
    };
    this.chunks = new ChunkManager(this.scene, this.raster, groundHost, {
      testChunk: ctx.debug?.testChunk ?? false,
      onChunkActivated: (cx, cz) => this.onChunkActivated(cx, cz),
    });
    this.testChunk = ctx.debug?.testChunk ?? false;
    this.rosterOnLanding = ctx.debug?.rosterOnLanding ?? false;
    // ★ 航行期：地图两级构建的【粗加载】——大半径铺粗块（硬边/纯色/无物理/无水面/无装饰）
    this.chunks.setCoarseMode(true);
    // ★ 航行低耗渲染：水面隐藏（不渲染水/不跑水面 FFT 着色）+ 云流体/月亮离屏不推进
    this.chunks.setWaterVisible(false);
    // ★ 环境基准复位（防上一局在舰内退出 → skyDome 还藏着）；
    //   phase 相关的其余副作用由下面的 setPhase('sail') 统一处理。
    this.envKind = 'world';
    renderManager.setEnvironment('world');

    // ★ 昼夜循环重置：每次出击从晚上出发（后续可按 Session.day 变化出发时刻）
    renderManager.resetDay();
    sharedWaterMaterial.resetImpacts(); // ★ 清空落水扰动槽（防跨局残留）

    // ★ 出生点每天随机（2026-09-19）：由（主种子, 天数）确定性派生 → 同天重进同点
    const sp0 = dailySpawnPoint(ctx.session.meta.seed, ctx.day);
    const spawn = { x: sp0.x, z: sp0.z };
    if (ctx.session.ship) ctx.session.ship.position = { x: spawn.x, z: spawn.z };

    // ★ 每天出击满油 + 满血（2026-09-12 用户定调：船每天修满，与油同口径）
    if (ctx.session.ship) {
      ctx.session.ship.fuel = ctx.session.ship.fuelMax;
      ctx.session.ship.hp = ctx.session.ship.maxHp;
    }

    // ★ Boss 战判定（必须先于 bootstrap：直接按四维空间风格建图，避免整套重建）
    this.bossRun = !!ctx.session.outOfRun?.owned?.['priestess'] && !ctx.session.meta?.bossCleared;
    if (this.bossRun) this.chunks.setStyle(true);
    this.bossEntity = null;

    // ---- ★ 初始 chunk 数据环 + 出生区 3×3 强制构建（不等队列调度） ----
    this.chunks.bootstrap(spawn.x, spawn.z);

    // ★ 舰船：航行阶段可操控（停靠后转为静止受击目标，敌人索敌最优先）
    this.ship = new ShipEntity(this.entities, this.scene, ctx.session, spawn.x, spawn.z);
    this.setPhase('sail');        // ★ 含 BGM / 环境 / 飞行模式 / 昼夜解冻 / 粗块 / 水面
    this.shipDestroyed = false;
    this.flightCamInit = false;
    this.landing = null;
    this.landingTouchdown = false;
    this.takeoff = false;
    this.camBlend = null;
    this.camShot = null;

    // ★ 主角
    this.protagonistAssetRef = ctx.protagonistAsset ?? null;
    this.player = new Player(this.entities, this.scene, ctx.protagonistAsset, {
      x: spawn.x, y: 0, z: spawn.z,
      animMap: {
        states: {
          idle: { 前: ['前0', '前1'], 后: ['后0', '后1', '后2'] },
          walk: { 前: ['前0', '前1'], 后: ['后0', '后1', '后2'] },
          attack: { 前: ['前0', '前1'], 后: ['后0', '后1', '后2'] },
        },
        fps: { idle: 2, walk: 6, attack: 8 },
      },
      moveSpeed: PLAYER_MOVE_SPEED,
      facing: '后',
    });
    // ★ 航行期：角色隐藏 + 操作锁（停靠时落到安全出生点接管）
    this.player.controlLocked = true;

    // ★ 玩家专属每帧管线（《实体架构.md》§7）：效果/属性/复活收口，模式层只注入依赖
    //   （依赖项惰性求值：worldUIManager/ship 等稍后才建，闭包在调用时才读）
    this.playerPipeline = new PlayerPipeline({
      player: this.player,
      isStatsDirty: () => this.statsDirty,
      refreshStats: () => { this.statsDirty = false; this.refreshPlayerStats(); },
      markStatsDirty: () => { this.statsDirty = true; },
      setRespawnCountdown: (sec) => this.worldUIManager.setRespawnCountdown(sec),
      respawnPoint: () => this.ship?.position ?? this.spawnPoint,
      surfaceHeightAt: (x, z) => this.raster.surfaceHeightAt(x, z),
      snapCamera: (x, y, z) => this.cameraCtrl.snapTo(x, y, z),
      showFloating: (x, y, z, text, style) => this.showFloatingAt(x, y, z, text, style),
    });
    // ★ 每天出击重置：复活阶梯/倒计时归零（首死瞬间复活）
    this.playerPipeline.resetRun();
    // ★ 模式层下沉系统：入水表现 + 贴地/悬停/掉坑结算（行为与旧 WorldMode 私有方法一致）
    this.waterFx = new WaterFx(this.raster);
    this.charClamp = new CharacterClamp({
      raster: this.raster,
      player: this.player,
      clampVehicle: (d) => this.clampVehicle(d),
      // ★ 平台顶（舰船甲板 + 掩体顶）：站上平台（含攀爬落顶）时以顶面为地面
      platformTopAt: (x, z) => {
        const deck = this.ship?.deckTopAt(x, z) ?? null;
        const cover = coverTopAt(x, z);
        if (deck === null) return cover;
        if (cover === null) return deck;
        return Math.max(deck, cover);
      },
    });
    // ★ 投送落点预览（祖宗/城墙/墙）
    if (this.scene) this.deployPreview = new DeployPreview(this.scene);

    // ---- ★ 初始化业务逻辑层（共享模块） —— 必须先于战斗属性应用（装备属性汇总依赖 itemManager）----
    this.itemManager = new ItemManager(ctx.session);
    // ★ 注入效果执行用户：消耗品 buff 作用于玩家实体的效果队列
    this.itemManager.setEffectUser(this.player);
    this.craftingManager = new CraftingManager(ctx.session, this.itemManager);
    this.interactionManager = new InteractionManager({
      session: ctx.session,
      itemManager: this.itemManager,
    });

    // ---- ★ 应用战斗属性：基础（存档原值）× 遗物（效果源）× 装备（效果源），统一走 EffectSystem ----
    this.refreshPlayerStats();
    // ★ 每次出击满血（上限含遗物/装备加成，不沿用上次剩余血量）
    this.player.hp = queryFinalStats(this.player).maxHp;

    // ★ 开局遗物管线（onRunStart 时机；多遗物多效果聚合）→ 优先背包（行囊），满则货舱/基地仓
    //   数量语义由各效果处理器决定（如 start_items：每件遗物 count × 拥有件数）
    for (const g of relicGrantsFor(ctx.session, RELIC_ITEM_CONFIG, 'onRunStart')) {
      for (const layer of ['player', 'ship', 'base'] as const) {
        if (this.itemManager.hasSpace(layer, g.itemId, g.count)) {
          this.itemManager.addItem(layer, g.itemId, g.count);
          break;
        }
      }
    }

    // ---- ★ 死亡动画管线初始化 ----
    CharacterFxManager.init(this.scene, this.renderer);

    // ---- ★ 杂兵配置：唯一直源 = `config/enemyRoster.ts`（按 id 一一对应）----
    //   ★ 这里**不能**用"取模复用"（曾为 `MOB_BLUEPRINTS[i % 3]`）：
    //     素材一多，第 4 个之后的敌人会循环套用前三条数值 → 新敌人拿到错的 AI/血量/掉落。
    //   ★ 名册查不到只 warn + 回退，绝不中断（mobDefs 下标 = mobIndex，不能有空洞）。
    this.bossAsset = ctx.bossAsset ?? null;
    this.mobDefs = (ctx.enemyAssets ?? []).map(({ id, asset }) => {
      let spec = ENEMY_BY_ID.get(id);
      if (!spec) {
        console.warn(`[WorldMode] 敌军 "${id}" 未登记于 config/enemyRoster.ts → 回退 ${ENEMY_FALLBACK.id} 数值`);
        spec = ENEMY_FALLBACK;
      }
      return {
        id: spec.id, name: spec.name,
        asset,
        ai: spec.ai, hp: spec.hp, defense: spec.defense, attackPower: spec.attackPower,
        scale: spec.scale, collisionScale: spec.collisionScale,
        pack: spec.pack, weight: spec.weight, drops: spec.drops,
        // ★ 接地补偿：量出素材底透明余量（比例）× scale = 世界下沉量，再叠加名册手调
        groundSink: footSinkRatioOf(asset) * spec.scale + (spec.groundSink ?? 0),
        // ★ 空中层（2026-09-18）：名册 isAir/airAltitude → 玩法层装配；缺省高度取引擎兜底
        isAir: spec.isAir === true,
        airAltitude: spec.airAltitude ?? AIR_ALTITUDE_DEFAULT,
        // ★ 贴片朝向（2026-09-18）：缺省自动（无「后」帧 → billboard）
        billboard: spec.billboard,
      };
    });
    // ★ 采集物纹理图集注入（'plant' 渲染器消费；需在本帧任何 chunk 装配之前）
    for (const [key, asset] of Object.entries(ctx.plantAssets ?? {})) {
      setPropAtlas(key, asset);
    }
    // ★ 蜂群批量渲染（每兵种图集 + InstancedMesh；《蜂群架构.md》§5.7）
    //   ★ 必须传接地补偿：L2 代理与 L3 实体口径不同会让"远看接地、近看悬空"
    this.swarm.buildBatch(
      this.scene!,
      this.mobDefs.map((d) => d.asset),
      this.mobDefs.map((d) => d.groundSink),
    );
    // ★ 蜂群回调（一次性绑定，避免每帧闭包分配）
    this.swarmHooks.promote = (snap) => this.spawner.promoteAgent(snap);
    this.swarmHooks.melee = (tk, dmg, x, z) => this.spawner.agentMelee(tk, dmg, x, z);
    this.swarmHooks.nearestTaunt = (x, z) => this.spawner.nearestTauntSentinel(x, z);
    this.swarmHooks.onAgentKilled = (mobIndex, x, y, z) => this.onAgentKilled(mobIndex, x, y, z);
    // ★ 友军世界端口（一次性注入所有友军；替代逐个体的 6 个回调）
    allySystem.setWorldPort({
      rangedAttack: (from, target) => this.fireSentinelShot(from, target),
      findAgentTarget: (x, z, r) => this.swarm.nearestAgentIndex(x, z, r),
      agentPosOf: (i) => (
        this.swarm.agentAlive(i)
          ? { x: this.swarm.agentX(i), y: this.swarm.agentY(i), z: this.swarm.agentZ(i) }
          : null
      ),
      rangedAgentAttack: (_from, i) => this.fireSentinelShotAtAgent(i),
      mineAttack: (from) => this.sentinelMine(from),
    });
    // ★ P0 压测：?enemies=N → 开局在玩家周围 40~120m 铺 N 只代理（基线度量用）
    this.debugEnemyStress = ctx.debug?.enemyStress ?? 0;
    if (this.debugEnemyStress > 0) this.spawner.spawnStressAgents(this.debugEnemyStress);
    // ★ 出生 chunk 不刷怪（自己的 chunk 留给玩家出生/回城安全区）
    this.spawnChunkKey = chunkKeyOf(
      Math.floor(spawn.x / CHUNK_SIZE),
      Math.floor(spawn.z / CHUNK_SIZE),
    );
    // ★ P4：波次由导演控制（威胁预算 + 节奏；不再双计时器硬刷）

    // ---- 相机 ----
    this.cameraCtrl = new CameraController(this.camera);

    // ---- ★ 战斗导演（监听 damage/killed 事件编排打击反馈） ----
    this.director = new CombatDirector(this.cameraCtrl);

    // ---- ★ UI 层（世界专属） ----
    this.worldUIManager = new WorldUIManager(
      ctx.session, this.itemManager, this.interactionManager, this.raster, spawn,
      this.pendingWorldState?.explored ?? null,
    );
    // ★ 地图标记增删 → 世界状态立即落盘（永久化存储：不放 15s 窗口里赌）
    this.worldUIManager.onMapChanged = () => this.saveWorldStateNow();
    // ★ 属性面板实时数据源（含限时 buff/遗物变化的最终属性）
    this.worldUIManager.setPlayerStatsProvider(() => queryFinalStats(this.player));
    // ★ 共享图标服务（背包/加工台同一份）
    this.iconRegistry = new ItemIconRegistry(this.itemManager);
    this.worldUIManager.setIconRegistry(this.iconRegistry);
    // ★ 战斗节奏导演：日节律（平时少量游荡 / 每天 1~2 波大举进攻）+ 预警播报 + 按天强化
    this.directorHooks.onWarning = (sec, label) => {
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      const tier = this.threat ? threatTier(this.threat.index) : null;
      this.worldUIManager.setAssaultBanner(
        `【预警】敌军来袭倒计时 ${mm}:${ss}　目标：${label}${tier ? `　敌军攻势：${tier.label}` : ''}　请做好准备`, true,
      );
    };
    this.directorHooks.onAssault = (label) => {
      this.worldUIManager.setAssaultBanner(`敌军来袭！目标：${label}`, true);
      this.showFloatingAt(this.player.position.x, this.player.position.y + 2.4, this.player.position.z, '敌军来袭', 'crit');
    };
    this.directorHooks.onClear = () => {
      this.worldUIManager.setAssaultBanner(null);
    };
    this.spawner.refreshEnemyScale();
    this.swarmDirector.beginDay(ctx.session.meta.day, this.directorHooks);
    // ★ 当天敌人总数（2026-09-16）：换日先清零，再按当日威胁**预计算并冻结**；
    //   同日多次出击沿用已有进度（跨出击累计，quota 不重置、不重算）。
    //   → HUD 分母全天不变（用户定调："当天的敌人会预计算好会有多少人"）。
    if (ctx.session.dayProgress.everDeparted !== ctx.session.meta.day) {
      resetDayQuota(ctx.session);
      ctx.session.dayProgress.everDeparted = ctx.session.meta.day;
    }
    if (this.threat) ensureDayQuota(ctx.session, this.threat);
    // ★ 遗物局内周期补给（祖宗发射器等）：每间隔补 1，多件缩短间隔
    this.timedRelics = relicTimedFor(ctx.session, RELIC_ITEM_CONFIG)
      .map((g) => ({ itemId: g.itemId, interval: g.interval, timer: 0 }));
    // ★ 事件 / 对话（用户定调：事件属于基地与战斗；探索期刷 NPC + 舰内固定位）
    this.eventSystem = new EventSystem(ctx.session, 10007);
    this.dialogueView = new DialogueView(document.body);
    this.dialogue = new DialogueSystem({
      session: ctx.session,
      itemManager: this.itemManager,
      view: this.dialogueView,
      // ★ 对话给东西要上屏（访客/事件送物资、遗物 → 右上角"获得物品"播报）
      onGrant: (g) => this.onDialogueGrant(g),
      onEnd: (eventId) => {
        if (eventId) {
          this.eventSystem.complete(eventId);
          SaveSystem.save(ctx.session);
        }
        // ★ 小游戏请求（对话以 flag 点名要开哪局）：开了就直接返回 ——
        //   访客**暂不离舰**、玩家**保持锁定**，等结果对话播完再走下面的收尾。
        if (this.tryStartMiniGameFromFlags(ctx.session)) return;
        if (this.phase === 'explore') this.player.controlLocked = false;
        // 事件完成 → 消耗该 NPC；舰内则刷新固定位（once/冷却生效）
        if (this.pendingNpc) {
          this.pendingNpc.dispose();
          const i = this.npcs.indexOf(this.pendingNpc);
          if (i >= 0) this.npcs.splice(i, 1);
          this.pendingNpc = null;
        }
        // ★ 访客对话收尾：途中 → 继续赶路；舰内 → 道别离舰（移出名册 + 清到访提示）
        if (this.pendingVisitor) {
          const v = this.pendingVisitor;
          this.pendingVisitor = null;
          if (v.visitPhase === 'approaching') {
            v.setPaused(false);
          } else {
            this.visitorManager?.removeInsider(v);
            if ((this.visitorManager?.insiders.length ?? 0) === 0) {
              this.worldUIManager.clearVisitorNotice();
            }
          }
        }
        if (this.shipInterior) {
          // ★ 访客增减后重建交互站列表（功能站 + 交谈站一并重算）
          this.applyShipInteriorEvents(this.shipInterior);
        }
      },
    });
    // ★ 访客系统：每天 1~2 名访客向舰船行进（首次探索帧生成；位置取当前停靠点）
    this.curDay = ctx.day;
    this.visitorsSpawned = false;
    this.nearbyVisitor = null;
    this.pendingVisitor = null;
    this.visitorManager = new VisitorManager({
      session: ctx.session,
      entities: this.entities,
      scene: this.scene,
      getShipPosition: () => this.ship?.position ?? null,
      getCameraFrame: () => this.cameraCtrl.getFrame(),
      onArrive: (v) => {
        // 进舰（房间）提示：金色横幅 + 现场飘字
        this.worldUIManager.showVisitorNotice('神秘访客已到访，快回舰船内看看吧！');
        this.showFloatingAt(v.position.x, v.position.y + 2.6, v.position.z, '已登舰', 'heal');
      },
      onFlee: (v) => {
        this.showFloatingAt(v.position.x, v.position.y + 2.2, v.position.z, '访客被吓跑了', 'miss');
      },
    });
    // ★ 弹药栏切换：点击/按键切换当前弹药（攻击键发射）
    this.worldUIManager.setAmmoSelector((id) => { this.selectedQuickItem = id; });
    // ★ 航行期：停靠按钮（F 键同义）+ 隐藏战斗 HUD（停靠后才绘制）
    this.worldUIManager.setDockButton(() => this.requestDock(false));
    this.worldUIManager.setDockButtonVisible(true);
    this.worldUIManager.setCombatHudVisible(false);
    // ★ boss4D 玩家专属：真实落地模式（每次跳跃必须踩实地面，禁止悬空穿/悬浮连跳）
    this.player.controller.requireRealLanding = this.chunks.isBoss4D;

    // ---- 子弹池 ----
    this.bullets = new BulletManager(
      this.entities, this.scene,
      ctx.bulletAsset ?? createSolidBulletAsset(), 10, // ★ 池 100 → 10（用户定调：10 颗足够；同时省 90 个记录/刚体）
      this.renderer,
      ctx.hitEffectAsset?.hitEffects ?? [],
      // ★ 命中解析层入口：每次碰撞开始，所有命中（敌人 / 装饰物 / 地块）都进这里分类结算
      (payload) => this.combatSystem.resolveBulletHit(payload),
    );
    // ★ 敌方弹道池（程序化箭矢；细长弹体 → baseWidth 给小数，否则 4 倍长的方片）
    this.enemyBullets = new BulletManager(
      this.entities, this.scene,
      createArrowAsset(), 8,
      this.renderer,
      ctx.hitEffectAsset?.hitEffects ?? [],
      (payload) => this.combatSystem.resolveBulletHit(payload),
      { baseWidth: ARROW_BASE_WIDTH },
    );
    // ★ 敌方法球池（术士；正方形纹理 → 世界尺寸 = baseWidth 见方）
    this.enemyBolts = new BulletManager(
      this.entities, this.scene,
      createFireballAsset(), 6,
      this.renderer,
      ctx.hitEffectAsset?.hitEffects ?? [],
      (payload) => this.combatSystem.resolveBulletHit(payload),
      { baseWidth: FIREBALL_BASE_WIDTH },
    );
    // ★ 命中解析层（P5）：子弹命中/代理命中的唯一结算入口（掉落/友军/水面由本类注入）
    this.combatSystem = new CombatSystem({
      physics: this.physics,
      swarm: this.swarm,
      bullets: this.bullets,
      chunks: this.chunks,
      spawnSentinelAt: (x, z) => this.spawnSentinelAt(x, z),
      spawnItemDrops: (impact) => this.spawnItemDrops(impact),
      agitateWaterNear: (x, z) => this.waterFx.agitateNear(x, z),
      showAgentDamage: (x, y, z, dmg) => this.showFloatingAt(x, y, z, String(dmg), 'normal'),
    });
    // ★ 路由：敌方弹按 `bulletSkin` 选池（箭 / 法球）；其余（玩家/友军）→ 玩家池
    this.aiCtx.attack = (opts) => {
      if (opts.type === 'projectile' && opts.camp === 'enemy') {
        executeAttack(
          this.entities,
          opts.bulletSkin === 'fireball' ? this.enemyBolts : this.enemyBullets,
          opts,
        );
        return;
      }
      executeAttack(this.entities, this.bullets, opts);
    };
    // ★ 敌人索敌优先级队列：祖宗（吸仇恨）＞ 玩家 ＞ 一般友军（无人机）
    this.aiCtx.targetCandidates = (e) => this.enemyTargetCandidates(e);

    // ---- ★ 战斗道具播放：装备贴片（挂主角 mesh） ----
    this.combatItems = new CombatItemController(
      ctx.session,
      this.scene,
      this.player.rendererMesh
        ?? (() => { const o = new THREE.Object3D(); this.scene!.add(o); return o; })(),
      () => this.player.facing,
    );
    this.combatItems.syncLoadout();

    // ★ 友军播放注册表：可露希尔的无人机 → 空中的 DroneEntity（跟随/攻击/损毁回收）
    allyPlaybackRegistry.set(DRONE_ITEM, {
      kind: 'drone',
      spawn: ({ itemId, slotIndex, spawnDroneNearPlayer }) => spawnDroneNearPlayer(slotIndex, itemId),
    });

    // ---- ★ 无人机素材（特效包优先；道具召唤用） ----
    this.droneAsset = ctx.droneAsset ?? null;
    // ★ 祖宗素材（缺省回退无人机素材 → 美术到位前管线可跑）
    this.sentinelAsset = ctx.sentinelAsset ?? null;
    // ★ 友军部署推迟到停靠（航行操船期不绘制友军；停靠/出舱时 syncSlotAllies 全量同步）

    // ---- ★ 调试：F9 回读最终绘制颜色（游标指向像素 + 中心网格；诊断警示贴画偏色用） ----
    const onF9 = (e: KeyboardEvent) => {
      if (e.key !== 'F9' || !this.renderer || !this.renderer.domElement) return;
      // ★ 不在 keydown 里直接 readPixels——three 默认缓冲已 swap，会读到全 0；
      //   置位后由本帧 render() 末尾在 render 紧后同步读。
      this._pendingReadback = true;
    };
    window.addEventListener('keydown', onF9);
    this._f9Handler = onF9;

    // ---- ★ 订阅伤害事件，显示浮动数字 ----
    //   ★ 2026-09-11：改静态 import 同步注册——原先动态 import().then 存在竞态：
    //   enter() 后立刻 exit() 时 promise resolve 晚于 exit → 订阅悬空、跨局累积
    this.damageUnsub = eventBus.on('damage', (payload) => {
      const target = payload.target;
      const pos = target.position;
      // ★ 遗物伤害时机管线：玩家受伤 / 造成伤害（与显示 LOD 无关，先派发再显示）
      if (this.session) {
        const kind = target.entity.kind;
        // ★ 舰船受击不算"造成/受到伤害"遗物时机（伤害由 ShipState 结算）
        if (kind !== 'ship') {
          dispatchRelicEvent(this.session, RELIC_ITEM_CONFIG, kind === 'player' ? 'onDamageTaken' : 'onDamageDealt', {
            damage: payload.damage, crit: payload.crit, blocked: payload.blocked, dodged: payload.dodged,
          });
        }
      }
      // ★ 伤害显示 LOD：距相机 >20m 不显示（近战/远射数字只在眼前出现，不刷屏）
      //   ★ 例外：主角自己的攻击（子弹多为远距离命中）不受此限，保证打击反馈
      if (payload.source?.camp !== 'player') {
        const camP = this.camera!.position;
        const dx = pos.x - camP.x, dz = pos.z - camP.z;
        if (dx * dx + dz * dz > 20 * 20) return;
      }
      // 将世界坐标投影到屏幕
      const vec = new THREE.Vector3(pos.x, pos.y + 1.0, pos.z);
      vec.project(this.camera!);
      const x = (vec.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-vec.y * 0.5 + 0.5) * window.innerHeight;
      // 只显示实际造成的伤害（大于0），并且没有被闪避/格挡免疫
      if (payload.damage > 0) {
        const type = payload.crit ? 'crit' : 'normal';
        this.worldUIManager.showFloatingText(x, y - 30, String(payload.damage), type);
      } else if (payload.dodged) {
        this.worldUIManager.showFloatingText(x, y - 30, 'Miss', 'miss');
      } else if (payload.blocked) {
        this.worldUIManager.showFloatingText(x, y - 30, 'Blocked', 'normal');
      }
    });
    // ★ 击杀结算：无人机与杂兵分流（无人机损毁 = 清空槽位 + 从编队移除）
    this.killedUnsub = eventBus.on('killed', (payload) => {
      // ★ 玩家死亡：累计永久死亡次数（遗物"每次死亡全属性 +5%"的驱动）
      if (payload.target === this.player) {
        const s = this.session;
        if (!s) return;
        s.meta.deaths = (s.meta.deaths ?? 0) + 1;
        // ★ 遗物死亡时机管线
        dispatchRelicEvent(s, RELIC_ITEM_CONFIG, 'onPlayerDeath', {});
        // ★ 复活倒计时 + 属性标脏（管线收口：PlayerPipeline）
        this.playerPipeline.onPlayerDeath();
        return; // 玩家不算杂兵、不掉落
      }
      const drone = payload.target as AllyBase;
      if (allySystem.remove(drone)) {
        // ★ 无人机损毁 = 彻底没了（2026-09-13 用户定调：不再有残骸/维修）
        if (drone.slotIndex >= 0) this.itemManager?.clearSlot(drone.slotIndex);
        this.showFloatingAt(drone.position.x, drone.position.y, drone.position.z, '无人机损毁', 'crit');
        return; // 不参与杂兵掉落结算
      }
      const enemy = payload.target as EnemyBase;
      // ★ 击败普瑞赛斯 = 通关
      if (enemy === this.bossEntity) {
        this.bossEntity = null;
        this.spawner.onBossDefeated();
      }
      this.rollEnemyDrops(enemy);
      const idx = this.enemies.indexOf(enemy);
      if (idx !== -1) this.enemies.splice(idx, 1);
      // ★ 遗物击杀时机管线（脏标记：击杀类属性遗物统一在本帧重算）
      if (this.session) {
        dispatchRelicEvent(this.session, RELIC_ITEM_CONFIG, 'onKill', {});
        this.statsDirty = true;
      }
    });
    // ★ 真击杀统计（2026-09-16）：实体侧由 EnemyBase.onRetire('killed') 发出（退役原因收口）；
    //   代理侧在 swarmHooks.onAgentKilled 里直接记数（两条路径互斥，不会双计）。
    this.enemyKilledUnsub = eventBus.on('enemy_killed', () => {
      recordKill(this.session);
    });
    // ★ 无人机召唤：使用「可露希尔的无人机」道具 → 近玩家位置放出（不入槽位）
    this.droneSummonUnsub = eventBus.on('drone_summon', () => {
      this.spawnDroneNearPlayer();
    });
    // ★ 舰船受击（damageShip 统一发）：明显 UI 报警 + 舰船头顶飘伤害数字
    this.shipDamagedUnsub = eventBus.on('ship_damaged', (payload) => {
      this.worldUIManager?.triggerShipAlert(payload.damage, payload.destroyed);
      const sp = this.ship?.position;
      if (sp) this.showFloatingAt(sp.x, sp.y + 3.2, sp.z, `-${payload.damage}`, 'crit');
    });
    // ★ 祖宗放置：使用「祖宗」→ 从枪口沿准星发射祖宗弹，命中/落地生成站桩友军
    this.sentinelSummonUnsub = eventBus.on('sentinel_summon', () => {
      this.launchSentinelProjectile();
    });
    // ★ 城墙/墙部署：使用「城墙 / 墙」→ 沿准星发射投送弹，落点生成
    this.coverSummonUnsub = eventBus.on('cover_summon', (payload) => {
      this.launchCoverProjectile(payload.variant === 'wall' ? 'wall' : 'cover');
    });
    // ★ 出击槽池变动（装备/友军增删换）：2026-09-14 修复"舰内换装不刷新"
    this.deploymentUnsub = eventBus.on('deployment_changed', () => {
      // ① 装备属性重算（穿脱/互换立即生效）
      this.refreshPlayerStats();
      // ② 舰内空间（E 进舱）用独立 BaseScene：换装立刻作用于舱内角色
      //    （贴片/跟随无人机/载具；出舱后世界侧再由 ③ 补齐）
      this.shipInterior?.refreshDeployment();
      // ③ 世界侧：探索期当场增删友军 + 立即重挂角色贴片（不等 0.5s 节拍）；
      //    航行/舰内期间不生成实体（出舱/停靠时 syncSlotAllies 统一同步）
      if (this.phase === 'explore') {
        this.syncSlotAllies();
        this.combatItems?.syncLoadout();
      }
    });
    // ★ 存档基础属性被永久改写（「训练类」消耗品，如古米的蜂蜜糖/霜星的辣味糖）：
    //   session.player 的 maxHp/attackPower/defense 是 EffectSystem 的 base 层，
    //   改了之后必须重算，否则本次出击内看不到提升（下次出击才会自然生效）。
    this.playerStatsUnsub = eventBus.on('player_stats_changed', () => {
      this.refreshPlayerStats();
    });
    // ★ 世界状态缓存：恢复墙 / 召唤友军（出击槽友军由 syncSlotAllies 自然重建）
    if (this.pendingWorldState) {
      this.restoreWorldState(this.pendingWorldState);
      this.pendingWorldState = null;
    }
    // ★ 刷新页面也保住世界状态（exit 不一定被调用）
    this.worldStateUnload = () => this.saveWorldStateNow();
    window.addEventListener('beforeunload', this.worldStateUnload);
  }

  /** 每帧驱动（自包含：输入 → 物理 → 相机 → 实体 → AI） */
  update(dt: number): void {
    if (!this.binding || !this.physics || !this.scene || !this.camera || !this.renderer) return;

    const _t0 = performance.now();
    this.binding.update();
    const input = this.binding.input;
    const attackPressed = this.binding.consumeAttack();
    const look = this.binding.consumeLook();
    let zoom = this.binding.consumeZoom();
    // ★ 大地图打开：鼠标用于拖拽/缩放 → 丢弃视角与缩放输入（防镜头跟着转/拉）
    if (this.worldUIManager.isMapPanelOpen) {
      look.x = 0;
      look.y = 0;
      zoom = 0;
    }
    // ★ 舰内房间：世界输入全部不消费（房间自己的键盘监听驱动行走）
    const inInterior = this.phase === 'interior';
    // ★ 对话中：世界输入全部不消费（指针解锁、角色站定；按键由对话视图处理）
    const talking = this.dialogue?.isActive ?? false;
    const uiLocked = inInterior || talking;

    // ★ 按 I 键打开/关闭背包（舰内同样可用）；M 打开/关闭世界地图（读持久小地图表）
    if (!talking && this.binding.consumeInventory()) {
      this.worldUIManager.toggleInventory();
    }
    if (!uiLocked && this.binding.consumeMap()) {
      this.worldUIManager.toggleMapPanel();
    }
    // ★ Q 切换快捷弹药（战斗中鼠标隐藏 → 键盘操作）
    //   ★ Q 按住 + 滚轮 = 直接前后切换弹药（不缩放视角）；点按 Q 仍顺序切换
    if (!uiLocked && this.binding.isSwitchItemHeld() && zoom !== 0) {
      this.cycleQuickItem(zoom > 0 ? 1 : -1);
      zoom = 0; // 滚轮已用于切换 → 本帧不缩放
    }
    if (!uiLocked && this.binding.consumeSwitchItem()) this.cycleQuickItem();
    // ★ F：航行期 = 停靠；探索期的消耗品请在背包（I）内点击使用
    if (!uiLocked && this.binding.consumeUseItem() && this.phase === 'sail') {
      this.requestDock(false);
    }

    // ★ 探索期事件 NPC / 途中访客：就近判定（E 对话优先于 E 进舰）
    this.nearbyNpc = null;
    this.nearbyVisitor = null;
    if (this.phase === 'explore' && !inInterior && !talking && !this.player.dead
      && !this.worldUIManager.hasModalOpen) {
      const p0 = this.player.position;
      let bestD = Infinity;
      for (const npc of this.npcs) {
        const d2 = (npc.position.x - p0.x) ** 2 + (npc.position.z - p0.z) ** 2;
        if (d2 <= npc.interactRadius * npc.interactRadius && d2 < bestD) {
          bestD = d2;
          this.nearbyNpc = npc;
        }
      }
      // ★ 访客（途中可对话；优先级低于事件 NPC）
      this.nearbyVisitor = this.visitorManager?.nearestTalkable(p0.x, p0.z) ?? null;
    }
    // ★ 采集物：接触即自动入包（2026-09-14 用户定调；0.1s 节拍省查询，JS 查 propRegistry）
    this.autoPickToastCd = Math.max(0, this.autoPickToastCd - dt);
    if (this.phase === 'explore' && !inInterior && !talking && !this.player.dead
      && !this.worldUIManager.hasModalOpen) {
      this.autoPickAccum += dt;
      if (this.autoPickAccum >= 0.1) {
        this.autoPickAccum = 0;
        const pp0 = this.player.position;
        const c = this.chunks.queryCollectibleNear(pp0.x, pp0.z, WorldMode.COLLECT_TOUCH_RADIUS);
        if (c) this.harvestCollectible(c, true);
      }
    }
    // ★ 按 E：就近 NPC / 途中访客对话 / 进舰内（仅降落后；飞行中不进）
    if (!uiLocked && input.held.interact && this.phase === 'explore' && !this.player.dead) {
      if (this.nearbyNpc) this.startNpcDialogue(this.nearbyNpc);
      else if (this.nearbyVisitor) this.startVisitorDialogue(this.nearbyVisitor);
      else this.enterShipInterior();
    }
    // ★ 交互提示（对话中隐藏；NPC/访客优先于舰船）
    {
      const s0 = this.ship?.position;
      const p0 = this.player.position;
      const nearShip = !this.worldUIManager.hasModalOpen && !!s0
        && this.phase === 'explore' && !this.player.dead
        && (p0.x - s0.x) ** 2 + (p0.z - s0.z) ** 2 <= WorldMode.REBOARD_RADIUS ** 2;
      if (talking) this.worldUIManager.setBoardPrompt(false);
      else if (this.nearbyNpc) this.worldUIManager.setBoardPrompt(true, `E · 与${this.nearbyNpc.displayName}交谈`);
      else if (this.nearbyVisitor) this.worldUIManager.setBoardPrompt(true, `E · 与${this.nearbyVisitor.displayName}交谈`);
      else this.worldUIManager.setBoardPrompt(nearShip);
    }

    // ★ 指针锁定唯一事实来源 = 是否有非战斗 UI 打开：
    //   任一面板/对话打开 → 解锁；全部关闭（回到战场）→ 恢复锁定。
    //   setPointerLock 内含冷却重试，且只在状态变化时真正请求/释放。
    this.binding.setPointerLock(!this.worldUIManager.hasModalOpen && !talking && this.phase !== 'interior');

    // ★ 舰内房间（2026-09-13）：世界冻结，只驱动房间场景（行走；操作走按钮条）
    if (this.phase === 'interior') {
      this.shipInterior?.update(dt);
      return;
    }

    // ★ 舰船已毁：冻结玩法更新（结算/复活面板接管；相机/输入不再跑）
    if (this.shipDestroyed) return;

    // ★ 访客：当天首次探索 → 生成 1~2 名（航行飞越/舰内不刷；落点取当前停靠点）
    if (this.phase === 'explore' && !this.visitorsSpawned) {
      this.visitorsSpawned = true;
      this.visitorManager?.beginDay(this.curDay);
    }

    // ★ 事件 NPC：走远回收（防无限世界累积；对话中的 NPC 不回收）
    if (this.npcs.length > 0) {
      const p0 = this.player.position;
      for (let i = this.npcs.length - 1; i >= 0; i--) {
        const npc = this.npcs[i];
        if (npc === this.pendingNpc) continue;
        const d2 = (npc.position.x - p0.x) ** 2 + (npc.position.z - p0.z) ** 2;
        if (d2 > 140 * 140) {
          npc.dispose();
          this.npcs.splice(i, 1);
        }
      }
    }

    // ★ 航行驾驶（飞行手感）：本帧鼠标增量交给舰船姿态，实体管线前先转向/俯仰/油门
    //   降落进近期：低操控权限（25%）+ 自动收油/下降（landingStep 驱动）
    if (this.phase === 'sail') {
      if (this.landing?.phase === 'approach') {
        this.landingTouchdown = this.ship.landingStep(dt, look.x, look.y, input.moveAxis.x);
      } else if (!this.landing && !this.takeoff) {
        this.ship.steer(look.x, look.y, input.moveAxis.x, input.moveAxis.y, dt);
      }
      // settle / 起飞段：位置由状态机驱动，输入不作用于舰船
    }

    // ★ 航行期：地形流式以舰船为焦点（优先算/建机头下方与前向）；探索期=角色
    const sailing = this.phase === 'sail';
    const shipPos = this.ship?.position;
    const shipFwd = this.ship?.forward;
    const pp = sailing && shipPos
      ? { x: shipPos.x, y: shipPos.z }
      : this.player.controllerPosition;
    const faceFw = sailing && shipFwd
      ? { x: shipFwd.x, z: shipFwd.z }
      : this.cameraCtrl.getFrame().forward;
    this.chunks.update(pp.x, pp.y, dt, faceFw.x, faceFw.z);
    const _t1 = performance.now();

    // ★ 小地图更新
    this.worldUIManager.update(dt, {
      playerPosition: { x: pp.x, z: pp.y },
      // ★ 航行期：小地图朝向取机头前方（追尾相机不再由 cameraCtrl 驱动）
      cameraYaw: this.phase === 'sail' && this.ship
        ? (() => { const f = this.ship.forward; return Math.atan2(f.x, f.z); })()
        : this.cameraCtrl.worldYaw,
      entities: this.entities.allBases(),
      // ★ 远层代理（35m 外敌人）：小地图/大地图与实体同口径播报（≤90m）
      swarm: this.swarm.pool,
      playerStats: { hp: this.player.hp, maxHp: queryFinalStats(this.player).maxHp },
      // ★ 舰船世界坐标（场景方位提示：角色离舰船很远时显示方向 + 距离）
      shipPosition: this.ship?.position ?? null,
      ammoEntries: this.buildAmmoEntries(),
      allies: this.drones
        .filter((d) => !(d instanceof GroundStationaryAlly && d.dormant)) // ★ 休眠站桩友军不入队友列表（接触唤醒后自动出现）
        .map((d) => ({
          id: `a${d.entity.id}`,
          itemId: d.itemId,
          hp: d.hp,
          maxHp: d.maxHp,
          slot: d.slotIndex,
        }))
        // ★ 列表顺序始终跟随出击槽位号（顶→下递增；道具召唤不入槽的沉底），
        //   槽位交换/移动后新实体生成顺序 ≠ 槽位顺序 → 在此重排，确保序号自上而下递增
        .sort((p, q) => {
          const sp = p.slot ?? -1, sq = q.slot ?? -1;
          if (sp < 0) return sq < 0 ? 0 : 1;
          if (sq < 0) return -1;
          return sp - sq;
        }),
    });
    const _t2 = performance.now();

    // ---- ★ 遗物周期补给（祖宗发射器）：进入战场后每 interval 秒补 1（背包满则保持就绪重试） ----
    for (const t of this.timedRelics) {
      t.timer += dt;
      if (t.timer < t.interval) continue;
      if (this.itemManager?.addItem('player', t.itemId, 1)) {
        t.timer -= t.interval;
        // ★ 走右上角"获得物品"播报渠道（不再头顶浮字）
        this.worldUIManager?.showPickupResult(t.itemId, true, 1);
        this.worldUIManager?.flashItemAndRefresh(t.itemId);
      } else {
        t.timer = t.interval; // 背包满：保持就绪，下一帧重试
      }
    }

    // ★ 战斗道具播放：装备贴片帧动画驱动（带相机 → 影子 LOD/昼夜浓度）
    this.combatItems.update(dt, this.camera ?? undefined);
    // ★ 载具贴片跟随（圆凳；装备时贴在主角脚下，独立 billboard）
    this.player.vehicleRide.update(dt, this.camera ?? undefined);
    // ★ 出击槽池同步（背包拖入/使用装备后，贴片及时刷新；内部 diff，未变则零开销）
    this.syncLoadoutAccum += dt;
    if (this.syncLoadoutAccum >= 0.5) {
      this.syncLoadoutAccum = 0;
      this.combatItems.syncLoadout();
    }
    const _t3 = performance.now();

    // AI 上下文
    this.aiCtx.dt = dt;
    this.aiCtx.time += dt;
    this.aiCtx.findTarget = () => ({ x: pp.x, z: pp.y });
    this.aiCtx.focusX = pp.x;
    this.aiCtx.focusZ = pp.y;
    // ★ 焦点瞄准高度 = 玩家受击锚点（贴片 65% 胸口）——远程弹道纵向瞄准用
    //   （focusX/Z 只是无高度的平面坐标；固定 +1.0 对高个目标会偏低）
    this.aiCtx.focusY = this.player.hitAnchorY();

    // ---- AI / 波次：仅探索阶段（航行期不刷怪、不打船） ----
    if (this.phase === 'explore') {
      aiSystem.updateAll(dt, this.aiCtx);
      // ---- ★ 蜂群（《蜂群架构.md》P1）：远层代理升/降格 + 降频决策/移动 ----
      const camF = this.cameraCtrl.getFrame().forward;
      const hooks = this.swarmHooks;
      hooks.playerX = pp.x; hooks.playerZ = pp.y;
      hooks.shipX = this.ship.position.x; hooks.shipZ = this.ship.position.z;
      hooks.camForwardX = camF.x; hooks.camForwardZ = camF.z;
      hooks.entityCount = this.enemies.length;
      this.swarm.update(dt, hooks);
      entityPerf.swarmEntities = this.enemies.length;
      // ---- ★ P2：玩家/友军子弹命中代理（线段 vs 人群网格；命中即结算） ----
      this.combatSystem.updateAgentHits(dt);
      // ---- ★ P4：导演调度波次（节奏 + 预算 + intent 分工） ----
      const order = this.swarmDirector.update({
        dt,
        alive: this.enemies.length + this.swarm.count,
        playerHpRatio: this.player.hp / Math.max(1, this.player.maxHp),
        playerX: pp.x, playerZ: pp.y,
        shipX: this.ship.position.x, shipZ: this.ship.position.z,
        // ★ 当天配额剩余（2026-09-16）：环境补怪据此持续补刷到打满总数。
        //   分母 quota 冻结 → "打满"由刷怪负责，UI 不做任何补偿。
        quotaLeft: remainingQuota(this.session),
      }, this.directorHooks);
      if (order) this.spawner.spawnDirectorWave(order);
      // ---- ★ 扫描式波次：周围 ±2 已加载但未刷过的 chunk 逐帧补怪（生成速度加倍） ----
      this.spawner.scanAndSpawnWaves(pp.x, pp.y, 4);
      // ---- ★ 远距实体降格（0.25s 一拍）：实体超出 DEMOTE_RADIUS → 回代理池，
      //   代理的远距回收由 SwarmSystem 统一处理。节拍与实现都在 WorldSpawner ----
      this.spawner.tickDemote(dt, pp.x, pp.y);
      // ---- ★ 当日配额耗尽 → 一次性提示（否则"野外一只敌人都没有"看着就是 bug） ----
      this.spawner.notifyQuotaExhausted(dt);
    }
    // ---- ★ 舰船遇围警示（无条件下方执行）：只要舰船活着就一直盯着，
    //   跟"大规模进攻"节奏无关（详见 updateShipGroupWarning）----
    this.spawner.updateShipGroupWarning(dt);
    const _t4 = performance.now();

    // --------------------------------------------------
    // ★ 无人机编队 AI：按编队槽位 3D 分布跟随（左右交替/高度错层/前后错落，
    //   远离准星正前方），各自 updateAI（跟随→锁定最近敌人→贴脸攻击→返回重锁）
    //   先于实体管线，保证本帧 syncRender 使用新位置。
    const _e0 = performance.now();
    if (this.drones.length > 0) {
      // ★ 祖宗共享流体：每帧只步进一次（有存活祖宗时），且 30Hz 节流省 GPU
      //   与图标动画器共用同一实例 → stepFluidShared 去重，全局每帧仅一次求解
      if (this.sentinelFluid && this.drones.some((d) => d.stationary && d.hp > 0)) {
        this.sentinelFluidAccum += dt;
        if (this.sentinelFluidAccum >= 1 / 30) {
          stepFluidShared(this.sentinelFluid, this.sentinelFluidAccum);
          this.sentinelFluidAccum = 0;
        }
      }
      const dp = this.player.position;
      // ★ 统一更新入口（AllySystem：喂编队槽位偏移 + playerPos → updateAI）
      allySystem.update(dt, {
        frame: this.cameraCtrl.getFrame(),
        camera: this.camera,
        playerX: dp.x,
        playerY: dp.y,
        playerZ: dp.z,
      });
      // ★ 留存站桩友军唤醒：玩家回到原地接触 → 启用（重新索敌/攻击/挖矿）并加入队友列表
      allySystem.wakeStationaryNear(dp.x, dp.z, SENTINEL_WAKE_R);
      // ★ 友军回血（黍姐的XX）：装备汇总的每秒回复量 → 所有友军（无人机/祖宗）
      if (this.allyRegen > 0) {
        for (const d of allySystem.allies) {
          if (d.hp > 0) applyHeal(d, this.allyRegen * dt);
        }
      }
    }

    // ---- 实体管线驱动 ----
    const _e1 = performance.now();
    if (this.phase === 'explore' && attackPressed && !this.player.dead) this.player.attack();
    if (this.phase === 'sail') {
      // ★ 航行期：实体管线全免（AI/物理/动画/渲染同步都不跑）——只推进舰船
      //   降落进近：位置/姿态由 landingStep 驱动（stepFlight 跳过）
      if (this.takeoff) {
        // ★ 起飞段：自动爬升到最低净空后交还驾驶
        if (this.ship.takeoffStep(dt)) this.takeoff = false;
      } else if (!this.landing) {
        this.ship.stepFlight(dt);
      }
      this.entities.onEntityMoved(this.ship);
      if (this.landing?.phase === 'approach') {
        // ★ 触地 → 转落稳段（镜头仍追舰船；完整看到接地）；无超时瞬移接地
        //   只在这一帧成立（beginSettle 立刻把 phase 切成 settle）→ 着陆音不会连播
        if (this.landingTouchdown) {
          this.beginSettle();
          playSfx('shipLand', 600);
        }
      } else if (this.landing?.phase === 'settle') {
        this.updateSettle(dt);
      } else if (!this.landing) {
        // 耗油/停靠推进；角色位置随舰船（小地图/相机跟随）
        this.updateSail(dt);
        const sp = this.ship.position;
        this.player.position.x = sp.x;
        this.player.position.z = sp.z;
        this.player.position.y = sp.y;
      }
    } else {
      // ★ P3 相位：Simulate（玩法）→ Present（表现）显式两相（行为与旧 update 等价）
      this.entities.simulate(dt, input, this.cameraCtrl.getFrame());
      this.entities.present(dt);
    }
    // ★ 玩家专属每帧管线：效果队列 → 属性脏刷新（基础+遗物+装备一次聚合）→ 复活倒计时
    this.playerPipeline.update(dt);
    const _e2 = performance.now();

    // ---- ★ 角色入水 → 水面剧烈波动（只加波动表现，不动角色位置/手感；航行期角色在船上） ----
    if (this.phase === 'explore') this.waterFx.entry(this.player, dt, true);
    // ★ 涉水循环轨：每帧统一裁决（非探索阶段自动淡出，防航行/舰内残留水声）
    this.waterFx.wade(dt, this.phase === 'explore', this.player);
    // ★ 投送落点预览（祖宗/城墙/墙）
    this.updateDeployPreview();
    // ★ 城墙光环：范围内墙体持续修复 + 上限（跟随玩家生命）+ 防御
    if (this.phase === 'explore') updateWallAuras(queryFinalStats(this.player).maxHp, dt);
    // ★ 周期自动保存（8s 一拍；世界状态缓存：坑洞/地形记录/探索/标记/墙/友军）
    if (this.phase === 'explore') {
      this.worldSaveAccum += dt;
      if (this.worldSaveAccum >= 8) {
        this.worldSaveAccum = 0;
        this.saveWorldStateNow();
      }
    }
    // ★ 环境音效：脚步 / 拨草（入水·涉水音在 WaterFx 内，只对玩家那次生效）
    if (this.phase === 'explore') this.updateAmbientSfx(dt);
    for (const e of this.enemies) this.waterFx.entry(e, dt, false);
    const _e3 = performance.now();

    // ---- 角色地形跟随（航行期角色位置由舰船同步） ----
    if (this.phase === 'explore') this.charClamp.update(this.player, dt);
    for (const e of this.enemies) this.charClamp.update(e, dt);
    const _t5 = performance.now();
    worldPerf.drones = _e1 - _e0;
    worldPerf.ent = _e2 - _e1;
    worldPerf.water = _e3 - _e2;
    worldPerf.clamp = _t5 - _e3;
    worldPerf.nEnemies = this.enemies.length;
    worldPerf.nDrones = this.drones.length;
    worldPerf.nAgents = this.swarm.count;
    // ★ 口径区分（2026-09-12）：活体实体（角色/道具/子弹）vs 全部物理记录
    //   （后者含 每 chunk 地面 trimesh + 每装饰物 cuboid ——"刚进图 105"即此类）
    worldPerf.nBases = this.entities.baseCount;
    worldPerf.nEntities = this.entities.count;
    const kc = this.entities.kindCounts();
    worldPerf.nGround = kc.ground;
    worldPerf.nDecor = kc.decoration;

    // ---- ★ 测试地图：玩家钳在出生 chunk 内（世界只有这一块，无邻可走） ----
    if (this.testChunk && this.phase === 'explore') {
      const wp = this.player.position;
      wp.x = Math.min(CHUNK_SIZE - 1, Math.max(1, wp.x));
      wp.z = Math.min(CHUNK_SIZE - 1, Math.max(1, wp.z));
    }

    // ---- 相机 ----
    if (this.camBlend) {
      // ★ 镜头调度接管（下机/上机过渡；期间两套相机控制器都不驱动 → 无漂移）
      this.updateCamBlend(dt);
    } else if (this.phase === 'sail') {
      if (this.camShot) {
        // ★ 观察机位接管：移动到定好的机位后保持不动（飞机独立降入画面）
        this.updateLandingShot(dt);
      } else {
        // ★ 飞行追尾相机：机后上方平滑跟随 + 看向机头前方（不随滚转翻转地平线）
        this.updateFlightCamera(dt);
        // ★ 降到起调高度 → 一次性取景切换到观察机位
        if (this.landing?.phase === 'approach') this.tryStartLandingShot();
      }
    } else {
      // ★ position.y 现在空中含真实跳高 → height = 贴地/起跳站立面（减回跳高），
      //   jump = 跳高偏移，二者语义与 CameraController 契约一致（不重复记账）。
      const jumpOff = this.player.jumpHeight;
      this.cameraCtrl.update(dt, look, zoom, {
        x: this.player.position.x, y: 0, z: this.player.position.z,
        height: this.player.position.y - jumpOff,
        jump: jumpOff,
      }, this.player.controller.isMoving);
    }
    // ★ 死亡等待复活 / 航行操船期间隐藏本体（复活/停靠后自动恢复）
    this.player.visible = !this.cameraCtrl.isFirstPerson && !this.player.dead && this.phase === 'explore';

    // ---- 玩家发射（★ 默认攻击走原路径：不消耗弹药；弹药出池留待后续弹药武器接入） ----
    //    ★ 基础间隔 0.9s（2026-09-10 用户定调）× 攻速修正（装备/遗物 attackSpeed 点数）
    this.bulletCooldown -= dt;
    if (this.phase === 'explore' && !this.player.dead && !talking
      && !this.worldUIManager.isMapPanelOpen // ★ 地图上拖拽/点击不触发开火
      && this.bulletCooldown <= 0 && (input.held.attack || attackPressed)) {
      this.bulletCooldown = PLAYER_ATTACK_INTERVAL * 100 / (100 + queryFinalStats(this.player).attackSpeed);
      this.firePlayerBullet();
    }

    // ---- ★ 舰船状态：HUD 节拍刷新 + 毁灭判定（真结局 → 结算/复活面板） ----
    //   2026-09-16：状态条换成顶部通栏（左 敌人数量 / 右 舰船生命红字纯数字）
    this.shipStatusAccum += dt;
    if (this.shipStatusAccum >= 0.1 && this.session) {
      this.shipStatusAccum = 0;
      const s = this.session.ship;
      const prog = queryKillProgress(this.session);
      this.worldUIManager.setShipStatus(s.hp, s.maxHp, prog.kills, prog.total);
    }
    if (this.session && !this.shipDestroyed && isShipDestroyed(this.session)) {
      this.shipDestroyed = true;
      // ★ 结算/复活等待期世界冻结（update 直接 return）→ 昼夜同步冻结，
      //   否则出现「敌人不动但时间照走」的割裂态（用户 2026-09-18 定调）
      renderManager.setClockPaused(true);
      this.worldUIManager.showShipDestroyedPanel(() => this.reviveShip());
    }

    // （生命回复已入 EffectSystem 队列：EntityBase.update 每帧统一结算）

    // ---- 子弹效果/死亡动画（航行期全免：只算地形） ----
    if (this.phase === 'explore') {
      this.bullets.update(dt, this.camera);
      this.enemyBullets.update(dt, this.camera);
      this.enemyBolts.update(dt, this.camera);
      // ★ 子弹扫掠采集物 → 顶部扭曲（2026-09-14）：角色子弹经过植被附近，
      //   触发 CPU 大摆（复用 propRegistry 索引、不另建检测体系）
      this.updatePlantGustSweep(dt);
      // ★ 祖宗弹推进（落地/寿命到 → 生成站桩祖宗）
      this.updateSentinelShots(dt);
      // ★ 治疗转伤害 proc（鱼生萌萌香/遥·幽隙栖萤）
      this.updateHealProc();
      CharacterFxManager.update(dt, this.camera);
    }

    // ---- 拾取发光粒子 ----
    for (let i = this.pickupGlows.length - 1; i >= 0; i--) {
      if (this.pickupGlows[i].update(dt)) {
        this.pickupGlows.splice(i, 1);
      }
    }
    const _t6 = performance.now();

    // ---- 物理固定步长（航行期无物理需求：舰船无刚体、无实体推进 → 全免） ----
    if (this.phase === 'explore') {
      this.acc += dt;
      const FIXED = 1 / 60;
      let steps = 0;
      while (this.acc >= FIXED && steps < 5) {
        this.physics.step();
        this.acc -= FIXED;
        steps++;
      }
      if (steps >= 5) this.acc = 0;
    }

    // ★ 性能细分落账（每帧覆写；main.ts HUD 读取）
    const _t7 = performance.now();
    worldPerf.chunks = _t1 - _t0;
    worldPerf.ui = _t2 - _t1;
    worldPerf.combat = _t3 - _t2;
    worldPerf.ai = _t4 - _t3;
    worldPerf.entity = _t5 - _t4;
    worldPerf.post = _t6 - _t5;
    worldPerf.phys = _t7 - _t6;
    worldPerf.total = _t7 - _t0;
    worldPerf.assembly = this.chunks.lastAssembleMs;
  }

  /** 渲染：实体管线 + 场景 */
  render(): void {
    if (!this.scene || !this.camera || !this.renderer) return;
    // ★ 防御：任何离屏 pass（流体/月亮/云/子弹特效）若遗留 FBO，主场景渲染会与
    //   采样纹理形成 Feedback loop（GL_INVALID_OPERATION）。渲染前强制回默认帧缓冲。
    this.renderer.setRenderTarget(null);
    // ★ 舰内：只渲染独立房间场景（世界粗块/地形/天空/雾全部不参与）
    if (this.phase === 'interior' && this.interiorScene) {
      // ★ 场景照旧直渲（材质色彩空间 / 立绘深度关系零改动），随后叠暗角
      this.renderer.render(this.interiorScene, this.camera); // 场景自带背景色
      this.interiorFx?.render(this.renderer);
      return;
    }
    // ★ 地形光照视锥裁剪：只喂视野锥内 chunk 的昼夜 uniform（视锥外冻结，进视野即刷新）
    const fw = this.cameraCtrl.getFrame().forward;
    this.chunks.markLightVisibility(this.camera.position.x, this.camera.position.z, fw.x, fw.z);
    // ★ 光照锚定玩家（update 后、渲染前，位置已是本帧最终值）
    if (this.player) renderManager.follow(this.player.position);
    this.entities.renderAll(this.camera);
    // ★ 蜂群代理批量渲染（实例矩阵同步；每帧一次，与实体渲染同帧）
    //   ★ 传相机 + 玩家焦点：视野半径内的代理同时实例化画头顶血条
    const playerP = this.player?.controllerPosition;
    this.swarm.syncRender(this.camera, playerP?.x ?? 0, playerP?.y ?? 0);
    this.bullets.syncHitEffects(this.camera);
    this.enemyBullets.syncHitEffects(this.camera);
    this.enemyBolts.syncHitEffects(this.camera);
    this.renderer.render(this.scene, this.camera);

    // ★ 调试：F9 置位后本帧末同步回读（渲染刚完成、缓冲未 swap，读数有效）
    if (this._pendingReadback) {
      this._pendingReadback = false;
      this.finalColorReadback();
    }
  }

  /** 退出模式：完整清理所有私有资源 */
  exit(): void {
    // ★ 世界状态缓存：退出前落盘（同种子下次进入不重建）
    this.saveWorldStateNow();
    if (this.worldStateUnload) {
      window.removeEventListener('beforeunload', this.worldStateUnload);
      this.worldStateUnload = null;
    }
    // ---- 小游戏（若正在跑：强制关闭，别把 DOM 面板留在基地界面上） ----
    closeMiniGame();
    // ---- 舰内房间（若在舱内退出：释放房间场景/交互站/加工台） ----
    this.craftingOverlay?.dispose();
    this.craftingOverlay = null;
    this.shipInterior?.dispose();
    this.shipInterior = null;
    this.interiorFx?.dispose();
    this.interiorFx = null;
    this.interiorScene = null;
    // ---- 事件 / 对话（对话视图销毁 + NPC 实体回收） ----
    this.dialogue?.close();
    this.dialogueView?.dispose();
    this.dialogueView = null;
    for (const npc of this.npcs) npc.dispose();
    this.npcs = [];
    this.nearbyNpc = null;
    this.autoPickAccum = 0;
    this.pendingNpc = null;
    // ---- 访客（世界侧 + 舰内名册实体全释放；跨局防残留） ----
    this.visitorManager?.dispose();
    this.visitorManager = null;
    this.nearbyVisitor = null;
    this.pendingVisitor = null;
    this.visitorsSpawned = false;
    // ---- 蜂群：代理池 + 批量渲染资源全释放 ----
    this.swarm.dispose();
    // ---- 取消伤害事件订阅 ----
    this.damageUnsub?.();
    this.damageUnsub = undefined;
    // ---- 取消 killed 事件订阅 ----
    this.killedUnsub?.();
    this.killedUnsub = undefined;
    // ---- 取消 enemy_killed 事件订阅（击杀统计） ----
    this.enemyKilledUnsub?.();
    this.enemyKilledUnsub = undefined;
    // ---- 取消无人机召唤事件订阅 + 销毁无人机 ----
    this.droneSummonUnsub?.();
    this.droneSummonUnsub = undefined;
    this.sentinelSummonUnsub?.();
    this.sentinelSummonUnsub = undefined;
    this.coverSummonUnsub?.();
    this.coverSummonUnsub = undefined;
    this.deploymentUnsub?.();
    this.deploymentUnsub = undefined;
    this.playerStatsUnsub?.();
    this.playerStatsUnsub = undefined;
    this.shipDamagedUnsub?.();
    this.shipDamagedUnsub = undefined;
    allySystem.setWorldPort(null);
    allySystem.disposeAll('mode_cleanup');
    for (const s of this.sentinelShots) s.proj.dispose();
    this.sentinelShots = [];
    this.playerCovers = [];
    this.sentinelTex?.dispose();
    this.sentinelTex = null;
    this.deployPreview?.dispose();
    this.deployPreview = null;
    this.droneAsset = null;
    // ---- 战斗导演退场（取消事件订阅） ----
    this.director?.dispose();

    // ---- 回写玩家血量到 Session（★ 上限不写装备临时值：避免下次出击把装备 maxHp 当基础值重复吃遗物乘算） ----
    if (this.session && this.player) {
      this.session.player.hp = Math.min(this.player.hp, this.session.player.maxHp);
    }

    // ---- 地图流式管理器（chunk 刚体移出物理世界 + 视觉销毁 + 烘焙缓存释放） ----
    this.chunks?.dispose();

    // ---- 实体清理 ----
    this.entities.clear();

    // ---- ★ 战斗道具播放清理 ----
    this.combatItems?.dispose();

    // ---- 准星 / UI / 子弹 ----
    this.worldUIManager?.dispose();
    this.bullets?.dispose();
    this.enemyBullets?.dispose();
    this.enemyBolts?.dispose();
    CharacterFxManager.dispose();

    // ---- 拾取发光粒子 ----
    for (const g of this.pickupGlows) g.dispose();
    this.pickupGlows = [];

    // ---- ★ 入水表现系统：跨局清理 + 涉水轨必停（否则水声会跟着你进基地） ----
    this.waterFx?.reset();
    this.waterFx?.stopWade();

    // ---- ★ 销毁私有输入绑定 ----
    this.binding?.dispose();
    this.binding = null;

    // ---- ★ 移除 F9 调试回读监听 ----
    if (this._f9Handler) {
      window.removeEventListener('keydown', this._f9Handler);
      this._f9Handler = null;
    }

    // ---- ★ 销毁私有物理世界 ----
    this.physics = null;

    // ---- 清空引用 ----
    this.enemies = [];
    this.session = null;
    this.onReturn = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
  }

  // ============================================================
  // 以下为内部方法，与重构前保持一致
  // ============================================================

  /**
   * ★ 调试：F9 回读最终绘制颜色（诊断沙土警示贴画偏色）。
   * 采样屏幕中心 5×5 网格 + 游标世界坐标射到屏幕的像素，
   * 打印 RGBA 与对应游标世界坐标（可配合 tileDefAt 对照)。
   */
  private finalColorReadback(): void {
    const r = this.renderer!;
    const gl = r.getContext();
    const canvas = r.domElement;
    const cw = canvas.width;
    const ch = canvas.height;
    const lines: string[] = ['[WorldMode] 最终颜色回读:'];

    // ★ 光照状态（判读亮度/是否夜间——夜间读数近黑无法判色相）
    const sun = renderManager.querySun();
    lines.push(`  光照 hour=${sun.hour.toFixed(1)} daylight=${sun.daylight.toFixed(3)} intensityScale=${sun.intensityScale.toFixed(3)} color=#${sun.color.toString(16).padStart(6,'0')}`);

    // 游标位置（射线方向投影到屏幕中心附近）
    let sx = Math.round(cw / 2), sy = Math.round(ch / 2);
    const aim = this.crosshairPoint();
    if (aim && this.camera) {
      const v = new THREE.Vector3(aim.x, aim.y, aim.z).project(this.camera);
      sx = Math.round((v.x * 0.5 + 0.5) * cw);
      sy = Math.round((-v.y * 0.5 + 0.5) * ch);
    }

    // 游标指向的地块信息（判定位块/材质，对照 RGBA 定位偏色源）
    let tileInfo = '?';
    if (aim && this.raster) {
      const td = this.raster.tileDefAt(aim.x, aim.z);
      const look = resolveTileLook(td);
      tileInfo = `id=${td.id} key=${td.key} mat=${td.visual.material?.fnId ?? 'none'} baseHsl=${look.baseHsl.h.toFixed(3)},${look.baseHsl.s.toFixed(3)},${look.baseHsl.l.toFixed(3)}`;
    }

    // 游标 1×1 精确像素
    const one = new Uint8Array(4);
    gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
    lines.push(`  aim@(${aim ? aim.x.toFixed(1) + ',' + aim.z.toFixed(1) : '?'}) ${tileInfo}`);
    lines.push(`  aim 像素(${sx},${sy}): rgba(${one[0]},${one[1]},${one[2]},${one[3]})`);

    // 中心 5×5 网格
    const N = 2;
    const grid = new Uint8Array((2 * N + 1) * (2 * N + 1) * 4);
    gl.readPixels(cw / 2 - N, ch / 2 - N, 2 * N + 1, 2 * N + 1, gl.RGBA, gl.UNSIGNED_BYTE, grid);
    lines.push('  中心 5×5 (行从底部起):');
    for (let row = 2 * N; row >= 0; row--) {
      const cols: string[] = [];
      for (let c = 0; c <= 2 * N; c++) {
        const i = (row * (2 * N + 1) + c) * 4;
        cols.push(`${grid[i]},${grid[i + 1]},${grid[i + 2]}`);
      }
      lines.push(`    [${cols.join(' | ')}]`);
    }
    console.log(lines.join('\n'));
  }

  private cameraRay(): { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } } {
    this.camera!.updateMatrixWorld();
    const rayDir = new THREE.Vector3();
    this.camera!.getWorldDirection(rayDir);
    const cam = this.camera!.position;
    return {
      origin: { x: cam.x, y: cam.y, z: cam.z },
      dir: { x: rayDir.x, y: rayDir.y, z: rayDir.z },
    };
  }

  /** ★ 经典 TPS 准星落点（弹道收敛点）：
   *  相机沿准星发线 → ① 蜂群代理优先（无物理体；3D 圆柱近似，比地形近才锁）
   *  ② 敌人实体 / 地形静态物兜底（phys 射线，越过自家舰船/友军/飞行弹体）
   *  ③ 全无命中（对天/虚空）→ 相机射线上 CROSSHAIR_CONVERGE_DIST 处虚拟落点。
   *  子弹方向 = 枪口 → 本落点 ⇒ 无论哪种情况，弹道都经过准星所指处。 */
  private crosshairPoint(): { x: number; y: number; z: number } {
    const ray = this.cameraRay();
    const hit = aimRaycast(this.entities, {
      origin: ray.origin, dir: ray.dir, maxDist: CROSSHAIR_CONVERGE_DIST,
      exclude: this.player,
      filter: (e) => e.camp === 'enemy',
      // ★ 城墙/墙不影响射击判定线（2026-09-19）：准星射线跳过墙（含遮挡校验），
      //   与"我方近墙射击无视墙"同一口径；子弹物理仍按实心处理（敌弹照常被挡）
      skipPhysics: (e) => e.camp === 'player' || e.camp === 'ally' || e instanceof CoverEntity,
    });
    // ★ 蜂群代理（主力杂兵）：3D 圆柱近似锁准星——比地形/实体落点更近才采用
    const swarmDist = hit ? hit.distance : Infinity;
    const agent = this.nearestSwarmOnRay(ray, swarmDist);
    if (agent) return agent;
    if (hit && isFinite(hit.point.x) && isFinite(hit.point.y) && isFinite(hit.point.z)) {
      return hit.point;
    }
    return {
      x: ray.origin.x + ray.dir.x * CROSSHAIR_CONVERGE_DIST,
      y: ray.origin.y + ray.dir.y * CROSSHAIR_CONVERGE_DIST,
      z: ray.origin.z + ray.dir.z * CROSSHAIR_CONVERGE_DIST,
    };
  }

  /** ★ 准星射线上的最近蜂群代理（3D 圆柱近似：与射线垂距 ≤ 命中半径视为正对准星；
   *  maxDist 之外/身后的不吃 → 不隔着地形抢锁）。返回身体瞄准点或 null。 */
  private nearestSwarmOnRay(
    ray: { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } },
    maxDist: number,
  ): { x: number; y: number; z: number } | null {
    if (this.swarm.count === 0) return null;
    let bestT = Math.min(maxDist, CROSSHAIR_CONVERGE_DIST);
    let bestIdx = -1;
    for (let i = 0; i < this.swarm.count; i++) {
      const cx = this.swarm.agentX(i);
      const cy = this.swarm.agentY(i) + 0.9; // 瞄胸口（与自瞄口径一致）
      const cz = this.swarm.agentZ(i);
      const t = raySphereHit(ray.origin, ray.dir, { x: cx, y: cy, z: cz }, BULLET_HIT_RADIUS);
      if (t !== null && t > 1 && t < bestT) {
        bestT = t;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return null;
    return {
      x: this.swarm.agentX(bestIdx),
      y: this.swarm.agentY(bestIdx) + 0.9,
      z: this.swarm.agentZ(bestIdx),
    };
  }

  /** ★ 枪口 → 指定落点 的发射方向（近距退化保险：太近退回相机方向） */
  private dirTo(
    muzzle: { x: number; y: number; z: number },
    aim: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } {
    const ax = aim.x - muzzle.x, ay = aim.y - muzzle.y, az = aim.z - muzzle.z;
    const len = Math.hypot(ax, ay, az);
    if (len > 0.6) return { x: ax / len, y: ay / len, z: az / len };
    const ray = this.cameraRay();
    return { x: ray.dir.x, y: ray.dir.y, z: ray.dir.z };
  }

  /** ★ 枪口 → 准星落点 的发射方向（祖宗弹等共用；普通弹为复用落点走 dirTo） */
  private aimDirectionFromMuzzle(
    muzzle: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } {
    return this.dirTo(muzzle, this.crosshairPoint());
  }

  private firePlayerBullet(): void {
    // ★ 选中特殊弹药：消耗 1 并发射该弹药（打空/无库存自动回普通弹药）
    if (this.selectedQuickItem !== 'default' && FIREABLE_AMMO.has(this.selectedQuickItem)
      && this.itemManager?.hasItem('player', this.selectedQuickItem, 1)) {
      this.itemManager.removeItem('player', this.selectedQuickItem, 1);
      if (this.selectedQuickItem === 'zuzong') {
        this.launchSentinelProjectile();
        return;
      }
      if (this.selectedQuickItem === 'cover') {
        this.launchCoverProjectile('cover');
        return;
      }
      if (this.selectedQuickItem === 'tumu_laojie') {
        this.launchCoverProjectile('wall');
        return;
      }
    }
    if (this.selectedQuickItem !== 'default' && FIREABLE_AMMO.has(this.selectedQuickItem)) {
      this.selectedQuickItem = 'default';
    }
    const p = this.player.position;
    const muzzle = { x: p.x, y: p.y + 1.1, z: p.z };
    // ★ 经典 TPS：枪口 → 准星落点（命中点/虚拟远点），再叠轻微自瞄修正；
    //   落点同时下发给子弹（命中窗口放大基准：临近落点放大体积，过点缩回）
    const aim = this.crosshairPoint();
    const dir = this.dirTo(muzzle, aim);
    let dx = dir.x, dy = dir.y, dz = dir.z;
    const assisted = this.aimAssist(muzzle, dx, dy, dz);
    dx = assisted.x; dy = assisted.y; dz = assisted.z;
    // ★ 子弹伤害在命中瞬间按角色最终攻击力现算（攻击公式：遗物/装备/限时效果全实时）
    executeAttack(this.entities, this.bullets, {
      type: 'projectile', source: this.player,
      x: muzzle.x + dx * 1.5, y: muzzle.y + dy * 1.5, z: muzzle.z + dz * 1.5,
      dirX: dx, dirY: dy, dirZ: dz,
      speed: PLAYER_BULLET_SPEED, camp: 'player', lifetime: PLAYER_BULLET_LIFETIME,
      attackFormula: { min: PLAYER_BULLET_MIN_DAMAGE, ratio: PLAYER_BULLET_ATK_RATIO },
      targetX: aim.x, targetY: aim.y, targetZ: aim.z,
      // ★ 贴墙开枪无视墙（防被自己的城墙挡）；离墙远则照常命中（能拆敌墙）
      ignoreWalls: wallNear(p.x, p.z),
    });
    // ★ P2：枪声刷警戒（共享感知——附近游走的代理按个体延迟进入追击）
    this.swarm.alertAt(p.x, p.z, 16, 6);
  }

  /** ★ 脚步间距（米）：每走这么远播一步 —— 速度越快步频越高（2026-09-17） */
  private static readonly STEP_DISTANCE = 2.2;

  /** ★ 击杀掉落：按敌人 MobDef.drops 逐项掷概率 → 直接入袋 + UI 提示 */
  private rollEnemyDrops(enemy: EnemyBase): void {
    const def = this.enemyDefs.get(enemy);
    if (!def) return;
    this.rollDropsFromDef(def);
  }

  /** ★ 掉落结算（实体/代理共用；掉落直接入袋 + UI 提示） */
  private rollDropsFromDef(def: MobDef): void {
    if (!this.itemManager || !this.worldUIManager) return;
    for (const d of def.drops) {
      if (Math.random() >= d.chance) continue;
      const count = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
      const ok = this.itemManager.hasSpace('player', d.itemId, count)
        && this.itemManager.addItem('player', d.itemId, count);
      this.worldUIManager.showPickupResult(d.itemId, ok, count);
      if (ok) this.worldUIManager.flashItemAndRefresh(d.itemId);
    }
  }

  /** ★ P2：代理被子弹击杀（掉落 + 遗物击杀统计，与实体击杀同口径） */
  private onAgentKilled(mobIndex: number, x: number, _y: number, z: number): void {
    const def = this.mobDefs[mobIndex];
    if (def) this.rollDropsFromDef(def);
    if (this.session) {
      dispatchRelicEvent(this.session, RELIC_ITEM_CONFIG, 'onKill', {});
      this.statsDirty = true;
    }
    // ★ P4：同伴阵亡 → 附近代理狂暴（短时加速，冲上来拼命）
    this.swarm.enrageAt(x, z, SWARM.RAGE_RADIUS, SWARM.RAGE_SECONDS);
  }

  /**
   * ★ 物品掉落管线：命中报告（ImpactReport）→ 掷掉落 → 背包落账 + UI 提示。
   *   地面(固原岩) / 水面或贴水地块(酮凝集) / 耗尽原石晶体~3m(异铁)；
   *   有空间直接入袋&提示，背包满则提示失败。
   */
  private spawnItemDrops(r: ImpactReport): void {
    const drops = rollDrops({
      hasGround: r.tile.role === 'ground' || r.tile.role === 'platform',
      hasWater: r.water !== 'none',
      hasCrystal: r.prop?.key === 'depleted_crystal',
    });
    for (const drop of drops) {
      const ok = this.itemManager.hasSpace('player', drop.itemId, drop.count)
        && this.itemManager.addItem('player', drop.itemId, drop.count);
      this.worldUIManager.showPickupResult(drop.itemId, ok, drop.count);
      if (ok) this.worldUIManager.flashItemAndRefresh(drop.itemId);
    }
  }

  /** ★ 生成一架无人机（追加进编队；道具可多次使用 → 多机编队）
   *  slotIndex = 友军槽位号（-1 = 道具召唤不入槽）；itemId = 来源道具（HUD 显示） */
  private spawnDroneNearPlayer(slotIndex = -1, itemId = DRONE_ITEM): void {
    if (!this.scene || !this.player || !this.droneAsset) return;
    const p = this.player.position;
    const drone = new DroneAlly(this.entities, this.scene, this.droneAsset, {
      x: p.x + (Math.random() - 0.5) * 2, y: p.y + 2.0, z: p.z + (Math.random() - 0.5) * 2,
      scale: 1.2,
    });
    drone.slotIndex = slotIndex;
    drone.itemId = itemId;
    drone.owner = this.player; // ★ 攻击时实时查询主人最终攻击力
    allySystem.add(drone);
    // ★ 注入主渲染器：翅膀 VAT 离屏 RT 需与主渲染器共享 WebGL 上下文（同 MoonEffect）
    if (this.renderer) drone.setRenderer(this.renderer);
  }

  /** ★ 在指定落点生成祖宗（站桩友军）：每个祖宗都是独立实体，可多个并存（列表按落地顺序追加） */
  private spawnSentinelAt(x: number, z: number, dormant = false): void {
    if (!this.scene || !this.player) return;
    const asset = this.sentinelAsset ?? this.droneAsset;
    if (!asset) return;
    // ★ 与主角同尺寸（主角 applyRenderScale(2.0)）；中心锚点 → 半身高贴身摆放（可调）
    const py = this.raster.surfaceHeightAt(x, z) + 0.5;
    const s = new SentinelAlly(this.entities, this.scene, asset, { x, y: py, z, scale: 2.0 });
    s.slotIndex = -1;
    s.itemId = 'zuzong';
    if (dormant) s.sleep();   // ★ 留存恢复 = 休眠入场（接触唤醒）
    s.stationaryBaseY = py;
    // ★ 世界端口（远程/代理/挖矿）由 AllySystem 统一注入，不再逐个体绑定回调
    s.owner = this.player; // ★ 攻击时实时查询主人最终攻击力
    allySystem.add(s);
    if (this.renderer) {
      s.setRenderer(this.renderer);
      // ★ 祖宗：单帧 + 流体参数 → 启用常驻流体（魂体流动；无流体参数则自动跳过）
      s.enableAmbientFluid(this.renderer);
      // ★ 魂体渲染模式：流体裁到轮廓 + 不写深度（透明背景不挡水/子弹）
      s.enableSoulRenderMode();
      // ★ 记录共享流体实例（资产缓存同一份）→ WorldMode 每帧只步进一次
      const fxSrc = asset as unknown as {
        getFluidEffect?: (i: number, r: THREE.WebGLRenderer) => FluidEffect | null;
      };
      this.sentinelFluid ??= fxSrc.getFluidEffect?.(0, this.renderer) ?? null;
    }
  }

  /** ★ 发射祖宗弹：专属投影物（祖宗纹理、尾部朝飞行方向）；落地/寿命到 → 该处生成站桩祖宗 */
  private launchSentinelProjectile(): void {
    if (!this.player || !this.scene) return;
    const tex = this.getSentinelTexture();
    if (!tex) return;
    const p = this.player.position;
    const muzzle = { x: p.x, y: p.y + 1.1, z: p.z };
    // 与普通子弹同口径：枪口 → 准星落点（命中点/虚拟远点）
    const dir = this.aimDirectionFromMuzzle(muzzle);
    let dx = dir.x, dy = dir.y, dz = dir.z;
    // 轻微弹道修正（与普通子弹同口径）
    const assisted = this.aimAssist(muzzle, dx, dy, dz);
    dx = assisted.x; dy = assisted.y; dz = assisted.z;
    this.sentinelShots.push({
      proj: new SentinelProjectile(
        this.scene, tex,
        muzzle.x + dx * 1.5, muzzle.y + dy * 1.5, muzzle.z + dz * 1.5,
        dx, dy, dz, SENTINEL_SHOT_SPEED, SENTINEL_SHOT_LIFETIME,
      ),
      spawnOnLand: true,
      damage: -1,
      source: this.player,
      kind: 'sentinel',
      variant: 'cover',
      heading: 0,
      targetX: 0, targetY: 0, targetZ: 0, flyLeft: 0,
    });
  }

  /** ★ 世界状态落盘（exit / beforeunload）：地形破坏 + 植被 + 墙 + 召唤友军 */
  private saveWorldStateNow(): void {
    if (!this.session || !this.raster) return;
    try {
      const rs = this.raster.exportPersistState();
      const allies: AllyRec[] = [];
      for (const a of allySystem.allies) {
        if (a.slotIndex >= 0) continue;            // 出击槽友军由配装重建，不入缓存
        if (!(a instanceof SentinelAlly)) continue; // ★ 无人机一直跟随玩家，不写入缓存（2026-09-19 用户定调）
        allies.push({
          kind: 'sentinel', x: a.position.x, y: a.position.y, z: a.position.z,
          hp: a.hp, itemId: a.itemId,
          stationaryBaseY: a.stationaryBaseY,
        });
      }
      saveWorldState({
        seed: this.session.meta.seed,
        levels: rs.levels,              // ★ 只存坑洞；植被每天重建（不入缓存）
        mapRecords: rs.mapRecords,      // ★ 地形记录（大地图回放）
        walls: snapshotCovers(),
        allies,
        // ★ 小地图已探索记忆 + 地图标记（跨模式/跨天一直保留）
        explored: this.worldUIManager?.getMinimapExploredState() ?? null,
        markers: this.worldUIManager?.getMapMarkersState() ?? [],
      });
      pruneWorldStates();
    } catch (e) {
      console.warn('[WorldMode] 世界状态保存失败（忽略）:', e);
    }
  }

  /** ★ 世界状态恢复：墙（CoverEntity）+ 召唤友军（祖宗/无人机） */
  private restoreWorldState(data: WorldStateData): void {
    if (!this.scene) return;
    // ★ 地图标记恢复（跨模式/跨天保留；不再每天清空）
    if (data.markers.length > 0) this.worldUIManager?.loadMapMarkersState(data.markers);
    for (const w of data.walls) {
      const cover = new CoverEntity(this.entities, this.scene, {
        x: w.x, y: w.y, z: w.z,
        heading: w.heading,
        variant: w.variant,
        owner: w.owner,
        hp: Math.max(1, Math.round(w.hp)),
        buildTime: 0,
      });
      if (w.owner === 'player') this.playerCovers.push(cover);
    }
    for (const a of data.allies) {
      if (a.kind !== 'sentinel') continue;   // ★ 无人机不入缓存（旧档残留记录直接丢弃）
      this.spawnSentinelAt(a.x, a.z, true);  // ★ 休眠入场：回到原地接触才启用
      const s = allySystem.allies[allySystem.allies.length - 1];
      if (s instanceof SentinelAlly) {
        s.position.y = a.y;
        s.stationaryBaseY = a.stationaryBaseY ?? a.y;
        s.hp = Math.max(1, Math.round(a.hp));
      }
    }
  }

  /** ★ 放置面高度：地形 / 墙顶 / 舰船甲板 取最高（墙上加墙用） */
  private deploySurfaceAt(x: number, z: number, y: number): number {
    let h = this.raster.surfaceHeightAtFor(x, z, y);
    const wallTop = coverTopAt(x, z);
    if (wallTop !== null && wallTop > h) h = wallTop;
    const deck = this.ship?.deckTopAt(x, z);
    if (deck !== null && deck !== undefined && deck > h) h = deck;
    return h;
  }

  /** ★ 沿射线的第一个放置面交点（与 deployAimPoint 同口径；给祖宗弹预览/落点用） */
  private landingAlong(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number } {
    const maxD = CROSSHAIR_CONVERGE_DIST;
    const step = 1.5;
    let prevT = 0;
    for (let t = step; t <= maxD; t += step) {
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      if (y <= this.deploySurfaceAt(x, z, y)) {
        let lo = prevT, hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const mx = origin.x + dir.x * mid;
          const my = origin.y + dir.y * mid;
          const mz = origin.z + dir.z * mid;
          if (my <= this.deploySurfaceAt(mx, mz, my)) hi = mid; else lo = mid;
        }
        const x2 = origin.x + dir.x * hi;
        const z2 = origin.z + dir.z * hi;
        return { x: x2, y: this.deploySurfaceAt(x2, z2, origin.y), z: z2 };
      }
      prevT = t;
    }
    const x = origin.x + dir.x * maxD;
    const z = origin.z + dir.z * maxD;
    return { x, y: this.deploySurfaceAt(x, z, origin.y), z };
  }

  /** ★ 投送落点（2026-09-19 用户定调）：**正中心一条射线**打到"放置面"的第一个交点
   *  —— 不锁敌人/代理、不做范围判定；预览与实际落点共用本函数（预览 = 实际）。
   *  放置面包含墙顶 → 允许"墙上加墙"。 */
  private deployAimPoint(): { x: number; y: number; z: number } {
    const ray = this.cameraRay();
    const maxD = CROSSHAIR_CONVERGE_DIST;
    const step = 1.5;
    let prevT = 0;
    for (let t = step; t <= maxD; t += step) {
      const x = ray.origin.x + ray.dir.x * t;
      const y = ray.origin.y + ray.dir.y * t;
      const z = ray.origin.z + ray.dir.z * t;
      if (y <= this.deploySurfaceAt(x, z, y)) {
        let lo = prevT, hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const mx = ray.origin.x + ray.dir.x * mid;
          const my = ray.origin.y + ray.dir.y * mid;
          const mz = ray.origin.z + ray.dir.z * mid;
          if (my <= this.deploySurfaceAt(mx, mz, my)) hi = mid; else lo = mid;
        }
        const x2 = ray.origin.x + ray.dir.x * hi;
        const z2 = ray.origin.z + ray.dir.z * hi;
        return { x: x2, y: this.deploySurfaceAt(x2, z2, ray.origin.y), z: z2 };
      }
      prevT = t;
    }
    const x = ray.origin.x + ray.dir.x * maxD;
    const z = ray.origin.z + ray.dir.z * maxD;
    return { x, y: this.deploySurfaceAt(x, z, ray.origin.y), z };
  }

  /** ★ 投送落点预览：选中「祖宗 / 掩体」时在准星落点显示投放圈/足迹（其余情况隐藏） */
  private updateDeployPreview(): void {
    const dp = this.deployPreview;
    if (!dp) return;
    const q = this.selectedQuickItem;
    const isDeploy = q === 'zuzong' || q === 'cover' || q === 'tumu_laojie';
    if (this.phase !== 'explore' || !isDeploy || this.player.dead || this.player.controlLocked
      || !this.itemManager?.hasItem('player', q, 1)) {
      dp.hide();
      return;
    }
    if (q === 'zuzong') {
      // ★ 祖宗：预览 = 枪口沿准星方向的第一个放置面交点（与实际弹道同射线）
      const p0 = this.player.position;
      const muzzle = { x: p0.x, y: p0.y + 1.1, z: p0.z };
      const dir = this.aimDirectionFromMuzzle(muzzle);
      const land = this.landingAlong(muzzle, dir);
      dp.showCircle(land.x, land.y + 0.06, land.z, 1.6);
      return;
    }
    const aim = this.deployAimPoint();
    const gy = aim.y + 0.06;
    // 掩体 / 实心墙：足迹矩形（宽 × 厚），朝向 = 玩家 → 落点方向（墙法线）
    const p = this.player.position;
    const wall = q === 'tumu_laojie';
    dp.showRect(aim.x, gy, aim.z, COVER_W, COVER_T,
      Math.atan2(aim.x - p.x, aim.z - p.z), wall ? 0xffcc66 : 0xffffff);
  }

  /** ★ 城墙/墙弹（遗物「死仇时代的恨意」/ 道具「城墙」「墙」）：像祖宗弹一样从枪口沿准星发射；
   *  不结算命中（直接飞过敌人），落地生成玩家掩体（朝向 = 发射方向）。 */
  private launchCoverProjectile(variant: 'cover' | 'wall' = 'cover'): void {
    if (!this.player || !this.scene) return;
    const p = this.player.position;
    const muzzle = { x: p.x, y: p.y + 1.1, z: p.z };
    // ★ 落点 = 预览点（同一函数）→ 预览位置 == 实际位置
    const aim = this.deployAimPoint();
    const dx = aim.x - muzzle.x, dy = aim.y - muzzle.y, dz = aim.z - muzzle.z;
    const dist = Math.hypot(dx, dy, dz);
    const dirX = dx / (dist || 1), dirY = dy / (dist || 1), dirZ = dz / (dist || 1);
    this.sentinelShots.push({
      proj: new SentinelProjectile(
        this.scene, coverBrickTexture(),
        muzzle.x + dirX * 1.5, muzzle.y + dirY * 1.5, muzzle.z + dirZ * 1.5,
        dirX, dirY, dirZ, COVER_SHOT_SPEED, Math.max(0.15, dist / COVER_SHOT_SPEED),
      ),
      spawnOnLand: false,
      damage: -1,
      source: this.player,
      kind: 'cover',
      variant,
      // 朝向 = 玩家 → 落点（墙法线背对玩家）
      heading: Math.atan2(aim.x - p.x, aim.z - p.z),
      targetX: aim.x, targetY: aim.y, targetZ: aim.z,
      flyLeft: Math.max(0.15, dist / COVER_SHOT_SPEED),
    });
  }

  /** ★ 玩家城墙/墙落成（含上限：超出先拆最早的一面） */
  private playerCovers: CoverEntity[] = [];
  private spawnCoverAt(x: number, z: number, heading: number, variant: 'cover' | 'wall' = 'cover'): void {
    if (!this.scene) return;
    // ★ 放置面 = 地形 / 墙顶 / 舰船甲板 取最高（允许墙上加墙、允许穿模）
    const y = this.deploySurfaceAt(x, z, this.raster.surfaceHeightAt(x, z) + 1);
    const cover = new CoverEntity(this.entities, this.scene, {
      x, y, z, heading, owner: 'player', buildTime: COVER_DEPLOY_BUILD_TIME, variant,
    });
    this.playerCovers.push(cover);
    while (this.playerCovers.length > MAX_COVER_PLAYER) {
      this.playerCovers.shift()!.retire('recycled');
    }
  }

  /** 祖宗弹纹理（懒建缓存：祖宗素材第 0 帧合成） */
  private getSentinelTexture(): THREE.CanvasTexture | null {
    if (this.sentinelTex) return this.sentinelTex;
    const asset = this.sentinelAsset ?? this.droneAsset;
    if (!asset) return null;
    try {
      const canvas = compositeFrameToCanvas(asset as unknown as FtxAsset, 0);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.sentinelTex = tex;
      return tex;
    } catch (e) {
      console.warn('[WorldMode] 祖宗弹纹理合成失败:', e);
      return null;
    }
  }

  /** 每帧推进祖宗弹：命中敌人 → 伤害（玩家弹还额外落地生成祖宗）；触地/寿命到 → 按记录处理 */
  private updateSentinelShots(dt: number): void {
    if (this.sentinelShots.length === 0 || !this.camera) return;
    for (let i = this.sentinelShots.length - 1; i >= 0; i--) {
      const rec = this.sentinelShots[i];
      const shot = rec.proj;
      const land = shot.update(dt, this.camera);
      // ★ 城墙/墙弹：不结算命中（直接飞过敌人）；飞行纯视觉，到点落在**预定落点**
      if (rec.kind === 'cover') {
        rec.flyLeft -= dt;
        if (rec.flyLeft <= 0) {
          this.sentinelShots.splice(i, 1);
          shot.dispose();
          this.spawnCoverAt(rec.targetX, rec.targetZ, rec.heading, rec.variant);
        }
        continue;
      }
      // ★ 命中敌人：结算伤害（玩家弹用 IMPACT 公式；祖宗攻击弹用发射时算好的 damage）
      const hit = land ? null : this.sentinelShotHitEnemy(shot);
      if (hit) {
        const src = rec.source ?? this.player;
        const dmg = rec.damage >= 0
          ? rec.damage
          : Math.max(SENTINEL_IMPACT_MIN_DAMAGE, Math.round(queryFinalStats(this.player).attackPower * SENTINEL_IMPACT_ATK_RATIO));
        // 玩家祖宗弹的 dmg 已含攻击力 → 不再叠加 source.attackPower（修双计）
        applyDamage(dmg, src, hit, { hitPoint: shot.sprite.position });
      }
      if (land || hit) {
        this.sentinelShots.splice(i, 1);
        const p = shot.sprite.position;
        shot.dispose();
        if (rec.spawnOnLand) this.spawnSentinelAt(p.x, p.z);
      }
    }
  }

  /** ★ 子弹扫掠采集物 → 顶部扭曲 + 采收（2026-09-14）：角色子弹经过近场植被时
   *   CPU 大摆 + 随机掉落（株级冷却门 + cap 上限，到上限株消失）。
   *  只认角色子弹（player/ally）；触发源 = ChunkManager.propRegistry（与 E 键
   *  采集同一 LOD1 物品索引）。每帧 tick 衰减在当前方法尾部统一做。 */
  private updatePlantGustSweep(dt: number): void {
    if (this.chunks) {
      this.bullets.forEachActive((b) => {
        if (b.camp !== 'player' && b.camp !== 'ally') return;
        const p = b.entity.position;
        this.chunks.forEachCollectibleNear(p.x, p.z, PROP_GUST_RADIUS, (prop) => {
          // ★ 真的摇动了（该株冷却通过）才发击草音 —— 否则每颗子弹每帧都会响
          if (plantGustAt(prop.cx, prop.cz, prop.index)) playSfx('grassHit', 110);
          // ★ 射击采收：与 E 键同一条掉落/上限管线（含株级冷却 → 一发子弹一次掉落）
          this.harvestCollectible(prop, true);
        });
      });
    }
    tickPlantGust(dt);
  }

  /** 祖宗弹命中检测（球心 ≈ 弹体中心；半径 1.0m，含高度带） */
  private sentinelShotHitEnemy(shot: SentinelProjectile): EnemyBase | null {
    const p = shot.sprite.position;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const dx = e.position.x - p.x;
      const dy = (e.position.y + 0.9) - p.y;
      const dz = e.position.z - p.z;
      if (dx * dx + dy * dy + dz * dz <= 1.0 * 1.0) return e;
    }
    return null;
  }

  /** ★★ 敌人索敌候选的**活对象槽**（4 个：祖宗 / 舰船 / 玩家 / 友军；复用零分配）。
   *
   *  ★★ 不变量：这里返回的候选**必须是"每帧原地更新 x/z 的活对象"**。
   *   `conditions.seePlayer` 把候选对象**引用**直接写进 `ctx.target`，而 seePlayer
   *   **只挂在 patrol 上**（chase/attack 期间不重跑索敌）。于是：
   *
   *     · 候选是活对象 → ctx.target 自动跟着目标跑，弹道/追击/脱战判定全部正确；
   *     · 候选若是坐标拷贝（`{ x: p.x, z: p.z }`）→ ctx.target 退化成
   *       **"看见那一刻的坐标快照"**，inRange / outOfRange / loseTarget 全按快照判定。
   *       首当其冲的是**远程兵**：它的 `attackFinished → chase`（持续开火设计）
   *       → 永不回 patrol → 永不重跑 seePlayer → **永久锁死在旧坐标上朝空气射击**
   *       （2026-09-18 实测：玩家跑到 38m 外，弹道与真实方向夹角 157.7°，且不会脱战）。
   *       近战兵只是"侥幸"能靠 `attackFinished → patrol` 重新索敌，同样在追鬼影。
   *
   *  ⚠️ 改这里请保持"活对象"语义；别再写 `{ x: …, z: … }`。
   *  （slots[0] 带 radius=祖宗嘲讽半径，其余 radius 必须为 undefined ——
   *    `retarget` 用 `c.radius === undefined` 区分"普通目标"与"吸仇恨目标"。）
   */
  private readonly candSlots: TargetCandidate[] = [
    { x: 0, z: 0, radius: SENTINEL_TAUNT_RADIUS }, // 0 祖宗
    { x: 0, z: 0, radius: undefined },             // 1 舰船
    { x: 0, z: 0, radius: undefined },             // 2 玩家
    { x: 0, z: 0, radius: undefined },             // 3 友军（无人机）
  ];
  /** ★ 复用输出数组（同上：零分配；targetCandidates 不会重入） */
  private candOut: TargetCandidate[] = [];

  /** ★ 敌人索敌候选（优先级从高到低，2026-09-12 用户定调）：
   *  ① 祖宗（站桩·吸仇恨；TAUNT 半径内——有索敌效果，优先级最高）
   *  ② 舰船（停靠后）③ 玩家 ④ 一般友军（最近无人机）
   *  条件侧按序取第一个"在该敌视野半径内"的候选 → 实现攻击优先级队列
   *  ★★ 返回的是**活对象**（引用），见 candSlots 的不变量说明。 */
  private enemyTargetCandidates(enemy: EnemyBase): TargetCandidate[] {
    const ep = enemy.position;
    const out = this.candOut;
    out.length = 0;
    let sentinel: AllyBase | null = null, sentinelD2 = Infinity;
    let ally: AllyBase | null = null, allyD2 = Infinity;
    for (const d of this.drones) {
      if (d.hp <= 0) continue;
      const dx = d.position.x - ep.x, dz = d.position.z - ep.z;
      const d2 = dx * dx + dz * dz;
      if (d.stationary) {
        if (d2 < sentinelD2) { sentinelD2 = d2; sentinel = d; }
      } else if (d2 < allyD2) {
        allyD2 = d2;
        ally = d;
      }
    }
    // ★ 祖宗最高优先（TAUNT 半径内；吸仇恨）：radius = 自身嘲讽半径，
    //   seePlayer/retarget 用该半径判定，不走敌人通用视野半径
    const taunt2 = SENTINEL_TAUNT_RADIUS * SENTINEL_TAUNT_RADIUS;
    if (sentinel && sentinelD2 <= taunt2) {
      const s = this.candSlots[0];
      s.x = sentinel.position.x; s.z = sentinel.position.z;
      out.push(s);
    }
    // ★ 其次舰船（仅探索阶段存在；hp<=0 由结算接管不再嘲讽）
    if (this.phase === 'explore' && this.ship && this.ship.hp > 0) {
      const s = this.candSlots[1];
      s.x = this.ship.position.x; s.z = this.ship.position.z;
      out.push(s);
    }
    if (this.player) {
      const s = this.candSlots[2];
      s.x = this.player.position.x; s.z = this.player.position.z;
      out.push(s);
    }
    if (ally) {
      const s = this.candSlots[3];
      s.x = ally.position.x; s.z = ally.position.z;
      out.push(s);
    }
    return out;
  }

  /** ★ 快捷栏条目：普通弹药（∞）+ 行囊内弹药（祖宗等）。
   *  排序：普通弹药 → 弹药（各自内部保持背包扫描顺序，稳定排序）；
   *  弹药由攻击键发射消耗；Q/点击切换。只列行囊（player）里的。
   *  ★ 消耗品不进快捷栏：直接在背包（I）内点击使用。 */
  private buildAmmoEntries(): AmmoEntryView[] {
    const out: AmmoEntryView[] = [
      { id: 'default', name: '普通弹药', count: -1, iconId: 'bullet_default', selected: this.selectedQuickItem === 'default' },
    ];
    // ★ 先归并计数 + 定优先级（0=可发射弹药 1=其它弹药），再稳定排序
    const found: { id: string; count: number; rank: number }[] = [];
    if (this.itemManager) {
      for (const it of this.itemManager.getItems('player')) {
        const arch = this.itemManager.getArchetype(it.itemId);
        if (!arch) continue;
        // ★ 可部署友军（可露希尔的无人机等）走出击槽，不进快捷栏；只留弹药
        if (this.itemManager.isDeployable(it.itemId)) continue;
        const isFireable = FIREABLE_AMMO.has(it.itemId);
        if (!isFireable && arch.type !== 'ammo') continue;
        const rank = isFireable ? 0 : 1;
        const exist = found.find((f) => f.id === it.itemId);
        if (exist) exist.count += it.stackSize;
        else found.push({ id: it.itemId, count: it.stackSize, rank });
      }
    }
    found.sort((a, b) => a.rank - b.rank); // 稳定排序：同类保持背包扫描顺序
    const counts = new Map<string, number>();
    for (const f of found) {
      counts.set(f.id, f.count);
      const arch = this.itemManager?.getArchetype(f.id);
      out.push({
        id: f.id,
        name: arch?.name ?? f.id,
        count: f.count,
        iconId: f.id,
        selected: this.selectedQuickItem === f.id,
      });
    }
    // 选中的物品已用完/不在行囊 → 自动回普通弹药
    if (this.selectedQuickItem !== 'default' && (counts.get(this.selectedQuickItem) ?? 0) <= 0) {
      this.selectedQuickItem = 'default';
      out[0].selected = true;
    }
    return out;
  }

  /** ★ 切换快捷弹药（dir=+1 下一个 / -1 上一个，循环；普通弹药 → 行囊内弹药）：
   *   点按 Q = 顺序 +1；Q+滚轮 = 前后双向切换 */
  private cycleQuickItem(dir = 1): void {
    const entries = this.buildAmmoEntries();
    if (entries.length <= 1) return;
    const idx = entries.findIndex((e) => e.id === this.selectedQuickItem);
    if (idx < 0) {
      // 当前选择不在列表（刚消耗完/被移除）→ 从头（或尾）
      this.selectedQuickItem = entries[dir >= 0 ? 0 : entries.length - 1].id;
      return;
    }
    const next = entries[(idx + dir + entries.length) % entries.length];
    this.selectedQuickItem = next.id;
  }

  /** ★ 轻微弹道修正（自瞄）：从枪口看，偏角 ≤ AIM_ASSIST_ANGLE 的最近方向目标 →
   *  方向按 AIM_ASSIST_STRENGTH 混合，且相对原方向最多修正 AIM_ASSIST_MAX 弧度。
   *  保持"一点点"：大角度甩枪、无目标时不生效。 */
  private aimAssist(
    muzzle: { x: number; y: number; z: number },
    dx: number, dy: number, dz: number,
  ): { x: number; y: number; z: number } {
    if (this.enemies.length === 0) return { x: dx, y: dy, z: dz };
    let bx = 0, by = 0, bz = 0;
    let bestAng = AIM_ASSIST_ANGLE;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const ex = e.position.x - muzzle.x;
      const ey = e.position.y + 0.8 - muzzle.y; // 瞄身体
      const ez = e.position.z - muzzle.z;
      const len = Math.hypot(ex, ey, ez);
      if (len < 0.6 || len > AIM_ASSIST_RANGE) continue;
      const dot = (ex * dx + ey * dy + ez * dz) / len;
      const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (ang < bestAng) {
        bestAng = ang;
        bx = ex / len; by = ey / len; bz = ez / len;
      }
    }
    if (bestAng >= AIM_ASSIST_ANGLE) return { x: dx, y: dy, z: dz };
    // 按强度混合 + 归一化
    let mx = dx + (bx - dx) * AIM_ASSIST_STRENGTH;
    let my = dy + (by - dy) * AIM_ASSIST_STRENGTH;
    let mz = dz + (bz - dz) * AIM_ASSIST_STRENGTH;
    let ml = Math.hypot(mx, my, mz) || 1;
    mx /= ml; my /= ml; mz /= ml;
    // 限制相对原方向的最大修正角（把偏移向量按比例缩回）
    const dot2 = Math.max(-1, Math.min(1, mx * dx + my * dy + mz * dz));
    const ang2 = Math.acos(dot2);
    if (ang2 > AIM_ASSIST_MAX) {
      const t = AIM_ASSIST_MAX / Math.max(1e-6, ang2);
      mx = dx + (mx - dx) * t;
      my = dy + (my - dy) * t;
      mz = dz + (mz - dz) * t;
      ml = Math.hypot(mx, my, mz) || 1;
      mx /= ml; my /= ml; mz /= ml;
    }
    return { x: mx, y: my, z: mz };
  }

  /** ★ 统一属性刷新（唯一入口）：基础 = 存档原值；遗物 = 'relic' 效果源；装备 = 'equipment' 效果源；
   *   限时效果 = 队列内 consumable 源。三者在 EffectSystem 一次聚合，实体字段即最终值。 */
  private refreshPlayerStats(): void {
    const s = this.session;
    if (!s || !this.player || !this.itemManager) return;
    // ---- 基础层：存档原值（派生值一律由效果源叠加） ----
    effectSystem.setBaseStats(this.player, {
      maxHp: s.player.maxHp,
      attackPower: s.player.attackPower,
      defense: s.player.defense,
      attackSpeed: 0,
      damageReduction: 0,
      hpRegen: 0,
    });
    // ---- 遗物层：复利乘区 + 加值（每次死亡/击杀后由 statsDirty 触发重算） ----
    const mods = computeRelicModifiers(s, RELIC_ITEM_CONFIG);
    this.playerPipeline.setRespawnTimeMul(mods.respawnTimeMul);
    effectSystem.setSourceEffects(this.player, 'relic', [{
      id: 'relics',
      duration: Infinity,
      mul: {
        maxHp: mods.mulHp,
        attackPower: mods.mulAtk,
        defense: mods.mulDef,
      },
      flat: {
        maxHp: mods.bonusHp,
        attackPower: mods.bonusAtk,
        defense: mods.bonusDef,
        // ★ 遗物生命回复（regen 效果，如「衣服」）→ 与装备 hpRegen 加算
        hpRegen: mods.bonusRegen,
      },
    }]);
    // ---- 装备层：加算 + 加法乘区（弹药/装备/消耗品 buff 由队列各自维护） ----
    const eq = this.itemManager.getEquipmentStats();
    // ★ 友军回血（黍姐的XX）：装备汇总 → 无人机/祖宗每帧结算
    this.allyRegen = eq.allyRegen;
    effectSystem.setSourceEffects(this.player, 'equipment', [{
      id: 'equipment',
      duration: Infinity,
      flat: {
        maxHp: eq.maxHp,
        attackPower: eq.attackPower,
        defense: eq.defense,
        attackSpeed: eq.attackSpeed,
        damageReduction: eq.damageReduction,
        hpRegen: eq.hpRegen,
        critRate: eq.critRate,
        critMult: eq.critMult,
        dodgeRate: eq.dodgeRate,
        blockRate: eq.blockRate,
        blockMult: eq.blockMult,
      },
      pct: {
        attackPower: eq.attackPct,
        defense: eq.defensePct,
      },
      healProc: eq.healProc ?? undefined,
    }]);
    // ★ 载具（逻各斯的圆凳）：躺乘姿态 + 移速大提升 + 爬坡/过坑
    //   （姿态/乘数在 Player.applyVehicleStats → VehicleRide；过坑桥接见 clampVehicle）
    this.player.applyVehicleStats(eq);
    this.player.controller.moveSpeed = PLAYER_MOVE_SPEED * this.player.moveSpeedMul;
  }

  /** ★ 治疗转伤害（遥·幽隙栖萤 口径）：累计治疗量 ≥ 阈值 → 对半径内最多 N 名敌人结算
   *  伤害 = 累计治疗量 × ratio（直接扣血、不经减法防御——按法术伤害口径） */
  private updateHealProc(): void {
    const p = this.player;
    const proc = p.healProc;
    if (!proc || p.hp <= 0 || p.healBuffer < HEAL_PROC_MIN_HEAL) return;
    const heal = p.healBuffer;
    p.healBuffer = 0;
    const dmg = Math.max(1, Math.round(heal * proc.ratio));
    const r2 = proc.radius * proc.radius;
    const px = p.position.x, pz = p.position.z;
    const targets = this._healProcTargets;
    targets.length = 0;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const dx = e.position.x - px;
      const dz = e.position.z - pz;
      if (dx * dx + dz * dz <= r2) targets.push(e);
    }
    if (targets.length === 0) return;
    targets.sort((a, b) => {
      const adx = a.position.x - px, adz = a.position.z - pz;
      const bdx = b.position.x - px, bdz = b.position.z - pz;
      return adx * adx + adz * adz - (bdx * bdx + bdz * bdz);
    });
    const n = Math.min(proc.maxTargets, targets.length);
    for (let i = 0; i < n; i++) {
      // ★ 法术口径：跳过减法防御（其余照常，事件统一在 applyDamage）
      applyDamage(dmg, p, targets[i], {
        type: 'arts',
        ignoreDefense: true,
        // ★ 纵向问目标自己（别写死 +1.0：对高个敌人会落到大腿）
        hitPoint: { x: p.position.x, y: targets[i].hitAnchorY(), z: p.position.z },
      });
    }
  }

  /** ★ 航行推进：耗油 + 油尽惩罚（扣当前血量一半 → 当前位置就近安全点紧急停靠） */
  private updateSail(dt: number): void {
    const s = this.session;
    if (!s || !this.ship) return;
    const sh = s.ship;
    sh.position.x = this.ship.position.x;
    sh.position.z = this.ship.position.z;
    if (!this.ship.sailable) return;
    sh.fuel = Math.max(0, sh.fuel - travelConfig.fuelDrainPerSec * dt);
    if (sh.fuel > 0) return;
    // 油尽：扣半血 + 紧急停靠（就近安全点）
    applyShipDamage(s, sh.hp * travelConfig.emergencyHpLossRatio);
    this.ship.hp = sh.hp;
    if (isShipDestroyed(s)) return; // 毁灭由结算/复活面板接管
    this.requestDock(true);
  }

  /** ★ 出击槽 ↔ 世界友军**全量同步**（增/删/换；2026-09-14 重做）：
   *  - 只处理入驻槽位的友军（slotIndex ≥ 0；道具召唤的无人机不动）
   *  - 槽位已空/换型 → 销毁对应世界实体；槽位有友军无实体 → 生成
   *  - 调用点：停靠（航行→探索）、出舱（舰内→探索）、探索期换装变化 */
  private syncSlotAllies(): void {
    if (!this.droneAsset) return;
    const slots = this.itemManager?.getSlots?.() ?? [];
    const wanted = new Map<number, string>();
    for (let i = 0; i < slots.length; i++) {
      const id = slots[i];
      if (id && allyPlaybackRegistry.has(id)) wanted.set(i, id);
    }
    // ① 回收：槽位已空 / 换型 → 销毁世界实体
    for (let i = allySystem.allies.length - 1; i >= 0; i--) {
      const d = allySystem.allies[i];
      if (d.slotIndex < 0) continue;
      if (wanted.get(d.slotIndex) === d.itemId) continue;
      allySystem.remove(d);
      d.retire('recycled');
    }
    // ② 补齐：有槽位但没有实体 → 生成
    for (const [slotIndex, itemId] of wanted) {
      if (allySystem.allies.some((d) => d.slotIndex === slotIndex && d.itemId === itemId)) continue;
      allyPlaybackRegistry.get(itemId)!.spawn({
        itemId,
        slotIndex,
        spawnDroneNearPlayer: (slot, id) => this.spawnDroneNearPlayer(slot, id),
      });
    }
  }

  /** ★ 玩家下机点：舰船右舷侧旁偏移（右向量 = (f.z, -f.x)），只避坑 */
  private playerExitPoint(shipX: number, shipZ: number): { x: number; y: number; z: number } {
    const f = this.ship?.forward ?? { x: 0, y: 0, z: 1 };
    const rx = f.z, rz = -f.x;
    const safe = resolveDockSpawn(
      this.raster,
      shipX + rx * WorldMode.PLAYER_EXIT_OFFSET,
      shipZ + rz * WorldMode.PLAYER_EXIT_OFFSET,
    );
    return { x: safe.x, y: this.raster.surfaceHeightAt(safe.x, safe.z), z: safe.z };
  }

  /** ★ 起调判定（降到起调高度）→ **一次性取景**：观察机位装下"飞机当前位置 →
   *  预测落点"整段（垂直跨度按 FOV 反推距离），注视点取两点中段偏上。
   *  触发后相机姿势/朝向/注视点全部冻结，不再逐帧重算（资料共识：固定镜头不抖）。 */
  private tryStartLandingShot(): void {
    const cam = this.camera;
    const ship = this.ship;
    if (!cam || !ship || this.camShot) return;
    const gy0 = RasterMap.current?.surfaceHeightAt(ship.position.x, ship.position.z) ?? 0;
    const alt0 = ship.position.y - gy0;
    if (alt0 > WorldMode.CAM_SHOT_START_ALT) return;
    // ★ 落点预测 = 与 landingStep 同模型的离散推进（收油 16 m/s²、sink=clamp(alt×0.4,2,8)）
    //   （旧版 speed×时间×0.6 在高速时严重高估漂移 → 跨度巨大 → 机位被推到几百米外）
    const f = ship.forward;
    let px = ship.position.x, pz = ship.position.z;
    let alt = alt0, v = ship.speedValue;
    for (let t = 0; t < 30 && alt > 0; t += 0.25) {
      px += f.x * v * 0.25;
      pz += f.z * v * 0.25;
      const sink = Math.min(
        travelConfig.flightLandingSinkMax,
        Math.max(travelConfig.flightLandingSink, alt * 0.4),
      );
      alt -= sink * 0.25;
      v = Math.max(travelConfig.flightLandingSpeed, v - 16 * 0.25);
    }
    const lgy = RasterMap.current?.surfaceHeightAt(px, pz) ?? 0;
    const ax = ship.position.x, ay = ship.position.y, az = ship.position.z;
    const dx = px - ax, dz = pz - az;
    const hspan = Math.hypot(dx, dz);
    const hl = hspan || 1;
    const dirX = dx / hl, dirZ = dz / hl;
    const sideX = dirZ, sideZ = -dirX; // 进近方向右侧
    // ★ 机位基准 = A→B 整段【中点】（侧向取景；不再相对落点前移 → 修"只能看到机头"）
    const mx = (ax + px) * 0.5, mz = (az + pz) * 0.5;
    const span3 = Math.hypot(hspan, ay - lgy);
    // 4× 大船：取景距离/高度同步放大（船体 ≈26m 长）
    const D = Math.min(140, Math.max(70, span3 * 0.55));
    const H = Math.min(50, Math.max(18, span3 * 0.25));
    // 正侧方（略向 A 偏 10%：从侧后方看，能看到完整机身而非迎面机头）
    const sx = mx + sideX * D - dirX * D * 0.1;
    const sz = mz + sideZ * D - dirZ * D * 0.1;
    const sgy = RasterMap.current?.surfaceHeightAt(sx, sz) ?? 0;
    // 机位抬高到"整段中间高度"之上（含地形净空）
    const midY = (ay + lgy) * 0.5;
    const shotPos = new THREE.Vector3(sx, Math.max(midY + H, sgy + 8), sz);
    // 注视点 = 整段中点（飞机从画面上方一路降到中心，全程在画幅内）
    const pivot = new THREE.Vector3(mx, midY + span3 * 0.06, mz);
    _camMat.lookAt(_camEye.copy(shotPos), pivot, _camUp);
    const shotQuat = new THREE.Quaternion().setFromRotationMatrix(_camMat);
    this.camShot = {
      t: 0,
      fromPos: cam.position.clone(),
      fromQuat: cam.quaternion.clone(),
      shotPos, shotQuat, pivot,
    };
  }

  /** ★ 观察机位步进：缓入缓出 + 绕注视点的球面弧移动过去；到位后保持静止
   *  （飞机独立降入画面，全程无逐帧目标重算 → 不抖）。 */
  private updateLandingShot(dt: number): void {
    const S = this.camShot;
    const cam = this.camera;
    if (!S || !cam) return;
    S.t += dt;
    const k = Math.min(1, S.t / WorldMode.CAM_SHOT_BLEND);
    const e = k * k * (3 - 2 * k);
    interpCamPose(S.fromPos, S.fromQuat, S.shotPos, S.shotQuat, e, S.pivot, cam.position, cam.quaternion);
    if (k >= 1) {
      // 到位：钉死在观察机位（其它系统若有残留写入也被覆盖）
      cam.position.copy(S.shotPos);
      cam.quaternion.copy(S.shotQuat);
    }
  }

  /** ★ 镜头调度步进：缓入缓出 + 绕注视点的球面弧（pivot 为空则线性），
   *  完成后交还控制权 */
  private updateCamBlend(dt: number): void {
    const B = this.camBlend;
    const cam = this.camera;
    if (!B || !cam) return;
    B.follow?.();
    B.t += dt;
    const k = Math.min(1, B.t / B.dur);
    const e = k * k * (3 - 2 * k);
    interpCamPose(B.fromPos, B.fromQuat, B.toPos, B.toQuat, e, B.pivot, cam.position, cam.quaternion);
    if (k >= 1) {
      this.camBlend = null;
      B.onDone?.();
    }
  }

  /** ★ 飞行追尾相机（航行期替代 CameraController）：机后上方平滑跟随 + 看向机头前方。
   *  首帧直接就位（否则从舰内相机位慢慢飞过来 → 前几秒看着黑屏/别处）。 */
  private updateFlightCamera(dt: number): void {
    const cam = this.camera;
    if (!cam || !this.ship) return;
    const sp = this.ship.position;
    const f = this.ship.forward;
    const dist = travelConfig.flightCamDist;
    const tx = sp.x - f.x * dist;
    const ty = sp.y - f.y * dist + travelConfig.flightCamUp;
    const tz = sp.z - f.z * dist;
    const k = this.flightCamInit ? 1 - Math.exp(-dt * travelConfig.flightCamDamp) : 1;
    this.flightCamInit = true;
    cam.position.x += (tx - cam.position.x) * k;
    cam.position.y += (ty - cam.position.y) * k;
    cam.position.z += (tz - cam.position.z) * k;
    cam.lookAt(sp.x + f.x * 8, sp.y + f.y * 8 + 1.2, sp.z + f.z * 8);
  }

  /** ★ 停靠请求（F/油尽）：进入**降落进近**（§19.7）——保留前进速度、低操控、
   *  自动收油下降；进近一开始就切【细化】+ 当前位置 3×3 强制构建（进近漂移量
   *  远小于细化环半径）→ 触地那刻地形已就绪。触地收尾见 finishDock。 */
  private requestDock(emergency: boolean): void {
    if (this.phase !== 'sail' || !this.session || !this.ship || this.landing
      || this.takeoff || this.camBlend) return;
    this.landing = {
      phase: 'approach', t: 0, fromX: 0, fromZ: 0, toX: 0, toZ: 0,
      exitX: 0, exitY: 0, exitZ: 0, emergency,
    };
    this.landingTouchdown = false;
    this.camShot = null; // 高空段追尾；降到起调高度再切观察机位
    // ★ 降落冲刺：立刻转细化 + 落点 3×3 强制构建 + 放开闸门；
    //   优先级（进近窗口内）= 当前块 > 机头方向下一块 > 十字臂 > 其余
    const fw = this.ship.forward;
    this.chunks.rushTerrain(this.ship.position.x, this.ship.position.z, fw.x, fw.z);
    this.worldUIManager.setDockButtonVisible(false);
  }

  /** ★ 触地 → 落稳段：记录安全落点 + 解析玩家下机点（舰船侧旁），
   *  并启动镜头调度后半程（当前机位 → 角色机位，与落稳同时结束）。 */
  private beginSettle(): void {
    const L = this.landing;
    if (!L || !this.ship) return;
    const cur = this.ship.position;
    const sp = resolveDockSpawn(this.raster, cur.x, cur.z);
    L.phase = 'settle';
    L.t = 0;
    L.fromX = cur.x;
    L.fromZ = cur.z;
    L.toX = sp.x;
    L.toZ = sp.z;
    this.camShot = null; // 观察机位结束，交棒落稳段镜头
    // 玩家下机点：舰船右舷侧旁（不在机体里）
    const exit = this.playerExitPoint(sp.x, sp.z);
    L.exitX = exit.x; L.exitY = exit.y; L.exitZ = exit.z;
    // ★ 镜头调度收尾：从当前（已预调度过半的）机位 → 角色机位；与落稳同步结束
    const cam = this.camera;
    if (!cam) return;
    const fromPos = cam.position.clone();
    const fromQuat = cam.quaternion.clone();
    this.cameraCtrl.snapTo(exit.x, exit.y, exit.z);
    this.cameraCtrl.update(1, { x: 0, y: 0 }, 0,
      { x: exit.x, y: 0, z: exit.z, height: exit.y, jump: 0 }, false);
    const toPos = cam.position.clone();
    const toQuat = cam.quaternion.clone();
    cam.position.copy(fromPos);
    cam.quaternion.copy(fromQuat);
    this.camBlend = {
      t: 0, dur: WorldMode.LAND_SETTLE_SECONDS,
      fromPos, fromQuat, toPos, toQuat,
      // 绕"角色焦点"的球面弧收尾（观察机位 → 角色机位，不直线穿地）
      pivot: new THREE.Vector3(exit.x, exit.y + 1.6, exit.z),
      onDone: () => { this.player.controlLocked = false; },
    };
  }

  /** ★ 落稳段步进：只固定位置（贴地 + 平滑滑向安全点），姿态角度不动 */
  private updateSettle(dt: number): void {
    const L = this.landing;
    if (!L || !this.ship) return;
    L.t += dt;
    const k = Math.min(1, L.t / WorldMode.LAND_SETTLE_SECONDS);
    const e = k * k * (3 - 2 * k);
    const x = L.fromX + (L.toX - L.fromX) * e;
    const z = L.fromZ + (L.toZ - L.fromZ) * e;
    const gy = RasterMap.current?.surfaceHeightAt(x, z) ?? 0;
    this.ship.settleStep(x, gy + SHIP_LANDED_HEIGHT, z);
    if (k >= 1) this.finishDock();
  }

  /** ★ 触地收尾：舰船落位、角色在下机点接管、友军部署、恢复水面/云月。
   *  镜头调度已在 beginSettle 启动（与落稳同步结束），此处不再重建过渡。 */
  private finishDock(): void {
    if (!this.session || !this.ship) return;
    const emergency = this.landing?.emergency ?? false;
    const L = this.landing;
    this.landing = null;
    this.landingTouchdown = false;
    const cur = this.ship.position;
    const sp = resolveDockSpawn(this.raster, cur.x, cur.z);
    this.setPhase('explore');     // ★ 落地停稳 = 人下机到地面（露天环境 + 恢复昼夜）
    // ★ Boss 战：落地后在舰船前方生成普瑞赛斯（一次性）
    if (this.bossRun && !this.bossEntity) this.spawner.spawnBoss(sp.x, sp.z);
    this.ship.position.x = sp.x;
    this.ship.position.z = sp.z;
    this.ship.land();
    this.entities.onEntityMoved(this.ship); // 航行期索引未逐帧刷新 → 停靠后就位
    this.session.ship.position = { x: sp.x, z: sp.z };
    this.chunks.setWaterVisible(true);      // 停靠：恢复水面渲染
    renderManager.setFlightMode(false);     // 停靠：恢复云/月亮更新
    // ★ 角色在下机点就位（舰船侧旁，不在飞机里）；控制权由镜头调度结束交还
    const exit = L && (L.exitX !== 0 || L.exitZ !== 0)
      ? { x: L.exitX, y: L.exitY, z: L.exitZ }
      : this.playerExitPoint(sp.x, sp.z);
    const p = this.player;
    p.controlLocked = true;
    p.position.x = exit.x;
    p.position.z = exit.z;
    p.position.y = exit.y;
    this.worldUIManager.setDockButtonVisible(false);
    this.worldUIManager.setCombatHudVisible(true); // ★ 停靠后：正式绘制战斗 HUD
    this.syncSlotAllies();                         // ★ 停靠后：友军出队（与出击槽全量同步）
    this.showFloatingAt(exit.x, exit.y + 1.6, exit.z, emergency ? '紧急停靠' : '已停靠', 'heal');
    // ★ 落地名册陈列（?roster=1）：每种敌人各铺一只（不含普瑞赛斯），绕舰船落点一圈。
    //   放在角色就位之后 —— 环带以舰船为中心，角色在舷侧，整圈都落在 L3 升格半径 35m 内，
    //   下一帧起就会逐个升格成实体（能看到真实的 AI/弹道）。
    if (this.rosterOnLanding) {
      this.spawner.spawnRosterShowcase(sp.x, sp.z);
      // 头顶再提示一次，避免玩家没注意脚下已经围了一圈
      this.showFloatingAt(exit.x, exit.y + 3.2, exit.z, '名册陈列：每兵种一只', 'crit');
    }
    // 兜底：若镜头调度意外缺失（无相机/被取消），直接就位并交还控制
    if (!this.camBlend) {
      this.cameraCtrl.snapTo(exit.x, exit.y, exit.z);
      p.controlLocked = false;
    }
  }

  // ============================================================
  // ★ 舰内房间（2026-09-13 用户定调）
  //   F 靠近舰船 → 进入舰内（类似基地的 3D 房间，可走动）；舱内三站：
  //   起飞（回航行）/ 返回罗德岛号 / 下船 / 加工台 / 背包。世界在舱内期间冻结（同航行期）。
  // ============================================================

  // ============================================================
  // ★ 事件 / 对话（2026-09-14）
  //   · 探索期：区块激活抽选事件 → 刷 NPC 实体，近处 E 对话
  //   · 舰内：固定锚点交互站（F 交谈），与按钮条并存
  // ============================================================

  /** ★ 区块激活：世界事件抽选 → 刷事件 NPC（探索期；位置/结果确定性：同天同块稳定） */
  private onChunkActivated(cx: number, cz: number): void {
    if (this.phase !== 'explore' || !this.scene || !this.dialogue) return;
    if (this.npcs.length >= WorldMode.MAX_EVENT_NPCS) return;
    const ev = this.eventSystem.rollWorldEvent(cx, cz);
    if (!ev) return;
    const assetUrl = ev.npc.portrait;
    if (!assetUrl) return;
    // 位置：chunk 内确定性随机点（避开坑/水/过低/玩家近旁）
    const seed = this.raster.worldSeed + 7717;
    const x = cx * CHUNK_SIZE + 4 + hash2(cx * 131 + 17, cz * 197 + 31, seed) * (CHUNK_SIZE - 8);
    const z = cz * CHUNK_SIZE + 4 + hash2(cx * 313 + 41, cz * 419 + 53, seed) * (CHUNK_SIZE - 8);
    const p = this.player?.position;
    if (p && (x - p.x) ** 2 + (z - p.z) ** 2 < 14 * 14) return;
    const role = this.raster.tileDefAt(x, z).genRole;
    if (role === 'pit' || role === 'liquid') return;
    const y = this.raster.surfaceHeightAt(x, z);
    if (y < -1.2) return;
    void loadFtxCached(assetUrl)
      .then((asset) => {
        if (!this.scene || this.phase !== 'explore') return; // 期间模式退出/换阶段
        if (this.npcs.length >= WorldMode.MAX_EVENT_NPCS) return;
        const npc = new NpcEntity(this.entities, this.scene, asset, {
          x, y, z,
          npcId: ev.id,
          name: ev.npc.speaker,
          dialogue: ev.dialogue,
          eventId: ev.id,
        });
        this.npcs.push(npc);
        this.showFloatingAt(x, y + 2.6, z, '？', 'heal');
      })
      .catch((err) => console.warn('[事件] NPC 立绘加载失败:', assetUrl, err));
  }

  /** ★ 开始与事件 NPC 对话（探索期；锁玩家操作，结束回调恢复） */
  private startNpcDialogue(npc: NpcEntity): void {
    if (!this.dialogue) return;
    if (!this.dialogue.start(npc.dialogueTree, { eventId: npc.eventId ?? undefined })) return;
    this.pendingNpc = npc;
    this.player.controlLocked = true;
    eventBus.emit('dialogue', { id: npc.dialogueTree });
  }

  /** ★ 途中访客对话：暂停赶路 + 看向玩家；结束由 dialogue.onEnd 续行/离舰 */
  private startVisitorDialogue(v: VisitorNpcBase): void {
    if (!this.dialogue) return;
    if (!this.dialogue.start(v.approachDialogue)) return;
    this.pendingVisitor = v;
    v.setPaused(true);
    v.faceToward(this.player.position.x, this.player.position.z);
    this.player.controlLocked = true;
    eventBus.emit('dialogue', { id: v.approachDialogue });
  }

  /**
   * ★ 对话奖励上屏：对话/访客送物资或遗物时，走右上角「获得物品」播报。
   *   与击杀掉落、采集复用同一条渠道（WorldUIManager.showPickupResult），观感统一。
   *   · 背包满 → success=false → 红字「背包已满，无法拾取 X」；
   *   · 遗物不入背包 → 只播报、**不闪背包格子**（闪了也没有那个格子）。
   */
  private onDialogueGrant(g: DialogueGrant): void {
    this.worldUIManager?.showPickupResult(g.id, g.success, g.count);
    if (g.success && g.kind === 'item') this.worldUIManager?.flashItemAndRefresh(g.id);
  }

  /**
   * ★ 对话点名的「小游戏请求」：对话树把某个剧情 flag 置位表示"谈完要开局"。
   *   目前只有鹰叫王子的校队检测（flag: yjwangzi_trial_start）。
   *
   * 流程：对话结束 → 本方法检出 flag → 开局 → 结算按分数播对应结果树 →
   *   结果树结束再次进 onEnd（此时 flag 已清）→ 正常收尾（访客离舰 / 解锁输入）。
   * ★ 返回 true 表示"已接管"，onEnd 必须直接 return，**不要**再走访客离舰那套收尾 ——
   *   否则人走了、结果对话还在说话。
   */
  private tryStartMiniGameFromFlags(session: GameSession): boolean {
    const flags = session.story.flags;
    if (!flags.yjwangzi_trial_start) return false;
    flags.yjwangzi_trial_start = 0;   // ★ 先清位：小游戏/结果树期间的任何重入都不会再触发

    const ok = startMiniGame('alignment_trial', {
      onFinish: (r) => {
        const tree = r.score >= 80 ? 'yjwangzi_result_high'
          : r.score >= 50 ? 'yjwangzi_result_mid'
          : 'yjwangzi_result_low';
        console.log(`[校队检测] 得分 ${r.score}（${r.detail ?? ''}）→ ${tree}`);
        this.dialogue.start(tree);
      },
      onCancel: () => {
        // 放弃：按最低档走，剧情不断线（访客照常离舰）
        this.dialogue.start('yjwangzi_result_low');
      },
    });
    if (!ok) {
      // 开局失败（未登记/已有小游戏在跑）→ 兜底按最低档，别把对话卡死
      this.dialogue.start('yjwangzi_result_low');
      return true;
    }
    return true;
  }

  /** ★ 采收（E 自动接触 / 子弹命中共享）：掉落入包 + 株采集次数 +1。
   *  · 株级冷却 → 不抽干（auto 接触每帧触发 / 快枪多弹都只按株节流）
   *  · 次数达 cap → 标记已采 + 重贴（株消失）；背包满 → 不消耗株 */
  private harvestCollectible(c: DecorPropInstance, auto = false): void {
    if (!this.itemManager || !this.worldUIManager) return;
    const drop = collectibleDropOf(c.key);
    if (!drop) return;
    const cap = collectibleCapOf(c.key);
    if (cap <= 0) return; // ★ 无上限声明 = 不可采（保守防御）
    // ★ 株级冷却门：同株两次产出间隔（秒）。E auto 每帧触发 / 一条弹道数次扫掠，
    //   都只让"每次经过"消费 1 次 → 株的 cap 不被一次贴脸/一发弹幕抽干。
    if (!plantDropTryClaim(c.cx, c.cz, c.index, (drop.cooldown ?? 0.35) * 1000)) return;
    const count = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
    const ok = this.itemManager.hasSpace('player', drop.itemId, count)
      && this.itemManager.addItem('player', drop.itemId, count);
    if (ok) {
      // ★ 采集次数 +1；到 cap → 株消失（重贴，从渲染与查询索引中移除）
      this.chunks.advanceCollectible(c.cx, c.cz, c.index, cap);
      // ★ 采集粒子特效（金色飞散；替代原植株头顶飘字——获取提示走右上角播报）
      if (this.scene) this.pickupGlows.push(new PickupGlowEffect(this.scene, c.x, c.y + 0.35, c.z));
      this.worldUIManager.showPickupResult(drop.itemId, true, count);
      this.worldUIManager.flashItemAndRefresh(drop.itemId);
    } else if (!auto || this.autoPickToastCd <= 0) {
      this.worldUIManager.showPickupResult(drop.itemId, false);
      if (auto) this.autoPickToastCd = 2;
    }
  }

  /** ★ 舰内固定位事件（2026-09-16 改版）：
   *   ① 三个**固定功能站**（加工台 / 航行终端 / 下船）—— 走到地面光圈里按 E 触发；
   *      其中【起飞】与【返回罗德岛号】合成"航行终端"一件事的两个选项。
   *   ② NPC / 访客交谈站 —— 仍然注册进同一份交互站列表。
   *   功能站**排在最前面**：交互站取"最近的一个"，并列时先注册者胜 → 功能优先。 */
  private applyShipInteriorEvents(interior: BaseScene): void {
    if (!this.eventSystem || !this.dialogue) return;
    const S = WorldMode.SHIP_STATIONS;
    const stations: BaseStation[] = [
      {
        x: S.nav.x, z: S.nav.z, rx: S.nav.rx, rz: S.nav.rz, label: S.nav.label,
        cb: () => this.openNavChoice(),
      },
      {
        x: S.craft.x, z: S.craft.z, rx: S.craft.rx, rz: S.craft.rz, label: S.craft.label,
        cb: () => { void this.openShipCrafting(); },
      },
      {
        x: S.exit.x, z: S.exit.z, rx: S.exit.rx, rz: S.exit.rz, label: S.exit.label,
        cb: () => this.exitShipInterior(),
      },
    ];
    const pads = [
      { x: S.nav.x, z: S.nav.z, color: S.nav.color, radius: S.nav.pad, label: S.nav.label },
      { x: S.craft.x, z: S.craft.z, color: S.craft.color, radius: S.craft.pad, label: S.craft.label },
      { x: S.exit.x, z: S.exit.z, color: S.exit.color, radius: S.exit.pad, label: S.exit.label },
    ];
    const fixed = this.eventSystem.fixedEvents('ship');
    stations.push(...fixed.map((f) => ({
      x: f.x, z: f.z, rx: 2.4, rz: 2.0,
      label: this.eventSystem.label(f.event),
      cb: () => {
        if (this.dialogue.start(f.event.dialogue, { eventId: f.event.id })) {
          this.player.controlLocked = true;
          eventBus.emit('dialogue', { id: f.event.dialogue });
        }
      },
    })));
    const quads = fixed.map((f) => ({ x: f.x, z: f.z, assetUrl: f.event.npc.portrait }));
    // ★ 已到舰访客：固定站位（按到舰顺序分配）；F 交谈 → 谈完离舰（onEnd 收尾）。
    //   有程序化身体的走 3D 身体（脸=各自纹理）；没有的退回贴片立绘。
    const bodies: {
      x: number; z: number;
      asset?: FrameAssetSource | null;
      style?: VisitorBodyStyle;
      model?: VisitorModelStyle;
    }[] = [];
    const insiders = this.visitorManager?.insiders ?? [];
    let bodyIdx = 0; // 身体索引（仅身体型访客递增；交互站跟随它走动）
    insiders.forEach((v, i) => {
      const a = WorldMode.VISITOR_ANCHORS[i % WorldMode.VISITOR_ANCHORS.length];
      const style = v.def.body;
      const model = v.def.model;
      const hasBody = !!style || !!model;
      stations.push({
        x: a.x, z: a.z, rx: 2.4, rz: 2.0,
        label: '交谈',
        followBodyIndex: hasBody ? bodyIdx : undefined,
        cb: () => {
          if (this.dialogue!.start(v.visitDialogue)) {
            this.pendingVisitor = v;
            this.player.controlLocked = true;
            eventBus.emit('dialogue', { id: v.visitDialogue });
          }
        },
      });
      if (hasBody) {
        bodies.push({ x: a.x, z: a.z, asset: v.anim?.source ?? null, style, model });
        bodyIdx++;
      } else {
        quads.push({ x: a.x, z: a.z, assetUrl: v.def.assetUrl });
      }
    });
    interior.setEventStations(stations);
    interior.setEventNpcs(quads);
    interior.setEventBodies(bodies);
    interior.setStationPads(pads); // ★ 功能站地面光圈（玩家看得见走到哪能按键）
  }

  // ============================================================
  // ★ 环境音效（2026-09-17 用户点题：地上走 / 在水里 / 走过草丛 / 击中草丛）
  //   曲目表 src/config/sfx.ts；三条触发线：
  //     脚步 + 拨草 → updateAmbientSfx（本文件）
  //     入水/涉水   → WaterFx.entry/wade（复用水面泛波节拍）
  //     击草       → updatePlantGustSweep（plantGustAt 冷却通过才算一次）
  // ============================================================

  /** 累计水平位移（米）；达到 STEP_DISTANCE 播一步（跑得快 → 步频自然高） */
  private stepAccum = 0;
  /** 上一帧玩家坐标（算位移用） */
  private stepLastX = 0;
  private stepLastZ = 0;
  /** 草丛检测节拍累计（秒；不是每帧查——附近植被查询有开销） */
  private grassCheckAccum = 0;

  /**
   * ★ 环境音效每帧推进（仅探索期）：脚步按位移触发，草丛按 0.2s 节拍查询。
   *   水里那两条不在这里（WaterFx 已经算好了入水/泛波节拍）。
   */
  private updateAmbientSfx(dt: number): void {
    const pl = this.player;
    if (!pl || pl.dead || pl.controlLocked) return;
    const p = pl.position;
    const dx = p.x - this.stepLastX;
    const dz = p.z - this.stepLastZ;
    this.stepLastX = p.x;
    this.stepLastZ = p.z;
    const dist = Math.hypot(dx, dz);
    const speed = dt > 1e-3 ? dist / dt : 0;
    if (speed > 0.4) {
      // ---- 脚步：每走 STEP_DISTANCE 米一步 ----
      this.stepAccum += dist;
      if (this.stepAccum >= WorldMode.STEP_DISTANCE) {
        this.stepAccum = 0;
        this.playFootstep(p.x, p.z);
      }
      // ---- 拨草：脚下 1.3m 内有植被 → 沙沙声（550ms 节流防糊成一片） ----
      this.grassCheckAccum += dt;
      if (this.grassCheckAccum >= 0.2) {
        this.grassCheckAccum = 0;
        let near = false;
        this.chunks.forEachCollectibleNear(p.x, p.z, 1.3, () => { near = true; });
        if (near) playSfx('grassBrush', 550);
      }
    } else {
      this.grassCheckAccum = 0;
      // 站着别积压距离（否则一动就连响好几步）
      this.stepAccum = Math.min(this.stepAccum, WorldMode.STEP_DISTANCE * 0.6);
    }
  }

  /** ★ 单步脚步音：按脚下地块 + 附近植被选音色（水/坑不响，交给涉水音） */
  private playFootstep(x: number, z: number): void {
    const td = this.raster.tileDefAt(x, z);
    if (td.genRole === 'liquid' || td.genRole === 'pit') return;
    if (td.genRole === 'platform') { playSfx('stepStone', 120); return; }
    let hasGrass = false;
    this.chunks.forEachCollectibleNear(x, z, 1.6, () => { hasGrass = true; });
    playSfx(hasGrass ? 'stepGrass' : 'stepDirt', 120);
  }

  /**
   * ★★ 阶段切换**唯一入口**（2026-09-18 收口）：所有与 phase 绑定的副作用都在这里，
   *   调用方只管"要切到哪个阶段"。
   *
   *   为什么必须有这个：在此之前 5 个赋值点各写一遍（BGM / 环境 / 飞行模式 /
   *   昼夜冻结 / 水面 / 粗块 / 涉水轨），**每新增一条不变量就要补 5 处**，
   *   漏一处就是一段时间状态不对（syncSceneBgm 曾因此散落 10 处调用）。
   *
   *   不变量一览（phase → 副作用）：
   *   | phase    | 环境   | flightMode | 昼夜冻结 | 水面 | 粗块 | 涉水轨 |
   *   |----------|--------|------------|----------|------|------|--------|
   *   | sail     | world  | true       | false    | 隐藏 | true | 停     |
   *   | explore  | world  | false      | false    | 显示 | false| 由 update 裁决 |
   *   | interior | ship   | true       | **true** | 隐藏 | 保持 | **停** |
   *
   *   ★ 与 `shipDestroyed` 的冻结互不冲突：那条不是 phase 变化，单独维护。
   */
  private setPhase(next: 'sail' | 'explore' | 'interior'): void {
    this.phase = next;
    if (next !== 'explore') this.deployPreview?.hide();
    const env: 'ship' | 'world' = next === 'interior' ? 'ship' : 'world';
    if (env !== this.envKind) {
      this.envKind = env;
      renderManager.setEnvironment(env);   // 内部会重置云场 → 只在真的切换时调
    }
    renderManager.setFlightMode(next !== 'explore');
    renderManager.setClockPaused(next === 'interior');
    if (next !== 'interior') {
      this.chunks.setWaterVisible(next === 'explore');
      this.chunks.setCoarseMode(next === 'sail');
    }
    // ★ 舰内时 update 直接 return，涉水轨不会被裁决 → 必须在这里显式停
    if (next === 'interior') this.waterFx?.stopWade();
    this.syncSceneBgm();
  }

  /**
   * ★ 场景音：只在「船内」放音乐，野外放低音量环境音（用户定调 2026-09-17）。
   *   interior（舰内舱）→ 舰船曲《生命流》
   *   explore（下机到野外）→ 环境音循环底噪（微风；不是音乐，不违背"出去不放 BGM"）
   *   sail（驾驶舰船航行）→ 静音（航行段也算「在外面」：出击进图第一件事就是停音乐）
   *   基地曲不在这里：由 main.enterBaseMode 下发。
   */
  private syncSceneBgm(): void {
    // ★ 引擎循环音（独立通道，与 BGM 互不打断）：只有航行段响，落地/进舱淡出
    //   ★ 只停引擎轨——无参 stopLoopSfx() 会连涉水轨一起停（涉水轨在 explore 段由
    //     updateWadeLoop 每帧重起，被误停会出现一瞬断音）
    if (this.phase === 'sail') playLoopSfx('shipEngine');
    else stopLoopSfx('shipEngine');
    // ① 航行段永远静音（用户定调：在外面飞就不放音乐），优先级最高
    if (this.phase === 'sail') { stopBgm(); return; }
    // ② 敌人大举入侵（近舰敌军持续超标）→ 战斗曲（WebAdapter 换曲 = 旧轨淡出 + 新轨淡入）
    if (this.spawner.warnShown) { playBgm('battle'); return; }
    // ③ 常态
    if (this.phase === 'interior') playBgm('ship');
    else playBgm('ambient'); // explore
  }

  /** 进入舰内房间（E 调用：仅探索期落地后、靠近舰船；返回是否进入） */
  private enterShipInterior(): boolean {
    if (!this.ship || !this.scene || !this.camera || !this.renderer) return false;
    if (this.phase !== 'explore' || this.shipInterior) return false;
    this.camBlend = null; // ★ 进舰取消在途镜头过渡（房间 setupCamera 直接接管）
    if (this.shipDestroyed) return false;
    const sp = this.ship.position;
    const p = this.player.position;
    const d2 = (p.x - sp.x) ** 2 + (p.z - sp.z) ** 2;
    if (d2 > WorldMode.REBOARD_RADIUS ** 2) return false;
    if (!this.protagonistAssetRef) return false;

    let interior: BaseScene;
    try {
    const shipRoom = (baseRoomsJson as unknown as { shipRoom: import('../ui/base/BaseScene').RoomDef }).shipRoom;
    // ★ 独立场景：舰内只画自己（世界粗块/地形/天空/雾全部不参与）
    this.interiorScene = new THREE.Scene();
    this.interiorScene.background = new THREE.Color(0x0b1016);   // 舰内保持灰底（用户定调）
    interior = new BaseScene(this.interiorScene, {
      rooms: [shipRoom],
      protagonistAsset: this.protagonistAssetRef,
      droneAsset: this.droneAsset ?? undefined,
      itemManager: this.itemManager,
      renderer: this.renderer,
    });
    interior.setupCamera(this.camera);
    interior.setUiBlocking(() => this.dialogue?.isActive
      || (this.worldUIManager?.hasModalOpen ?? false)
      || (this.craftingOverlay?.isOpen() ?? false));       // ★ 加工台打开时也要收提示（2026-09-16 修）
    } catch (err) {
      console.error('[interior] 创建失败:', err);
      return false;
    }
    this.shipInterior = interior;
    // ★ 进舱：船内环境 / 舰船 BGM / 昼夜冻结 / 关云月亮离屏 / 停涉水轨 —— 全在 setPhase 里
    this.setPhase('interior');
    // ★ 舰内屏幕叠加（暗角）；随舰内房间一起创建 / 销毁
    this.interiorFx = new RoomPostFx();
    this.player.controlLocked = true;
    this.player.visible = false;
    this.worldUIManager?.setCombatHudVisible(false);
    this.worldUIManager?.setMinimapVisible(false);
    this.worldUIManager?.setDockButtonVisible(false);
    this.worldUIManager?.setBoardPrompt(false);
    this.worldUIManager?.closePanel('map-panel');
    this.worldUIManager?.setAssaultBanner('舰内 · 驾驶舱', false);
    this.worldUIManager?.clearVisitorNotice(); // 已回舰：到访提示谢幕（人在房间里了）
    // （环境切换 / 飞行模式 / 昼夜冻结 / 涉水轨 / 水面 已由 setPhase('interior') 统一处理：
    //   舰内要关天空/云/月亮/水的离屏 pass，否则离屏 RT 与主渲染形成 feedback loop）
    // ★ 舰内操作全部事件触发式（2026-09-16 用户定调：加工台/下船/起飞/返回罗德岛号
    //   都做成走到指定区域按键触发，不再有按钮条）。
    //   ★ 按键：舱内**只用 F**（用户定调 2026-09-16）——E 是"进舱"的键，
    //     如果舱内也认 E，落地的同一次按键会连带触发舱内最近的站点。
    interior.setPromptKey('f');
    this.applyShipInteriorEvents(interior);
    return true;
  }

  /** ★ 舰内三个**固定交互站**（2026-09-16 用户定调：全部事件触发式，
   *   走到地面光圈里按 E，不再有 DOM 按钮条）。
   *   ★ 起飞 与 返回罗德岛号 **合成一件事的两个选项**（航行终端面板二选一）。
   *   坐标是驾驶舱房间本地坐标（单间 x∈[-12.6,12.6]，z∈[-8.1,7.8]），
   *   与 RoomDecor.decorateCockpit 里摆的实体座子一一对应（导航台 / 工作台 / 舱门）。 */
  private static readonly SHIP_STATIONS = {
    nav:   { x: 9.8,  z: 5.6, rx: 3.2, rz: 2.6, pad: 3.0, color: 0xffb765, label: '航行终端' },
    craft: { x: -9.8, z: 5.6, rx: 3.2, rz: 2.6, pad: 3.0, color: 0x7ce0c8, label: '加工台' },
    exit:  { x: 0,    z: 7.2, rx: 3.4, rz: 2.0, pad: 2.8, color: 0x8fd0ff, label: '下船' },
  } as const;

  /** ★ 航行终端：起飞 / 返回罗德岛号 —— 一件事的两个选项。
   *  返航代价高（结束本次出击）→ 选中后仍走一次二次确认。 */
  private openNavChoice(): void {
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;padding:22px 36px;color:#eaf6ff;text-align:center;';
    const title = document.createElement('div');
    title.textContent = '航行模式已就绪';
    title.style.cssText = 'font-size:19px;font-weight:bold;color:#ffc98a;letter-spacing:2px;';
    const sub = document.createElement('div');
    sub.textContent = '舰船已加注完毕，请选择接下来的行动。';
    sub.style.cssText = 'color:#a8c4e0;font-size:14px;line-height:1.7;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;justify-content:center;';

    const takeoff = createButton({
      label: '起飞', style: 'primary', size: 'lg',
      onClick: () => {
        this.worldUIManager?.closePanel('interior-nav');
        this.exitShipInterior();
        this.tryBoardShip();
      },
    });
    const back = createButton({
      label: '返回罗德岛号', style: 'secondary', size: 'lg',
      onClick: () => {
        this.worldUIManager?.closePanel('interior-nav');
        this.openReturnConfirm();
      },
    });
    // ★ 不提供"取消"：面板自带关闭（右上角 / ESC），用户定调去掉这个按钮
    row.append(takeoff, back);
    content.append(title, sub, row);
    this.worldUIManager?.openPanel({
      id: 'interior-nav',
      title: '航行终端',
      render: () => content,
      onClose: () => {},
    });
  }

  /** ★ 返回罗德岛号确认面板（舰内按钮触发；确认后才出舱返航） */
  private openReturnConfirm(): void {
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:14px;padding:22px 36px;color:#eaf6ff;font-size:14px;text-align:center;';
    const title = document.createElement('div');
    title.textContent = '返回罗德岛号？';
    title.style.cssText = 'font-size:19px;font-weight:bold;color:#8ac8ff;letter-spacing:2px;';
    const body = document.createElement('div');
    body.textContent = '将立即结束本次出击，启程返回罗德岛号（本日战斗进度不会保留）。';
    body.style.cssText = 'color:#a8c4e0;line-height:1.7;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:14px;';
    const cancel = createButton({
      label: '取消', style: 'secondary', size: 'md',
      onClick: () => this.worldUIManager?.closePanel('interior-return'),
    });
    const confirm = createButton({
      label: '确认返航', style: 'danger', size: 'md',
      onClick: () => {
        this.worldUIManager?.closePanel('interior-return');
        this.exitShipInterior();
        this.onReturn?.();
      },
    });
    row.append(cancel, confirm);
    content.append(title, body, row);
    this.worldUIManager?.openPanel({
      id: 'interior-return',
      title: '返回罗德岛号',
      render: () => content,
      onClose: () => {},
    });
  }

  /** ★ 舰内加工台（懒建覆盖层；与基地加工台同一实现） */
  private async openShipCrafting(): Promise<void> {
    if (!this.craftingManager || !this.itemManager || !this.iconRegistry) return;
    if (!this.craftingOverlay) {
      this.craftingOverlay = new CraftingOverlay(this.craftingManager, this.itemManager, this.iconRegistry);
    }
    // ★ 等背景/模块素材加载完再开页，否则首次打开加工模块没有背景（2026-09-16 修复）
    await this.craftingOverlay.load().catch((err) => console.error('[interior] 加工台加载失败:', err));
    this.craftingOverlay.show('ship');
  }

  /** 离开舰内房间（按来源恢复：探索=回地面 / 航行=回驾驶；相机瞬移防长镜头） */
  private exitShipInterior(): void {
    if (!this.shipInterior) return;
    this.craftingOverlay?.hide();
    this.worldUIManager?.closePanel('interior-return');
    this.shipInterior.dispose();
    this.shipInterior = null;
    this.interiorFx?.dispose();
    this.interiorFx = null;
    this.interiorScene = null; // 场景随房间一并废弃（下次重建）
    this.worldUIManager?.setAssaultBanner(null);
    // 回地面：露天环境 / 静音 / 昼夜解冻 / 水面恢复 / 细化 LOD —— 全在 setPhase 里
    this.setPhase('explore');
    // ★ 舰内换装落地：出舱时与世界侧对齐（友军增删换 + 角色贴片立即重挂）
    this.syncSlotAllies();
    this.combatItems?.syncLoadout();
    this.player.controlLocked = false;
    this.player.visible = true;
    this.worldUIManager?.setCombatHudVisible(true);
    this.worldUIManager?.setMinimapVisible(true); // ★ 修复：舰内隐藏的小地图出舱恢复（否则一去不回）
    this.worldUIManager?.setDockButtonVisible(false);
    const p = this.player.position;
    this.cameraCtrl?.snapTo(p.x, p.y, p.z);
  }

  /** ★ 登船起飞（探索期靠近舰船按 F；2026-09-12 用户定调：舰船当实体载具）：
   *  收起友军 → 回航行阶段（起飞爬升段 + 追尾相机 + 航行极简帧），可继续飞行。 */
  private tryBoardShip(): boolean {
    if (!this.ship || !this.session || this.camBlend) return false;
    const p = this.player.position;
    const s = this.ship.position;
    const dx = p.x - s.x, dz = p.z - s.z;
    if (dx * dx + dz * dz > WorldMode.REBOARD_RADIUS ** 2) return false;
    allySystem.disposeAll();
    this.takeoff = true;
    this.ship.beginTakeoff();
    this.setPhase('sail');        // ★ 登船起飞：静音 + 粗块 LOD + 藏水面 + 飞行模式（统一收口）
    this.player.controlLocked = true;
    this.worldUIManager.setCombatHudVisible(false);
    this.worldUIManager.setDockButtonVisible(true);
    this.showFloatingAt(s.x, s.y + 2.5, s.z, '起飞', 'heal');

    // ★ 镜头调度（上机）：角色第三人称 → 追尾机位（目标每帧跟随舰船爬升）
    const cam = this.camera;
    if (cam) {
      const follow = (): void => {
        if (!this.ship || !this.camBlend) return;
        const sp = this.ship.position;
        const f = this.ship.forward;
        const dist = travelConfig.flightCamDist;
        const tx = sp.x - f.x * dist;
        const ty = sp.y - f.y * dist + travelConfig.flightCamUp;
        const tz = sp.z - f.z * dist;
        this.camBlend.toPos.set(tx, ty, tz);
        _camMat.lookAt(
          _camEye.set(tx, ty, tz),
          _camAt.set(sp.x + f.x * 8, sp.y + f.y * 8 + 1.2, sp.z + f.z * 8),
          _camUp,
        );
        this.camBlend.toQuat.setFromRotationMatrix(_camMat);
      };
      this.camBlend = {
        t: 0, dur: WorldMode.CAM_BLEND_UP,
        fromPos: cam.position.clone(),
        fromQuat: cam.quaternion.clone(),
        toPos: new THREE.Vector3(),
        toQuat: new THREE.Quaternion(),
        pivot: null, // 上机：直线（机位相邻，无需弧线）
        follow,
        onDone: () => { this.flightCamInit = true; }, // 交还追尾相机（位置已一致 → 无跳变）
      };
      follow();
    } else {
      this.flightCamInit = false;
    }
    return true;
  }

  /** ★ 舰船复活（结算页按钮）：回满血满油，恢复探索 */
  private reviveShip(): void {
    if (!this.session || !this.ship) return;
    reviveShip(this.session);
    this.ship.hp = this.session.ship.hp;
    this.shipDestroyed = false;
    renderManager.setClockPaused(false); // ★ 复活后世界恢复 → 昼夜解冻
    this.shipStatusAccum = 1; // 下一帧立刻刷新 HUD
  }

  /** ★ 祖宗远程射击：友军弹道（复用子弹管线；数值集中此处便于调平衡） */
  /** ★ 祖宗激光命中结算（红色激光是瞬时 hitscan；光束特效由祖宗实体播放） */
  private fireSentinelShot(from: AllyBase, target: EntityBase): void {
    const dmg = Math.max(SENTINEL_MIN_DAMAGE, Math.round(queryFinalStats(this.player).attackPower * SENTINEL_ATK_RATIO));
    applyDamage(dmg, from, target, { hitPoint: from.position }); // 事件统一在 applyDamage
    // ★ 眩晕（2026-09-14 用户定调）：激光命中 → 眩晕 1s；眩晕结束后 2s 免疫（防锁死）
    if (target instanceof EnemyBase && target.hp > 0 && target.applyStun()) {
      this.showFloatingAt(target.position.x, target.position.y + 2.2, target.position.z, '眩晕', 'normal');
    }
  }

  /**
   * ★ 祖宗激光打**代理层**（远处敌人没有实体，只有代理 —— 见 updateStationaryAI ②）。
   *   伤害口径与 fireSentinelShot 完全一致（同攻击力系数、同下限），
   *   但结算走 swarm.damageAgent（防御减法 + 取整，与实体伤害管线同口径）。
   *   ★ 不施加眩晕：代理层没有 stun 状态，避免"打远处反而更强/更弱"的口径分裂。
   */
  private fireSentinelShotAtAgent(idx: number): void {
    if (!this.swarm.agentAlive(idx)) return;
    const dmg = Math.max(SENTINEL_MIN_DAMAGE, Math.round(queryFinalStats(this.player).attackPower * SENTINEL_ATK_RATIO));
    this.swarm.damageAgent(idx, dmg);
  }

  /** ★ 祖宗自动挖矿（无敌人时）：随机在 铁（耗尽原石晶体）/ 水 / 地面 三类中找点，
   *  播激光 → 复用命中解析层掉落（只出资源，不挖坑/不改地形） */
  private sentinelMine(from: AllyBase): void {
    if (!this.itemManager || !this.worldUIManager) return;
    const p = from.position;
    const pt = this.pickMinePoint(p.x, p.z);
    if (!pt) return;
    from.playBeam();
    const y = this.raster.surfaceHeightAt(pt.x, pt.z);
    const impact = this.chunks.resolveImpact(pt.x, y, pt.z);
    this.spawnItemDrops(impact);      // 掉落：铁/水/地面 → 异铁/酮凝集/固原岩
    if (impact.water !== 'none') this.waterFx.agitateNear(pt.x, pt.z);
  }

  /** ★ 挖矿选点：三类随机优先（1/3 概率），采样不中回退其它两类；全无 → null */
  private pickMinePoint(x: number, z: number): { x: number; z: number } | null {
    const kinds = ['iron', 'water', 'ground'] as const;
    const first = kinds[(Math.random() * kinds.length) | 0];
    for (const kind of [first, ...kinds.filter((k) => k !== first)]) {
      const pt = this.sampleMinePoint(x, z, kind);
      if (pt) return pt;
    }
    return null;
  }

  /** 单类采样：环带（3m~射程）+ 随机角度丢点，命中该类地形/装饰即可 */
  private sampleMinePoint(x: number, z: number, kind: 'iron' | 'water' | 'ground'): { x: number; z: number } | null {
    const inner = 3;
    const span = Math.max(0, SENTINEL_MINE_RANGE - inner);
    for (let i = 0; i < SENTINEL_MINE_SAMPLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = inner + Math.random() * span;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      if (kind === 'iron') {
        // 铁 = 耗尽原石晶体装饰物（直接瞄准晶体本体）
        const prop = this.chunks.queryPropsNear(px, pz, 3.0, 'depleted_crystal');
        if (prop) return { x: prop.x, z: prop.z };
        continue;
      }
      const role = this.raster.tileDefAt(px, pz).genRole;
      if (kind === 'water') {
        if (role === 'liquid') return { x: px, z: pz };
      } else if (role === 'ground' || role === 'platform') {
        return { x: px, z: pz };
      }
    }
    return null;
  }

  /** ★ 回收指定槽位友军（槽位被卸载/替换/损毁）：销毁对应无人机（池固定 12 格，索引不移位）。
   *  装备类槽位无对应实体，安全 no-op。 */
  /** 世界坐标 → 屏幕浮动文字（距相机 >20m 不显示，与伤害数字同 LOD 口径） */
  private showFloatingAt(x: number, y: number, z: number, text: string, type: 'normal' | 'crit' | 'heal' | 'miss' | 'pickup'): void {
    if (!this.camera || !this.worldUIManager) return;
    const cam = this.camera.position;
    const dx = x - cam.x, dz = z - cam.z;
    if (dx * dx + dz * dz > 20 * 20) return;
    const v = new THREE.Vector3(x, y + 1.0, z).project(this.camera);
    this.worldUIManager.showFloatingText(
      (v.x * 0.5 + 0.5) * window.innerWidth,
      (-v.y * 0.5 + 0.5) * window.innerHeight - 30,
      text, type,
    );
  }

  /** ★ 载具贴地（逻各斯的圆凳）：过坑——脚下取邻域最高面桥接（不沉坑、不判死）+ 快速爬坡 */
  private clampVehicle(dt: number): void {
    const p = this.player.position;
    const r = VEHICLE_BRIDGE_RADIUS;
    const targetY = Math.max(
      this.raster.surfaceHeightAtFor(p.x, p.z, p.y),
      this.raster.surfaceHeightAtFor(p.x + r, p.z, p.y),
      this.raster.surfaceHeightAtFor(p.x - r, p.z, p.y),
      this.raster.surfaceHeightAtFor(p.x, p.z + r, p.y),
      this.raster.surfaceHeightAtFor(p.x, p.z - r, p.y),
    );
    const dy = targetY - p.y;
    p.y += dy > 0 ? Math.min(dy, VEHICLE_CLIMB_SPEED * dt) : Math.max(dy, -30 * dt);
  }

}
