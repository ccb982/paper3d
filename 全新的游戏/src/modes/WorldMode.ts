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
import { FtxAsset } from '../vendor/player/FtxAsset';
import { CombatItemController } from '../systems/itemPlayback/CombatItemController';
import { allyPlaybackRegistry } from '../systems/itemPlayback/AllyPlayback';
import type { Asset } from '../vendor/player';
import type { FluidEffect } from '../vendor/player/fluid/FluidEffect';
import { compositeFrameToCanvas } from '../services/item/BasicMaterialsIcons';
import { SentinelProjectile } from '../services/fx/SentinelProjectile';
import { stepFluidShared } from '../services/fx/FluidShared';
import { CharacterBase } from '../entity/CharacterBase';
import { EntityManager } from '../entity/EntityManager';
import type { EntityBase } from '../entity/EntityBase';
import { Player } from '../entity/Player';
import { ShipEntity, SHIP_LANDED_HEIGHT } from '../entity/ShipEntity';
import { resolveDockSpawn } from '../services/ship/DockResolver';
import { applyShipDamage, isShipDestroyed, reviveShip } from '../systems/ship/ShipState';
import travelConfig from '../config/travel.json';
import { EnemyBase } from '../entity/EnemyBase';
import { DroneEntity } from '../entity/DroneEntity';
import { droneFollowOffset } from '../services/fx/DroneFormation';
import { CameraController } from '../services/camera/CameraController';
import { renderManager } from '../services/render/RenderManager';
import { PhysicsWorld } from '../services/physics/PhysicsWorld';
import { DesktopBinding } from '../platform/input/DesktopBinding';
import { RasterMap, chunkKeyOf } from '../services/map/RasterMap';
import { CHUNK_SIZE } from '../services/map/ChunkGenerator';
import { ChunkManager, type ImpactReport } from '../services/map/ChunkManager';
import { resolveTileLook } from '../services/map/TileMaterials';
import { LOD_MAX_DIST } from '../services/lod';
import type { ChunkGroundHost } from '../services/map/decor/MapEntityDecorBase';
import { aiSystem } from '../systems/ai/AISystem';
import type { BehaviorContext } from '../systems/ai/behaviors';
import { ROCK_BUG_AI, REUNION_AI, LAOJIE_AI } from '../systems/ai/aiconfig';
import type { AIConfig } from '../systems/ai/aiconfig';
import { ItemBase } from '../entity/ItemBase';
import { ItemArchetype } from '../core/ItemArchetype';
import { createSolidBulletAsset } from '../services/fx/SolidBulletAsset';
import { CharacterFxManager } from '../services/fx/CharacterFxManager';
import { aimRaycast } from '../services/combat/Targeting';
import { BulletManager, type BulletHitPayload } from '../services/combat/BulletManager';
import { applyDamage } from '../services/combat/DamagePipeline';
import { effectSystem } from '../services/combat/EffectSystem';
import { queryFinalStats } from '../services/combat/FinalStats';
import { eventBus } from '../core/EventBus';
import { computeRelicModifiers } from '../core/Session';
import type { AmmoEntryView } from '../services/ui/AmmoPanel';
import { RELIC_ITEM_CONFIG } from '../config/relics';
import { relicGrantsFor, dispatchRelicEvent } from '../core/RelicEffects';
import { addStaticObstacle, removeStaticObstacle } from '../services/physics/StaticObstacleRegistry';
import { sharedWaterMaterial } from '../services/map/WaterMaterial';
import { CombatDirector } from '../services/combat/CombatDirector';
import { executeAttack } from '../services/combat/Attack';
import { ItemManager } from '../systems/inventory/ItemManager';
import { CraftingManager } from '../systems/inventory/CraftingManager';
import { InteractionManager } from '../systems/interaction/InteractionManager';
import { WorldUIManager } from '../ui/world/WorldUIManager';
import { PickupGlowEffect } from '../services/fx/PickupGlowEffect';
import { rollDrops } from '../services/item/ItemDropPipeline';

/** ★ 友军物品 id：部署生成 / 损毁替换为残骸（维修配方在舰船加工台） */
const DRONE_ITEM = 'kaltsit_drone';
const DRONE_BROKEN_ITEM = 'kaltsit_drone_broken';
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
/** ★ 可发射弹药 itemId（背包中有该类型即可在弹药栏切换；开火消耗 1） */
const FIREABLE_AMMO = new Set<string>(['zuzong']);
/** ★ 祖宗吸仇恨半径（米）：敌人与祖宗在此范围内时，索敌优先级压过玩家 */
const SENTINEL_TAUNT_RADIUS = 40;
/** ★ 祖宗弹（专属投影物）：速度（m/s）/ 寿命（s） */
const SENTINEL_SHOT_SPEED = 20;
const SENTINEL_SHOT_LIFETIME = 3.0;
/** ★ 祖宗弹命中伤害 = max(下限, 主角攻击力 × 系数)，结算后立即落地生成祖宗 */
const SENTINEL_IMPACT_MIN_DAMAGE = 8;
const SENTINEL_IMPACT_ATK_RATIO = 0.8;
/** ★ 祖宗弹伤害 = max(下限, 主角攻击力 × 系数)（与无人机同口径：友军随主角强度） */
const SENTINEL_MIN_DAMAGE = 8;
const SENTINEL_ATK_RATIO = 1.0;
/** ★ 祖宗自动挖矿：索矿半径（米；无敌人时随机打铁/水/地面） */
const SENTINEL_MINE_RANGE = 22;
/** 挖矿采样次数上限（每类） */
const SENTINEL_MINE_SAMPLES = 16;
/** ★ 治疗转伤害（遥·幽隙栖萤）：累计治疗量 ≥ 该值才触发一次（避免每帧 1 点伤害刷屏/暴涨） */
const HEAL_PROC_MIN_HEAL = 1.0;
/** ★ 复活倒计时阶梯（按"当天出击内"累计死亡次数分档；每天出击重置）：
 *   1 死瞬间复活 → 2~10 死 5s → 11~20 死 10s → 21~30 死 20s → 31 死起 30s 封顶 */
const PLAYER_RESPAWN_TIERS: { minDeaths: number; delay: number }[] = [
  { minDeaths: 1, delay: 0 },
  { minDeaths: 2, delay: 5 },
  { minDeaths: 11, delay: 10 },
  { minDeaths: 21, delay: 20 },
  { minDeaths: 31, delay: 30 },
];
/** ★ 复活血量保底 = 最大血量 × 该比例（死前一半更低时取保底） */
const PLAYER_RESPAWN_FLOOR_HP_RATIO = 0.1;

// ============================================================
// WorldMode 进入上下文（扩展 IGameModeContext）
// ============================================================

export interface WorldModeEnterContext extends IGameModeContext {
  day: number;
  protagonistAsset: FtxAsset;
  bulletAsset?: Asset | FtxAsset;
  /** ★ 三个杂兵素材（纯纹理包；地图大量随机生成用） */
  enemyAssets?: FtxAsset[];
  hitEffectAsset?: Asset;
  /** ★ 可露希尔的无人机素材（特效包优先，回退纯纹理包） */
  droneAsset?: Asset | FtxAsset;
  /** ★ 祖宗素材（站桩友军；缺省回退无人机素材） */
  sentinelAsset?: Asset | FtxAsset;
  /** ★ 调试开关（main.ts 从 URL 参数解析；素材填充测试用） */
  debug?: { testChunk?: boolean };
}

/** ★ 杂兵配置条目（素材 + AI + 属性 + 体型 + 集群；生成时随机取一条） */
interface MobDef {
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
}

// ============================================================
// WorldMode 类
// ============================================================

/** ★ 每帧性能细分（毫秒；main.ts 的 FPS HUD 读取，定位更新耗时分布） */
export const worldPerf = {
  chunks: 0, ui: 0, combat: 0, ai: 0, entity: 0, post: 0, phys: 0, total: 0,
  drones: 0, ent: 0, water: 0, clamp: 0,
  nEnemies: 0, nDrones: 0, nEntities: 0, nBases: 0,
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
const _camQuat = new THREE.Quaternion();
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
  /** ★ 阶段：sail = 操控舰船航行（耗油/选停靠）；explore = 控制角色探索 */
  private phase: 'sail' | 'explore' = 'sail';
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

  /** ★ 杂兵配置条目（由 enemyAssets 派生：素材+AI+HP+体型；生成时随机取一条） */
  private mobDefs: MobDef[] = [];
  /** ★ 已生成过的 chunk key（每 chunk 一波，不重复生成） */
  private spawnedChunks = new Set<number>();
  /** ★ 敌人实例 → 其 MobDef（击杀掉落结算用；WeakMap 不阻回收） */
  private enemyDefs = new WeakMap<EnemyBase, MobDef>();
  /** ★ 出生 chunk key（玩家安全区：自己不刷怪；敌人从他处生成） */
  private spawnChunkKey = -1;
  /** ★ 波次节奏（秒）：距下次"LOD 外环"刷怪的倒计时 */
  private respawnTimer = 0;
  /** ★ 全图杂兵上限（2026-09-12 用户定调：60 → 50——总量控住，靠快刷快清维持密度） */
  private static readonly MAX_ENEMIES = 50;
  /** ★ 敌人远距回收半径（米，2026-09-12 用户定调【狠狠缩小】260 → 120）：
   *  只留"可视 LOD 90m 外一点点"的缓冲——90m 外本就看不见，超过 120m 即清，
   *  不许"看不见还活着"；刷怪点同样被约束在回收环内（见 spawnAtRandomPointInChunk） */
  private static readonly ENEMY_CULL_RADIUS = 120;
  /** ★ 远距回收节拍（2026-09-12 用户定调：1s → 0.25s：销毁速度加快，超环即清） */
  private static readonly ENEMY_CULL_INTERVAL = 0.25;
  private cullAccum = 0;

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

  // ★ 战斗道具播放（弹药池 + 装备贴片）
  private combatItems!: CombatItemController;
  /** ★ 穿戴同步节拍（战斗中使用装备道具 → 贴片 0.5s 内刷新） */
  private syncLoadoutAccum = 0;

  // ★ UI 层（世界专属）
  private worldUIManager!: WorldUIManager;

  private bullets!: BulletManager;
  private bulletCooldown = 0;
  // （chunk 流式构建已下沉 services/map/ChunkManager；材质为每 chunk 独立 Canvas 外观）
  private aiCtx: BehaviorContext = {
    dt: 0, time: 0, target: null,
    findTarget: () => null,
    attack: () => undefined,
  };
  // ★ 调试：出生点临时改到侧壁缺口报告位（seed 12345, chunk(0,1)）
  private readonly spawnPoint = { x: 50.6, z: 101.6 };
  private acc = 0;
  private damageUnsub?: () => void;
  /** ★ killed 事件订阅：杂兵死亡 → 从 enemies 列表移除 */
  private killedUnsub?: () => void;
  private pickupGlows: PickupGlowEffect[] = [];
  /** ★ 可露希尔的无人机编队（可多架悬浮体；使用道具追加，退出时销毁） */
  private drones: DroneEntity[] = [];
  /** ★ 无人机素材（特效包/纯纹理包；enter 存入上下文引用） */
  private droneAsset: Asset | FtxAsset | null = null;
  /** ★ 祖宗素材（站桩友军；缺省回退无人机素材，美术到位后只换路径） */
  private sentinelAsset: Asset | FtxAsset | null = null;
  /** ★ 遗物复活时间倍率（computeRelicModifiers 汇总；复活倒计时结算用） */
  private relicRespawnMul = 1;
  /** ★ 当前选择的快捷物品（'default' = 普通弹药；其余 = 弹药/消耗品 itemId）
   *  Q 切换 / 点击切换；弹药由攻击键发射，消耗品由 F 使用 */
  private selectedQuickItem = 'default';
  /** ★ 祖宗弹投影物（专属纹理/朝向；落地或寿命到 → 生成站桩祖宗） */
  private sentinelShots: {
    proj: SentinelProjectile;
    /** 落地是否生成祖宗（玩家祖宗弹 true；祖宗自身攻击弹 false） */
    spawnOnLand: boolean;
    /** 命中伤害（<0 = 玩家祖宗弹：用 SENTINEL_IMPACT_* 公式现场结算） */
    damage: number;
    /** 伤害来源（伤害事件/遗物管线用） */
    source: EntityBase | null;
  }[] = [];
  /** 祖宗弹共享纹理（懒建；exit 释放） */
  private sentinelTex: THREE.CanvasTexture | null = null;
  /** ★ 祖宗共享流体（多个祖宗共用一份；每帧只步进一次，避免 N 倍求解卡顿） */
  private sentinelFluid: FluidEffect | null = null;
  /** ★ 祖宗流体步进蓄积（30Hz 节流：半速求解不可感，省 GPU 合成开销） */
  private sentinelFluidAccum = 0;
  /** ★ 治疗转伤害 proc 命中候选缓冲（复用防每帧分配） */
  private _healProcTargets: EnemyBase[] = [];
  /** ★ 当天出击内死亡次数（复活倒计时阶梯；每次进入世界清零 → 每天重置） */
  private runDeaths = 0;
  /** ★ 遗物属性脏标记（死亡/击杀等事件可能改变遗物结算；每帧最多重算一次） */
  private statsDirty = false;
  /** ★ 玩家复活倒计时（秒；玩家 dead 时倒数，到 0 复活）——与刷怪波次 respawnTimer 区分 */
  private playerRespawnTimer = 0;
  /** 倒计时 UI 上次刷新值（0.1s 节流，避免每帧写 DOM） */
  private playerRespawnShown = -1;
  /** ★ 无人机召唤事件订阅（enter 注册 / exit 移除） */
  private droneSummonUnsub?: () => void;
  /** ★ 祖宗召唤事件订阅（enter 注册 / exit 移除） */
  private sentinelSummonUnsub?: () => void;
  /** ★ 出击槽池变动订阅（部署/卸载/替换 → 友军生成/回收；enter 注册 / exit 移除） */
  private deploymentUnsub?: () => void;
  /** ★ 角色入水检测（每角色上一帧：是否水面 + 高度/位置 + 上次溅波时刻） */
  private waterPrev = new Map<
    CharacterBase,
    { liquid: boolean; y: number; rippleMs: number }
  >();
  /** ★ 测试地图（单 chunk 陈列馆；ctx.debug.testChunk） */
  private testChunk = false;
  /** ★ 调试：F9 颜色回读监听器（exit 时移除） */
  private _f9Handler: ((e: KeyboardEvent) => void) | null = null;
  /** ★ 调试：置位后本帧 render() 末尾立即回读（默认帧缓冲 swap 后读返回 0） */
  private _pendingReadback = false;

  // ============================================================
  // IGameMode 接口实现
  // ============================================================

  enter(ctx: WorldModeEnterContext): void {
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
    this.raster = new RasterMap();
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
    });
    this.testChunk = ctx.debug?.testChunk ?? false;
    // ★ 航行期：地图两级构建的【粗加载】——大半径铺粗块（硬边/纯色/无物理/无水面/无装饰）
    this.chunks.setCoarseMode(true);
    // ★ 航行低耗渲染：水面隐藏（不渲染水/不跑水面 FFT 着色）+ 云流体/月亮离屏不推进
    this.chunks.setWaterVisible(false);
    renderManager.setFlightMode(true);

    // ★ 昼夜循环重置：每次出击从晚上出发（后续可按 Session.day 变化出发时刻）
    renderManager.resetDay();
    sharedWaterMaterial.resetImpacts(); // ★ 清空落水扰动槽（防跨局残留）

    // ★ 本图起点 = 舰船当前位置（上次停靠点；航行阶段从这里出发）
    const shipPos = ctx.session.ship?.position ?? { x: this.spawnPoint.x, z: this.spawnPoint.z };
    const spawn = shipPos;

    // ★ 每天出击满油（油量 = 每日航行预算）
    if (ctx.session.ship) ctx.session.ship.fuel = ctx.session.ship.fuelMax;

    // ---- ★ 初始 chunk 数据环 + 出生区 3×3 强制构建（不等队列调度） ----
    this.chunks.bootstrap(spawn.x, spawn.z);

    // ★ 舰船：航行阶段可操控（停靠后转为静止受击目标，敌人索敌最优先）
    this.ship = new ShipEntity(this.entities, this.scene, ctx.session, spawn.x, spawn.z);
    this.phase = 'sail';
    this.shipDestroyed = false;
    this.flightCamInit = false;
    this.landing = null;
    this.landingTouchdown = false;
    this.takeoff = false;
    this.camBlend = null;
    this.camShot = null;

    // ★ 主角
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
      moveSpeed: 5.0,
      facing: '后',
    });
    // ★ 航行期：角色隐藏 + 操作锁（停靠时落到安全出生点接管）
    this.player.controlLocked = true;

    // ★ 复活倒计时状态：每天出击重置（首死瞬间复活）
    this.runDeaths = 0;
    this.playerRespawnTimer = 0;
    this.playerRespawnShown = -1;

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

    // ---- ★ 杂兵配置条目（三种特色：原石虫=慢/脆/成群；整合=高防高血；
    //       牢杰/杰斯顿=高速高攻脆皮）----
    const MOB_BLUEPRINTS: Omit<MobDef, 'asset'>[] = [
      {
        ai: ROCK_BUG_AI, hp: 22, defense: 0, attackPower: 0,
        scale: 1.6, collisionScale: 1.1, pack: 4, weight: 1, // ★ 成群（慢速炮灰；2026-09-09 权重 3→1：单次仍一次生 4 只）
        drops: [{ itemId: 'polyester', chance: 0.35, min: 1, max: 1 }],
      },
      {
        ai: REUNION_AI, hp: 75, defense: 3, attackPower: 2,
        scale: 2, collisionScale: 1.25, pack: 1, weight: 1, // ★ 中高防中血（2026-09-09 削：130/6 → 75/3；权重 2→1 平衡牢杰）
        drops: [
          { itemId: 'polyester', chance: 0.3, min: 1, max: 1 },
          { itemId: 'device', chance: 0.8, min: 1, max: 2 },
        ],
      },
      {
        ai: LAOJIE_AI, hp: 45, defense: 0, attackPower: 12,
        scale: 2, collisionScale: 1.25, pack: 1, weight: 2, // ★ 高速高攻脆皮（2026-09-09 权重 1→2：提高出现率）
        drops: [{ itemId: 'device', chance: 0.95, min: 1, max: 3 }],
      },
    ];
    this.mobDefs = (ctx.enemyAssets ?? []).map((asset, i) => ({
      asset,
      ...(MOB_BLUEPRINTS[i % MOB_BLUEPRINTS.length] ?? MOB_BLUEPRINTS[1]),
    }));
    // ★ 出生 chunk 不刷怪（自己的 chunk 留给玩家出生/回城安全区）
    this.spawnChunkKey = chunkKeyOf(
      Math.floor(spawn.x / CHUNK_SIZE),
      Math.floor(spawn.z / CHUNK_SIZE),
    );
    // ★ 首波节奏：1.5s 后先来第一波（出生圈附近的安全巡逻）
    this.respawnTimer = 1.5;

    // ---- 相机 ----
    this.cameraCtrl = new CameraController(this.camera);

    // ---- ★ 战斗导演（监听 damage/killed 事件编排打击反馈） ----
    this.director = new CombatDirector(this.cameraCtrl);

    // ---- ★ UI 层（世界专属） ----
    this.worldUIManager = new WorldUIManager(
      ctx.session, this.itemManager, this.interactionManager, this.raster,
    );
    // ★ 属性面板实时数据源（含限时 buff/遗物变化的最终属性）
    this.worldUIManager.setPlayerStatsProvider(() => queryFinalStats(this.player));
    // ★ 快捷栏切换：点击/按键切换当前物品（弹药 → 攻击键发射；消耗品 → F 使用）
    this.worldUIManager.setAmmoSelector((id) => { this.selectedQuickItem = id; });
    // ★ 航行期：停靠按钮（F 键同义）+ 隐藏战斗 HUD（停靠后才绘制）
    this.worldUIManager.setDockButton(() => this.requestDock(false));
    this.worldUIManager.setDockButtonVisible(true);
    this.worldUIManager.setCombatHudVisible(false);
    // ★ 地图风格切换按钮（标准外观 ↔ 四维空间[最终 Boss 战地图]）
    // ★ boss4D 玩家专属：真实落地模式（每次跳跃必须踩实地面，禁止悬空穿/悬浮连跳）
    this.player.controller.requireRealLanding = this.chunks.isBoss4D;
    this.worldUIManager.addMapStyleButton(
      () => (this.chunks.isBoss4D ? '地图：四维空间' : '地图：标准'),
      () => {
        this.chunks.setStyle(!this.chunks.isBoss4D);
        // 仅玩家生效（敌人维持旧连跳行为）
        this.player.controller.requireRealLanding = this.chunks.isBoss4D;
      },
    );

    // ---- ★ 测试物品（UI 初始化后创建，避免碰撞回调时 worldUIManager 未就绪） ----
    const testArchetypes = [
      this.itemManager.getArchetype('healing_potion')!,
      this.itemManager.getArchetype('iron_ore')!,
      this.itemManager.getArchetype('originium_shard')!,
    ];
    for (let i = 0; i < testArchetypes.length; i++) {
      const arch = testArchetypes[i];
      const item = new ItemBase(this.entities, this.scene, arch,
        spawn.x + 6 + i * 2.5,
        this.raster.surfaceHeightAt(spawn.x + 6 + i * 2.5, spawn.z + 6),
        spawn.z + 6,
        this.itemManager,
        { physical: true },
      );
      item.onPickup = (it, picker) => {
        const success = this.itemManager.addItem('player', it.archetype.id, 1);
        if (success) {
          // ★ 金色发光粒子
          const pos = it.position;
          this.pickupGlows.push(new PickupGlowEffect(this.scene!, pos.x, pos.y + 0.3, pos.z));
          // ★ HUD 浮动文字 + 格子闪烁
          this.worldUIManager.showPickupResult(it.archetype.id, true);
          this.worldUIManager.refreshIfOpen();
          return true;
        } else {
          this.worldUIManager.showPickupResult(it.archetype.id, false);
          return false;
        }
      };
    }

    // ---- 子弹池 ----
    this.bullets = new BulletManager(
      this.entities, this.scene,
      ctx.bulletAsset ?? createSolidBulletAsset(), 10, // ★ 池 100 → 10（用户定调：10 颗足够；同时省 90 个记录/刚体）
      this.renderer,
      ctx.hitEffectAsset?.hitEffects ?? [],
      // ★ 命中解析层入口：每次碰撞开始，所有命中（敌人 / 装饰物 / 地块）都进这里分类结算
      (payload) => this.resolveBulletHit(payload),
    );
    this.aiCtx.attack = (opts) => executeAttack(this.entities, this.bullets, opts);
    // ★ 敌人索敌优先级队列：祖宗（吸仇恨）＞ 玩家 ＞ 一般友军（无人机）
    this.aiCtx.targetCandidates = (e) => this.enemyTargetCandidates(e);

    // ---- ★ 战斗道具播放：弹药池 + 装备贴片（挂主角 mesh） ----
    this.combatItems = new CombatItemController(
      ctx.session,
      this.scene,
      this.player.rendererMesh
        ?? (() => { const o = new THREE.Object3D(); this.scene!.add(o); return o; })(),
      () => this.player.facing,
    );
    this.combatItems.syncLoadout();

    // ★ 友军播放注册表：可露希尔的无人机 → 空中的 DroneEntity（跟随/攻击/残骸回收）
    allyPlaybackRegistry.set(DRONE_ITEM, {
      kind: 'drone',
      spawn: ({ itemId, slotIndex, spawnDroneNearPlayer }) => spawnDroneNearPlayer(slotIndex, itemId),
    });

    // ---- ★ 无人机素材（特效包优先；道具召唤用） ----
    this.droneAsset = ctx.droneAsset ?? null;
    // ★ 祖宗素材（缺省回退无人机素材 → 美术到位前管线可跑）
    this.sentinelAsset = ctx.sentinelAsset ?? null;
    // ★ 友军部署推迟到停靠（航行操船期不绘制友军；停靠后 deploySlotAllies）

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
    // ★ 击杀结算：无人机与杂兵分流（无人机损毁 = 槽位换残骸 + 从编队移除）
    this.killedUnsub = eventBus.on('killed', (payload) => {
      // ★ 玩家死亡：累计永久死亡次数（遗物"每次死亡全属性 +5%"的驱动）
      if (payload.target === this.player) {
        const s = this.session;
        if (!s) return;
        s.meta.deaths = (s.meta.deaths ?? 0) + 1;
        // ★ 遗物死亡时机管线
        dispatchRelicEvent(s, RELIC_ITEM_CONFIG, 'onPlayerDeath', {});
        // ★ 标记属性脏：砾小姐的爱等"每次死亡"遗物实时生效（本帧统一重算，非手动刷点）
        this.statsDirty = true;
        // ★ 复活倒计时：按当天出击内累计死亡次数分档（每天重置；首死 0s 瞬间复活）
        this.runDeaths++;
        let delay = 0;
        for (const t of PLAYER_RESPAWN_TIERS) {
          if (this.runDeaths >= t.minDeaths) delay = t.delay;
        }
        // ★ 遗物缩减（砾小姐的爱等：respawnTimeMul < 1）
        this.playerRespawnTimer = delay * this.relicRespawnMul;
        this.playerRespawnShown = -1;
        return; // 玩家不算杂兵、不掉落
      }
      const di = this.drones.indexOf(payload.target as DroneEntity);
      if (di !== -1) {
        const drone = this.drones[di];
        this.drones.splice(di, 1);
        if (drone.slotIndex >= 0) this.itemManager?.replaceSlot(drone.slotIndex, DRONE_BROKEN_ITEM);
        this.showFloatingAt(drone.position.x, drone.position.y, drone.position.z, '无人机损毁', 'crit');
        return; // 不参与杂兵掉落结算
      }
      const enemy = payload.target as EnemyBase;
      this.rollEnemyDrops(enemy);
      const idx = this.enemies.indexOf(enemy);
      if (idx !== -1) this.enemies.splice(idx, 1);
      // ★ 遗物击杀时机管线（脏标记：击杀类属性遗物统一在本帧重算）
      if (this.session) {
        dispatchRelicEvent(this.session, RELIC_ITEM_CONFIG, 'onKill', {});
        this.statsDirty = true;
      }
    });
    // ★ 无人机召唤：使用「可露希尔的无人机」道具 → 近玩家位置放出（不入槽位）
    this.droneSummonUnsub = eventBus.on('drone_summon', () => {
      this.spawnDroneNearPlayer();
    });
    // ★ 祖宗放置：使用「祖宗」→ 从枪口沿准星发射祖宗弹，命中/落地生成站桩友军
    this.sentinelSummonUnsub = eventBus.on('sentinel_summon', () => {
      this.launchSentinelProjectile();
    });
    // ★ 出击槽池变动：友军部署 → 生成；卸载/替换 → 回收对应实体（装备贴片由 0.5s 同步兜底）
    this.deploymentUnsub = eventBus.on('deployment_changed', (payload) => {
      // ★ 装备属性重算（穿脱/互换立即生效；与友军生成无关，先于无人机素材守卫）
      this.refreshPlayerStats();
      // ★ 航行操船期：友军不部署（停靠时统一 deploySlotAllies 生成）
      if (!this.droneAsset || this.phase !== 'explore') return;
      this.despawnAllyAt(payload.slotIndex);
      if (payload.itemId && allyPlaybackRegistry.has(payload.itemId)) {
        allyPlaybackRegistry.get(payload.itemId)!.spawn({
          itemId: payload.itemId,
          slotIndex: payload.slotIndex,
          spawnDroneNearPlayer: (slot, itemId) => this.spawnDroneNearPlayer(slot, itemId),
        });
      }
    });
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

    // ★ 按 I 键打开/关闭背包
    if (this.binding.consumeInventory()) {
      this.worldUIManager.toggleInventory();
    }
    // ★ Q 切换快捷物品（换武器/道具）；F 使用所选消耗品（战斗中鼠标隐藏 → 键盘操作）
    //   ★ Q 按住 + 滚轮 = 直接前后切换弹药/物品（不缩放视角）；点按 Q 仍顺序切换
    //   死亡等待复活期间：锁消耗品使用（切换仍可看）
    if (this.binding.isSwitchItemHeld() && zoom !== 0) {
      this.cycleQuickItem(zoom > 0 ? 1 : -1);
      zoom = 0; // 滚轮已用于切换 → 本帧不缩放
    }
    if (this.binding.consumeSwitchItem()) this.cycleQuickItem();
    if (this.binding.consumeUseItem()) {
      if (this.phase === 'sail') this.requestDock(false);       // 航行期：F = 停靠
      else if (!this.player.dead) {
        // ★ 探索期：靠近舰船 = 登船起飞（舰船当实体载具可再飞）；否则 F = 使用消耗品
        if (!this.tryBoardShip()) this.useSelectedConsumable();
      }
    }
    // ★ 指针锁定唯一事实来源 = 是否有非战斗 UI 打开：
    //   任一面板打开 → 解锁；全部关闭（回到战场）→ 恢复锁定。
    //   setPointerLock 内含冷却重试，且只在状态变化时真正请求/释放。
    this.binding.setPointerLock(!this.worldUIManager.hasModalOpen);

    // ★ 舰船已毁：冻结玩法更新（结算/复活面板接管；相机/输入不再跑）
    if (this.shipDestroyed) return;

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

    // ★ 按 E 键返回舰船（held 状态，每帧检查）
    if (input.held.interact) {
      this.onReturn?.();
      return;
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
      playerStats: { hp: this.player.hp, maxHp: queryFinalStats(this.player).maxHp },
      ammoEntries: this.buildAmmoEntries(),
      allies: this.drones
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

    // ★ 战斗道具播放：装备贴片帧动画驱动（带相机 → 影子 LOD/昼夜浓度）
    this.combatItems.update(dt, this.camera ?? undefined);
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

    // ---- AI / 波次：仅探索阶段（航行期不刷怪、不打船） ----
    if (this.phase === 'explore') {
      aiSystem.updateAll(dt, this.aiCtx);
      // ---- ★ 敌人波次节奏：定时在玩家 LOD 外环周围补一波 ----
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        // ★ 下一波随机 5~10s（2026-09-12 用户定调：生成速度加快，配 50 上限快刷快清）
        this.respawnTimer = 5 + Math.random() * 5;
        this.spawnAmbientWave(pp.x, pp.y);
      }
      // ---- ★ 扫描式波次：周围 ±2 已加载但未刷过的 chunk 逐帧补怪（生成速度加倍） ----
      this.scanAndSpawnWaves(pp.x, pp.y, 8);
      // ---- ★ 远距敌人回收（0.25s 一拍；玩家走过的旧区清场） ----
      this.cullAccum += dt;
      if (this.cullAccum >= WorldMode.ENEMY_CULL_INTERVAL) {
        this.cullAccum = 0;
        this.cullFarEnemies(pp.x, pp.y);
      }
    }
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
      const frame = this.cameraCtrl.getFrame();
      for (let i = 0; i < this.drones.length; i++) {
        const d = this.drones[i];
        const off = droneFollowOffset(i, frame);
        d.followTarget.x = dp.x + frame.right.x * off.r + frame.forward.x * off.f;
        d.followTarget.z = dp.z + frame.right.z * off.r + frame.forward.z * off.f;
        d.followTarget.y = dp.y + off.up;
        d.playerPos.x = dp.x;
        d.playerPos.y = dp.y;
        d.playerPos.z = dp.z;
        // （友军伤害在攻击瞬间 queryFinalStats(d.owner) 实时查询，无需逐帧注入）
        d.updateAI(dt, this.camera);
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
        if (this.landingTouchdown) this.beginSettle();
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
      this.entities.update(dt, input, this.cameraCtrl.getFrame());
    }
    // ★ 效果队列只服务玩家（队友/敌人不参与、零每帧开销）：WorldMode 每帧显式推进
    if (this.player.effects) effectSystem.tickEntity(this.player, dt);
    // ★ 遗物属性脏标记：本帧统一刷新（基础+遗物+装备一次聚合；每帧最多一次，事件处只标记）
    if (this.statsDirty) {
      this.statsDirty = false;
      this.refreshPlayerStats();
    }
    // ★ 复活倒计时推进（玩家死亡等待期）
    this.updatePlayerRespawn(dt);
    const _e2 = performance.now();

    // ---- ★ 角色入水 → 水面剧烈波动（只加波动表现，不动角色位置/手感；航行期角色在船上） ----
    if (this.phase === 'explore') this.updateWaterEntry(this.player, dt);
    for (const e of this.enemies) this.updateWaterEntry(e, dt);
    const _e3 = performance.now();

    // ---- 角色地形跟随（航行期角色位置由舰船同步） ----
    if (this.phase === 'explore') this.clampCharacter(this.player, dt);
    for (const e of this.enemies) this.clampCharacter(e, dt);
    const _t5 = performance.now();
    worldPerf.drones = _e1 - _e0;
    worldPerf.ent = _e2 - _e1;
    worldPerf.water = _e3 - _e2;
    worldPerf.clamp = _t5 - _e3;
    worldPerf.nEnemies = this.enemies.length;
    worldPerf.nDrones = this.drones.length;
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
    if (this.phase === 'explore' && !this.player.dead && this.bulletCooldown <= 0 && (input.held.attack || attackPressed)) {
      this.bulletCooldown = PLAYER_ATTACK_INTERVAL * 100 / (100 + queryFinalStats(this.player).attackSpeed);
      this.firePlayerBullet();
    }

    // ---- ★ 舰船状态：HUD 节拍刷新 + 毁灭判定（真结局 → 结算/复活面板） ----
    this.shipStatusAccum += dt;
    if (this.shipStatusAccum >= 0.1 && this.session) {
      this.shipStatusAccum = 0;
      const s = this.session.ship;
      this.worldUIManager.setShipStatus(s.hp, s.maxHp, s.fuel, s.fuelMax, this.phase === 'sail');
    }
    if (this.session && !this.shipDestroyed && isShipDestroyed(this.session)) {
      this.shipDestroyed = true;
      this.worldUIManager.showShipDestroyedPanel(() => this.reviveShip());
    }

    // （生命回复已入 EffectSystem 队列：EntityBase.update 每帧统一结算）

    // ---- 子弹效果/死亡动画（航行期全免：只算地形） ----
    if (this.phase === 'explore') {
      this.bullets.update(dt, this.camera);
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
    // ★ 地形光照视锥裁剪：只喂视野锥内 chunk 的昼夜 uniform（视锥外冻结，进视野即刷新）
    const fw = this.cameraCtrl.getFrame().forward;
    this.chunks.markLightVisibility(this.camera.position.x, this.camera.position.z, fw.x, fw.z);
    // ★ 光照锚定玩家（update 后、渲染前，位置已是本帧最终值）
    if (this.player) renderManager.follow(this.player.position);
    this.entities.renderAll(this.camera);
    this.bullets.syncHitEffects(this.camera);
    this.renderer.render(this.scene, this.camera);

    // ★ 调试：F9 置位后本帧末同步回读（渲染刚完成、缓冲未 swap，读数有效）
    if (this._pendingReadback) {
      this._pendingReadback = false;
      this.finalColorReadback();
    }
  }

  /** 退出模式：完整清理所有私有资源 */
  exit(): void {
    // ---- 取消伤害事件订阅 ----
    this.damageUnsub?.();
    this.damageUnsub = undefined;
    // ---- 取消 killed 事件订阅 ----
    this.killedUnsub?.();
    this.killedUnsub = undefined;
    // ---- 取消无人机召唤事件订阅 + 销毁无人机 ----
    this.droneSummonUnsub?.();
    this.droneSummonUnsub = undefined;
    this.sentinelSummonUnsub?.();
    this.sentinelSummonUnsub = undefined;
    this.deploymentUnsub?.();
    this.deploymentUnsub = undefined;
    for (const d of this.drones) d.dispose();
    for (const s of this.sentinelShots) s.proj.dispose();
    this.sentinelShots = [];
    this.sentinelTex?.dispose();
    this.sentinelTex = null;
    this.drones = [];
    this.droneAsset = null;
    this.relicRespawnMul = 1;
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
    CharacterFxManager.dispose();

    // ---- 拾取发光粒子 ----
    for (const g of this.pickupGlows) g.dispose();
    this.pickupGlows = [];

    // ---- ★ 角色入水检测状态 ----
    this.waterPrev.clear();

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
    const ray = this.cameraRay();
    let sx = Math.round(cw / 2), sy = Math.round(ch / 2);
    const aim = this.aimRaycast();
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

  private aimRaycast(): { x: number; y: number; z: number } | null {
    const ray = this.cameraRay();
    const hit = aimRaycast(this.entities, {
      origin: ray.origin, dir: ray.dir, maxDist: 200, exclude: this.player,
    });
    return hit ? hit.point : null;
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
    }
    if (this.selectedQuickItem !== 'default' && FIREABLE_AMMO.has(this.selectedQuickItem)) {
      this.selectedQuickItem = 'default';
    }
    const p = this.player.position;
    const muzzle = { x: p.x, y: p.y + 1.1, z: p.z };
    const ray = this.cameraRay();
    let dx = ray.dir.x, dy = ray.dir.y, dz = ray.dir.z;
    try {
      const aim = this.aimRaycast();
      if (aim && isFinite(aim.x) && isFinite(aim.y) && isFinite(aim.z)) {
        const ax = aim.x - muzzle.x, ay = aim.y - muzzle.y, az = aim.z - muzzle.z;
        const alen2 = ax * ax + ay * ay + az * az;
        if (alen2 >= 1) {
          const alen = Math.sqrt(alen2);
          dx = ax / alen; dy = ay / alen; dz = az / alen;
        }
      }
    } catch { /* 忽略 */ }
    // ★ 轻微弹道修正：朝准星小偏角内的敌人修正一点点（手感向）
    const assisted = this.aimAssist(muzzle, dx, dy, dz);
    dx = assisted.x; dy = assisted.y; dz = assisted.z;
    // ★ 子弹伤害在命中瞬间按角色最终攻击力现算（攻击公式：遗物/装备/限时效果全实时）
    executeAttack(this.entities, this.bullets, {
      type: 'projectile', source: this.player,
      x: muzzle.x + dx * 1.5, y: muzzle.y + dy * 1.5, z: muzzle.z + dz * 1.5,
      dirX: dx, dirY: dy, dirZ: dz,
      speed: PLAYER_BULLET_SPEED, camp: 'player', lifetime: PLAYER_BULLET_LIFETIME,
      attackFormula: { min: PLAYER_BULLET_MIN_DAMAGE, ratio: PLAYER_BULLET_ATK_RATIO },
    });
  }

  /**
   * ★ 扫描式波次生成：沿玩家所在 chunk 周围 ±2 已加载地块扫描，
   *   每个尚未生成过的 chunk 生成一波敌人（新加载的地块也会自然被扫到）。
   *   ★ 出生 chunk（玩家所在 chunk 锚点）不刷怪 → spawnChunkKey 排除。
   *   ★ 每帧只放 budget 个（防单帧卡顿），未放满的 chunk 不标记完成 → 后续帧续铺。
   */
  private scanAndSpawnWaves(px: number, pz: number, budget: number): void {
    if (this.testChunk || this.mobDefs.length === 0) return;
    if (this.chunks.isBoss4D) return; // 四维空间（最终 Boss 战地图）不刷杂兵
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
          if (key === this.spawnChunkKey) continue;  // 出生 chunk 不刷
          if (this.spawnedChunks.has(key)) continue; // 已完成波次的 chunk 跳过
          // ★ chunk 地形已就绪（有数据环）才可落点
          if (!this.raster.getChunkData(cx, cz)) continue;
          // ★ 回收环约束（2026-09-12 狠缩环配套）：chunk 最近点超过回收环 −10m
          //   → 整块不刷【且不标记完成】（靠近后转内环再补），避免刷出即被销毁
          const nxp = Math.max(cx * CHUNK_SIZE, Math.min(px, (cx + 1) * CHUNK_SIZE));
          const nzp = Math.max(cz * CHUNK_SIZE, Math.min(pz, (cz + 1) * CHUNK_SIZE));
          const nd = Math.hypot(nxp - px, nzp - pz);
          if (nd > WorldMode.ENEMY_CULL_RADIUS - 10) continue;
          // ★ 每 chunk 一波 2~4 个（比全铺档减半：有怪但不会过密）
          const want = 2 + Math.floor(Math.random() * 3);
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
  private spawnAtRandomPointInChunk(cx: number, cz: number): boolean {
    if (this.mobDefs.length === 0 || !this.scene || !this.camera) return false;
    // ★ 敌人上限（防无限世界累积过多实体）
    if (this.enemies.length >= WorldMode.MAX_ENEMIES) return false;
    const x = cx * CHUNK_SIZE + 4 + Math.random() * (CHUNK_SIZE - 8);
    const z = cz * CHUNK_SIZE + 4 + Math.random() * (CHUNK_SIZE - 8);
    // ★ 玩家近旁不刷（防贴脸 pop-in；出生 chunk 自身已整体排除，
    //   邻 chunk 允许到 12m——初始密度够又不出现在脚边）
    const p = this.player?.position;
    if (p) {
      const ddx = x - p.x, ddz = z - p.z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < 12 * 12) return false;
      // ★ 回收环约束（配套狠缩环）：超出 回收环−10m 的点不刷——否则 0.25s 后即被清
      const maxR = WorldMode.ENEMY_CULL_RADIUS - 10;
      if (d2 > maxR * maxR) return false;
    }
    // ★ 坑/水/虚空/未生成：不站（isDepression 包含坑洞与水）
    const role = this.raster.tileDefAt(x, z).genRole;
    if (role === 'pit' || role === 'liquid') return false;
    const y = this.raster.surfaceHeightAt(x, z);
    // ★ 落点过低（挖坑后的深坑区）不生成
    if (y < -1.2) return false;
    return this.spawnOne(this.pickMob(), x, y, z);
  }

  /** ★ 定时波次：在玩家 LOD 外环（60m+，chunk 数据环内）周围随机生成一波 */
  private spawnAmbientWave(px: number, pz: number): void {
    if (this.testChunk || this.mobDefs.length === 0) return;
    if (this.chunks.isBoss4D) return; // 四维空间不补杂兵
    const want = 2 + (Math.random() < 0.5 ? 1 : 0); // ★ 每波 2~3 个（2026-09-12 生成加速）
    let placed = 0;
    // 环带：内圈 > LOD3（LOD_MAX_DIST，随 LOD 放宽外移），外圈 < 数据预载环（~2 chunk）
    for (let i = 0; i < want * 10 && placed < want; i++) {
      const ang = Math.random() * Math.PI * 2;
      // ★ 94~110m：LOD 外（不 pop-in）且回收环 120m 内（可持续，不刷出即销毁）
      const dist = LOD_MAX_DIST + 4 + Math.random() * 16;
      const x = px + Math.cos(ang) * dist;
      const z = pz + Math.sin(ang) * dist;
      // 目标 chunk 必须已有地形数据（未生成的世界区域不刷）
      const cx = Math.floor(x / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      if (chunkKeyOf(cx, cz) === this.spawnChunkKey) continue;
      if (!this.raster.getChunkData(cx, cz)) continue;
      const role = this.raster.tileDefAt(x, z).genRole;
      if (role === 'pit' || role === 'liquid') continue;
      const y = this.raster.surfaceHeightAt(x, z);
      if (y < -1.2) continue;
      if (this.spawnOne(this.pickMob(), x, y, z)) placed++;
    }
  }

  /** ★ 随机取一条杂兵配置（按 weight 加权：原石虫权重大 → 成群出现） */
  private pickMob(): MobDef {
    let total = 0;
    for (const d of this.mobDefs) total += d.weight;
    let r = Math.random() * total;
    for (const d of this.mobDefs) {
      r -= d.weight;
      if (r <= 0) return d;
    }
    return this.mobDefs[this.mobDefs.length - 1];
  }

  /** ★ 远距回收：距玩家超 ENEMY_CULL_RADIUS 的敌人销毁并移除
   *   （无限世界防累积；靠近后再由 chunk 激活/周期波次补上） */
  private cullFarEnemies(px: number, pz: number): void {
    const r2 = WorldMode.ENEMY_CULL_RADIUS ** 2;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dx = e.position.x - px;
      const dz = e.position.z - pz;
      if (dx * dx + dz * dz > r2) {
        e.dispose();
        this.enemies.splice(i, 1);
      }
    }
  }

  /** ★ 生成一"窝"杂兵：以落点为中心放 def.pack 只（原石虫 = 一整窝），
   *   同伴围绕中心 ±1.6m 散布（同一 asset/属性）。返回是否至少放了 1 只。 */
  private spawnOne(
    def: MobDef,
    x: number, y: number, z: number,
  ): boolean {
    if (!this.scene || !this.camera) return false;
    let any = false;
    for (let k = 0; k < def.pack; k++) {
      // ★ 同伴散布（k=0 中心；其余绕圈小偏移）
      let sx = x, sz = z;
      if (k > 0) {
        const ang = (k / def.pack) * Math.PI * 2 + Math.random() * 0.8;
        const dist = 1.2 + Math.random() * 1.6;
        sx = x + Math.cos(ang) * dist;
        sz = z + Math.sin(ang) * dist;
      }
      // ★ 上限检查（每只都查）
      if (this.enemies.length >= WorldMode.MAX_ENEMIES) break;
      // ★ 同伴落点也要可站（坑/水/过低跳过该同伴）
      const role = this.raster.tileDefAt(sx, sz).genRole;
      if (role === 'pit' || role === 'liquid') continue;
      const sy = this.raster.surfaceHeightAt(sx, sz);
      if (sy < -1.2) continue;
      const enemy = new EnemyBase(this.entities, this.scene, def.asset, {
        x: sx, y: sy, z: sz,
        animMap: {
          states: {
            idle: { 前: ['前'], 后: ['后'] },
            walk: { 前: ['前'], 后: ['后'] },
            attack: { 前: ['前'], 后: ['后'] },
          },
          fps: { idle: 1, walk: 1, attack: 1 },
        },
        facing: Math.random() < 0.5 ? '前' : '后',
        aggressive: true,
        aiConfig: def.ai,
        hp: def.hp,
        defense: def.defense,
        attackPower: def.attackPower,
        scale: def.scale,
        collisionScale: def.collisionScale,
      }, this.camera);
      enemy.billboard = false;
      this.enemyDefs.set(enemy, def);
      this.enemies.push(enemy);
      any = true;
    }
    return any;
  }

  /**
   * ★ 角色入水检测：走进水面 / 从高处落入水面 → 该处水面剧烈波动；
   *   在水中持续移动 → 脚下周期性泛波。只触发波动表现，不改角色位置。
   */
  private updateWaterEntry(e: CharacterBase, dt: number): void {
    const p = e.position;
    const liquid = this.raster.tileDefAt(p.x, p.z).genRole === 'liquid';
    // ★ 复用记录对象（每帧 set 新对象会制造 GC 压力——60+ 实体每帧一个）
    let rec = this.waterPrev.get(e);
    if (!rec) {
      rec = { liquid, y: p.y, rippleMs: 0 };
      this.waterPrev.set(e, rec);
      return;
    }
    const prevLiquid = rec.liquid;
    const prevY = rec.y;
    rec.liquid = liquid;
    rec.y = p.y;
    // 走进水面（方块由非水 → 水，且脚底在水面以下 0.5m 内才算真正入水）
    if (liquid && !prevLiquid && p.y < 0.5) {
      rec.rippleMs = performance.now();
      sharedWaterMaterial.addImpact(p.x, p.z, 0.8);
      return;
    }
    // 高处坠落 / 跳入：本帧穿过 y=0 水面 → 波幅随坠落速度增大
    if (liquid && prevY > 0.08 && p.y <= 0.08) {
      rec.rippleMs = performance.now();
      const vy = Math.max(0, (prevY - p.y) / Math.max(dt, 1e-3));
      sharedWaterMaterial.addImpact(p.x, p.z, Math.min(1.6, 0.7 + vy * 0.15));
      return;
    }
    // ★ 在水中移动 → 脚下周期性泛波（速度越快越密/越强）
    if (liquid && e.controller.moveSpeed > 0.3) {
      const now = performance.now();
      const gap = 340 - e.controller.moveSpeed * 28; // 慢走 0.3s 一泛，快跑 ~0.2s
      if (now - rec.rippleMs >= gap) {
        rec.rippleMs = now;
        sharedWaterMaterial.addImpact(p.x, p.z, Math.min(0.55, 0.28 + e.controller.moveSpeed * 0.06));
      }
    }
  }

  /**
   * ★ 炮弹/子弹落点 0.6m 半径内若存在水面 → 注入水面剧烈波动。
   */
  /**
   * ★★ 命中解析层（唯一入口）：一次子弹碰撞 → 全分类结算。
   *   敌人实体 → 伤害管线 + 'damage' 事件（combat 归口）；
   *   静态世界（地块 / 装饰物）→ resolveImpact 一次权威判定 →
   *     地形扣除（消费地块属性）/ 水面波动 / 物品掉落（消费报告三键）。
   */
  private resolveBulletHit({ self, other, point, damage }: BulletHitPayload): void {
    // ★ 祖宗弹：命中/落地 → 在落点生成站桩友军，子弹就地回收（不结算伤害、不改地形）
    if (self.allyOnHit) {
      self.deactivate();
      self.recycle?.();
      this.spawnSentinelAt(point.x, point.z);
      return;
    }
    if (other) {
      // 伤害/事件统一在 applyDamage 内结算（base 已含攻击力 → 不再叠加）
      applyDamage(damage, self, other);
      return;
    }
    const impact = this.chunks.resolveImpact(point.x, point.y, point.z);
    this.chunks.playBulletImpact(impact); // 地形修改：消费解析结果（含地块资格门）
    this.agitateWaterNear(point.x, point.z); // 水面波动
    this.spawnItemDrops(impact); // 掉落：ground/water/crystal 全来自报告
  }

  private agitateWaterNear(x: number, z: number): void {
    const hit = this.waterPointWithin(x, z, 0.6);
    if (!hit) return;
    sharedWaterMaterial.addImpact(hit.x, hit.z, 1.4);
  }

  /** 命中点及半径 r 的十字采样内找水面；返回最近水面点，无则 null */
  private waterPointWithin(
    x: number, z: number, r: number,
  ): { x: number; z: number } | null {
    if (this.raster.tileDefAt(x, z).genRole === 'liquid') return { x, z };
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i;
      const sx = x + Math.cos(a) * r;
      const sz = z + Math.sin(a) * r;
      if (this.raster.tileDefAt(sx, sz).genRole === 'liquid') {
        return { x: sx, z: sz };
      }
    }
    return null;
  }

  /**
   * ★ 物品掉落管线：命中报告（ImpactReport）→ 掷掉落 → 背包落账 + UI 提示。
   *   地面(固原岩) / 水面或贴水地块(酮凝集) / 耗尽原石晶体~3m(异铁)；
   *   有空间直接入袋&提示，背包满则提示失败。
   */
  /** ★ 击杀掉落：按敌人 MobDef.drops 逐项掷概率 → 直接入袋 + UI 提示 */
  private rollEnemyDrops(enemy: EnemyBase): void {
    const def = this.enemyDefs.get(enemy);
    if (!def || !this.itemManager || !this.worldUIManager) return;
    for (const d of def.drops) {
      if (Math.random() >= d.chance) continue;
      const count = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
      const ok = this.itemManager.hasSpace('player', d.itemId, count)
        && this.itemManager.addItem('player', d.itemId, count);
      this.worldUIManager.showPickupResult(d.itemId, ok, count);
      if (ok) this.worldUIManager.flashItemAndRefresh(d.itemId);
    }
  }

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
    const drone = new DroneEntity(this.entities, this.scene, this.droneAsset, {
      x: p.x + (Math.random() - 0.5) * 2, y: p.y + 2.0, z: p.z + (Math.random() - 0.5) * 2,
      scale: 1.2,
    });
    drone.slotIndex = slotIndex;
    drone.itemId = itemId;
    drone.owner = this.player; // ★ 攻击时实时查询主人最终攻击力
    this.drones.push(drone);
    // ★ 注入主渲染器：翅膀 VAT 离屏 RT 需与主渲染器共享 WebGL 上下文（同 MoonEffect）
    if (this.renderer) drone.setRenderer(this.renderer);
  }

  /** ★ 在指定落点生成祖宗（站桩友军）：每个祖宗都是独立实体，可多个并存（列表按落地顺序追加） */
  private spawnSentinelAt(x: number, z: number): void {
    if (!this.scene || !this.player) return;
    const asset = this.sentinelAsset ?? this.droneAsset;
    if (!asset) return;
    // ★ 与主角同尺寸（主角 applyRenderScale(2.0)）；中心锚点 → 半身高贴身摆放（可调）
    const py = this.raster.surfaceHeightAt(x, z) + 0.5;
    const s = new DroneEntity(this.entities, this.scene, asset, { x, y: py, z, scale: 2.0 });
    s.slotIndex = -1;
    s.itemId = 'zuzong';
    s.stationary = true;
    s.stationaryBaseY = py;
    s.rangedAttack = (t) => this.fireSentinelShot(s, t);
    s.mineAttack = (d) => this.sentinelMine(d); // ★ 无敌人时自动挖矿
    s.owner = this.player; // ★ 攻击时实时查询主人最终攻击力
    this.drones.push(s);
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
    const ray = this.cameraRay();
    let dx = ray.dir.x, dy = ray.dir.y, dz = ray.dir.z;
    try {
      const aim = this.aimRaycast();
      if (aim && isFinite(aim.x) && isFinite(aim.y) && isFinite(aim.z)) {
        const ax = aim.x - muzzle.x, ay = aim.y - muzzle.y, az = aim.z - muzzle.z;
        const alen2 = ax * ax + ay * ay + az * az;
        if (alen2 >= 1) {
          const alen = Math.sqrt(alen2);
          dx = ax / alen; dy = ay / alen; dz = az / alen;
        }
      }
    } catch { /* 忽略 */ }
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
    });
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
      // ★ 命中敌人：结算伤害（玩家弹用 IMPACT 公式；祖宗攻击弹用发射时算好的 damage）
      const hit = land ? null : this.sentinelShotHitEnemy(shot);
      if (hit) {
        const src = rec.source ?? this.player;
        const dmg = rec.damage >= 0
          ? rec.damage
          : Math.max(SENTINEL_IMPACT_MIN_DAMAGE, Math.round(queryFinalStats(this.player).attackPower * SENTINEL_IMPACT_ATK_RATIO));
        // 玩家祖宗弹的 dmg 已含攻击力 → 不再叠加 source.attackPower（修双计）
        applyDamage(dmg, src, hit);
      }
      if (land || hit) {
        this.sentinelShots.splice(i, 1);
        const p = shot.sprite.position;
        shot.dispose();
        if (rec.spawnOnLand) this.spawnSentinelAt(p.x, p.z);
      }
    }
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

  /** ★ 敌人索敌候选（优先级从高到低）：
   *  ① 舰船（停靠后；用户定调：优先打舰船）② 祖宗（站桩·吸仇恨；TAUNT 半径内）
   *  ③ 玩家 ④ 一般友军（最近无人机）
   *  条件侧按序取第一个"在该敌视野半径内"的候选 → 实现攻击优先级队列 */
  private enemyTargetCandidates(enemy: EnemyBase): { x: number; z: number }[] {
    const ep = enemy.position;
    const out: { x: number; z: number }[] = [];
    // ★ 舰船最优先（仅探索阶段存在；hp<=0 由结算接管不再嘲讽）
    if (this.phase === 'explore' && this.ship && this.ship.hp > 0) {
      out.push({ x: this.ship.position.x, z: this.ship.position.z });
    }
    let sentinel: DroneEntity | null = null, sentinelD2 = Infinity;
    let ally: DroneEntity | null = null, allyD2 = Infinity;
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
    const taunt2 = SENTINEL_TAUNT_RADIUS * SENTINEL_TAUNT_RADIUS;
    if (sentinel && sentinelD2 <= taunt2) {
      out.push({ x: sentinel.position.x, z: sentinel.position.z });
    }
    if (this.player) out.push({ x: this.player.position.x, z: this.player.position.z });
    if (ally) out.push({ x: ally.position.x, z: ally.position.z });
    return out;
  }

  /** ★ 快捷栏条目：普通弹药（∞）+ 行囊内可发射弹药 + 可消耗物品（药品/增益品等）。
   *  排序：普通弹药 → 弹药（祖宗等）→ 消耗品（各自内部保持背包扫描顺序，稳定排序）；
   *  弹药 → 攻击键发射消耗；消耗品 → F 使用；Q/点击切换。只列行囊（player）里的。 */
  private buildAmmoEntries(): AmmoEntryView[] {
    const out: AmmoEntryView[] = [
      { id: 'default', name: '普通弹药', count: -1, iconId: 'bullet_default', selected: this.selectedQuickItem === 'default' },
    ];
    // ★ 先归并计数 + 定优先级（0=可发射弹药 1=其它弹药 2=消耗品），再稳定排序
    const found: { id: string; count: number; rank: number }[] = [];
    if (this.itemManager) {
      for (const it of this.itemManager.getItems('player')) {
        const arch = this.itemManager.getArchetype(it.itemId);
        if (!arch) continue;
        // ★ 可部署友军（可露希尔的无人机等）走出击槽，不进快捷栏；只留弹药与消耗品
        if (this.itemManager.isDeployable(it.itemId)) continue;
        const isFireable = FIREABLE_AMMO.has(it.itemId);
        const quick = isFireable || arch.type === 'consumable' || arch.type === 'ammo';
        if (!quick) continue;
        const rank = isFireable ? 0 : arch.type === 'ammo' ? 1 : 2;
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

  /** ★ 切换快捷物品（dir=+1 下一个 / -1 上一个，循环；普通弹药 → 行囊内各项）：
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

  /** ★ F：使用所选消耗品（弹药不在此列——弹药由攻击键发射） */
  private useSelectedConsumable(): void {
    const id = this.selectedQuickItem;
    if (id === 'default' || FIREABLE_AMMO.has(id)) return;
    const res = this.itemManager?.useItemId('player', id);
    if (res?.message && this.player) {
      const p = this.player.position;
      this.showFloatingAt(p.x, p.y + 1.8, p.z, res.message, res.success ? 'heal' : 'miss');
    }
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
    this.relicRespawnMul = mods.respawnTimeMul;
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
      },
    }]);
    // ---- 装备层：加算 + 加法乘区（弹药/装备/消耗品 buff 由队列各自维护） ----
    const eq = this.itemManager.getEquipmentStats();
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
      applyDamage(dmg, p, targets[i], { type: 'arts', ignoreDefense: true });
    }
  }

  /** ★ 玩家死亡等待复活：倒计时推进 → 到期复活
   *   复活血量 = 死前血量一半，保底最大血量 10%（阶梯/重置见 PLAYER_RESPAWN_DELAYS） */
  private updatePlayerRespawn(dt: number): void {
    if (!this.player.dead) return;
    if (this.playerRespawnTimer > 0) {
      this.playerRespawnTimer = Math.max(0, this.playerRespawnTimer - dt);
      const shown = Math.ceil(this.playerRespawnTimer * 10) / 10;
      if (shown !== this.playerRespawnShown) {
        this.playerRespawnShown = shown;
        this.worldUIManager.setRespawnCountdown(shown);
      }
      if (this.playerRespawnTimer > 0) return;
    }
    const maxHp = queryFinalStats(this.player).maxHp;
    const hp = Math.max(this.player.preDeathHp * 0.5, maxHp * PLAYER_RESPAWN_FLOOR_HP_RATIO);
    // ★ 复活点 = 舰船停靠点（出生点）；死亡期间镜头留在死亡地点
    const sp = this.ship?.position ?? this.spawnPoint;
    const pos = this.player.position;
    pos.x = sp.x;
    pos.z = sp.z;
    pos.y = this.raster.surfaceHeightAt(sp.x, sp.z);
    this.cameraCtrl.snapTo(pos.x, pos.y, pos.z);
    this.player.revive(hp);
    this.playerRespawnShown = -1;
    this.worldUIManager.setRespawnCountdown(null);
    this.showFloatingAt(pos.x, pos.y, pos.z, '复活', 'heal');
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

  /** ★ 出击槽池 → 友军实体部署（停靠时调用；航行期不绘制友军） */
  private deploySlotAllies(): void {
    if (!this.droneAsset) return;
    const slots = this.itemManager?.getSlots?.() ?? [];
    for (let i = 0; i < slots.length; i++) {
      const id = slots[i];
      if (!id) continue;
      const entry = allyPlaybackRegistry.get(id);
      if (entry) {
        entry.spawn({ itemId: id, slotIndex: i, spawnDroneNearPlayer: (slot, itemId) => this.spawnDroneNearPlayer(slot, itemId) });
      }
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
    this.phase = 'explore';
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
    this.deploySlotAllies();                       // ★ 停靠后：友军出队
    this.showFloatingAt(exit.x, exit.y + 1.6, exit.z, emergency ? '紧急停靠' : '已停靠', 'heal');
    // 兜底：若镜头调度意外缺失（无相机/被取消），直接就位并交还控制
    if (!this.camBlend) {
      this.cameraCtrl.snapTo(exit.x, exit.y, exit.z);
      p.controlLocked = false;
    }
  }

  /** ★ 登船起飞（探索期靠近舰船按 F；2026-09-12 用户定调：舰船当实体载具）：
   *  收起友军 → 回航行阶段（起飞爬升段 + 追尾相机 + 航行极简帧），可继续飞行。 */
  private tryBoardShip(): boolean {
    if (!this.ship || !this.session || this.camBlend) return false;
    const p = this.player.position;
    const s = this.ship.position;
    const dx = p.x - s.x, dz = p.z - s.z;
    if (dx * dx + dz * dz > WorldMode.REBOARD_RADIUS ** 2) return false;
    for (const d of this.drones) d.dispose();
    this.drones = [];
    this.takeoff = true;
    this.ship.beginTakeoff();
    this.phase = 'sail';
    this.chunks.setCoarseMode(true);  // 航行极简：粗块 LOD
    this.chunks.setWaterVisible(false);
    renderManager.setFlightMode(true);
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
    this.shipStatusAccum = 1; // 下一帧立刻刷新 HUD
  }

  /** ★ 祖宗远程射击：友军弹道（复用子弹管线；数值集中此处便于调平衡） */
  /** ★ 祖宗激光命中结算（红色激光是瞬时 hitscan；光束特效由祖宗实体播放） */
  private fireSentinelShot(from: DroneEntity, target: EntityBase): void {
    const dmg = Math.max(SENTINEL_MIN_DAMAGE, Math.round(queryFinalStats(this.player).attackPower * SENTINEL_ATK_RATIO));
    applyDamage(dmg, from, target); // 事件统一在 applyDamage
  }

  /** ★ 祖宗自动挖矿（无敌人时）：随机在 铁（耗尽原石晶体）/ 水 / 地面 三类中找点，
   *  播激光 → 复用命中解析层掉落（只出资源，不挖坑/不改地形） */
  private sentinelMine(from: DroneEntity): void {
    if (!this.itemManager || !this.worldUIManager) return;
    const p = from.position;
    const pt = this.pickMinePoint(p.x, p.z);
    if (!pt) return;
    from.playBeam();
    const y = this.raster.surfaceHeightAt(pt.x, pt.z);
    const impact = this.chunks.resolveImpact(pt.x, y, pt.z);
    this.spawnItemDrops(impact);      // 掉落：铁/水/地面 → 异铁/酮凝集/固原岩
    if (impact.water !== 'none') this.agitateWaterNear(pt.x, pt.z);
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
   *  残骸/装备类槽位无对应实体，安全 no-op。 */
  private despawnAllyAt(slotIndex: number): void {
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (d.slotIndex === slotIndex) {
        this.drones.splice(i, 1);
        d.dispose();
        break;
      }
    }
  }

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

  private clampCharacter(e: CharacterBase, dt: number): void {
    // ★ 死亡等待复活：冻结在死亡地点（不贴地/不重复判死），复活时统一传送回出生点
    if (e.dead) return;
    // ★ 空中态不钉地形：真实跳跃（空格）让 y 由 CharacterBase 的抛物线结算，
    //   落地瞬间再回落贴地；否则会把跳起来的角色钉回地面、无法跃过 0.5 高差。
    if (e.controller.isAirborne()) return;
    const p = e.position;
    const targetY = this.raster.surfaceHeightAt(p.x, p.z);
    // ★ 脚下地块复核（2026-09-05 用户实测：补丁把普通地块挖到 <−1.5 也被当深坑判死）：
    //   死亡只属于"坑洞地块的足够深位置"——地面低于 −1.5 只是触发条件之一，还须
    //   所在 4m 地块是坑洞（genRole==='pit'）。普通地块被挖深的补丁坑：正常贴地站立
    //   （不沉落、不判死）；天然坑洞：维持沉落死亡。
    //   ★ 2026-09-10 水里连射被误判掉坑：isDepression 同时覆盖坑洞与水（Tiles.ts），
    //   子弹会把水底挖到 −1.5 以下 → 判死传送。水不是坑洞 → 死亡门槛只认 pit。
    const onPitTile = this.raster.tileDefAt(p.x, p.z).genRole === 'pit';
    if (targetY >= -1.5 || !onPitTile) {
      const dy = targetY - p.y;
      if (dy > 0) p.y += Math.min(dy, 7.5 * dt);
      else p.y += Math.max(dy, -25 * dt);
      return;
    }
    p.y += Math.max(targetY - p.y, -25 * dt);
    if (p.y <= targetY + 0.05) {
      // ★ 玩家掉坑死亡：补发 killed 事件 → 计入遗物"每次死亡"统计（meta.deaths）
      //   （血量归零路径经由 onTakeDamage 自发 killed；掉坑是环境死亡，需手动补发）
      if (e === this.player) {
        eventBus.emit('killed', { target: e, source: null });
      }
      e.onDeath(null);
      if (e !== this.player) {
        // 杂兵坠坑死亡：从列表移除
        const idx = this.enemies.indexOf(e as EnemyBase);
        if (idx !== -1) this.enemies.splice(idx, 1);
      }
      // 玩家：不在此处传送——镜头留在死亡地点，复活时统一回出生点（updatePlayerRespawn）
    }
  }
}