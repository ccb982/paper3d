// ============================================================
// ChunkManager —— 地图流式构建管理器
// ============================================================
// 职责（自 WorldMode 抽出）：
//   - 以玩家为中心的 chunk 流式扩张（RasterMap 数据环 → 视觉网格 + 地面刚体）
//   - 构建预算队列（每帧限时消化，跨区爆发不同帧全建，消卡顿）
//   - 异步烘焙管线（重计算在 Worker；换代作废 + 看门狗自愈空洞）
//   - 双风格：标准（异步烘焙）/ Boss4D 四维空间（同步直建）；风格热切换
//   - ★ 虚空地块（四维空间专属）：isBoss4DVoidChunk 命中的 chunk 只建
//     物理不建视觉——历史"有碰撞无纹理"bug 的主题化转正
//   - dispose：队列/在途/视觉/刚体/烘焙缓存一次清空
//
// 分层：services 不依赖 entity 层——地面刚体经 ChunkGroundHost 接口注入，
//       模式层用 EntityManager 适配（"services 可独立测试"约定）。
// ============================================================

import * as THREE from 'three';
import { CHUNK_SIZE, BLOCKS_PER_SIDE, BLOCK_SIZE } from './ChunkGenerator';
import { RasterMap, chunkKeyOf } from './RasterMap';
import {
  bakeChunkMaps, assembleChunkMaps,
  getCachedChunkMaps, cacheChunkMaps, releaseBakeCache, trimBakeCache,
  type ChunkMaps,
} from './ChunkAppearance';
import { terrainBaker, type BakeResult } from './TerrainBaker';
import { terrainPatch } from './TerrainPatch';
import { coarsePatch } from './CoarsePatch';
import { TerrainMaterial, MATERIAL_SLOTS, materialFnIndex, clearWallMaterialRegistry, type TileRenderConfig } from './TerrainMaterial';
import { tileById } from './Tiles';
import { groupByKey, applyGroupTintHsl, type GroupPalette } from './TileGroups';
import { resolveTileLook } from './TileMaterials';
import { srgbHslToOklch, srgbHslJitterAmp } from './colorLab';
import { circleCells, PATCH_LEVEL_WIDTH, type FaceGeometry } from './FaceBuild';
import { computeTableGeometry, type PatchGeomResult, type PatchGroundCell, type GeomBounds } from './PatchCompute';
import type { WaterSurfaceRaw } from './WaterSurface';
import { worldBlockKey } from './WaterSurface';
import { createWaterMesh, sharedWaterMaterial } from './WaterMaterial';
import { WallMaterial } from './TerrainMaterial';
import { disposePropRenderers } from './decor/MapEntityDecorBase';
import {
  buildBoss4DChunk, buildBoss4DChunkPhysics, isBoss4DVoidChunk,
} from './Boss4DArena';
import { planChunkDecals, type PlannedDecal } from './decor/TileDecalBase';
import {
  planChunkProps, buildPropLayer, computePropVolumes, mapDecorByKey, groupPropsByKey,
  type ChunkGroundHost, type PlannedProp,
} from './decor/MapEntityDecorBase';
import { buildTileLabelLayer, disposeTileLabelCache } from './debug/TileLabels';
import { buildPlatformAprons, type ApronPhysics } from './decor/PlatformApron';
import { buildCementPlinths, disposeCementPlinthShared, type CementPlinthPhysics } from './decor/CementPlinth';

/** 命中解析：装饰实体探测半径（m）——耗尽原石晶体碰撞半径 ~1.15×scale */
const PROP_PROBE_R = 3.0;

/** 装饰计划（预渲染前放置完成；烘焙与装配两侧消费同一份） */
export interface DecorPlan {
  decals: PlannedDecal[];
  props: PlannedProp[];
  /** 装饰物阴影体积（世界坐标，5×N Float32Array，随快照进 Worker） */
  propVolumes: Float32Array;
}

/** 水体几何共享装配（createWaterMesh，WaterMaterial 统一管理闪烁/波/LOD） */

/** ★ 运行时装饰实体索引条目（权威=实际存在于场景的碰撞体；与 propBodies 同步登记/销毁） */
export interface DecorPropInstance {
  key: string;
  cx: number;
  cz: number;
  /** 世界坐标（x/z 为底面中心；y 为底面高度） */
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
}

/** ★ 命中解析结果：地形修改 / 掉落 / 表现三端共用一份权威判定 */
export interface ImpactTile {
  cx: number;
  cz: number;
  /** 世界 4m 地块坐标 */
  bx: number;
  bz: number;
  /** 地块属性表 id（最终 TileDef.id） */
  id: number;
  /** 来自表的生成长相 role */
  role: string;
  /** 地块面高（米） */
  h: number;
}
export interface ImpactProp {
  key: string;
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
}
export interface ImpactReport {
  x: number;
  y: number;
  z: number;
  tile: ImpactTile;
  /** 命中地块本身是水 / 紧邻水（4 邻块） / 无水 */
  water: 'hit' | 'edge' | 'none';
  /** 命中点附近（PROP_PROBE_R 内）的装饰性实体；无 = null */
  prop: ImpactProp | null;
}

/** 体积列表 → 平面 Float32Array（每 5 个 [x,z,y,r,h]） */
function packVolumes(v: { x: number; z: number; y: number; r: number; h: number }[]): Float32Array {
  const out = new Float32Array(v.length * 5);
  for (let i = 0; i < v.length; i++) {
    out[i * 5] = v[i].x;
    out[i * 5 + 1] = v[i].z;
    out[i * 5 + 2] = v[i].y;
    out[i * 5 + 3] = v[i].r;
    out[i * 5 + 4] = v[i].h;
  }
  return out;
}

export class ChunkManager {
  private scene: THREE.Scene;
  private raster: RasterMap;
  private host: ChunkGroundHost;

  /** 视觉网格（key → group/mesh） */
  private meshes = new Map<number, THREE.Object3D>();
  /** ★ 虚空地块（四维空间：只建物理不建视觉；key 集合，与 bodies 对齐） */
  private voidKeys = new Set<number>();
  /** 地面刚体 id（key → entity.id） */
  private bodies = new Map<number, number>();
  /** 装饰物碰撞体 id（key → entity.id[]；随 chunk 生灭） */
  private propBodies = new Map<number, number[]>();
  /** ★ 装饰实体运行时索引（key → 实例[]；与 propBodies 同生命周期，命中解析只在真实存在物上判定） */
  private propRegistry = new Map<number, DecorPropInstance[]>();
  /** ★ 石围裙地面刚体 id（key → entity.id；trimesh，与地形同管线，随 chunk 生灭） */
  private apronBodies = new Map<number, number>();
  /** 水泥台座地面刚体 id（chunkKey → id；同墙裙 trimesh 管线） */
  private plinthBodies = new Map<number, number>();
  /** ★ 地图风格：false=标准外观 / true=四维空间（最终 Boss 战地图，Boss4DArena） */
  private boss4D = false;

  // ---- ★ 构建预算队列：跨区爆发不再同帧全部构建 ----
  private queue: { cx: number; cz: number; rebuild: boolean }[] = [];
  private queuedKeys = new Set<number>();
  /** 每帧构建时间预算（毫秒）；单帧最多消耗这么多，剩余下帧继续 */
  private static readonly BUILD_BUDGET_MS = 8;
  /** ★ 档位（2026-09-10）：可见构建半径（±2 chunk = 5×5）/ 数据+预烘焙半径（±4 = 9×9）
   *  ★ 2026-09-11：预烘半径 3→4——更早算好（数据+纹理+几何），进入构建环直接装配不等烘焙 */
  private static readonly BUILD_RADIUS = 2;
  private static readonly PREFETCH_RADIUS = 4;
  /** ★ 烘焙在途上限（构建请求）：防跨区/接缝批量时把多个烘焙任务同时塞进 worker
   *  ★ 2026-09-11：2 → 1（用户定调"减少同时计算 chunk 的数量"）——同一时刻只算一块 */
  private static readonly BUILD_INFLIGHT_MAX = 1;
  /** ★ 降落冲刺（WorldMode 进近）：窗口内放开首建节流/在途/装配三档闸门
   *  （进近变慢后窗口同步拉长，覆盖整段下降） */
  private static readonly RUSH_SECONDS = 18;
  private static readonly BUILD_INFLIGHT_MAX_RUSH = 4;
  private static readonly ASSEMBLE_PER_FRAME_RUSH = 3;
  private rushUntil = 0;
  /** ★ 预烘焙投递间隔（ms）：空闲时每拍投"前方条带"chunk（★ 2026-09-11：每拍 1 个，
   *  x/y 轴交替，减少同时计算量） */
  private static readonly PREFETCH_INTERVAL_MS = 220;
  /** 每拍预烘焙个数（★ 2026-09-11：2 → 1，轴间交替） */
  private static readonly PREFETCH_PER_TICK = 1;
  /** 预烘焙轴交替开关（每拍翻转，保证 x/y 前方都被覆盖） */
  private prefetchLaneAlt = false;
  /** 预烘焙节拍累加器 */
  private prefetchAccum = 0;
  /** 预烘焙方向（位移差分；本拍位移 ≥0.5m 才更新，否则沿用上次朝向） */
  private prefetchDirX = 1;
  private prefetchDirZ = 1;
  private prefetchMoveX = 0;
  private prefetchMoveZ = 0;
  private prefetchLastPx = NaN;
  private prefetchLastPz = NaN;
  /** 玩家当前 chunk（队列最近优先 + 预烘焙环扫描用） */
  private hotPcx = 0;
  private hotPcz = 0;
  /** ★ 移动方向（逐帧平滑；构建队列的前向优先加权用） */
  private moveDirSmX = 0;
  private moveDirSmZ = 0;
  private moveLastPx = NaN;
  private moveLastPz = NaN;
  /** 平滑移动方向单位向量（站立 → 0,0；数据加载/粗块请求共用） */
  private moveDirUnit(): { x: number; z: number } {
    const l = Math.hypot(this.moveDirSmX, this.moveDirSmZ);
    return l > 0.05 ? { x: this.moveDirSmX / l, z: this.moveDirSmZ / l } : { x: 0, z: 0 };
  }
  /** 构建优先级方向/加权（update 每帧刷新；构建队列与装配队列共用） */
  private prioDirX = 0;
  private prioDirZ = 0;
  private prioBoost = 0;
  /** 刷新构建优先级参数（移动方向平滑后调用） */
  private refreshBuildPriority(): void {
    const l = Math.hypot(this.moveDirSmX, this.moveDirSmZ);
    const moving = l > 0.05;
    this.prioDirX = moving ? this.moveDirSmX / l : 0;
    this.prioDirZ = moving ? this.moveDirSmZ / l : 0;
    this.prioBoost = moving && this.forwardBuiltCount(this.prioDirX, this.prioDirZ) < ChunkManager.FORWARD_MIN_BUILT
      ? ChunkManager.FORWARD_BONUS
      : ChunkManager.FORWARD_BONUS * 0.3;
  }
  /** ★ 构建优先级评分（越小越先）：角色所在 chunk 绝对第一 → 正前方三层 →
   *  十字臂（对角惩罚）→ 移动方向加权 → 最近优先。
   *  构建队列（processQueue）与装配队列（update 内）共用同一评分。 */
  private buildPriorityScore(cx: number, cz: number): number {
    const qdx = cx - this.hotPcx, qdz = cz - this.hotPcz;
    const d = Math.max(Math.abs(qdx), Math.abs(qdz));
    if (d === 0) return -2e6; // ★ 角色落点 chunk 第一（用户定调）
    if (this.frontKeys.has(chunkKeyOf(cx, cz))) return -1e6 + d;
    const cross = qdx !== 0 && qdz !== 0 ? ChunkManager.CROSS_PENALTY : 0;
    return d + cross - (qdx * this.prioDirX + qdz * this.prioDirZ) * this.prioBoost;
  }
  /** ★ 前向优先：构建环内前向已建数量低于该阈值 → 前向 chunk 加权抢占
   *  （用户定调：优先补角色当前移动方向上"数量不足"的 chunk） */
  private static readonly FORWARD_MIN_BUILT = 3;
  /** 前向投影加权系数（score = 距离 − 投影 × 系数；不足阈值全权重，足够时降权） */
  private static readonly FORWARD_BONUS = 1.2;
  /** ★ 细块十字形扩充（用户定调）：非轴（对角）格的惩罚——角色落点 chunk 起，
   *  十字臂（dx=0 或 dz=0）先铺满构建环，四角最后补（2 > 环距 1，臂优先于角） */
  private static readonly CROSS_PENALTY = 2;
  /** ★ 粗块请求前向加权（归一化投影；前向最多提前 ~1.5 环，环距仍是第一序） */
  private static readonly COARSE_FORWARD_BONUS = 1.5;
  /** ★ 地形光照可见距离（米）：超出 + 视野锥外的 chunk 材质不喂昼夜 uniform */
  private static readonly LIGHT_VISIBLE_DIST = 170;

  // ---- ★ 异步烘焙管线：重计算在 Worker，主线程零尖峰 ----
  /** 在途烘焙（key→请求；t=发起时刻供看门狗超时判定；bakeOnly=预烘焙只入缓存不建网格） */
  private pendingBakes = new Map<number, { cx: number; cz: number; gen: number; t: number; decor: DecorPlan; bakeOnly: boolean }>();
  /** 烘焙换代计数：dispose / 切地图风格时自增，使在途结果全部作废 */
  private bakeGen = 0;
  /** 看门狗节拍累加器 */
  private watchdogAccum = 0;
  /** 已激活 chunk 集合（激活回调只触发一次） */
  private activated = new Set<number>();
  /** 激活回调（玩家进入半径/首个网格落地时；特殊事件预留） */
  private onChunkActivated?: (cx: number, cz: number, key: number) => void;

  // ---- ★ 双 Worker 几何管线（2026-09-05：bake/geometry 两个 worker 并行） ----
  // 普通新建/重建 chunk 的几何生成全部走 terrainPatch worker（第二线程，与烘焙 worker
  // 流水并行），主线程只做"预算化装配"（BufferGeometry 上传 + rapier collider 重建），
  // 每帧最多 ASSEMBLE_PER_FRAME 个 → 流式创建不再出现几何计算的单帧尖峰。
  /** 几何在途（key → 占位；避免看门狗/重复请求在装配前二次派发） */
  private geoInflight = new Map<number, { cx: number; cz: number }>();
  /** 几何就绪、待帧预算装配的 chunk（maps/decor/几何字节就绪） */
  private assembleQueue: {
    key: number; cx: number; cz: number;
    maps: ChunkMaps; decor: DecorPlan | null; // null = 破坏重建(只换地形，见 rebuildTerrainOnly)
    deferDecor?: boolean; // 首建：先上地形，装饰层延后见 pendingDecorJobs
    decorMode?: 'none' | 'props' | 'full'; // ★ 挖坑局部重贴地：无影响/仅道具/整块（缺省 full）
    top: FaceGeometry; wall: FaceGeometry; water: WaterSurfaceRaw;
    cells?: PatchGroundCell[]; // ★ 物理分区（增量重建只含受影响分区；缺省 = 合并 trimesh）
    bounds?: { top: GeomBounds; wall: GeomBounds }; // ★ y 范围（Worker 扫出 → 解析构造包围球）
  }[] = [];
  /** 装配预算：几何就绪的 chunk 每帧最多 N 个（平滑 BufferGeometry/物理开销）
   *  ★ 2026-09：1 个/帧 + 耗时冷却（见 update）——单块装配超预算时，下一块推迟交付 */
  private static readonly ASSEMBLE_PER_FRAME = 1;
  /** 单块装配耗时预算（ms）：本次超过多少，下一块就等同等时间再装（把尖峰摊到后续帧） */
  private static readonly ASSEMBLE_BUDGET_MS = 8;
  /** 装配冷却截止时刻（performance.now；update 内消费） */
  private assembleCooldownUntil = 0;
  /** ★ 本帧装配耗时（ms；0 = 本帧未装配。WorldMode 读入 HUD，定位交付尖峰） */
  lastAssembleMs = 0;
  /** 装饰补挂冷却截止时刻（同上） */
  private decorCooldownUntil = 0;
  /** ★ 首建交付节拍（用户定调：700ms 交一块；挖坑重建不受限、优先放行） */
  private static readonly BUILD_RATE_MIN_INTERVAL_MS = 700;
  /** 上一块首建交付时刻（performance.now；节拍依据） */
  private lastBuildStamp = 0;
  /** 预烘积压上限：待装配队列达到此长度暂停预烘（保住提前量的同时防内存/worker 过载）
   *  ★ 2026-09-11：12 → 6（配合 700ms 节拍，减少"算好堆着"的数量） */
  private static readonly PREFETCH_BACKLOG_MAX = 6;
  /** ★ 远处 chunk 封存半径（切比雪夫，chunk 数）：> 此距离停止渲染 + 物理停用，
   *  但保留网格/碰撞体/装饰实体（回程瞬间恢复，零重建）；< 此距离自动解封。
   *  ★ 2026-09-12：6 → 5 → **4**（细化环收窄：可视/封存/内存三降；远景由粗块 LOD 接） */
  private static readonly PARK_RADIUS = 4;
  /** ★ 封存上限：超过此距离才真正销毁（释放资源、防内存无限累积）；
   *  滞回：构建 ≤2 → 预烘 ≤4 → 封存 4 → 销毁 6
   *  ★ 2026-09-12：8 → 6（封存区最多 48 块，砍掉 ≈70% 封存几何内存；更远留给粗块） */
  private static readonly DESTROY_RADIUS = 6;
  /** 已封存 chunk key（网格已从场景摘除、刚体已停用） */
  private parkedKeys = new Set<number>();

  // ---- ★ 延迟装饰（首建/破坏重建共用）：地形先上，装饰延后重贴地重建 ----
  // 以 chunkKey 为 key 去重（多坑连射只保留一个任务，补挂时取最新 levels 重计划）
  private pendingDecorJobs = new Map<number, { cx: number; cz: number; maps: ChunkMaps; mode: 'full' | 'props' }>();
  /** 每帧补挂装饰预算（个）—— 延后补挂同一 chunk 的 planDecor+buildDecorLayer+colliders */
  private static readonly DECOR_PER_FRAME = 1;
  /** 装饰补挂耗时预算（ms）：超出则下一块推迟（与装配同款冷却） */
  private static readonly DECOR_BUDGET_MS = 6;

  // ---- ★ 装饰脏区局部重贴地（2026-09-10）：挖坑不再整 chunk 重排装饰 ----
  /** 最近一次构建的装饰计划（挖坑影响判定 + 道具 y 重贴地数据源） */
  private decorCache = new Map<number, DecorPlan>();
  /** 本 chunk 攒下的挖动 1m cell（局部 idx = lz*60+lx）；full = 必须整块重贴地（邻块联动等） */
  private decorDirty = new Map<number, { cells: Set<number>; full: boolean }>();
  /** 已挂进 chunk group 的道具层引用（局部重贴地时只拆它，围裙/台座不动） */
  private propLayers = new Map<number, THREE.Object3D>();

  // ---- ★ 物理分区 collider 帧预算化（2026-09-10） ----
  /** 原位换队列：key = bodyId*1024+slot（同分区最新覆盖旧值）；典型一次挖 1 分区
   *  → 同帧排空；多分区/跨 chunk 联动时按 GROUND_CELL_PER_FRAME 分摊，避免单帧
   *  同步 cooking 尖峰（§17.8 的教训是 225 个 4m 小块逐帧 1 块 → 延迟过大，
   *  此处 9 分区 + 3/帧，最坏 3 帧，物理滞后可忽略） */
  private groundCellQueue = new Map<number, { bodyId: number; slot: number; vertices: Float32Array; indices: Uint32Array }>();
  private static readonly GROUND_CELL_PER_FRAME = 3;
  /** 物理分区原位换耗时预算（ms）：超出即停（防多分区同步 cooking 尖峰） */
  private static readonly GROUND_CELL_BUDGET_MS = 3;

  // ---- ★ 地形修改性能重构（原地更新，2026-09-09） ----
  // 计算侧（Worker 内 IncrementalGeometry 逐 cell 重发）本就增量；主线程开销大头
  // 是「新建 BufferGeometry×3 + 材质×2 + 整块 trimesh 销毁重建 + 装饰销毁重挂」。
  // 重构后：视觉 = Mesh/材质常驻、attr.array 原地写（长度变了整体换 geometry）；
  // 物理 = 维持每 chunk 一个合并 trimesh（分块方案实测失败，见 §17.8）；
  // 装饰保持既有语义（销毁 → pendingDecorJobs 预算化重贴地）。
  /** 原地更新地形视觉登记（key → top/wall/water mesh 引用） */
  private terrainVisuals = new Map<number, { top: THREE.Mesh; wall: THREE.Mesh | null; water: THREE.Mesh | null }>();

  // ---- ★ 地形补丁（§14.11 层数覆盖层） ----
  // ★ 单一真源 = RasterMap chunk 数据的 levels 表（生成不写、clearAll 随 chunk 回收）；
  //   ChunkManager 只是读/写者，不做副本（渲染几何/Worker/玩法高度采样同源）。
  /** ★ 测试地图（单 chunk 陈列馆 + 地块名标注；构造 opts.testChunk） */
  private readonly testChunk: boolean;

  constructor(
    scene: THREE.Scene, raster: RasterMap, host: ChunkGroundHost,
    opts?: { onChunkActivated?: (cx: number, cz: number, key: number) => void; testChunk?: boolean },
  ) {
    this.scene = scene;
    this.raster = raster;
    this.host = host;
    this.onChunkActivated = opts?.onChunkActivated;
    // ★ 测试地图：整个世界只有出生 chunk(0,0)，每块地块挂名字标牌
    //   （素材填充陈列馆；配合 TileGroups.setTestGroup 单组覆盖使用）
    this.testChunk = opts?.testChunk ?? false;
  }

  get isBoss4D(): boolean {
    return this.boss4D;
  }

  // ============================================================
  // 公共驱动入口（模式层每帧一行调用）
  // ============================================================

  /**
   * 出生区初始化：数据环扩张 + 出生 3×3 强制构建（不等队列调度）。
   * 标准风格走异步烘焙不阻塞主线程——角色 Y 由 clampCharacter 按
   * raster 高度场驱动，不依赖地面刚体先存在；
   * 地面视觉/刚体在头几帧内由烘焙结果补齐。
   */
  bootstrap(px: number, pz: number): void {
    this.syncChunks(px, pz);
    this.markHotChunk(px, pz);
    const scx = Math.floor(px / CHUNK_SIZE);
    const scz = Math.floor(pz / CHUNK_SIZE);
    if (this.testChunk) {
      // ★ 测试地图：仅建出生 chunk 一个（spawnPoint 恒在 (30,30) → chunk(0,0)）
      if (this.boss4D) this.buildChunkMesh(scx, scz);
      else this.requestStandardBake(scx, scz);
      return;
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (this.boss4D) this.buildChunkMesh(scx + dx, scz + dz);
        else this.requestStandardBake(scx + dx, scz + dz);
      }
    }
  }

  /** ★ 正前方三层 chunk（最高优先级：预烘与构建队列都最先处理；
   *  每层 = 前向第 k 排、横向铺满构建环宽度 ±BUILD_RADIUS） */
  private static readonly FRONT_LAYERS = 3;
  /** 当前正前方三层 chunk key 集（层内由近到远；每帧重算） */
  private frontKeys = new Set<number>();
  /** 角色正前方向（相机/朝向单位向量；WorldMode.update 传入） */
  private faceX = 0;
  private faceZ = 0;

  // ============================================================
  // ★ 地图两级构建：粗块（硬边/纯色/无物理/无水面/无装饰）→ 细化（全量）
  //   粗块：飞行期大半径铺（coarseOnly）＋ 探索期远景 LOD；
  //   细化：探索期近处环全量构建，完成时粗块退场（dropCoarse）。
  // ============================================================
  /** 粗块专属模式（航行期）：只走粗块管线，不投细化 */
  private coarseOnly = false;
  /** 粗块半径（±6 = 约 420m 视距；"±6 试试"用户定调） */
  private static readonly COARSE_RADIUS = 6;
  /** 每帧最多装配粗块数 */
  private static readonly COARSE_PER_FRAME = 3;
  /** 粗块补齐顺序（由内向外） */
  private static readonly COARSE_OFFSETS: { dx: number; dz: number }[] = (() => {
    const R = ChunkManager.COARSE_RADIUS;
    const out: { dx: number; dz: number }[] = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) out.push({ dx, dz });
    out.sort((a, b) => Math.max(Math.abs(a.dx), Math.abs(a.dz)) - Math.max(Math.abs(b.dx), Math.abs(b.dz)));
    return out;
  })();
  /** ★ 粗块请求顺序（移动方向优先；方向稳定时复用上次排序，避免每帧重排） */
  private coarseOrder: number[] | null = null;
  private coarseOrderScore: Float32Array | null = null;
  private coarseOrderDirX = 0;
  private coarseOrderDirZ = 0;
  /** 已装配粗块（key → group） */
  private coarseMeshes = new Map<number, THREE.Group>();
  /** 粗块几何在途（防重复请求） */
  private coarseInflight = new Set<number>();
  /** 粗块装配队列（几何到达 → 预算化建网格） */
  private coarseQueue: (() => void)[] = [];
  /** 粗块数据代（切风格/dispose 递增 → 丢弃迟到结果） */
  private coarseEpoch = 0;
  /** ★ 烘焙缓存 LRU 上限（块数；在用块不淘汰）与节拍 */
  private static readonly BAKE_CACHE_CAP = 32;
  private bakeTrimAccum = 0;
  private _coarseMat: THREE.MeshBasicMaterial | null = null;

  /** ★ 粗块模式开关（WorldMode：航行开、停靠关；关后粗块保留作远景 LOD） */
  setCoarseMode(v: boolean): void {
    this.coarseOnly = v;
  }

  private coarseMat(): THREE.MeshBasicMaterial {
    this._coarseMat ??= new THREE.MeshBasicMaterial({ vertexColors: true });
    return this._coarseMat;
  }

  /** ★ 水面网格显隐（航行期隐藏：不渲染水、不跑水面 FFT 着色；停靠恢复）。
   *  新装配的 chunk 水网格按当前开关创建。 */
  private waterVisible = true;
  setWaterVisible(v: boolean): void {
    if (this.waterVisible === v) return;
    this.waterVisible = v;
    for (const tv of this.terrainVisuals.values()) {
      if (tv.water) tv.water.visible = v;
    }
    // 常规网格组（非地形直挂路径）里的水网格一并切换
    for (const g of this.meshes.values()) {
      g.traverse((o) => {
        if (o.userData?.isWater === true) o.visible = v;
      });
    }
  }

  /** 每帧驱动：玩家驱动的无限扩张 + 看门狗自愈 + 几何装配预算 */
  update(px: number, pz: number, dt: number, faceX = 0, faceZ = 0): void {
    // ★ 热点 chunk 标记（玩家当前所在，用于降低该 chunk 重建节流间隔）
    this.markHotChunk(px, pz);
    // ★ 正前方三层（最高优先级；沿主轴方向分层、横向铺满，视角变化每帧重算）
    const fl = Math.hypot(faceX, faceZ);
    if (fl > 1e-4) {
      this.faceX = faceX / fl;
      this.faceZ = faceZ / fl;
    }
    this.frontKeys.clear();
    const ax = Math.abs(this.faceX), az = Math.abs(this.faceZ);
    if (ax > 1e-3 || az > 1e-3) {
      const alongX = ax >= az;
      const s = alongX ? (this.faceX >= 0 ? 1 : -1) : (this.faceZ >= 0 ? 1 : -1);
      const R = ChunkManager.BUILD_RADIUS;
      for (let k = 1; k <= ChunkManager.FRONT_LAYERS; k++) {
        // 先中间后两侧（预烘/装配优先顺序更顺路）
        for (let j = 0; j <= R; j++) {
          const offs = j === 0 ? [0] : [j, -j];
          for (const off of offs) {
            const cx = alongX ? this.hotPcx + s * k : this.hotPcx + off;
            const cz = alongX ? this.hotPcz + off : this.hotPcz + s * k;
            this.frontKeys.add(chunkKeyOf(cx, cz));
          }
        }
      }
    }
    // ★ 移动方向平滑（构建队列前向优先加权；站立时自然衰减归零）
    if (!Number.isNaN(this.moveLastPx)) {
      const mdx = px - this.moveLastPx, mdz = pz - this.moveLastPz;
      if (mdx * mdx + mdz * mdz > 1e-4) {
        this.moveDirSmX += (mdx - this.moveDirSmX) * 0.25;
        this.moveDirSmZ += (mdz - this.moveDirSmZ) * 0.25;
      } else {
        this.moveDirSmX *= 0.9;
        this.moveDirSmZ *= 0.9;
      }
    }
    this.moveLastPx = px;
    this.moveLastPz = pz;
    // ★ 构建优先级参数（角色 chunk 第一/十字/前向；构建+装配共用）
    this.refreshBuildPriority();
    // ★ 烘焙缓存 LRU 淘汰（2s 一拍；在用块跳过）——长距离跑图防显存无界增长
    this.bakeTrimAccum += dt;
    if (this.bakeTrimAccum >= 2) {
      this.bakeTrimAccum = 0;
      trimBakeCache(ChunkManager.BAKE_CACHE_CAP, (cx, cz) => {
        const key = chunkKeyOf(cx, cz);
        return this.meshes.has(key) || this.voidKeys.has(key);
      });
    }
    // ★ 粗块专属模式（航行）：只铺粗块（大半径、无物理/水面/装饰），不投细化
    if (this.coarseOnly) {
      const md = this.moveDirUnit();
      this.raster.updateChunks(px, pz, this.dataRadius(), md.x, md.z);
      this.syncCoarse(px, pz);
      this.flushCoarseQueue();
      this.parkFarChunks(px, pz);
      return;
    }
    // ★ 优先级：地形修改（坑洞）重建排在帧首，先于地形创建（2026-09-08 用户定调）
    this.flushPatchRebuilds();
    this.syncChunks(px, pz);
    // ★ 预烘焙（分批次提前生成）：空闲时向构建环外一档逐拍投递（只烘不建）
    this.prefetchChunks(px, pz, dt);
    // ★ 装配预算（时间感知 + 首建限流）：每帧最多 1 块；单块耗时超预算 → 冷却 (耗时−预算)；
    //   首建遵守滚动窗口 ≤2（挖坑重建不受限、优先放行）
    this.lastAssembleMs = 0;
    const rushing = performance.now() < this.rushUntil;
    let n = rushing ? ChunkManager.ASSEMBLE_PER_FRAME_RUSH : ChunkManager.ASSEMBLE_PER_FRAME;
    while (n-- > 0 && this.assembleQueue.length > 0
      && (rushing || performance.now() >= this.assembleCooldownUntil)) {
      // ★ 装配顺序 = 构建优先级（角色所在 chunk 第一；用户定调 2026-09-12）：
      //   装配队列按 bake 结果**到达顺序**堆积，若按 FIFO 装配，角色 chunk 会被
      //   先到的远处结果插队 → 这里按 buildPriorityScore 选出最高优先级项。
      //   首建限流时只放行重建（decor===null，挖坑链路）；没有则本帧停装。
      const onlyRebuild = !this.allowFirstBuild();
      let idx = -1, bestScore = Infinity;
      for (let i = 0; i < this.assembleQueue.length; i++) {
        const q = this.assembleQueue[i];
        if (onlyRebuild && q.decor !== null) continue;
        const sc = this.buildPriorityScore(q.cx, q.cz);
        if (sc < bestScore) { bestScore = sc; idx = i; }
      }
      if (idx === -1) break;
      const a = this.assembleQueue.splice(idx, 1)[0];
      // ★ 卸载范围外作废：unload 后晚到的 Worker 结果/队列项不再装配（防复活）
      if (Math.max(Math.abs(a.cx - this.hotPcx), Math.abs(a.cz - this.hotPcz)) > ChunkManager.PARK_RADIUS) {
        this.geoInflight.delete(a.key);
        continue;
      }
      this.geoInflight.delete(a.key);
      const _ta = performance.now();
      if (a.decor === null || a.deferDecor) {
        // ★ 首建/破坏重建统一走增量地形：只挂 top/wall/water + trimesh。
        //   装饰按脏区模式处理（none=不动 / props=只重贴道具 / full=整块重贴）。
        //   2026-09-09：挖坑重建优先原地更新（attr 写入 + 分块 collider 原位换）
        const mode = a.decorMode ?? 'full';
        this.rebuildTerrainOnly(a.cx, a.cz, a.maps, a.top, a.wall, a.water, a.cells, a.bounds, mode);
      } else {
        this.assembleTableChunk(a.cx, a.cz, a.maps, a.decor, a.top, a.wall, a.water, a.cells, a.bounds);
      }
      if (a.decor !== null && a.deferDecor) this.lastBuildStamp = performance.now();
      const _cost = performance.now() - _ta;
      this.lastAssembleMs = _cost;
      // ★ 全功率档不设冷却（高速移动宁可吃帧重也要连续交付地形）
      if (_cost > ChunkManager.ASSEMBLE_BUDGET_MS) {
        this.assembleCooldownUntil = performance.now() + (_cost - ChunkManager.ASSEMBLE_BUDGET_MS);
      }
    }
    // ★ 物理分区 collider 原位换：帧预算排空（典型单分区同帧生效；
    //   多分区联动按 3/帧分摊 + 耗时预算，防单帧同步 cooking 尖峰）
    if (this.host.updateGroundCell) {
      let g = ChunkManager.GROUND_CELL_PER_FRAME;
      const _tg = performance.now();
      while (g-- > 0 && this.groundCellQueue.size > 0) {
        // 已超时且本帧已换过至少一个 → 停止（保底第一个必换，物理滞后最小）
        if (g < ChunkManager.GROUND_CELL_PER_FRAME - 1 && performance.now() - _tg > ChunkManager.GROUND_CELL_BUDGET_MS) break;
        const firstKey = this.groundCellQueue.keys().next().value;
        if (firstKey === undefined) break;
        const c = this.groundCellQueue.get(firstKey)!;
        this.groundCellQueue.delete(firstKey);
        try {
          this.host.updateGroundCell(c.bodyId, c.slot, c.vertices, c.indices);
        } catch (e) {
          console.error('[ChunkManager] 分区 collider 原位换失败（保留旧碰撞体）', e);
        }
      }
    }
    // ★ 延迟装饰补挂：地形重建结束后重贴地（此刻 levels 已落库、
    //   surfaceHeightAt 含有挖坑下探）→ props 落到新坑面，不再浮空。
    //   每帧预算个 chunk（同样带耗时冷却）；同 chunk 多任务以更强模式合并（full > props）。
    let d = rushing ? ChunkManager.DECOR_PER_FRAME + 1 : ChunkManager.DECOR_PER_FRAME;
    while (d-- > 0 && this.pendingDecorJobs.size > 0
      && (rushing || performance.now() >= this.decorCooldownUntil)) {
      const _td = performance.now();
      const first = this.pendingDecorJobs.keys().next().value;
      if (first === undefined) break;
      const j = this.pendingDecorJobs.get(first)!;
      this.pendingDecorJobs.delete(first);
      const group = this.meshes.get(first);
      if (!group) continue; // chunk 已被销毁或为虚空
      if (j.mode === 'props') {
        // ★ 脏区局部：只重排/重贴受影响道具层（围裙/台座/碰撞体不动）——§17.11
        this.resnapProps(j.cx, j.cz, group);
        this.applyDecorCooldown(_td);
        continue;
      }
      // ★ 整块重贴地：以当前 levels 重计划整个 chunk 的装饰（props Y 含下探）
      const decor = this.planDecor(j.cx, j.cz);
      this.cacheDecorPlan(first, decor);
      const decorLayer = this.buildDecorLayer(j.cx, j.cz, decor);
      if (decorLayer) group.add(decorLayer.layer);
      // ★ 与 assembleTableChunk 同构：碰撞体与围裙/台座刚体独立于装饰层有无
      this.createDecorColliders(j.cx, j.cz, decor);
      this.createStructuralGround(j.cx, j.cz, decorLayer?.apronPhysics ?? null, decorLayer?.plinthPhysics ?? null);
      this.applyDecorCooldown(_td);
    }
    // ★ 看门狗：自愈一切"数据在、网格丢"的状态（Worker 被杀/消息丢失/
    //   装配异常等任何原因造成的空洞，0.5s 内补请求）
    // ★ 远景粗块（探索期：近处细化，远处粗块 LOD）
    this.syncCoarse(px, pz);
    this.flushCoarseQueue();
    this.sweepChunks(px, pz, dt);
  }

  /** 构建环内"移动方向前方"的已建数量（前向优先阈值判定；5×5 环最多 25 次查表） */
  private forwardBuiltCount(dirX: number, dirZ: number): number {
    const R = ChunkManager.BUILD_RADIUS;
    let n = 0;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dirX + dz * dirZ <= 0.1) continue; // 只统计前向格
        const key = chunkKeyOf(this.hotPcx + dx, this.hotPcz + dz);
        if (this.meshes.has(key) || this.voidKeys.has(key)) n++;
      }
    }
    return n;
  }

  /** ★ 地形光照可见性（每帧由 WorldMode.render 传入相机位置/前向）：
   *  视野锥（半角 75° + 距离余量）外的 chunk 材质标记 lightVisible=false，
   *  updateTerrainLighting/updateWallMaterialsLighting 跳过——进视野即恢复刷新。 */
  markLightVisibility(camX: number, camZ: number, fwdX: number, fwdZ: number): void {
    const fl = Math.hypot(fwdX, fwdZ) || 1;
    const fx = fwdX / fl, fz = fwdZ / fl;
    const cosLimit = Math.cos((75 * Math.PI) / 180);
    const maxD = ChunkManager.LIGHT_VISIBLE_DIST;
    for (const [key, vis] of this.terrainVisuals) {
      const cz = (key % 8192) - 4096;
      const cx = Math.floor(key / 8192) - 4096;
      const dx = (cx * CHUNK_SIZE + CHUNK_SIZE / 2) - camX;
      const dz = (cz * CHUNK_SIZE + CHUNK_SIZE / 2) - camZ;
      const dl = Math.hypot(dx, dz) || 1;
      const on = dl < maxD && (dx / dl) * fx + (dz / dl) * fz > cosLimit;
      (vis.top.material as THREE.Material).userData.lightVisible = on;
      if (vis.wall) (vis.wall.material as THREE.Material).userData.lightVisible = on;
    }
  }

  /** 首建节拍判定：距上一块首建交付 ≥ BUILD_RATE_MIN_INTERVAL_MS 才放行
   *  （降落冲刺窗口内全放行） */
  private allowFirstBuild(): boolean {
    if (performance.now() < this.rushUntil) return true;
    return performance.now() - this.lastBuildStamp >= ChunkManager.BUILD_RATE_MIN_INTERVAL_MS;
  }

  /** ★ 降落冲刺（WorldMode 进近调用）：立刻转细化 + 落点 3×3 强制构建，
   *  并在 `seconds` 秒内放开首建节流/在途闸门/装配预算——
   *  让"按下 F"的瞬间就开始实时细化装配（不再 0.7s 一块慢慢吞） */
  rushTerrain(px: number, pz: number, seconds = ChunkManager.RUSH_SECONDS): void {
    this.rushUntil = performance.now() + seconds * 1000;
    this.assembleCooldownUntil = 0;
    this.setCoarseMode(false);
    this.bootstrap(px, pz);
  }

  /** 装饰补挂耗时冷却：本次超过预算 → 下一块推迟同等时间（把尖峰摊到后续帧） */
  private applyDecorCooldown(t0: number): void {
    const cost = performance.now() - t0;
    if (cost > ChunkManager.DECOR_BUDGET_MS) {
      this.decorCooldownUntil = performance.now() + (cost - ChunkManager.DECOR_BUDGET_MS);
    }
  }

  /** ★ 地图风格切换：重建全部已加载 chunk 的物理+视觉 */
  setStyle(boss4D: boolean): void {
    if (this.boss4D === boss4D) return;
    this.boss4D = boss4D;
    // ★ boss4D 小水体 FFT 幅度略降（坑水帘走 waterWaveY 不受影响）；
    //   标准世界保持 1.0（L0 涌浪 hRms 0.10m，水池内半个波长——"面的起伏"可见）
    sharedWaterMaterial.uniforms.uAmpScale.value = boss4D ? 0.6 : 1.0;
    sharedWaterMaterial.uniforms.uChopScale.value = boss4D ? 0.6 : 1.0;
    // ★ 作废在途标准烘焙；未建成的 key 重新按当前风格构建
    this.bakeGen++;
    this.coarseEpoch++;            // ★ 粗块数据换代（丢弃迟到结果）
    this.clearCoarse();
    coarsePatch.clearCaches();   // ★ 粗池静态源缓存同换代
    terrainPatch.clearCaches(); // ★ 增量基座缓存随 chunk 数据换代作废
    this.geoInflight.clear();      // ★ 几何在途/待装配随风格换代作废
    this.assembleQueue.length = 0;
    this.pendingDecorJobs.clear(); // 延迟装饰随风格换代作废
    this.decorCache.clear();
    this.decorDirty.clear();
    this.propLayers.clear();
    this.groundCellQueue.clear(); // 物理原位换队列随风格换代作废
    for (const p of this.pendingBakes.values()) this.enqueueChunk(p.cx, p.cz, false);
    this.pendingBakes.clear();
    // ★ 可见 + 虚空一并重建（虚空块不在 meshes 里，漏掉会永远悬空）
    const keys = new Set<number>([...this.meshes.keys(), ...this.voidKeys]);
    for (const key of keys) {
      const cz = (key % 8192) - 4096;
      const cx = Math.floor(key / 8192) - 4096;
      if (boss4D) this.buildChunkMesh(cx, cz);          // boss4D 同步重建
      else this.requestStandardBake(cx, cz);            // 标准异步重建
    }
  }

  /** 完整清理（模式退出调用）：队列/在途作废 → 刚体 → 视觉 → 烘焙缓存 */
  dispose(): void {
    this.queue.length = 0;        // ★ 清空构建队列
    this.queuedKeys.clear();
    this.bakeGen++;
    this.coarseEpoch++;           // ★ 粗块数据换代（丢弃迟到结果）
    this.clearCoarse();
    this._coarseMat?.dispose();
    this._coarseMat = null;
    coarsePatch.clearCaches();    // ★ 粗池静态源缓存同清
    terrainPatch.clearCaches();   // ★ 增量基座缓存随 dispose 作废
    this.geoInflight.clear();     // ★ 几何在途/待装配随 dispose 作废
    this.assembleQueue.length = 0;
    this.pendingDecorJobs.clear(); // 延迟装饰随 dispose 作废
    this.decorCache.clear();
    this.decorDirty.clear();
    this.propLayers.clear();
    this.groundCellQueue.clear(); // 物理原位换队列随 dispose 作废
    // ★ 在途烘焙全部作废（Worker 结果到达后因换代+scene 空被丢弃）
    this.pendingBakes.clear();
    for (const id of this.bodies.values()) {
      this.host.destroyGround(id);
    }
    this.bodies.clear();
    for (const ids of this.propBodies.values()) {
      for (const id of ids) this.host.destroyGround(id);
    }
    this.propBodies.clear();
    this.propRegistry.clear();
    this.pendingPatches.clear();
    this.patchRebuilds.clear();
    for (const id of this.apronBodies.values()) {
      this.host.destroyGround(id);
    }
    this.apronBodies.clear();
    for (const id of this.plinthBodies.values()) {
      this.host.destroyGround(id);
    }
    this.plinthBodies.clear();
    for (const v of this.meshes.values()) {
      this.scene.remove(v);
      this.disposeVisual(v);
    }
    this.meshes.clear();
    this.voidKeys.clear();
    this.activated.clear();
    this.terrainVisuals.clear(); // ★ 原地更新登记随 dispose 作废
    clearWallMaterialRegistry();   // ★ 侧壁材质注册表清空（材质已由 disposeVisual 释放）
    disposePropRenderers(); // ★ 装饰共享几何/材质统一释放（chunk 重建不释放）
    disposeCementPlinthShared(); // ★ 台座共享几何/材质统一释放（模块级单例）
    disposeTileLabelCache(); // ★ 测试地图标牌纹理/材质统一释放（共享缓存唯一 dispose 点）
    releaseBakeCache(); // ★ 缓存纹理统一销毁（唯一缓存侧 dispose 点）
  }

  // ============================================================
  // 内部管线
  // ============================================================

  /**
   * ★ 看门狗（每 0.5s 一拍）：
   *   ① 在途烘焙超时（>8s = Worker 被杀/消息丢失）→ 释放占位；
   *   ② 加载环内"有数据、无网格、不在途、不在队"的 chunk → 补请求。
   * 二者合流：任何原因造成的空洞都会在下一拍自动重建成完整 chunk。
   */
  private sweepChunks(px: number, pz: number, dt: number): void {
    this.watchdogAccum += dt;
    if (this.watchdogAccum < 0.5) return;
    this.watchdogAccum = 0;

    const now = performance.now();
    for (const [key, p] of [...this.pendingBakes]) {
      if (now - p.t > 8000) {
        console.warn(`[ChunkManager] chunk(${p.cx},${p.cz}) 烘焙超时，释放占位待重试`);
        this.pendingBakes.delete(key);
      }
    }

    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    // ★ 远处 chunk 封存/解封/销毁（与航行预览期共用同一实现）
    this.parkFarChunks(px, pz);

    if (this.boss4D) return; // boss4D 同步构建，不存在异步空洞
    if (this.testChunk) {      // ★ 测试地图：只自愈 chunk(0,0)。注意邻居的"数据"是烘焙快照的
      //   ensureData 邻域采样（不可见、无物理），不等于加载——若不加此守卫，
      //   sweep 会见"有数据无网格"而把 8 个邻居全部重建出来。
      const key = chunkKeyOf(0, 0);
      if (!this.meshes.has(key) && !this.voidKeys.has(key)
        && !this.pendingBakes.has(key) && !this.queuedKeys.has(key)) {
        this.requestStandardBake(0, 0);
      }
      return;
    }
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const key = chunkKeyOf(cx, cz);
        if (this.meshes.has(key)) continue;
        if (this.pendingBakes.has(key)) continue;
        if (this.geoInflight.has(key)) continue;
        if (this.queuedKeys.has(key)) continue;
        if (!this.raster.getChunkData(cx, cz)) continue; // 数据未生成=本来就没排
        this.requestStandardBake(cx, cz);
      }
    }
  }

  /** ★ 卸载远处 chunk：视觉/地面物理/装饰碰撞实体/全部运行时索引一起销毁；
   *  chunk 数据与烘焙缓存保留 → 回程 syncChunks 命中缓存快速重建。
   *  ★ 在途请求同步作废，防晚到的 Worker 结果把已卸载 chunk"复活"。 */
  /** ★ 封存 chunk（>PARK_RADIUS）：视觉从场景摘除 + 刚体停用（保留对象/句柄/索引），
   *  回程 unparkChunk 瞬间恢复；不释放任何资源 */
  private parkChunk(key: number): void {
    const v = this.meshes.get(key);
    if (v) this.scene.remove(v);
    this.parkedKeys.add(key);
    this.host.setBodyEnabled?.(this.bodies.get(key) ?? -1, false);
    const props = this.propBodies.get(key);
    if (props) for (const id of props) this.host.setBodyEnabled?.(id, false);
    const apron = this.apronBodies.get(key);
    if (apron !== undefined) this.host.setBodyEnabled?.(apron, false);
    const plinth = this.plinthBodies.get(key);
    if (plinth !== undefined) this.host.setBodyEnabled?.(plinth, false);
  }

  /** ★ 解封 chunk（≤PARK_RADIUS）：视觉挂回场景 + 刚体启用（零重建、瞬时）；
   *  同时粗块退场（细化视觉回归） */
  private unparkChunk(key: number): void {
    this.parkedKeys.delete(key);
    this.dropCoarse(key);
    const v = this.meshes.get(key);
    if (v && !v.parent) this.scene.add(v);
    const body = this.bodies.get(key);
    if (body !== undefined) this.host.setBodyEnabled?.(body, true);
    const props = this.propBodies.get(key);
    if (props) for (const id of props) this.host.setBodyEnabled?.(id, true);
    const apron = this.apronBodies.get(key);
    if (apron !== undefined) this.host.setBodyEnabled?.(apron, true);
    const plinth = this.plinthBodies.get(key);
    if (plinth !== undefined) this.host.setBodyEnabled?.(plinth, true);
  }

  /** ★ 销毁 chunk（>DESTROY_RADIUS）：释放全部视觉/物理/索引（封存上限，防内存累积）；
   *  数据与烘焙缓存保留 → 回程 syncChunks 命中缓存重建。 */
  private destroyChunk(key: number): void {
    this.parkedKeys.delete(key);
    const v = this.meshes.get(key);
    if (v) {
      this.scene.remove(v);
      this.disposeVisual(v);
      this.meshes.delete(key);
    }
    this.voidKeys.delete(key);
    this.terrainVisuals.delete(key);
    const body = this.bodies.get(key);
    if (body !== undefined) {
      this.host.destroyGround(body);
      this.bodies.delete(key);
    }
    const props = this.propBodies.get(key);
    if (props) {
      for (const id of props) this.host.destroyGround(id);
      this.propBodies.delete(key);
    }
    this.propRegistry.delete(key);
    const apron = this.apronBodies.get(key);
    if (apron !== undefined) {
      this.host.destroyGround(apron);
      this.apronBodies.delete(key);
    }
    const plinth = this.plinthBodies.get(key);
    if (plinth !== undefined) {
      this.host.destroyGround(plinth);
      this.plinthBodies.delete(key);
    }
    // 运行时索引/缓存清理（装饰计划确定性重算，回程自动重建）
    this.decorCache.delete(key);
    this.propLayers.delete(key);
    this.decorDirty.delete(key);
    this.activated.delete(key);
    this.pendingDecorJobs.delete(key);
    // 在途请求作废
    this.queuedKeys.delete(key);
    this.geoInflight.delete(key);
    for (let i = this.assembleQueue.length - 1; i >= 0; i--) {
      if (this.assembleQueue[i].key === key) this.assembleQueue.splice(i, 1);
    }
  }

  private syncChunks(px: number, pz: number): void {
    if (this.testChunk) {
      // ★ 测试地图：坐标钳在出生 chunk 内 + loadRadius 0 → 永远只有 chunk(0,0)
      const cx0 = Math.min(CHUNK_SIZE - 1, Math.max(1, px));
      const cz0 = Math.min(CHUNK_SIZE - 1, Math.max(1, pz));
      const added0 = this.raster.updateChunks(cx0, cz0, 0);
      for (const { cx, cz } of added0) this.enqueueChunk(cx, cz, false);
      this.processQueue();
      return;
    }
    // ★ 数据环 = 预烘焙半径（±3 = 7×7），构建环另按 BUILD_RADIUS 取
    //   ★ 移动方向优先（用户定调）：方向上的数据块先加载
    const mdir = this.moveDirUnit();
    const added = this.raster.updateChunks(px, pz, this.dataRadius(), mdir.x, mdir.z);
    // 数据新增 → 已有网格的 3×3 邻域变了 → 接缝重建（排在新建之后处理）
    for (const { cx, cz } of added) {
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nkey = chunkKeyOf(cx + nx, cz + nz);
        if (this.meshes.has(nkey)) {
          this.enqueueChunk(cx + nx, cz + nz, true);
        }
      }
    }
    // ★ 构建环（玩家 ±BUILD_RADIUS）：不依赖 added 列表——数据早已生成而 chunk
    //   尚未建成的（跨区后回到旧区域/预烘焙环进入视野）同样会被补齐
    const R = ChunkManager.BUILD_RADIUS;
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const key = chunkKeyOf(cx, cz);
        if (this.meshes.has(key) || this.voidKeys.has(key)) continue;
        if (this.pendingBakes.has(key) || this.geoInflight.has(key)) continue;
        if (!this.raster.getChunkData(cx, cz)) continue;
        this.enqueueChunk(cx, cz, false);
      }
    }
    this.processQueue();
  }

  private enqueueChunk(cx: number, cz: number, rebuild: boolean): void {
    const key = chunkKeyOf(cx, cz);
    if (this.queuedKeys.has(key)) return;
    // 已建（可见或虚空，如出生区强制构建）
    if (!rebuild && (this.meshes.has(key) || this.voidKeys.has(key))) return;
    this.queuedKeys.add(key);
    this.queue.push({ cx, cz, rebuild });
  }

  /**
   * 每帧按时间预算消化构建队列。
   * ★ Boss4D 同步构建；标准风格走异步烘焙（本循环只做快照提取+投递，
   *   重计算在 Worker——单帧不再有"首项必建"的烘焙尖峰）。
   */
  private processQueue(): void {
    if (this.queue.length === 0) return;
    const t0 = performance.now();
    // ★ 优先级：坑洞重建在途/待投时压缩地形创建预算（地形创建优先级不高——
    //   2026-09-08 用户定调），把主线程+烘焙 worker 让给地形修改链路
    const patching = this.patchRebuilds.size > 0 || this.pendingPatches.size > 0;
    const budget = ChunkManager.BUILD_BUDGET_MS * (patching ? 0.5 : 1);
    while (this.queue.length > 0 && performance.now() - t0 < budget) {
      // ★ 在途闸门：构建类烘焙在途 ≤ BUILD_INFLIGHT_MAX
      //   （跨区新增一片/接缝重建批量时不再把多个烘焙任务同帧塞进 worker → 无爆发）
      //   ★ 降落冲刺窗口内放宽到 RUSH 上限（进近时限内把落点区铺出来）
      const inflightMax = performance.now() < this.rushUntil
        ? ChunkManager.BUILD_INFLIGHT_MAX_RUSH
        : ChunkManager.BUILD_INFLIGHT_MAX;
      if (!this.boss4D && this.countBuildInflight() >= inflightMax) break;
      // ★ 构建优先级（buildPriorityScore）：角色 chunk 绝对第一 → 正前方三层
      //   → 十字臂（对角惩罚）→ 前向加权 → 最近优先
      let best = 0, bestScore = Infinity;
      for (let i = 0; i < this.queue.length; i++) {
        const it = this.queue[i];
        const score = this.buildPriorityScore(it.cx, it.cz);
        if (score < bestScore) { bestScore = score; best = i; }
      }
      const item = this.queue.splice(best, 1)[0];
      const key = chunkKeyOf(item.cx, item.cz);
      this.queuedKeys.delete(key);
      if (this.boss4D) {
        if (item.rebuild) {
          // 可能已不在视野/已被销毁：有 mesh 才重建
          if (this.meshes.has(key)) this.buildChunkMesh(item.cx, item.cz);
        } else {
          this.buildChunkMesh(item.cx, item.cz);
        }
      } else {
        // 标准风格：重建与新建同走异步烘焙（结果到达后 replaceChunk 换装）
        if (!item.rebuild || this.meshes.has(key)) {
          this.requestStandardBake(item.cx, item.cz);
        }
      }
    }
  }

  /** 构建类（非预烘焙）在途数——processQueue 的闸门依据 */
  private countBuildInflight(): number {
    let n = 0;
    for (const p of this.pendingBakes.values()) if (!p.bakeOnly) n++;
    return n;
  }

  /** ★ 每拍卸载预算：远的优先（销毁/封存），防跨区一步销毁十几块的帧尖峰 */
  private static readonly UNLOAD_PER_SWEEP = 6;
  /** ★ 解封预算（回程回填视觉；超限下拍继续） */
  private static readonly UNPARK_PER_SWEEP = 12;

  /** ★ 远处全量 chunk 封存/解封/销毁（探索期由 sweepChunks 每 0.5s 调用；
   *  飞行粗块期每帧调用）：按距离降序 + 每拍预算化，防单帧批量 dispose 尖峰 */
  private parkFarChunks(px: number, pz: number): void {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const parkR = ChunkManager.PARK_RADIUS;
    const destroyR = ChunkManager.DESTROY_RADIUS;
    const destroys: { key: number; d: number }[] = [];
    const parks: { key: number; d: number }[] = [];
    const unparks: { key: number; d: number }[] = [];
    for (const key of [...this.meshes.keys(), ...this.voidKeys]) {
      const cz = (key % 8192) - 4096;
      const cx = Math.floor(key / 8192) - 4096;
      const d = Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz));
      if (d > destroyR) {
        destroys.push({ key, d });
      } else if (d > parkR) {
        if (!this.parkedKeys.has(key)) parks.push({ key, d });
      } else if (this.parkedKeys.has(key)) {
        unparks.push({ key, d });
      }
    }
    destroys.sort((a, b) => b.d - a.d); // 最远先卸
    parks.sort((a, b) => b.d - a.d);
    for (let i = 0; i < destroys.length && i < ChunkManager.UNLOAD_PER_SWEEP; i++) {
      this.destroyChunk(destroys[i].key);
    }
    for (let i = 0; i < parks.length && i < ChunkManager.UNLOAD_PER_SWEEP; i++) {
      this.parkChunk(parks[i].key);
    }
    // ★ 解封最近优先（用户定调）：回程时角色所在 chunk 先挂回视觉，
    //   而不是按 Map 迭代序（否则附近已解封一半、脚下还是粗块）
    unparks.sort((a, b) => a.d - b.d);
    for (let i = 0; i < unparks.length && i < ChunkManager.UNPARK_PER_SWEEP; i++) {
      this.unparkChunk(unparks[i].key);
    }
    // 粗块同样按范围剔除（超出粗块环 +1 即销毁重建；同样预算化）
    let coarseBudget = ChunkManager.UNLOAD_PER_SWEEP;
    for (const key of [...this.coarseMeshes.keys()]) {
      if (coarseBudget <= 0) break;
      const cz = (key % 8192) - 4096;
      const cx = Math.floor(key / 8192) - 4096;
      if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > ChunkManager.COARSE_RADIUS + 1) {
        this.dropCoarse(key);
        coarseBudget--;
      }
    }
  }

  // ============================================================
  // ★ 粗块管线（地图两级构建第一级）
  // ============================================================

  /** 数据环半径：取预烘半径与粗块半径+1 的较大者（粗块取数需要） */
  private dataRadius(): number {
    return Math.max(ChunkManager.PREFETCH_RADIUS, ChunkManager.COARSE_RADIUS + 1);
  }

  /** ★ 粗块请求顺序（移动方向优先）：score = 环距 − 前向投影 × 加权；
   *  站立（方向≈0）→ 纯由内向外；方向稳定时复用上次排序 */
  private coarseRequestOrder(): number[] {
    const n = ChunkManager.COARSE_OFFSETS.length;
    if (!this.coarseOrder) {
      this.coarseOrder = Array.from({ length: n }, (_, i) => i);
      this.coarseOrderScore = new Float32Array(n);
    }
    const dir = this.moveDirUnit();
    if (
      Math.abs(dir.x - this.coarseOrderDirX) > 0.15 ||
      Math.abs(dir.z - this.coarseOrderDirZ) > 0.15
    ) {
      const s = this.coarseOrderScore!;
      for (let i = 0; i < n; i++) {
        const o = ChunkManager.COARSE_OFFSETS[i];
        if (o.dx === 0 && o.dz === 0) { s[i] = -1e6; continue; } // ★ 舰船所在块第一
        const d = Math.max(Math.abs(o.dx), Math.abs(o.dz));
        // 环距为第一序（近处永远先于远处）；归一化前向投影为第二序（同环内方向优先）
        s[i] = d - ((o.dx * dir.x + o.dz * dir.z) / d) * ChunkManager.COARSE_FORWARD_BONUS;
      }
      this.coarseOrder.sort((a, b) => s[a] - s[b]);
      this.coarseOrderDirX = dir.x;
      this.coarseOrderDirZ = dir.z;
    }
    return this.coarseOrder;
  }

  /** 粗块请求/补齐：环内数据块（近处交给细化）→ coarsePatch worker；
   *  ★ 移动方向优先（用户定调）：方向上的环先铺 */
  private syncCoarse(px: number, pz: number): void {
    if (this.boss4D) return; // 四维空间不铺粗块（同步构建）
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const epoch = this.coarseEpoch;
    for (const oi of this.coarseRequestOrder()) {
      const o = ChunkManager.COARSE_OFFSETS[oi];
      const cx = pcx + o.dx, cz = pcz + o.dz;
      const key = chunkKeyOf(cx, cz);
      // ★ 细→粗降级：已封存的细化块（视觉已摘除）允许粗块接管，避免"走过就空"
      if (this.voidKeys.has(key)) continue;
      if (this.meshes.has(key) && !this.parkedKeys.has(key)) continue;
      if (this.coarseMeshes.has(key) || this.coarseInflight.has(key)) continue;
      // 探索期：近处（细化环内）留给细化，不铺粗块
      if (!this.coarseOnly && Math.max(Math.abs(o.dx), Math.abs(o.dz)) <= ChunkManager.BUILD_RADIUS) continue;
      if (!this.raster.getChunkData(cx, cz)) continue;
      this.coarseInflight.add(key);
      coarsePatch
        .compute(
          { seed: this.raster.worldSeed, cx, cz, palette: this.chunkPalette(cx, cz) },
          (a, b) => this.raster.getChunkData(a, b),
        )
        .then((geom) => {
          this.coarseInflight.delete(key);
          if (!geom || epoch !== this.coarseEpoch) return;
          this.coarseQueue.push(() => this.buildCoarseMesh(cx, cz, geom));
        });
    }
  }

  /** 粗块装配预算（每帧限量，防上传尖峰） */
  private flushCoarseQueue(): void {
    let n = ChunkManager.COARSE_PER_FRAME;
    while (n-- > 0 && this.coarseQueue.length > 0) this.coarseQueue.shift()!();
  }

  /** ★ 由粗几何建粗网格：纯色顶点色 + MeshBasic（无纹理/水面/装饰/物理） */
  private buildCoarseMesh(cx: number, cz: number, g: PatchGeomResult): void {
    const key = chunkKeyOf(cx, cz);
    if (this.coarseMeshes.has(key) || this.meshes.has(key) || this.voidKeys.has(key)) return;
    const mat = this.coarseMat();
    const group = new THREE.Group();
    const addPart = (part: { vertices: Float32Array; colors?: Float32Array; indices: Uint32Array }): void => {
      if (!part.indices || part.indices.length === 0) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(part.vertices, 3));
      const n = part.vertices.length / 3;
      geo.setAttribute('color', new THREE.BufferAttribute(
        part.colors && part.colors.length === n * 3 ? part.colors : new Float32Array(n * 3).fill(0.7), 3,
      ));
      geo.setIndex(new THREE.BufferAttribute(part.indices, 1));
      geo.computeBoundingSphere();
      group.add(new THREE.Mesh(geo, mat));
    };
    addPart(g.top);
    addPart(g.wall);
    group.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);
    this.scene.add(group);
    this.coarseMeshes.set(key, group);
  }

  /** 粗块退场（细化就位 / 超出范围 / dispose） */
  private dropCoarse(key: number): void {
    const g = this.coarseMeshes.get(key);
    if (!g) return;
    this.scene.remove(g);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.coarseMeshes.delete(key);
  }

  private clearCoarse(): void {
    for (const key of [...this.coarseMeshes.keys()]) this.dropCoarse(key);
    this.coarseQueue.length = 0;
    this.coarseInflight.clear();
  }

  /**
   * ★ 预烘焙（分批次提前生成，2026-09-10）：空闲时每拍投 **1 个 x 轴前方 + 1 个 y 轴
   *   前方**的"只烘焙不建网格"chunk（沿移动方向的前方条带，横向由近到远）。
   *   进入构建环时缓存命中 → 直接几何+装配，零烘焙等待；不提前占网格/物理/装饰。
   */
  private prefetchChunks(px: number, pz: number, dt: number): void {
    if (this.boss4D || this.testChunk) return;
    if (Number.isNaN(this.prefetchLastPx)) {
      this.prefetchLastPx = px;
      this.prefetchLastPz = pz;
    }
    this.prefetchMoveX += px - this.prefetchLastPx;
    this.prefetchMoveZ += pz - this.prefetchLastPz;
    this.prefetchLastPx = px;
    this.prefetchLastPz = pz;
    this.prefetchAccum += dt;
    if (this.prefetchAccum < ChunkManager.PREFETCH_INTERVAL_MS) return;
    this.prefetchAccum = 0;
    // 方向：本拍实际位移 ≥0.5m 才更新（站立/微抖沿用上次朝向）
    if (Math.abs(this.prefetchMoveX) > 0.5) this.prefetchDirX = Math.sign(this.prefetchMoveX);
    if (Math.abs(this.prefetchMoveZ) > 0.5) this.prefetchDirZ = Math.sign(this.prefetchMoveZ);
    this.prefetchMoveX = 0;
    this.prefetchMoveZ = 0;
    // 有建造成本在途（raster 生成/烘焙/挖掘重建）→ 不抢 worker；
    // ★ 装配积压不再阻塞预烘（提前算好，等限流慢慢交付），仅以积压上限约束
    if (this.queue.length > 0 || this.pendingBakes.size > 0) return;
    if (this.patchRebuilds.size > 0 || this.pendingPatches.size > 0) return;
    if (this.assembleQueue.length >= ChunkManager.PREFETCH_BACKLOG_MAX) return;
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    // ★ 最高优先级：角色正前方三层先投（每拍上限内，层内由中间向两侧）
    let sent = 0;
    for (const key of this.frontKeys) {
      if (sent >= ChunkManager.PREFETCH_PER_TICK) break;
      const cz = (key % 8192) - 4096;
      const cx = Math.floor(key / 8192) - 4096;
      if (this.tryPrefetch(cx, cz)) sent++;
    }
    // 再走轴间交替（每拍 1 块，x/y 前方轮流覆盖）；都取不到再环扫兜底
    this.prefetchLaneAlt = !this.prefetchLaneAlt;
    const xFirst = this.prefetchLaneAlt;
    if (sent < ChunkManager.PREFETCH_PER_TICK && this.prefetchAxisLane(pcx, pcz, xFirst, xFirst ? this.prefetchDirX : this.prefetchDirZ)) sent++;
    if (sent < ChunkManager.PREFETCH_PER_TICK && this.prefetchAxisLane(pcx, pcz, !xFirst, xFirst ? this.prefetchDirZ : this.prefetchDirX)) sent++;
    if (sent < ChunkManager.PREFETCH_PER_TICK) this.prefetchRingFallback(pcx, pcz);
  }

  /** 沿 x/y 轴"前方"条带预烘一个：轴向前移（构建环外一档起），横向偏移按 |k| 由近到远 */
  private prefetchAxisLane(pcx: number, pcz: number, xAxis: boolean, dir: number): boolean {
    for (let ring = ChunkManager.BUILD_RADIUS + 1; ring <= ChunkManager.PREFETCH_RADIUS; ring++) {
      const base = (xAxis ? pcx : pcz) + dir * ring;
      for (const k of [0, 1, -1, 2, -2]) {
        const cx = xAxis ? base : pcx + k;
        const cz = xAxis ? pcz + k : base;
        if (this.tryPrefetch(cx, cz)) return true;
      }
    }
    return false;
  }

  /** 环扫兜底（角落/后方；从构建环外一档到预烘半径由近到远） */
  private prefetchRingFallback(pcx: number, pcz: number): void {
    for (let ring = ChunkManager.BUILD_RADIUS + 1; ring <= ChunkManager.PREFETCH_RADIUS; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          if (this.tryPrefetch(pcx + dx, pcz + dz)) return;
        }
      }
    }
  }

  /** 单个预烘投递（占用/已有缓存检查；命中即投 "只烘不建" 请求） */
  private tryPrefetch(cx: number, cz: number): boolean {
    const key = chunkKeyOf(cx, cz);
    if (this.meshes.has(key) || this.voidKeys.has(key)) return false;
    if (this.pendingBakes.has(key) || this.queuedKeys.has(key) || this.geoInflight.has(key)) return false;
    if (!this.raster.getChunkData(cx, cz)) return false;
    if (getCachedChunkMaps(this.raster.worldSeed, cx, cz)) return false;
    this.requestStandardBake(cx, cz, true);
    return true;
  }

  /**
   * ★ 装饰计划（预渲染前完成放置）：
   * 贴图 + 装饰物都在烘焙【之前】放置——装饰物高度参与预渲染结构
   * （其阴影体积随快照进 Worker 印进光照图；贴图印进 albedo）。
   * 确定性：同 seed 同 chunk 结果恒定，烘焙与装配两侧消费同一份计划。
   */
  /** 取本 chunk 所属组的调色板（融合原 RegionTheme；缺省中性） */
  private chunkPalette(cx: number, cz: number): GroupPalette | undefined {
    const key = this.raster.getChunkData(cx, cz)?.groupKey;
    return key ? groupByKey(key)?.palette : undefined;
  }

  private planDecor(cx: number, cz: number): DecorPlan {
    const chunkData = this.raster.getChunkData(cx, cz);
    if (!chunkData) {
      console.warn(`[ChunkManager][装饰] chunk(${cx},${cz}) 无 ChunkData，装饰跳过`);
      return { decals: [], props: [], propVolumes: new Float32Array(0) };
    }
    const base = {
      seed: this.raster.worldSeed, cx, cz,
      groupKey: chunkData.groupKey, blockTypes: chunkData.blockTypes,
    };
    const decals = planChunkDecals(base);
    const props = planChunkProps({
      ...base,
      // ★ 贴地采样 = 表驱动视觉面（含 Levels 覆盖；与角色脚底同函数）
      surfaceHeightAt: (x, z) => this.raster.surfaceHeightAt(x, z),
    });
    const vols = computePropVolumes(props, cx, cz);
    return { decals, props, propVolumes: packVolumes(vols) };
  }

  /**
   * ★ 标准风格构建①：装饰放置 → 缓存查询 → 快照投给 Worker
   * （无 Worker 时同步回退直建）。同 key 已在途则跳过；
   * 缓存命中则跳过烘焙直接装配（装饰计划确定性重算，结果一致）。
   * @param bakeOnly 预烘焙：只烘进缓存，不建网格（进入构建环时缓存命中即建）
   */
  private requestStandardBake(cx: number, cz: number, bakeOnly = false): void {
    const key = chunkKeyOf(cx, cz);
    const existing = this.pendingBakes.get(key);
    if (existing) {
      // ★ 预烘焙在途时来了正式构建需求 → 升级为"烘完即建"
      if (!bakeOnly) existing.bakeOnly = false;
      return;
    }
    const seed = this.raster.worldSeed;

    // ★ 装饰先行：预渲染（烘焙）前完成贴图与装饰物的放置
    const decor = this.planDecor(cx, cz);

    // ★ 烘焙缓存命中：接缝重建 / 风格切换往返零重烘（纹理复用）
    const cached = getCachedChunkMaps(seed, cx, cz);
    if (cached) {
      if (!bakeOnly) this.finishStandardChunk(cx, cz, cached, decor);
      return;
    }

    const gen = this.bakeGen;
    // ★ 快照前补齐覆盖区数据环（确定性纯生成，亚毫秒）：
    //   烘焙输出与加载顺序无关，射线永不见"未加载=0"的假邻域
    //   ——接缝重建从此只需重建几何，不再需要重烘焙
    const p = terrainBaker.request(
      (gcx, gcz) => {
        this.raster.ensureData(gcx, gcz);
        return this.raster.getChunkData(gcx, gcz);
      },
      seed, cx, cz,
      { propVolumes: decor.propVolumes, decals: decor.decals },
    );
    if (!p) {
      // Worker 不可用（如微信端未适配）：主线程同步烘 + 入缓存（+ 非预烘焙时立即建）
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) this.raster.ensureData(cx + dx, cz + dz);
      const maps = bakeChunkMaps(this.raster, cx, cz, {
        propVolumes: decor.propVolumes, decals: decor.decals,
      }, this.chunkPalette(cx, cz));
      cacheChunkMaps(seed, cx, cz, maps);
      if (!bakeOnly) this.finishStandardChunk(cx, cz, maps, decor);
      return;
    }
    this.pendingBakes.set(key, { cx, cz, gen, t: performance.now(), decor, bakeOnly });
    p.then((bufs) => {
      const rec = this.pendingBakes.get(key);
      if (rec?.gen !== gen) return; // 换代（切风格/dispose）已作废
      this.pendingBakes.delete(key);
      this.completeStandardBake(cx, cz, seed, bufs, decor, rec.bakeOnly);
    });
  }

  /**
   * ★ 烘焙完成落地（组装+入缓存；非预烘焙才建网格）。
   * 任何一步异常都回退主线程同步烘焙——绝不让 chunk 因单次失败而
   * 永久消失（"整片区域踩虚空"bug 的根因即此处的无兜底 rejection）。
   */
  private completeStandardBake(
    cx: number, cz: number, seed: number,
    bufs: BakeResult | null, decor: DecorPlan, bakeOnly = false,
  ): void {
    try {
      const maps = bufs ? assembleChunkMaps(bufs.albedo, bufs.light, bufs.low) : null;
      if (maps) {
        cacheChunkMaps(seed, cx, cz, maps);
        if (!bakeOnly) this.finishStandardChunk(cx, cz, maps, decor); // 预烘焙：只入缓存
        return;
      }
      throw new Error('空结果');
    } catch (e) {
      console.error(`[ChunkManager] chunk(${cx},${cz}) 异步装配失败，回退主线程同步烘焙`, e);
      try {
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) this.raster.ensureData(cx + dx, cz + dz);
        const maps = bakeChunkMaps(this.raster, cx, cz, {
          propVolumes: decor.propVolumes, decals: decor.decals,
        }, this.chunkPalette(cx, cz));
        cacheChunkMaps(seed, cx, cz, maps);
        if (!bakeOnly) this.finishStandardChunk(cx, cz, maps, decor);
      } catch (e2) {
        // 不入缓存：看门狗 sweep 会在下个周期重新走完整请求
        console.error(`[ChunkManager] chunk(${cx},${cz}) 同步回退也失败，交由看门狗重试`, e2);
      }
    }
  }

  /**
   * ★ 标准风格构建②：像素就绪 → 几何（Worker）→ 预算化装配。
   * 顶面几何走表驱动（coarse/fine 0.125m；§14.10/14.11 补丁、Levels 覆盖同源）；
   * 物理 trimesh = 顶面 + 侧壁同一份缓冲合并（碰撞=所见不变式）。
   * ★ 几何生成在 terrainPatch worker（与烘焙 worker 并行）；主线程只排队装配
   *   （每帧预算 ASSEMBLE_PER_FRAME）。Worker 不可用/故障 → 主线程同步同函数。
   */
  private finishStandardChunk(cx: number, cz: number, maps: ChunkMaps, decor: DecorPlan): void {
    const key = chunkKeyOf(cx, cz);
    if (this.geoInflight.has(key)) return; // 已在途：装配时自然带最新数据
    const gen = this.bakeGen;
    this.geoInflight.set(key, { cx, cz });
    const levels = this.raster.levelsOf(cx, cz);
    const readChunk = (ccx: number, ccz: number) => this.raster.getChunkData(ccx, ccz);
    terrainPatch
      .compute({ seed: this.raster.worldSeed, cx, cz, levels: new Uint8Array(levels) }, readChunk)
      .then((geom) => {
        if (this.bakeGen !== gen) return; // 换代（切风格/dispose）已作废
        if (geom) {
const key2 = chunkKeyOf(cx, cz);
          // ★ 首建延迟装饰：chunk 无现存网格时先只上地形，装饰延后（无关紧要）
          const isFirstBuild = !this.meshes.has(key2) && !this.voidKeys.has(key2);
          this.assembleQueue.push({
            key: key2, cx, cz, maps,
            decor, // 仅 isFirstBuild=false（重建已有）时用于完整装配
            deferDecor: isFirstBuild,
            top: geom.top, wall: geom.wall, water: geom.water,
            cells: geom.cells,
            bounds: { top: geom.topBounds, wall: geom.wallBounds },
          });
          return;
        }
        // Worker 故障批 → 主线程同步同函数（字节一致；见 PatchCompute）
        this.geoInflight.delete(key);
        try {
          const g = computeTableGeometry(readChunk, this.raster.worldSeed, cx, cz, new Uint8Array(levels));
          this.assembleTableChunk(cx, cz, maps, decor, g.top, g.wall, g.water, g.cells, { top: g.topBounds, wall: g.wallBounds });
        } catch (e) {
          console.error(`[ChunkManager] chunk(${cx},${cz}) 同步几何失败，交看门狗重试`, e);
        }
      })
      .catch((e) => {
        console.error(`[ChunkManager] chunk(${cx},${cz}) Worker 几何异常，交看门狗重试`, e);
        this.geoInflight.delete(key);
      });
  }

  /**
   * ★ 表几何装配（几何字节 → 材质/Group/装饰/物理/换装）：
   * 新建/重建/破坏 Worker 结果与同步兜底共用同一装配（几何来源不同，装配唯一）。
   * 2026-09-09：网格/材质构建收敛到 buildTerrainMeshes（登记 terrainVisuals +
   * 包围球余量）；地面刚体经 replaceChunk 走整 chunk 合并 trimesh。
   */
  private assembleTableChunk(
    cx: number,
    cz: number,
    maps: ChunkMaps,
    decor: DecorPlan,
    topG: FaceGeometry,
    wallG: FaceGeometry,
    waterG?: WaterSurfaceRaw,
    cells?: PatchGroundCell[],
    bounds?: { top: GeomBounds; wall: GeomBounds },
  ): void {
    const key = chunkKeyOf(cx, cz);
    const cfg = this.buildTerrainMeshes(cx, cz, maps, topG, wallG, waterG, bounds);
    const group = new THREE.Group();
    for (const m of cfg.meshes) group.add(m);
    group.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);

    const decorLayer = this.buildDecorLayer(cx, cz, decor);
    // ★ 装饰计划入缓存（挖坑脏区局部重贴地的判定/数据源；§17.11）
    this.cacheDecorPlan(key, decor);
    if (decorLayer) group.add(decorLayer.layer);
    (group.userData as { terrainCount?: number }).terrainCount = cfg.meshes.length;

    // 物理：分区优先（cells → grid×grid collider），兜底整 chunk 合并 trimesh
    this.replaceChunk(key, group, cx, cz, cfg.pv, cfg.pi, cells);
    this.createDecorColliders(cx, cz, decor);
    this.createStructuralGround(cx, cz, decorLayer?.apronPhysics ?? null, decorLayer?.plinthPhysics ?? null);
  }
/**
   * ★ 破坏重建/首建（2026-09-09 原地更新重构）：
   *   - 已有网格（挖坑重建）→ applyTerrainPatchInPlace：视觉 attr 原地写 +
   *     物理只换受影响 4m 块 collider + 装饰既有销毁重挂语义；任一步失败 →
   *     回退全量换装（replaceChunk，与旧路径一致）。
   *   - 首建 → 地形 mesh + 整 chunk 合并地面刚体。
   *   - void 保持虚空（levels 已落库，数据正确）。
   *   旧装饰层销毁语义不变（props 定位于挖坑前高度——重贴地由 pendingDecorJobs
   *   预算化重造）；围裙/台座刚体同样销毁重建（装饰补挂时 createStructuralGround）。
   */
  private rebuildTerrainOnly(
    cx: number, cz: number, maps: ChunkMaps,
    topG: FaceGeometry, wallG: FaceGeometry, waterG?: WaterSurfaceRaw,
    cells?: PatchGroundCell[],
    bounds?: { top: GeomBounds; wall: GeomBounds },
    decorMode: 'none' | 'props' | 'full' = 'full',
  ): void {
    const key = chunkKeyOf(cx, cz);
    if (this.meshes.has(key)) {
      // ★ 挖坑增量：视觉原地写 + 受影响物理分区原位换；失败回退全量换装
      if (cells && cells.length > 0 && this.applyTerrainPatchInPlace(key, topG, wallG, waterG, cells, bounds, decorMode)) {
        // ★ 原地更新成功：装饰按脏区模式排队（none = 完全不动，零重排/零重建）
        if (decorMode !== 'none') this.queueDecorJob(cx, cz, maps, decorMode === 'props' ? 'props' : 'full');
        return;
      }
      const cfg = this.buildTerrainMeshes(cx, cz, maps, topG, wallG, waterG, bounds);
      const group = new THREE.Group();
      for (const m of cfg.meshes) group.add(m);
      group.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);
      // 地形网格数（top/wall/water；装饰由补挂循环挂在其后）
      (group.userData as { terrainCount?: number }).terrainCount = cfg.meshes.length;
      // 有现存网格（破坏重建/结构重建）：replaceChunk 统一拆旧——
      // 旧地形与装饰视觉、旧 trimesh、旧 propBodies/注册表/围裙/台座全清
      this.replaceChunk(key, group, cx, cz, cfg.pv, cfg.pi, cells);
      // ★ 全量换装把装饰整体销毁了 → 必须整块重贴地
      this.queueDecorJob(cx, cz, maps, 'full');
      return;
    }
    if (!this.voidKeys.has(key)) {
      // 首建：无现存网格 → 只挂地形 mesh + 分区地面（装饰后补）
      const cfg = this.buildTerrainMeshes(cx, cz, maps, topG, wallG, waterG, bounds);
      const group = new THREE.Group();
      for (const m of cfg.meshes) group.add(m);
      group.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);
      (group.userData as { terrainCount?: number }).terrainCount = cfg.meshes.length;
      this.scene.add(group);
      this.meshes.set(key, group);
      this.dropCoarse(key); // ★ 细化就位 → 粗块退场
      this.createChunkGround(key, cx, cz, cfg.pv, cfg.pi, cells);
      this.queueDecorJob(cx, cz, maps, 'full');
    }
  }

  /**
   * ★ 原地更新（挖坑增量核心，2026-09-09）：不再新建 BufferGeometry/材质/整 chunk trimesh——
   *   ① 视觉：top/wall 原地写（Tier A：布局一致 → attr.array.set 零分配；
   *      Tier B：布局漂移 → 整体换 geometry，Mesh/材质保留）；
   *   ② 物理：只原位换受影响分区 collider（grid×grid；O(受影响分区) 提前返回）；
   *   ③ 水：小网格拓扑可变（干块摘除/拆池）→ 整体换 mesh（廉价）；
   *   ④ 装饰：按脏区模式处理——none=保留旧装饰（最省）/ props=只拆道具层 /
   *      full=拆整层；重贴地由 pendingDecorJobs 预算化补挂（§17.11）。
   *   任一失败 → 返回 false，调用方回退全量换装（分区全量重建）。
   */
  private applyTerrainPatchInPlace(
    key: number,
    topG: FaceGeometry, wallG: FaceGeometry,
    waterG: WaterSurfaceRaw | undefined,
    cells: PatchGroundCell[],
    bounds?: { top: GeomBounds; wall: GeomBounds },
    decorMode: 'none' | 'props' | 'full' = 'full',
  ): boolean {
    const entry = this.terrainVisuals.get(key);
    const group = this.meshes.get(key) as THREE.Group | undefined;
    const bodyId = this.bodies.get(key);
    if (!entry || !group || bodyId === undefined) return false;
    if (!this.host.updateGroundCell) return false;

    // ① 视觉（先视觉后物理：失败即回退，物理不动）
    if (!this.applyGeoInPlace(entry.top, topG, false, bounds?.top)) return false;
    if (wallG.indices.length > 0) {
      if (!entry.wall || !this.applyGeoInPlace(entry.wall, wallG, true, bounds?.wall)) return false;
    } else if (entry.wall) {
      return false; // 防御：墙消失（现管线不发生）→ 回退全量
    }
    // ④ 装饰：按脏区模式处理（none=保留 / props=只拆道具层 / full=拆整层）
    if (decorMode === 'full') this.teardownDecorOnly(key, group);
    else if (decorMode === 'props') this.teardownPropsOnly(key);
    // ③ 水：小网格整体换（拓扑可变）
    this.replaceWaterMesh(group, entry, waterG);
    // ② 物理：受影响分区入队（帧预算排空；同 slot 最新覆盖，其余分区不动）
    for (const c of cells) {
      this.groundCellQueue.set(bodyId * 1024 + c.slot, {
        bodyId, slot: c.slot, vertices: c.vertices, indices: c.indices,
      });
    }
    return true;
  }

  /** ② 视觉原地写（两档）：
   *  Tier A 布局稳定（顶点/索引数一致）→ 逐属性 array.set（零分配）；
   *    ★ 若输出带 updateRanges（增量未漂移）→ 只拷/传受影响区间（几 KB~几十 KB），
   *      替代整块数 MB 的 CPU 拷贝 + GPU 重传（带宽优先路径）。
   *  Tier B 布局漂移（fine 区扩张 → 顶点数变化）→ 整体换 geometry（Mesh/材质保留，
   *  旧 GPU 缓冲 dispose，新缓冲渲染时惰性上传） */
  private applyGeoInPlace(
    mesh: THREE.Mesh, g: FaceGeometry, withShade: boolean, bounds?: GeomBounds,
  ): boolean {
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    const idx = geo.getIndex();
    const shade = withShade ? (geo.getAttribute("shade") as THREE.BufferAttribute | undefined) : undefined;
    // Tier A 前提：顶点/索引布局一致（其余属性长度随顶点数；shade 随壁顶点数）
    const stable = !!pos && !!idx &&
      pos.array.length === g.vertices.length &&
      idx.array.length === g.indices.length &&
      (!withShade || (!!g.shade && !!shade && shade.array.length === g.shade.length));
    // ★ 局部区间上传（增量未漂移时）：只动受影响顶点/索引段
    if (stable && g.updateRanges && g.updateRanges.vertex.length > 0) {
      const ur = g.updateRanges;
      const ok =
        this.copyAttrRanges(geo, "position", g.vertices, ur.vertex) &&
        this.copyAttrRanges(geo, "normal", g.normals, ur.vertex) &&
        this.copyAttrRanges(geo, "uv", g.uvs, ur.vertex) &&
        this.copyAttrRanges(geo, "color", g.colors, ur.vertex) &&
        this.copyAttrRanges(geo, "apw", g.patchW, ur.vertex) &&
        (!withShade || this.copyAttrRanges(geo, "shade", g.shade, ur.vertex)) &&
        this.copyAttrRanges(geo, "index", g.indices, ur.index, true);
      if (ok) {
        if (bounds) this.setPaddedSphere(geo, bounds);
        return true;
      }
      // 局部失败（异常属性缺失）→ 落入下方整块兜底
    }
    if (stable) {
      const setArr = (name: string, arr: Float32Array | undefined): boolean => {
        if (!arr) return true; // 属性可缺省（未产出不消费）
        const a = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
        if (!a || a.array.length !== arr.length) return false;
        (a.array as Float32Array).set(arr);
        a.needsUpdate = true;
        return true;
      };
      if (
        setArr("position", g.vertices) && setArr("normal", g.normals) &&
        setArr("uv", g.uvs) && setArr("color", g.colors) && setArr("apw", g.patchW) &&
        (!withShade || setArr("shade", g.shade))
      ) {
        (idx.array as Uint32Array).set(g.indices);
        idx.needsUpdate = true;
        if (bounds) this.setPaddedSphere(geo, bounds);
        return true;
      }
      return false; // 属性缺失等意外 → 回退全量
    }
    // Tier B：整体换 geometry（Mesh/材质/物理保留；原地路径存活 → 下次仍走增量）
    const ng = new THREE.BufferGeometry();
    ng.setAttribute("position", new THREE.BufferAttribute(g.vertices, 3));
    ng.setAttribute("normal", new THREE.BufferAttribute(g.normals, 3));
    if (g.uvs) ng.setAttribute("uv", new THREE.BufferAttribute(g.uvs, 2));
    if (g.colors) ng.setAttribute("color", new THREE.BufferAttribute(g.colors, 3));
    if (g.patchW) ng.setAttribute("apw", new THREE.BufferAttribute(g.patchW, 1));
    if (withShade && g.shade) ng.setAttribute("shade", new THREE.BufferAttribute(g.shade, 1));
    ng.setIndex(new THREE.BufferAttribute(g.indices, 1));
    this.setPaddedSphere(ng, bounds);
    mesh.geometry = ng;
    geo.dispose();
    return true;
  }

  /** ★ 区间拷贝 + addUpdateRange（three 上传后自动清空区间）：
   *  ranges 单位 = 顶点/索引下标；按 attribute.itemSize 换算成元素偏移。
   *  isIndex=true 时处理索引属性（name 传 "index"）。属性缺省规则与整块路径一致。 */
  private copyAttrRanges(
    geo: THREE.BufferGeometry, name: string,
    src: Float32Array | Uint32Array | undefined,
    ranges: { start: number; count: number }[],
    isIndex = false,
  ): boolean {
    const a = (isIndex ? geo.getIndex() : geo.getAttribute(name)) as THREE.BufferAttribute | null | undefined;
    if (!src) return true; // 属性可缺省（未产出不消费）
    if (!a) return false;
    if (a.array.length !== src.length) return false;
    const dst = a.array as Float32Array | Uint32Array;
    const stride = a.itemSize;
    for (const r of ranges) {
      const start = r.start * stride, count = r.count * stride;
      dst.set(src.subarray(start, start + count), start);
      a.addUpdateRange(start, count);
    }
    a.needsUpdate = true;
    return true;
  }

  /** ③ 水网格整体换（拓扑可变；共享 WaterMaterial，旧几何就地释放） */
  private replaceWaterMesh(
    group: THREE.Group, entry: { water: THREE.Mesh | null },
    waterG: WaterSurfaceRaw | undefined,
  ): void {
    const old = entry.water;
    if (waterG && waterG.indices.length > 0) {
      const m = createWaterMesh(waterG);
      m.visible = this.waterVisible; // ★ 航行期隐藏水面（停靠恢复）
      if (old) {
        group.remove(old);
        old.geometry.dispose();
      }
      group.add(m);
      entry.water = m;
    } else if (old) {
      group.remove(old);
      old.geometry.dispose();
      entry.water = null;
    }
  }

  /** ④ 装饰销毁（tag 版：不依赖 children 次序，水网格先/后挂都安全）：
   *  userData.decorKind==='decor' 的子树逐个 dispose；装饰碰撞体/围裙/台座
   *  刚体与注册表清除——重贴地重造由 pendingDecorJobs 预算化补挂 */
  private teardownDecorOnly(key: number, group: THREE.Group): void {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const c = group.children[i];
      if ((c.userData as { decorKind?: string }).decorKind !== 'decor') continue;
      group.remove(c);
      this.disposeVisual(c);
    }
    const oldProps = this.propBodies.get(key);
    if (oldProps) {
      for (const id of oldProps) this.host.destroyGround(id);
      this.propBodies.delete(key);
    }
    this.propRegistry.delete(key);
    const oldApron = this.apronBodies.get(key);
    if (oldApron !== undefined) {
      this.host.destroyGround(oldApron);
      this.apronBodies.delete(key);
    }
    const oldPlinth = this.plinthBodies.get(key);
    if (oldPlinth !== undefined) {
      this.host.destroyGround(oldPlinth);
      this.plinthBodies.delete(key);
    }
    this.propLayers.delete(key);
  }

  /** ★ 只拆道具层（脏区局部重贴地；围裙/台座/地形/水不动 —— §17.11） */
  private teardownPropsOnly(key: number): void {
    const pl = this.propLayers.get(key);
    if (pl) {
      pl.parent?.remove(pl);
      this.disposeVisual(pl);
      this.propLayers.delete(key);
    }
    const oldProps = this.propBodies.get(key);
    if (oldProps) {
      for (const id of oldProps) this.host.destroyGround(id);
      this.propBodies.delete(key);
    }
    this.propRegistry.delete(key);
  }

  /** ★ 局部重贴地（§17.11）：道具 y 按新表面重算（sink 不变），重挂道具层 + 碰撞体。
   *  位置/存在性沿用原计划——presence 哈希与 blockTypes 均未变，与整块重排等价；
   *  坡度门槛跨过时挖坑只会变陡，保留道具由 sink 吸收落位（不删除、不浮空）。 */
  private resnapProps(cx: number, cz: number, group: THREE.Object3D): void {
    const key = chunkKeyOf(cx, cz);
    const cached = this.decorCache.get(key);
    if (!cached) return;
    const props = cached.props.map((p) => ({
      ...p,
      y: this.raster.surfaceHeightAt(cx * CHUNK_SIZE + p.x, cz * CHUNK_SIZE + p.z) - (p.sink ?? 0),
    }));
    if (props.length > 0) {
      const propLayer = buildPropLayer(props);
      if (propLayer) {
        const wrap = new THREE.Group();
        wrap.position.set(-CHUNK_SIZE / 2, 0, -CHUNK_SIZE / 2);
        (wrap.userData as { decorKind?: string }).decorKind = 'decor';
        wrap.add(propLayer);
        group.add(wrap);
        this.propLayers.set(key, wrap);
      }
    }
    this.createDecorColliders(cx, cz, { ...cached, props });
    cached.props = props;
  }

  /** ★ 装饰计划入缓存（只留重贴地需要的 props；decals/propVolumes 是烘焙一次性数据，不驻留） */
  private cacheDecorPlan(key: number, decor: DecorPlan): void {
    this.decorCache.set(key, { props: decor.props, decals: [], propVolumes: new Float32Array(0) });
  }

  /** ★ 装饰任务入队（full > props 合并：同 chunk 更强者优先） */
  private queueDecorJob(cx: number, cz: number, maps: ChunkMaps, mode: 'full' | 'props'): void {
    const key = chunkKeyOf(cx, cz);
    const prev = this.pendingDecorJobs.get(key);
    const final: 'full' | 'props' = prev?.mode === 'full' || mode === 'full' ? 'full' : 'props';
    this.pendingDecorJobs.set(key, { cx, cz, maps, mode: final });
  }

  /** ★ 挖坑装饰影响判定：none=无影响（不拆不建）/ props=仅道具 / full=整块（结构件/未知） */
  private decideDecorMode(
    cx: number, cz: number,
    dd: { cells: Set<number>; full: boolean } | undefined,
  ): 'none' | 'props' | 'full' {
    const key = chunkKeyOf(cx, cz);
    const plan = this.decorCache.get(key);
    if (!plan) return 'full';           // 无计划（首建等）：走整块
    if (!dd) return 'full';             // 非挖动触发（邻块/其它）：保守整块
    if (dd.full) return 'full';         // 邻块联动：保守整块
    if (dd.cells.size === 0) return 'none';
    if (this.dirtyTouchesPlatform(cx, cz, dd.cells)) return 'full'; // 围裙/台座可能受影响
    // 道具足迹 ±6m 与脏区相交 → 仅重贴道具（余量覆盖层过渡 W=0.5m/层 × 深挖）
    for (const p of plan.props) {
      const x0 = Math.max(0, Math.floor(p.x) - 6);
      const x1 = Math.min(CHUNK_SIZE - 1, Math.floor(p.x) + 6);
      const z0 = Math.max(0, Math.floor(p.z) - 6);
      const z1 = Math.min(CHUNK_SIZE - 1, Math.floor(p.z) + 6);
      for (let lz = z0; lz <= z1; lz++) {
        for (let lx = x0; lx <= x1; lx++) {
          if (dd.cells.has(lz * CHUNK_SIZE + lx)) return 'props';
        }
      }
    }
    return 'none';
  }

  /** 脏区是否靠近 platform 地块（±2 个 4m 块）——围裙/台座结构件的保守触发 */
  private dirtyTouchesPlatform(cx: number, cz: number, cells: Set<number>): boolean {
    const d = this.raster.getChunkData(cx, cz);
    if (!d) return true;
    const B = BLOCKS_PER_SIDE;
    for (const idx of cells) {
      const lx = idx % CHUNK_SIZE;
      const lz = (idx / CHUNK_SIZE) | 0;
      const b0x = Math.max(0, (lx >> 2) - 2), b1x = Math.min(B - 1, (lx >> 2) + 2);
      const b0z = Math.max(0, (lz >> 2) - 2), b1z = Math.min(B - 1, (lz >> 2) + 2);
      for (let bz = b0z; bz <= b1z; bz++) {
        for (let bx = b0x; bx <= b1x; bx++) {
          if (tileById(d.blockTypes[bz * B + bx]).genRole === 'platform') return true;
        }
      }
    }
    return false;
  }

  /** 用几何字节构建地形 top/wall/water 网格 + 合并 trimesh（供非破坏装配与增量重建共用）
 *  ★ 同时登记 terrainVisuals（原地更新用）+ 包围球：Worker 传 y 范围 → 解析构造
 *  （免主线程 O(n) 扫描）+6m 下沉余量（挖坑只降不高，原地更新免重算、视锥不误裁） */
  private buildTerrainMeshes(
    cx: number, cz: number, maps: ChunkMaps,
    topG: FaceGeometry, wallG: FaceGeometry, waterG?: WaterSurfaceRaw,
    bounds?: { top: GeomBounds; wall: GeomBounds },
  ): { meshes: THREE.Object3D[]; pv: Float32Array; pi: Uint32Array } {
    const toGeo = (g: FaceGeometry, withColor: boolean, b?: GeomBounds): THREE.BufferGeometry => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(g.vertices, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(g.normals, 3));
      if (g.uvs) geo.setAttribute("uv", new THREE.BufferAttribute(g.uvs, 2));
      if (g.colors) geo.setAttribute("color", new THREE.BufferAttribute(g.colors, 3));
      if (g.patchW) geo.setAttribute("apw", new THREE.BufferAttribute(g.patchW, 1));
      if (withColor && g.shade) geo.setAttribute("shade", new THREE.BufferAttribute(g.shade, 1));
      geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
      this.setPaddedSphere(geo, b);
      return geo;
    };
    const palette = this.chunkPalette(cx, cz);
    const chunkDataForMat = this.raster.getChunkData(cx, cz);
    const matCfg = chunkDataForMat ? buildTileRenderConfig(chunkDataForMat, palette) : undefined;
    const mat = new TerrainMaterial(maps.albedo, maps.lightmap, maps.matLow, matCfg, true);
    (mat as unknown as { userData: { lightMap?: THREE.Texture; tileIds?: THREE.Texture; cached?: boolean } }).userData =
      { lightMap: maps.lightmap, tileIds: matCfg?.tileIds, cached: true };
    const topMesh = new THREE.Mesh(toGeo(topG, false, bounds?.top), mat);
    const meshes: THREE.Object3D[] = [topMesh];
    let wallMesh: THREE.Mesh | null = null;
    if (wallG.indices.length > 0) {
      wallMesh = new THREE.Mesh(toGeo(wallG, true, bounds?.wall), new WallMaterial(maps.albedo, maps.lightmap, matCfg, true));
      meshes.push(wallMesh);
    }
    let waterMesh: THREE.Mesh | null = null;
    if (waterG && waterG.indices.length > 0) {
      waterMesh = createWaterMesh(waterG);
      waterMesh.visible = this.waterVisible; // ★ 航行期隐藏水面（停靠恢复）
      meshes.push(waterMesh);
    }
    // ★ 原地更新登记（key → mesh 引用；破坏重建走 attr 原地写，不重建 Mesh/材质）
    this.terrainVisuals.set(chunkKeyOf(cx, cz), { top: topMesh, wall: wallMesh, water: waterMesh });

    const nVT = topG.vertices.length / 3;
    const pv = new Float32Array(topG.vertices.length + wallG.vertices.length);
    pv.set(topG.vertices, 0);
    pv.set(wallG.vertices, topG.vertices.length);
    const pi = new Uint32Array(topG.indices.length + wallG.indices.length);
    pi.set(topG.indices, 0);
    for (let i = 0; i < wallG.indices.length; i++) pi[topG.indices.length + i] = wallG.indices[i] + nVT;
    return { meshes, pv, pi };
  }

  /** ★ 包围球解析构造：center=(0, yMid, 0)、r=√((S/2)²×2+dy²)+6m 挖深余量
   *  （mesh 原点=chunk 中心，全部顶点 |x|,|z| ≤ S/2、y∈[minY,maxY] → 精确覆盖）；
   *  bounds 缺失（旧数据兜底）→ 主线程 computeBoundingSphere +6m */
  private setPaddedSphere(geo: THREE.BufferGeometry, b?: GeomBounds): void {
    if (b) {
      const half = CHUNK_SIZE / 2;
      const mid = (b.minY + b.maxY) * 0.5;
      const dy = (b.maxY - b.minY) * 0.5;
      geo.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(0, mid, 0),
        Math.sqrt(half * half * 2 + dy * dy) + 6,
      );
    } else {
      geo.computeBoundingSphere();
      if (geo.boundingSphere) geo.boundingSphere.radius += 6;
    }
  }

  /** ★ chunk 地面刚体创建：分区优先（宿主不支持 → 整 chunk 合并 trimesh 兜底）。
   *  ★ 物理 cooking 摊帧（2026-09-11）：玩家脚下热点 chunk 同步全建（防掉坑），
   *    其余 chunk 只建首分区 → 余下分区进 groundCellQueue 帧预算化 cooking，
   *    避免单块装配出现 ~100ms 尖峰（初始入图 25 块连建尤其明显）。 */
  private createChunkGround(
    key: number, cx: number, cz: number,
    pv: Float32Array, pi: Uint32Array, cells?: PatchGroundCell[],
  ): void {
    if (cells && cells.length > 0 && this.host.createGroundCells) {
      const hot = key === this.hotChunkKey;
      const first = hot ? cells : [cells[0]];
      const id = this.host.createGroundCells(cx, cz, first);
      if (id !== null && id !== undefined) {
        this.bodies.set(key, id);
        if (!hot) {
          for (let i = 1; i < cells.length; i++) {
            this.groundCellQueue.set(id * 1024 + cells[i].slot, {
              bodyId: id,
              slot: cells[i].slot,
              vertices: cells[i].vertices,
              indices: cells[i].indices,
            });
          }
        }
        return;
      }
    }
    this.bodies.set(key, this.host.createGround(cx, cz, pv, pi));
  }

  // ============================================================
  // ★ 地形补丁（§14.10 剔除+打补丁：子弹撞地 → 区域统一补丁材质）
  // ============================================================

  /**
   * 某世界坐标 (x,z) 是否已是补丁 cell（只读查询；供判定/验收用）
   */
  isPatchedAt(px: number, pz: number): boolean {
    if (this.boss4D) return false; // 四维空间不扣地形
    return this.raster.isLevelPatched(px, pz);
  }

  /**
   * ★ 世界点 (x,z) 半径 r 内是否存在指定 key 的装饰实体（不含四维空间）。
   * 装饰计划按 seed/chunk 确定性复算（纯查询，不建网格），对命中点所在 chunk
   * 及其邻环逐一重算 → 世界坐标 = cx*60 + 本地（chunk 群中心+30 / 装饰层 −30 抵消）。
   * 物品掉落管线用：耗尽原石晶体（depleted_crystal，探测定界 ~3m）→ 异铁。
   */
  /**
   * ★ 装饰实体查询：命中点附近（水平距离 ≤ r）的可碰撞装饰物，取最近的那个。
   * 权威索引 = propRegistry（实际存在物；随 createDecorColliders / chunk 销毁同步）。
   * 含本 chunk + 8 邻环（跨片边界处的实体仍会被探到）。
   * ★ 可选 key：只取指定类型（祖宗挖矿索敌"耗尽原石晶体"）。
   */
  queryPropsNear(x: number, z: number, r: number, key?: string): ImpactProp | null {
    if (this.boss4D || this.propRegistry.size === 0) return null;
    const baseCx = Math.floor(x / CHUNK_SIZE);
    const baseCz = Math.floor(z / CHUNK_SIZE);
    const r2 = r * r;
    let best: ImpactProp | null = null;
    let bestD2 = Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.propRegistry.get(chunkKeyOf(baseCx + dx, baseCz + dz));
        if (!list) continue;
        for (const p of list) {
          if (key && p.key !== key) continue; // ★ 指定类型过滤（挖矿索敌用）
          const ddx = p.x - x;
          const ddz = p.z - z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 <= r2 && d2 < bestD2) {
            bestD2 = d2;
            best = { key: p.key, x: p.x, y: p.y, z: p.z, r: p.r, h: p.h };
          }
        }
      }
    }
    return best;
  }

  /** 附近（r 内）是否存在某类装饰性实体（授权实现 = propRegistry，无重放代价） */
  hasPropTypeNear(x: number, z: number, propKey: string, r: number): boolean {
    return this.queryPropsNear(x, z, r, propKey) !== null;
  }

  /** ★ 命中解析层：一次调用产出权威 ImpactReport（地形修改 / 掉落 / 表现三端共用） */
  resolveImpact(x: number, y: number, z: number): ImpactReport {
    const bx = Math.floor(x / BLOCK_SIZE);
    const bz = Math.floor(z / BLOCK_SIZE);
    const cx = Math.floor(bx / BLOCKS_PER_SIDE);
    const cz = Math.floor(bz / BLOCKS_PER_SIDE);
    let id = 0;
    let role = '';
    let h = 0;
    const cd = this.raster.getChunkData(cx, cz);
    if (cd) {
      const lbx = bx - cx * BLOCKS_PER_SIDE;
      const lbz = bz - cz * BLOCKS_PER_SIDE;
      id = cd.blockTypes[lbz * BLOCKS_PER_SIDE + lbx];
      role = tileById(id).genRole;
      const gx = Math.min(CHUNK_SIZE - 1, Math.max(0, Math.floor(x - cx * CHUNK_SIZE)));
      const gz = Math.min(CHUNK_SIZE - 1, Math.max(0, Math.floor(z - cz * CHUNK_SIZE)));
      h = cd.heights[gz * CHUNK_SIZE + gx];
    }
    let water: ImpactReport['water'] = role === 'liquid' ? 'hit' : 'none';
    if (water === 'none') {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (this.isLiquidBlock(bx + dx, bz + dz)) {
          water = 'edge';
          break;
        }
      }
    }
    return {
      x, y, z,
      tile: { cx, cz, bx, bz, id, role, h },
      water,
      prop: this.queryPropsNear(x, z, PROP_PROBE_R),
    };
  }

  /** 世界 4m 块 → 生成长相 role（无数据 = ''，视为不可挖） */
  private blockRole(bx: number, bz: number): string {
    const cd = this.raster.getChunkData(Math.floor(bx / BLOCKS_PER_SIDE), Math.floor(bz / BLOCKS_PER_SIDE));
    if (!cd) return '';
    const lbx = bx - Math.floor(bx / BLOCKS_PER_SIDE) * BLOCKS_PER_SIDE;
    const lbz = bz - Math.floor(bz / BLOCKS_PER_SIDE) * BLOCKS_PER_SIDE;
    if (lbx < 0 || lbx >= BLOCKS_PER_SIDE || lbz < 0 || lbz >= BLOCKS_PER_SIDE) return '';
    return tileById(cd.blockTypes[lbz * BLOCKS_PER_SIDE + lbx]).genRole;
  }

  private isLiquidBlock(bx: number, bz: number): boolean {
    return this.blockRole(bx, bz) === 'liquid';
  }

  /**
   * ★ 子弹撞地 → 补丁层数 +1（§14.11 R=0.6/D=0.2/层）：
   *   1) 水平圆与 coarse cell AABB 判交 → digCells 逐格 +1（不封顶；同点连打持续加深，
   *      视觉饱和由包络场几何吸收 → digCells 返回 false 跳过重建）
   *   2) 有可见变化才重建受影响 chunk —— 几何生成走 terrainPatch Worker；
   *      Worker 不可用 → 主线程同步同函数；纹理缓存缺失 → 既有标准烘焙管线兜底
   *   3) chunk 未建成（未达构建半径）只登记（levels 随数据落库）→ 将来烘焙自然带补丁
   */
  playBulletImpact(r: ImpactReport): void {
    if (this.boss4D) return; // 四维空间不扣地形
    // ★ 打坑半径：0.6 → 0.49（面积 ×2/3，即"打坑面积缩小 1/3"；0.6×√(2/3)≈0.49）
    const R = 0.49; // §14.10 T2 轻量档（破坏小）
    const byChunk = new Map<number, {
      cx: number; cz: number;
      cells: { lx: number; lz: number }[];
      dirty: Set<number>; // 世界 4m 块 key（水体增量边界探针失效用）
    }>();
    for (const c of circleCells(r.x, r.z, R, CHUNK_SIZE)) {
      const key = chunkKeyOf(c.cx, c.cz);
      let rec = byChunk.get(key);
      if (!rec) {
        rec = { cx: c.cx, cz: c.cz, cells: [], dirty: new Set() };
        byChunk.set(key, rec);
      }
      rec.cells.push({ lx: c.lx, lz: c.lz });
      rec.dirty.add(worldBlockKey(c.cx * BLOCKS_PER_SIDE + (c.lx >> 2), c.cz * BLOCKS_PER_SIDE + (c.lz >> 2)));
    }
    for (const [, rec] of byChunk) {
      if (this.raster.digCells(rec.cx, rec.cz, rec.cells)) {
        // ★ 帧间合并：不立即重建——digCells 已同步落库（数据即时正确），
        //   视觉重建攒进 pendingPatches，flushPatchRebuilds 每帧开头合并为一次
        const key = chunkKeyOf(rec.cx, rec.cz);
        if (this.meshes.has(key) || this.voidKeys.has(key)) {
          let p = this.pendingPatches.get(key);
          if (!p) {
            p = { cx: rec.cx, cz: rec.cz, dirty: new Set() };
            this.pendingPatches.set(key, p);
          }
          for (const d of rec.dirty) p.dirty.add(d);
          // ★ 装饰脏区（局部 1m cell）：flushPatchRebuilds 据此判定局部重贴地
          let dd = this.decorDirty.get(key);
          if (!dd) { dd = { cells: new Set(), full: false }; this.decorDirty.set(key, dd); }
          for (const c of rec.cells) dd.cells.add(c.lz * CHUNK_SIZE + c.lx);
        }
      }
      // ★ 跨 chunk 联动（2026-09-10）：本块挖动改变邻块包络场/共享边 → 邻块也要重建
      this.markNeighborsForDug(rec);
    }
  }

  /**
   * ★ 跨 chunk 破坏联动（2026-09-10）：本 chunk 的挖动会改变邻 chunk 的包络场
   * （射线穿 seam 经 levelAt 读本块层数）与共享边补丁判定 → 需一并重建。
   * 影响半径 = 邻块贴 seam 边界的最大层数 × 层过渡宽度 W（m/层）：
   *   我们的挖动 cell 到该边界的距离 ≤ reach 时才可能改变邻块包络场（安全超集）。
   * 邻块无补丁（边界层数 0）→ reach<0 跳过（其几何不依赖本块）。数据已同步落库；
   * 未建成的 chunk 由后续标准构建自然读到新层数。
   */
  private markNeighborsForDug(rec: { cx: number; cz: number; cells: { lx: number; lz: number }[] }): void {
    const N = CHUNK_SIZE;
    for (const c of rec.cells) {
      const dirs: [number, number, number][] = [
        [c.lx, rec.cx - 1, rec.cz],          // 西邻：本 cell 距西边界距离
        [N - 1 - c.lx, rec.cx + 1, rec.cz],  // 东邻
        [c.lz, rec.cx, rec.cz - 1],          // 南邻
        [N - 1 - c.lz, rec.cx, rec.cz + 1],  // 北邻
      ];
      for (const [dist, ncx, ncz] of dirs) {
        const lv = this.neighborBoundaryMaxLevel(ncx, ncz);
        if (lv <= 0) continue; // 邻块 seam 边界无补丁 → 不受本块影响
        if (dist <= lv * PATCH_LEVEL_WIDTH) this.enqueuePatch(ncx, ncz);
      }
    }
  }

  /** 邻 chunk 面向本块一侧的边界线最大层数（0 = 无补丁/未加载） */
  private neighborBoundaryMaxLevel(ncx: number, ncz: number): number {
    const d = this.raster.getChunkData(ncx, ncz);
    if (!d?.levels) return 0;
    const lv = d.levels, N = CHUNK_SIZE;
    let max = 0;
    // 取四条边界线的最大值（安全超集：实际只同行 cell 的射线能看见本块）
    for (let i = 0; i < N; i++) {
      const wcol = lv[i * N];
      if (wcol > max) max = wcol;
      const ecol = lv[i * N + N - 1];
      if (ecol > max) max = ecol;
      const srow = lv[i];
      if (srow > max) max = srow;
      const nrow = lv[(N - 1) * N + i];
      if (nrow > max) max = nrow;
    }
    return max;
  }

  /** 把邻 chunk 加入破坏重建缓冲（未建成则跳过：数据落库，后续构建自然带新层数） */
  private enqueuePatch(cx: number, cz: number): void {
    const key = chunkKeyOf(cx, cz);
    if (!this.meshes.has(key) && !this.voidKeys.has(key)) return;
    let p = this.pendingPatches.get(key);
    if (!p) {
      p = { cx, cz, dirty: new Set() };
      this.pendingPatches.set(key, p);
    }
    // ★ 邻块联动：包络场影响范围难精确 → 装饰脏区标记 full（保守整块重贴地）
    let dd = this.decorDirty.get(key);
    if (!dd) { dd = { cells: new Set(), full: false }; this.decorDirty.set(key, dd); }
    dd.full = true;
  }

  /** 同一 chunk 破坏重建的最短间隔（ms）：连射/多跳弹 → 视觉分批下陷，
   *  不再每帧一次全量重建+装配（worker 与主线程都不再被持续射击打满）。 */
  private static readonly PATCH_REBUILD_MIN_MS = 120;

  /** ★ 热点 chunk（玩家当前所在）重建最短间隔：比常规更短 → 连射当前坑更跟手 */
  private static readonly PATCH_REBUILD_MIN_MS_HOT = 40;

  /** 各 chunk 上次破坏重建发起时刻（performance.now） */
  private lastPatchStart = new Map<number, number>();

  /** ★ 热点 chunk = 玩家当前所在：重建节流间隔更短（40ms vs 120ms）。 */
  private hotChunkKey = -1;

  private markHotChunk(px: number, pz: number): void {
    const cx = Math.floor(px / CHUNK_SIZE);
    const cz = Math.floor(pz / CHUNK_SIZE);
    this.hotChunkKey = chunkKeyOf(cx, cz);
    this.hotPcx = cx;
    this.hotPcz = cz;
    // ★ 脚下封存块立即解封（不等 sweep 预算/排序）：回程或落地瞬间细化视觉即刻恢复
    if (this.parkedKeys.has(this.hotChunkKey)) this.unparkChunk(this.hotChunkKey);
  }

  /** ★ 破坏重建帧间合并 + 节流（每帧开头调用）：把本帧攒下的挖坑请求按 chunk 合并后
   *   一次性投递。digCells 已同步落库（数据即时正确），此处只补视觉重建——
   *   同 chunk 同帧 N 挖 → 1 次重建（dirty 取并集，worker 收敛终态）；
   *   跨帧连续挖 → 按节流间隔分批，未到期/在途的继续攒缓冲。
   *   ★ 热点 chunk（玩家当前）节流 40ms；其他 chunk 120ms。 */
  private flushPatchRebuilds(): void {
    if (this.pendingPatches.size === 0) return;
    const now = performance.now();
    const items = [...this.pendingPatches.values()];
    this.pendingPatches.clear();
    for (const p of items) {
      const key = chunkKeyOf(p.cx, p.cz);
      const hot = key === this.hotChunkKey;
      const minMs = hot ? ChunkManager.PATCH_REBUILD_MIN_MS_HOT : ChunkManager.PATCH_REBUILD_MIN_MS;
      const last = this.lastPatchStart.get(key) ?? -Infinity;
      if (now - last < minMs || this.patchRebuilds.has(key)) {
        let q = this.pendingPatches.get(key);
        if (!q) { q = { cx: p.cx, cz: p.cz, dirty: new Set() }; this.pendingPatches.set(key, q); }
        for (const d of p.dirty) q.dirty.add(d);
        continue;
      }
      this.lastPatchStart.set(key, now);
      // ★ 装饰脏区快照 + 模式判定（与本次几何的 levels 快照同时消费；期间新挖的
      //   会留在 decorDirty 里随下一次重建处理，不丢）
      const dd = this.decorDirty.get(key);
      this.decorDirty.delete(key);
      const mode = this.decideDecorMode(p.cx, p.cz, dd);
      this.patchRebuildChunk(p.cx, p.cz, p.dirty.size > 0 ? [...p.dirty] : null, mode);
    }
  }

  /** 同 chunk 破坏重建在途串行化（终态收敛；key → Promise） */
  private patchRebuilds = new Map<number, Promise<void>>();

  /** ★ 破坏重建帧间合并缓冲：本帧内多发射击/多跳弹对同一 chunk 的挖坑
   *   先攒在这，flushPatchRebuilds 每帧开头合并为一次重建（≈同帧 N 挖 → 1 重建）。 */
  private pendingPatches = new Map<number, { cx: number; cz: number; dirty: Set<number> }>();

  /**
   * ★ 破坏重建（异步）：几何字节来自 terrainPatch（Worker 优先 / 主线程同函数回退），
   * 装配与同步路径共用 assembleTableChunk。纹理缓存缺失 → requestStandardBake 兜底
   * （其完成装配的几何在主线程内联生成，与无 Worker 回退同一函数，字节一致）。
   */
  private patchRebuildChunk(cx: number, cz: number, dirty?: number[] | null, decorMode: 'none' | 'props' | 'full' = 'full'): void {
    const key = chunkKeyOf(cx, cz);
    // ★ 并发合并：同 chunk 在途 → 等其完成后再重算一次（掩码只增，第二次即终态）
    const prev = this.patchRebuilds.get(key);
    const run = async (): Promise<void> => {
      if (prev) await prev.catch(() => {});
      if (!this.meshes.has(key) && !this.voidKeys.has(key)) return;
      const maps = getCachedChunkMaps(this.raster.worldSeed, cx, cz);
      if (!maps) {
        // 纹理缓存缺失（罕见：清缓存/换风格后）：整 chunk 走既有标准烘焙（几何主线程同源）
        this.requestStandardBake(cx, cz);
        return;
      }
      const levelsArr = this.raster.levelsOf(cx, cz);
      // ★ 层数表必须传拷贝：postMessage(transfer) 会转移所有权，本体在 chunk 数据
      const levels = new Uint8Array(levelsArr);
      try {
        const geom = await terrainPatch.compute(
          { seed: this.raster.worldSeed, cx, cz, levels, dirty },
          (ccx, ccz) => this.raster.getChunkData(ccx, ccz),
        );
        if (!geom) { this.requestStandardBake(cx, cz); return; } // Worker 失败 → 兜底
        if (!this.meshes.has(key) && !this.voidKeys.has(key)) return;
        const maps2 = getCachedChunkMaps(this.raster.worldSeed, cx, cz);
        if (!maps2) return; // 期间缓存被清：后续 bake/重建自然覆盖
        // ★ 增量重建（2026-09-08）：只替换地形 top/wall/water 与 trimesh；
        //  装饰（props 贴地）由 pendingDecorJobs 在地形重建后重贴地补挂。
        //  仍走 assembleQueue 预算化装配（每帧 ≤ ASSEMBLE_PER_FRAME）
        //  2026-09-09 原地更新：视觉 attr 原地写 + 受影响物理分区原位换，失败回退全量
        this.assembleQueue.push({
          key, cx, cz, maps: maps2, decor: null, decorMode,
          top: geom.top, wall: geom.wall, water: geom.water,
          cells: geom.cells,
          bounds: { top: geom.topBounds, wall: geom.wallBounds },
        });
      } catch (e) {
        console.error(`[ChunkManager] chunk(${cx},${cz}) 破坏重建失败，回退标准烘焙`, e);
        this.requestStandardBake(cx, cz);
      }
    };
    const p = run().finally(() => {
      if (this.patchRebuilds.get(key) === p) this.patchRebuilds.delete(key);
    });
    this.patchRebuilds.set(key, p);
  }


  // ============================================================
  // ★ 装饰装配辅助（标准 / Boss4D 两风格共用）
  // ============================================================

  /**
   * 装饰物网格层（含调试标记）+ 石围裙/水泥台座物理 trimesh。
   * 返回 null = 无装饰物或渲染器未注册。
   * 调用方挂进 chunk group 后必须调用 createDecorColliders 与
   * createStructuralGround（都在 replaceChunk 之后）。
   */
  private buildDecorLayer(
    cx: number, cz: number, decor: DecorPlan,
  ): { layer: THREE.Object3D; apronPhysics: ApronPhysics | null; plinthPhysics: CementPlinthPhysics | null } | null {
    const parts: THREE.Object3D[] = [];
    let apronPhysics: ApronPhysics | null = null;
    let plinthPhysics: CementPlinthPhysics | null = null;
    let propLayer: THREE.Object3D | null = null;
    if (decor.props.length > 0) {
      propLayer = buildPropLayer(decor.props);
      if (propLayer) parts.push(propLayer);
      else console.warn(`[ChunkManager][装饰] chunk(${cx},${cz}) 有 ${decor.props.length} 个装饰物但 buildPropLayer 返回 null（渲染器未注册？）`);
    }
    // ★ 水泥台座（cement_platform 专属结构件，35% 高台块）：4×4 整格正置、
    //   顶面进 surfaceHeightAt 叠加层（站得上去）；采样用 base 防自反馈。
    const plinth = buildCementPlinths(
      cx, cz, this.raster.worldSeed,
      this.raster.getChunkData(cx, cz)?.blockTypes,
      (x, z) => this.raster.baseSurfaceHeightAt(x, z),
    );
    if (plinth) {
      parts.push(plinth.mesh);
      plinthPhysics = plinth.physics;    // 调用方在 replaceChunk 后经 createPlinthGround 建体
    }
    // ★ 石围裙（沙土高台专属）：周界压边 + 侧壁下裙（platform_sand 暴露边）；
    //   blockKeyAt 用世界块坐标跨 chunk 查地块 key（防叠环判定需要邻 chunk 数据）；
    //   ★ 采样必须用 baseSurfaceHeightAt（不含围裙叠加层）——传 surfaceHeightAt
    //   会采样到自己的带顶自反馈循环抬升
    const apron = buildPlatformAprons(
      cx, cz, this.raster.worldSeed,
      this.raster.getChunkData(cx, cz)?.blockTypes,
      (x, z) => this.raster.baseSurfaceHeightAt(x, z),
      (wx, wz) => {
        const ccx = Math.floor(wx / BLOCKS_PER_SIDE), ccz = Math.floor(wz / BLOCKS_PER_SIDE);
        const d = this.raster.getChunkData(ccx, ccz);
        if (!d) return null;
        return tileById(d.blockTypes[(wz - ccz * BLOCKS_PER_SIDE) * BLOCKS_PER_SIDE + (wx - ccx * BLOCKS_PER_SIDE)]).key;
      },
    );
    if (apron) {
      parts.push(apron.mesh);
      apronPhysics = apron.physics;   // 调用方在 replaceChunk 后经 createApronGround 建体
    }
    if (parts.length === 0 && !apronPhysics && !plinthPhysics) return null;
    const layer = new THREE.Group();
    (layer.userData as { decorKind?: string }).decorKind = 'decor'; // ★ 拆除识别（不依赖 children 次序）
    for (const p of parts) layer.add(p);
    // ★ 对齐 chunk 角：装饰 x/z 是 chunk 角落坐标(0~60)，而 chunk
    //   group 原点在 chunk 中心——不偏移会整体错位半块（30m），
    //   影子/碰撞体与可见网格三者错位（踩过的坑）
    layer.position.set(-CHUNK_SIZE / 2, 0, -CHUNK_SIZE / 2);
    // ★ 道具层引用：脏区局部重贴地只拆它（围裙/台座不动 —— §17.11）
    if (propLayer) this.propLayers.set(chunkKeyOf(cx, cz), propLayer);
    return { layer, apronPhysics, plinthPhysics };
  }

  /**
   * 装饰物碰撞体：必须在 replaceChunk 之后创建（replaceChunk 会销毁
   * propBodies[key] 的"旧"碰撞体——若先创建，刚建的会被当旧体立刻销毁，
   * 物理实体永不存在。踩过的坑）。创建走基类统一实现。
   */
  private createDecorColliders(cx: number, cz: number, decor: DecorPlan): void {
    if (!this.host.createPropBody) return;
    const ids: number[] = [];
    const instances: DecorPropInstance[] = [];
    for (const [key, list] of groupPropsByKey(decor.props)) {
      const def = mapDecorByKey(key);
      if (!def?.isCollidable) continue;
      ids.push(...def.createColliders(this.host, list, cx, cz));
      const ph = def.physics!;
      for (const p of list) {
        const r = ph.radius * p.scale;
        instances.push({
          key, cx, cz,
          x: cx * CHUNK_SIZE + p.x,
          y: p.y,
          z: cz * CHUNK_SIZE + p.z,
          r,
          h: ph.height * p.scale,
        });
      }
    }
    if (ids.length > 0) {
      this.propBodies.set(chunkKeyOf(cx, cz), ids);
      this.propRegistry.set(chunkKeyOf(cx, cz), instances);
    } else if (decor.props.some((p) => mapDecorByKey(p.propKey)?.isCollidable)) {
      console.warn(`[ChunkManager][装饰] chunk(${cx},${cz}) 有可碰撞装饰物但 createPropBody 返回空（宿主未实现？）`);
    }
  }

  /**
   * ★ 石围裙 + 水泥台座地面刚体：结构件属于高台的一部分，与地形同一逻辑——
   *   trimesh 经宿主 createGround 建独立地面刚体（kind 同地形），角色/子弹
   *   行为与 cliff 完全一致，无 cuboid 挤压去穿透问题。必须在 replaceChunk
   *   之后调用（旧体销毁 → 新体创建，同装饰物碰撞时序）。
   *   apronPhysics/plinthPhysics 由 buildDecorLayer 随视觉层产出。
   */
  private createStructuralGround(cx: number, cz: number, apronPhysics: ApronPhysics | null, plinthPhysics: CementPlinthPhysics | null): void {
    if (apronPhysics) {
      const key = chunkKeyOf(cx, cz);
      const id = this.host.createGround(cx, cz, apronPhysics.vertices, apronPhysics.indices);
      this.apronBodies.set(key, id);
    }
    if (plinthPhysics) {
      const key = chunkKeyOf(cx, cz);
      const id = this.host.createGround(cx, cz, plinthPhysics.vertices, plinthPhysics.indices);
      this.plinthBodies.set(key, id);
    }
  }

  /**
   * Boss4D 风格 chunk 同步构建（标准风格走 requestStandardBake 异步管线）。
   * ★ 虚空地块（isBoss4DVoidChunk 命中）：只建物理不建视觉——
   *   复刻"chunk 有碰撞无纹理"的历史 bug，主题化为四维空间的一部分。
   *   （虚空地块不放置装饰——不可见障碍对玩家不公平）
   */
  private buildChunkMesh(cx: number, cz: number): void {
    const key = chunkKeyOf(cx, cz);
    if (this.boss4D && isBoss4DVoidChunk(this.raster.worldSeed, cx, cz)) {
      const b = buildBoss4DChunkPhysics(this.raster, cx, cz);
      this.replaceChunk(key, null, cx, cz, b.trimeshVertices, b.trimeshIndices);
      return;
    }
    // ★ 装饰先行（与标准风格同管线）：贴图印进外观纹理、装饰物挂网格+碰撞
    const decor = this.planDecor(cx, cz);
    this.cacheDecorPlan(key, decor);
    const b = buildBoss4DChunk(this.raster, cx, cz, decor.decals);
    const decorLayer = this.buildDecorLayer(cx, cz, decor);
    if (decorLayer) b.group.add(decorLayer.layer);
    this.replaceChunk(key, b.group, cx, cz, b.trimeshVertices, b.trimeshIndices);
    // ★ 装饰物碰撞体独立阶段（地形后补，不依赖视觉层）——同上解耦逻辑
    this.createDecorColliders(cx, cz, decor);
    this.createStructuralGround(cx, cz, decorLayer?.apronPhysics ?? null, decorLayer?.plinthPhysics ?? null);
  }

  /** 拆旧视觉+旧物理 → 装新视觉 → 建配套新物理体（风格切换/流式构建共用） */
  private replaceChunk(
    key: number,
    visual: THREE.Object3D | null,
    cx: number,
    cz: number,
    trimeshVertices: Float32Array,
    trimeshIndices: Uint32Array,
    cells?: PatchGroundCell[],
  ): void {
    const old = this.meshes.get(key);
    if (old) {
      this.scene.remove(old);
      this.disposeVisual(old);
    }
    this.meshes.delete(key);
    this.voidKeys.delete(key);
    const oldBody = this.bodies.get(key);
    if (oldBody !== undefined) {
      this.host.destroyGround(oldBody);
      this.bodies.delete(key);
    }
    // 装饰物碰撞体随 chunk 视觉替换一并销毁
    const oldProps = this.propBodies.get(key);
    if (oldProps) {
      for (const id of oldProps) this.host.destroyGround(id);
      this.propBodies.delete(key);
    }
    this.propRegistry.delete(key);
    // 石围裙地面刚体同生命周期销毁（trimesh，与地形同管线）
    const oldApron = this.apronBodies.get(key);
    if (oldApron !== undefined) {
      this.host.destroyGround(oldApron);
      this.apronBodies.delete(key);
    }
    // 水泥台座地面刚体同生命周期销毁（同墙裙管线）
    const oldPlinth = this.plinthBodies.get(key);
    if (oldPlinth !== undefined) {
      this.host.destroyGround(oldPlinth);
      this.plinthBodies.delete(key);
    }
    if (visual) {
      this.scene.add(visual);
      this.meshes.set(key, visual);
      this.dropCoarse(key); // ★ 细化就位 → 粗块退场
    } else {
      this.voidKeys.add(key);
    }
    // ★ 地面刚体：分块优先（tiles 就绪且宿主支持）；分块失败 → 合并兜底
    this.createChunkGround(key, cx, cz, trimeshVertices, trimeshIndices, cells);

    // ★ 激活回调（每个 chunk 只触发一次；特殊事件/监听预留接口位）
    if (!this.activated.has(key)) {
      this.activated.add(key);
      this.onChunkActivated?.(cx, cz, key);
    }
  }

  /** 释放 chunk 视觉资源（兼容 Mesh 与 Group 两种形态） */
   private disposeVisual(obj: THREE.Object3D): void {
     obj.traverse((o) => {
       const m = o as THREE.Mesh;
       if (!m.geometry) return;
       const mm = m.material as THREE.MeshStandardMaterial | undefined;
       // ★ 装饰物共享几何/材质（decorShared 标记）：chunk 重建不得释放，
       //   仅由 disposePropRenderers 在模式退出时统一释放
       const shared = (m.geometry.userData as { decorShared?: boolean } | undefined)?.decorShared
         || (mm?.userData as { decorShared?: boolean } | undefined)?.decorShared;
       if (!shared) m.geometry.dispose();
       if (!mm) return;
       // ★ 双纹理方案：lightmap 挂在材质 userData 上；cached = 纹理归烘焙
       //   缓存所有（接缝重建/风格切换要复用），跳过纹理释放，材质照常销毁
       const extra = (mm as unknown as { userData?: { lightMap?: THREE.Texture; tileIds?: THREE.Texture; cached?: boolean } }).userData;
       // ★ 块 id 微纹理是本 chunk 私有（每次构建新建），无条件释放
       extra?.tileIds?.dispose();
       if (!extra?.cached) {
         mm.map?.dispose();
         extra?.lightMap?.dispose();
       }
       if (!shared) mm.dispose();
     });
   }
}

// ============================================================
// 材质渲染配置（模块级；阶段二：块 id 微纹理 + 参数数组打包）
// ============================================================

/**
 * 构建每 chunk 的材质渲染配置：
 * 块 id 微纹理（15×15 R8，Nearest）+ 材质参数数组（按 tileId 索引打包）。
 * 有材质的地块 → 基色/表面/图案参数；无材质 → 默认值（叠加层提供颜色）。
 */
function buildTileRenderConfig(chunkData: { blockTypes: Uint8Array }, palette?: GroupPalette): TileRenderConfig {
  const base = new Float32Array(MATERIAL_SLOTS * 4);
  const jitter = new Float32Array(MATERIAL_SLOTS * 4);
  const surface = new Float32Array(MATERIAL_SLOTS * 4);
  const emissive = new Float32Array(MATERIAL_SLOTS * 4);
  const params = new Float32Array(MATERIAL_SLOTS * 16);
  const lodEmissive = new Float32Array(MATERIAL_SLOTS);

   for (let id = 0; id < MATERIAL_SLOTS; id++) {
     const td = tileById(id);
     const look = resolveTileLook(td); // ★ 两级解析：一级底色（基底）+ 二级细节材质
     const mat = look.mat;
      // ★ 无材质地块：基色由 albedo 纹理承载，uMatBaseLCH 必须置白（OKLab 白 = L1,C0,H0），
      //   否则 base=LCH 解码 × alb(已含完整基色) 会把颜色平方 → 坑/水/冰发黑
      // ★ 有材质地块：uMatBaseLCH = 组调色板(融合原 RegionTheme)调制后的材质一级底色，
      //   着色器 oklchShade = LCH + 二级细节逐像素偏移 + 每地块抖动
      //   （2026-08-31：旧实现直接喂 sRGB 值到 linear 管线 = srgb/linear bug；现整链路 OKLab）
      const tintHsl = mat
        ? applyGroupTintHsl(look.baseHsl, palette)
        : look.baseHsl;
      const lch = mat
        ? srgbHslToOklch(tintHsl.h, tintHsl.s, tintHsl.l)
        : { L: 1, C: 0, H: 0 };   // OKLab 白
     base[id * 4] = lch.L;
     base[id * 4 + 1] = lch.C;
     base[id * 4 + 2] = lch.H;
    base[id * 4 + 3] = mat?.detail.surface.roughness ?? 0.9;
    // ★ 逐地块抖动幅度：GPU 化（原 albedo 侧 CPU 抖动移除）→ uMatJitter[id].xyz
    const j = td.visual.jitter ?? { h: 0, s: 0, l: 0 };
    const jlch = td.visual.material
      ? srgbHslJitterAmp(tintHsl.h, tintHsl.s, tintHsl.l, j.h, j.s, j.l)
      : { L: 0, C: 0, H: 0 };
    jitter[id * 4] = jlch.L;
    jitter[id * 4 + 1] = jlch.C;
    jitter[id * 4 + 2] = jlch.H;
    const s = mat?.detail.surface;
    surface[id * 4] = s?.specular ?? 0;
    surface[id * 4 + 1] = s?.fresnel ?? 0;
    surface[id * 4 + 2] = s?.emissive ? s.emissive.strength : 0;
    // ★ 地块边界黑色描边强度（borderLine=false 的水面无描边）；
    //   0.85 ≈ 全黑细线（2026-08-29 二调：0.16→0.6→0.85，配 band 0.035）
    surface[id * 4 + 3] = td.visual.borderLine === false ? 0 : 0.85;
    emissive[id * 4] = s?.emissive?.r ?? 0;
    emissive[id * 4 + 1] = s?.emissive?.g ?? 0;
    emissive[id * 4 + 2] = s?.emissive?.b ?? 0;
    // 材质图案参数：模板声明顺序打包（GLSL 端按同序索引读取）
    if (mat) {
      const merged = { ...mat.detail.params, ...(td.visual.material?.params ?? {}) };
      let i = 0;
      for (const k of Object.keys(mat.detail.params)) {
        params[id * 16 + i++] = merged[k] ?? mat.detail.params[k];
      }
      // ★ 通用装饰槽（slot 15）：条带装饰强度——全材质统一索引（模板无需声明），
      //   地块 material.params 加 { stripes: 0.6 } 即启用，0/缺省 = 关
      params[id * 16 + 15] = merged.stripes ?? 0;
      // ★ 通用装饰槽（slot 14）：警示贴画强度——沙土地块专属（黑黄警示方框），
      //   地块 material.params 加 { hazard: 0.85 } 即启用，0/缺省 = 关
      params[id * 16 + 14] = merged.hazard ?? 0;
    }
  }

  const tileIds = new THREE.DataTexture(
    Uint8Array.from(chunkData.blockTypes), 15, 15,
    THREE.RedFormat, THREE.UnsignedByteType,
  );
  tileIds.magFilter = THREE.NearestFilter;
  tileIds.minFilter = THREE.NearestFilter;
  tileIds.flipY = false;
  tileIds.needsUpdate = true;

  // ★ 每 tile id 的材质函数索引（数据驱动分发，见 TerrainMaterial.MAT_FN_INDEX）
  const fn = new Int32Array(MATERIAL_SLOTS);
  for (let id = 0; id < MATERIAL_SLOTS; id++) {
    const td = tileById(id);
    fn[id] = td.visual.material ? materialFnIndex(td.visual.material.fnId) : -1;
    // ★ LOD 高台发光强度（材质二级声明；无材质机构地块 = 0）
    lodEmissive[id] = resolveTileLook(td).mat?.detail.lodEmissive ?? 0;
  }

  return { tileIds, base, jitter, surface, emissive, params, lodEmissive, fn };
}
