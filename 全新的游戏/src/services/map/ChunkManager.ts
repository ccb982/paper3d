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
import { CHUNK_SIZE } from './ChunkGenerator';
import { RasterMap, chunkKeyOf } from './RasterMap';
import {
  bakeChunkMaps, assembleChunkMaps,
  getCachedChunkMaps, cacheChunkMaps, releaseBakeCache,
  type ChunkMaps,
} from './ChunkAppearance';
import { terrainBaker, type BakeResult } from './TerrainBaker';
import { terrainPatch } from './TerrainPatch';
import { TerrainMaterial, MATERIAL_SLOTS, materialFnIndex, clearWallMaterialRegistry, type TileRenderConfig } from './TerrainMaterial';
import { tileById } from './Tiles';
import { groupByKey, applyGroupTintHsl, type GroupPalette } from './TileGroups';
import { tileMaterialByKey } from './TileMaterials';
import { srgbHslToOklch, srgbHslJitterAmp } from './colorLab';
import { circleCells, type FaceGeometry } from './FaceBuild';
import { computeTableGeometry } from './PatchCompute';
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

/** 装饰计划（预渲染前放置完成；烘焙与装配两侧消费同一份） */
export interface DecorPlan {
  decals: PlannedDecal[];
  props: PlannedProp[];
  /** 装饰物阴影体积（世界坐标，5×N Float32Array，随快照进 Worker） */
  propVolumes: Float32Array;
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
  /** ★ 地图风格：false=标准外观 / true=四维空间（最终 Boss 战地图，Boss4DArena） */
  private boss4D = false;

  // ---- ★ 构建预算队列：跨区爆发不再同帧全部构建 ----
  private queue: { cx: number; cz: number; rebuild: boolean }[] = [];
  private queuedKeys = new Set<number>();
  /** 每帧构建时间预算（毫秒）；单帧最多消耗这么多，剩余下帧继续 */
  private static readonly BUILD_BUDGET_MS = 8;

  // ---- ★ 异步烘焙管线：重计算在 Worker，主线程零尖峰 ----
  /** 在途烘焙（key→请求；t=发起时刻供看门狗超时判定） */
  private pendingBakes = new Map<number, { cx: number; cz: number; gen: number; t: number; decor: DecorPlan }>();
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
    maps: ChunkMaps; decor: DecorPlan;
    top: FaceGeometry; wall: FaceGeometry;
  }[] = [];
  /** 每帧装配预算（个；几何已在 Worker 算好，装配 ≈ 上传+物理，个位 ms/块） */
  private static readonly ASSEMBLE_PER_FRAME = 2;

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

  /** 每帧驱动：玩家驱动的无限扩张 + 看门狗自愈 + 几何装配预算 */
  update(px: number, pz: number, dt: number): void {
    this.syncChunks(px, pz);
    // ★ 装配预算：几何就绪的 chunk 每帧最多 N 个（平滑 BufferGeometry/物理开销）
    let n = ChunkManager.ASSEMBLE_PER_FRAME;
    while (n-- > 0 && this.assembleQueue.length > 0) {
      const a = this.assembleQueue.shift()!;
      this.geoInflight.delete(a.key);
      this.assembleTableChunk(a.cx, a.cz, a.maps, a.decor, a.top, a.wall);
    }
    // ★ 看门狗：自愈一切"数据在、网格丢"的状态（Worker 被杀/消息丢失/
    //   装配异常等任何原因造成的空洞，0.5s 内补请求）
    this.sweepChunks(px, pz, dt);
  }

  /** ★ 地图风格切换：重建全部已加载 chunk 的物理+视觉 */
  setStyle(boss4D: boolean): void {
    if (this.boss4D === boss4D) return;
    this.boss4D = boss4D;
    // ★ 作废在途标准烘焙；未建成的 key 重新按当前风格构建
    this.bakeGen++;
    this.geoInflight.clear();      // ★ 几何在途/待装配随风格换代作废
    this.assembleQueue.length = 0;
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
    this.geoInflight.clear();     // ★ 几何在途/待装配随 dispose 作废
    this.assembleQueue.length = 0;
    // ★ 在途烘焙全部作废（Worker 结果到达后因换代+scene 空被丢弃）
    this.bakeGen++;
    this.pendingBakes.clear();
    for (const id of this.bodies.values()) {
      this.host.destroyGround(id);
    }
    this.bodies.clear();
    for (const ids of this.propBodies.values()) {
      for (const id of ids) this.host.destroyGround(id);
    }
    this.propBodies.clear();
    for (const v of this.meshes.values()) {
      this.scene.remove(v);
      this.disposeVisual(v);
    }
    this.meshes.clear();
    this.voidKeys.clear();
    this.activated.clear();
    clearWallMaterialRegistry();   // ★ 侧壁材质注册表清空（材质已由 disposeVisual 释放）
    disposePropRenderers(); // ★ 装饰共享几何/材质统一释放（chunk 重建不释放）
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

    if (this.boss4D) return; // boss4D 同步构建，不存在异步空洞
    if (this.testChunk) {
      // ★ 测试地图：只自愈 chunk(0,0)。注意邻居的"数据"是烘焙快照的
      //   ensureData 邻域采样（不可见、无物理），不等于加载——若不加此守卫，
      //   sweep 会见"有数据无网格"而把 8 个邻居全部重建出来。
      const key = chunkKeyOf(0, 0);
      if (!this.meshes.has(key) && !this.voidKeys.has(key)
        && !this.pendingBakes.has(key) && !this.queuedKeys.has(key)) {
        this.requestStandardBake(0, 0);
      }
      return;
    }
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
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
    const added = this.raster.updateChunks(px, pz);
    for (const { cx, cz } of added) {
      this.enqueueChunk(cx, cz, false);
    }
    // 相邻接缝重建也入队（排在新建之后），避免同帧叠加烘焙开销
    for (const { cx, cz } of added) {
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nkey = chunkKeyOf(cx + nx, cz + nz);
        if (this.meshes.has(nkey)) {
          this.enqueueChunk(cx + nx, cz + nz, true);
        }
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
    do {
      const item = this.queue.shift()!;
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
    } while (
      this.queue.length > 0 &&
      performance.now() - t0 < ChunkManager.BUILD_BUDGET_MS
    );
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
   */
  private requestStandardBake(cx: number, cz: number): void {
    const key = chunkKeyOf(cx, cz);
    if (this.pendingBakes.has(key)) return;
    const seed = this.raster.worldSeed;

    // ★ 装饰先行：预渲染（烘焙）前完成贴图与装饰物的放置
    const decor = this.planDecor(cx, cz);

    // ★ 烘焙缓存命中：接缝重建 / 风格切换往返零重烘（纹理复用）
    const cached = getCachedChunkMaps(seed, cx, cz);
    if (cached) {
      this.finishStandardChunk(cx, cz, cached, decor);
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
      // Worker 不可用（如微信端未适配）：主线程同步烘 + 入缓存 + 立即建
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) this.raster.ensureData(cx + dx, cz + dz);
      const maps = bakeChunkMaps(this.raster, cx, cz, {
        propVolumes: decor.propVolumes, decals: decor.decals,
      }, this.chunkPalette(cx, cz));
      cacheChunkMaps(seed, cx, cz, maps);
      this.finishStandardChunk(cx, cz, maps, decor);
      return;
    }
    this.pendingBakes.set(key, { cx, cz, gen, t: performance.now(), decor });
    p.then((bufs) => {
      if (this.pendingBakes.get(key)?.gen !== gen) return; // 换代（切风格/dispose）已作废
      this.pendingBakes.delete(key);
      this.completeStandardBake(cx, cz, seed, bufs, decor);
    });
  }

  /**
   * ★ 烘焙完成落地（组装+入缓存+建网格）。
   * 任何一步异常都回退主线程同步烘焙——绝不让 chunk 因单次失败而
   * 永久消失（"整片区域踩虚空"bug 的根因即此处的无兜底 rejection）。
   */
  private completeStandardBake(
    cx: number, cz: number, seed: number,
    bufs: BakeResult | null, decor: DecorPlan,
  ): void {
    try {
      const maps = bufs ? assembleChunkMaps(bufs.albedo, bufs.light) : null;
      if (maps) {
        cacheChunkMaps(seed, cx, cz, maps);
        this.finishStandardChunk(cx, cz, maps, decor);
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
        this.finishStandardChunk(cx, cz, maps, decor);
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
          this.assembleQueue.push({ key, cx, cz, maps, decor, top: geom.top, wall: geom.wall });
          return;
        }
        // Worker 故障批 → 主线程同步同函数（字节一致；见 PatchCompute）
        this.geoInflight.delete(key);
        try {
          const g = computeTableGeometry(readChunk, this.raster.worldSeed, cx, cz, new Uint8Array(levels));
          this.assembleTableChunk(cx, cz, maps, decor, g.top, g.wall);
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
   */
  private assembleTableChunk(
    cx: number,
    cz: number,
    maps: ChunkMaps,
    decor: DecorPlan,
    topG: FaceGeometry,
    wallG: FaceGeometry,
  ): void {
    const toGeo = (g: FaceGeometry, withColor: boolean): THREE.BufferGeometry => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(g.vertices, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(g.normals, 3));
      if (g.uvs) geo.setAttribute("uv", new THREE.BufferAttribute(g.uvs, 2));
      if (g.colors) geo.setAttribute("color", new THREE.BufferAttribute(g.colors, 3));
      if (g.patchW) geo.setAttribute("apw", new THREE.BufferAttribute(g.patchW, 1)); // ★ 补丁权重（装饰纹理）
      if (withColor) {
        if (g.shade) geo.setAttribute("shade", new THREE.BufferAttribute(g.shade, 1));
      }
      geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
      return geo;
    };

    const palette = this.chunkPalette(cx, cz);
    const chunkDataForMat = this.raster.getChunkData(cx, cz);
    const matCfg = chunkDataForMat ? buildTileRenderConfig(chunkDataForMat, palette) : undefined;

    const mat = new TerrainMaterial(maps.albedo, maps.lightmap, matCfg, true);
    (mat as unknown as { userData: { lightMap?: THREE.Texture; tileIds?: THREE.Texture; cached?: boolean } }).userData =
      { lightMap: maps.lightmap, tileIds: matCfg?.tileIds, cached: true };
    const group = new THREE.Group();
    group.add(new THREE.Mesh(toGeo(topG, false), mat));
    const wallMesh = new THREE.Mesh(toGeo(wallG, true), new WallMaterial(maps.albedo, maps.lightmap, matCfg, true));
    if (wallG.indices.length > 0) group.add(wallMesh);
    group.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);

    const propLayer = this.buildDecorLayer(cx, cz, decor);
    if (propLayer) group.add(propLayer);

    // 物理：顶面 + 侧壁合并（同一数据同源）
    const nVT = topG.vertices.length / 3;
    const pv = new Float32Array(topG.vertices.length + wallG.vertices.length);
    pv.set(topG.vertices, 0);
    pv.set(wallG.vertices, topG.vertices.length);
    const pi = new Uint32Array(topG.indices.length + wallG.indices.length);
    pi.set(topG.indices, 0);
    for (let i = 0; i < wallG.indices.length; i++) pi[topG.indices.length + i] = wallG.indices[i] + nVT;

    this.replaceChunk(chunkKeyOf(cx, cz), group, cx, cz, pv, pi);
    this.createDecorColliders(cx, cz, decor);
    console.log(`[TABLE] chunk(${cx},${cz}) 顶tris=${topG.indices.length / 3} 壁quads=${wallG.indices.length / 6}`);
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
   * ★ 子弹撞地 → 补丁层数 +1（§14.11 R=0.6/D=0.2/层）：
   *   1) 水平圆与 coarse cell AABB 判交 → digCells 逐格 +1（不封顶；同点连打持续加深，
   *      视觉饱和由包络场几何吸收 → digCells 返回 false 跳过重建）
   *   2) 有可见变化才重建受影响 chunk —— 几何生成走 terrainPatch Worker；
   *      Worker 不可用 → 主线程同步同函数；纹理缓存缺失 → 既有标准烘焙管线兜底
   *   3) chunk 未建成（未达构建半径）只登记（levels 随数据落库）→ 将来烘焙自然带补丁
   */
  playBulletImpact(px: number, _py: number, pz: number): void {
    if (this.boss4D) return; // 四维空间不扣地形
    const R = 0.6; // §14.10 T2 轻量档（破坏小）
    const byChunk = new Map<number, { cx: number; cz: number; cells: { lx: number; lz: number }[] }>();
    for (const c of circleCells(px, pz, R, CHUNK_SIZE)) {
      const key = chunkKeyOf(c.cx, c.cz);
      let rec = byChunk.get(key);
      if (!rec) { rec = { cx: c.cx, cz: c.cz, cells: [] }; byChunk.set(key, rec); }
      rec.cells.push({ lx: c.lx, lz: c.lz });
    }
    let changedChunks = 0, cells = 0;
    for (const [, rec] of byChunk) {
      cells += rec.cells.length;
      if (this.raster.digCells(rec.cx, rec.cz, rec.cells)) {
        changedChunks++;
        const key = chunkKeyOf(rec.cx, rec.cz);
        if (this.meshes.has(key) || this.voidKeys.has(key)) this.patchRebuildChunk(rec.cx, rec.cz);
      }
    }
    if (changedChunks > 0) {
      console.log(
        `[PATCH] 命中(${px.toFixed(1)},${pz.toFixed(1)}) r=${R} 格${cells} 变化chunk=${changedChunks}`,
      );
    }
  }

  /** 同 chunk 破坏重建在途串行化（终态收敛；key → Promise） */
  private patchRebuilds = new Map<number, Promise<void>>();

  /**
   * ★ 破坏重建（异步）：几何字节来自 terrainPatch（Worker 优先 / 主线程同函数回退），
   * 装配与同步路径共用 assembleTableChunk。纹理缓存缺失 → requestStandardBake 兜底
   * （其完成装配的几何在主线程内联生成，与无 Worker 回退同一函数，字节一致）。
   */
  private patchRebuildChunk(cx: number, cz: number): void {
    const key = chunkKeyOf(cx, cz);
    // ★ 并发合并：同 chunk 在途 → 等其完成后再重算一次（掩码只增，第二次即终态）
    const prev = this.patchRebuilds.get(key);
    const run = async (): Promise<void> => {
      if (prev) await prev.catch(() => {});
      if (!this.meshes.has(key) && !this.voidKeys.has(key)) return;
      const maps = getCachedChunkMaps(this.raster.worldSeed, cx, cz);
      const decor = this.planDecor(cx, cz);
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
          { seed: this.raster.worldSeed, cx, cz, levels },
          (ccx, ccz) => this.raster.getChunkData(ccx, ccz),
        );
        if (!geom) { this.requestStandardBake(cx, cz); return; } // Worker 失败 → 兜底
        if (!this.meshes.has(key) && !this.voidKeys.has(key)) return;
        const maps2 = getCachedChunkMaps(this.raster.worldSeed, cx, cz);
        if (!maps2) return; // 期间缓存被清：后续 bake/重建自然覆盖
        const decor2 = this.planDecor(cx, cz);
        this.assembleTableChunk(cx, cz, maps2, decor2, geom.top, geom.wall);
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
   * 装饰物网格层（含调试标记）。返回 null = 无装饰物或渲染器未注册。
   * 调用方挂进 chunk group 后必须调用 createDecorColliders（在 replaceChunk 之后）。
   */
  private buildDecorLayer(cx: number, cz: number, decor: DecorPlan): THREE.Object3D | null {
    if (decor.props.length === 0) return null;
    const propLayer = buildPropLayer(decor.props);
    if (!propLayer) {
      console.warn(`[ChunkManager][装饰] chunk(${cx},${cz}) 有 ${decor.props.length} 个装饰物但 buildPropLayer 返回 null（渲染器未注册？）`);
      return null;
    }
    // ★ 对齐 chunk 角：PlannedProp.x/z 是 chunk 角落坐标(0~60)，而 chunk
    //   group 原点在 chunk 中心——不偏移会整体错位半块（30m），
    //   影子/碰撞体与可见网格三者错位（踩过的坑）
    propLayer.position.set(-CHUNK_SIZE / 2, 0, -CHUNK_SIZE / 2);
    return propLayer;
  }

  /**
   * 装饰物碰撞体：必须在 replaceChunk 之后创建（replaceChunk 会销毁
   * propBodies[key] 的"旧"碰撞体——若先创建，刚建的会被当旧体立刻销毁，
   * 物理实体永不存在。踩过的坑）。创建走基类统一实现。
   */
  private createDecorColliders(cx: number, cz: number, decor: DecorPlan): void {
    if (!this.host.createPropBody) return;
    const ids: number[] = [];
    for (const [key, list] of groupPropsByKey(decor.props)) {
      const def = mapDecorByKey(key);
      if (!def?.isCollidable) continue;
      ids.push(...def.createColliders(this.host, list, cx, cz));
    }
    if (ids.length > 0) {
      this.propBodies.set(chunkKeyOf(cx, cz), ids);
    } else if (decor.props.some((p) => mapDecorByKey(p.propKey)?.isCollidable)) {
      console.warn(`[ChunkManager][装饰] chunk(${cx},${cz}) 有可碰撞装饰物但 createPropBody 返回空（宿主未实现？）`);
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
    const b = buildBoss4DChunk(this.raster, cx, cz, decor.decals);
    const propLayer = this.buildDecorLayer(cx, cz, decor);
    if (propLayer) b.group.add(propLayer);
    this.replaceChunk(key, b.group, cx, cz, b.trimeshVertices, b.trimeshIndices);
    // ★ 装饰物碰撞体独立阶段（地形后补，不依赖视觉层）——同上解耦逻辑
    this.createDecorColliders(cx, cz, decor);
  }

  /** 拆旧视觉+旧物理 → 装新视觉 → 建配套新物理体（风格切换/流式构建共用） */
  private replaceChunk(
    key: number,
    visual: THREE.Object3D | null,
    cx: number,
    cz: number,
    trimeshVertices: Float32Array,
    trimeshIndices: Uint32Array,
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
    if (visual) {
      this.scene.add(visual);
      this.meshes.set(key, visual);
    } else {
      this.voidKeys.add(key);
    }
    const bodyId = this.host.createGround(cx, cz, trimeshVertices, trimeshIndices);
    this.bodies.set(key, bodyId);

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
     const mat = td.visual.material ? tileMaterialByKey(td.visual.material.fnId) : undefined;
      // ★ 无材质地块：基色由 albedo 纹理承载，uMatBaseLCH 必须置白（OKLab 白 = L1,C0,H0），
      //   否则 base=LCH 解码 × alb(已含完整基色) 会把颜色平方 → 坑/水/冰发黑
      // ★ 有材质地块：uMatBaseLCH = 组调色板(融合原 RegionTheme)调制后的基色，
      //   着色器 oklchShade = LCH + 逐像素偏移 + 每地块抖动 → 得"随组变色"的材质地面
      //   （2026-08-31：旧实现直接喂 sRGB 值到 linear 管线 = srgb/linear bug；现整链路 OKLab）
      const tintHsl = td.visual.material
        ? applyGroupTintHsl(td.visual.baseHsl, palette)
        : td.visual.baseHsl;
      const lch = td.visual.material
        ? srgbHslToOklch(tintHsl.h, tintHsl.s, tintHsl.l)
        : { L: 1, C: 0, H: 0 };   // OKLab 白
     base[id * 4] = lch.L;
     base[id * 4 + 1] = lch.C;
     base[id * 4 + 2] = lch.H;
    base[id * 4 + 3] = mat?.surface.roughness ?? 0.9;
    // ★ 逐地块抖动幅度：GPU 化（原 albedo 侧 CPU 抖动移除）→ uMatJitter[id].xyz
    const j = td.visual.jitter ?? { h: 0, s: 0, l: 0 };
    const jlch = td.visual.material
      ? srgbHslJitterAmp(tintHsl.h, tintHsl.s, tintHsl.l, j.h, j.s, j.l)
      : { L: 0, C: 0, H: 0 };
    jitter[id * 4] = jlch.L;
    jitter[id * 4 + 1] = jlch.C;
    jitter[id * 4 + 2] = jlch.H;
    const s = mat?.surface;
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
      const merged = { ...mat.params, ...(td.visual.material?.params ?? {}) };
      let i = 0;
      for (const k of Object.keys(mat.params)) {
        params[id * 16 + i++] = merged[k] ?? mat.params[k];
      }
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
    // ★ LOD 高台发光强度（材质模板声明；无材质机构地块 = 0）
    const mat = td.visual.material ? tileMaterialByKey(td.visual.material.fnId) : undefined;
    lodEmissive[id] = mat?.lodEmissive ?? 0;
  }

  return { tileIds, base, jitter, surface, emissive, params, lodEmissive, fn };
}
