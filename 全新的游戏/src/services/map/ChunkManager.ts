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
import { buildBlockFaceIndex, type BlockFaceIndexBundle } from './BlockFaceIndex';
import { RasterMap, chunkKeyOf } from './RasterMap';
import {
  bakeChunkMaps, assembleChunkMaps,
  getCachedChunkMaps, cacheChunkMaps, releaseBakeCache,
  type ChunkMaps,
} from './ChunkAppearance';
import { terrainBaker, type BakeResult } from './TerrainBaker';
import { TerrainMaterial, MATERIAL_SLOTS, materialFnIndex, type TileRenderConfig } from './TerrainMaterial';
import { tileById } from './Tiles';
import { groupByKey, applyGroupTintHsl, type GroupPalette } from './TileGroups';
import { tileMaterialByKey } from './TileMaterials';
import { srgbHslToOklch, srgbHslJitterAmp } from './colorLab';
import { clearWallMaterials } from './ChunkWalls';
import { mergeTerrainPhysics, buildChunkFinal, buildChunkWallBuffers } from './Refinements';
import { buildFaceTable } from './FaceTable';
import { buildTopGeometry, buildWallGeometry, circleCells, buildPatchOverlay, type FaceGeometry } from './FaceBuild';
import { WallMaterial } from './TerrainMaterial';
import {
  buildPostChunkTopSurface,
  buildPostSideWalls,
  buildBevelWallDebug,
  postSurfaceHeightAt,
} from './PostProcess';
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

  // ---- ★ 地形补丁（§14.10 剔除+打补丁：子弹撞地 → 区域内统一补丁材质） ----
  /** chunkKey → N×N 补丁标记（1 = 该 1m coarse cell 已补丁；内存态，不持久化） */
  private patches = new Map<number, Uint8Array>();
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

  /** 每帧驱动：玩家驱动的无限扩张 + 看门狗自愈 */
  update(px: number, pz: number, dt: number): void {
    this.syncChunks(px, pz);
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
    clearWallMaterials();   // ★ 侧壁材质注册表清空（材质已由 disposeVisual 释放）
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
      // ★ 后处理层路由：贴地查询带后处理偏移（关闭时透传 raster 原值）
      surfaceHeightAt: (x, z) => postSurfaceHeightAt(this.raster, x, z),
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
   * ★ 标准风格构建②：像素就绪 → 几何/材质/物理（原 buildStandardChunk 后半）。
   * 贴图已在烘焙时印进 albedo（装饰叠加层）；材质由地块自挂 shader 分发。
   * 顶面几何走 ChunkSurface（SurfaceRules 派生，2026-08-29）；
   * 物理 trimesh = 顶面 + 断崖墙同一份缓冲合并（碰撞=所见不变式）。
   */
  private finishStandardChunk(cx: number, cz: number, maps: ChunkMaps, decor: DecorPlan): void {
    // ★ 表驱动直建（默认启用；设 __PP_TABLE_BUILD=false 可回退旧后处理管线）
    if ((globalThis as { __PP_TABLE_BUILD?: boolean }).__PP_TABLE_BUILD !== false) {
      this.finishStandardChunkTable(cx, cz, maps, decor);
      return;
    }
    // ★ 后处理层路由：顶面 = 后处理重建网格（关闭时透传精修层原输出）；
    // ★ 材质渲染配置：块 id 微纹理 + 参数数组（材质分发）
    const chunkDataForMat = this.raster.getChunkData(cx, cz);
    const palette = this.chunkPalette(cx, cz);
    const matCfg = chunkDataForMat ? buildTileRenderConfig(chunkDataForMat, palette) : undefined;

    // ★ per-chunk 地块面索引 bundle：一次构建（精修定型 cornerH + 墙缓冲 +
    //   面索引），顶面/侧壁/调试/贴地单点全复用，避免各后处理函数重复构建精修层产物。
    const src = this.raster.chunkSource(cx, cz);
    const cornerH = buildChunkFinal(src, cx, cz, CHUNK_SIZE).cornerH;
    const wallBuffers = buildChunkWallBuffers(src, cx, cz, CHUNK_SIZE, {
      seed: this.raster.worldSeed,
      palette,
      heightAt: (x, z) => this.raster.heightAt(x, z),
      tileDefAt: (x, z) => this.raster.tileDefAt(x, z),
    });
    const bundle: BlockFaceIndexBundle = {
      index: buildBlockFaceIndex(src, cx, cz, cornerH, wallBuffers),
      src,
      cornerH,
      wallBuffers,
    };
    this.raster.setBlockIndex(cx, cz, bundle);

    //   surf.vertices/indices 即渲染网格 = 物理顶点（视觉=物理同源）
    const surf = buildPostChunkTopSurface(this.raster, cx, cz, bundle);
    const mat = new TerrainMaterial(maps.albedo, maps.lightmap, matCfg);
    // lightmap 挂 userData 供 disposeVisual 一并释放（.map 只登记 albedo）；
    // cached = 纹理归烘焙缓存所有，chunk 销毁时跳过纹理释放（releaseBakeCache 统一管）
    (mat as unknown as { userData: { lightMap?: THREE.Texture; tileIds?: THREE.Texture; cached?: boolean } }).userData =
      { lightMap: maps.lightmap, tileIds: matCfg?.tileIds, cached: true };

    const top = new THREE.Mesh(surf.geometry, mat);
    const group = new THREE.Group();
    group.add(top);
    // ★ 断崖侧壁：独立几何 + 顶面同款材质纹理与光照（WallMaterial 复用
    //   uAlbedo/uLightmap/uTileIds/Okada 库，2026-09-01：不再是纯色 MeshBasicMaterial）
    // ★ 后处理层路由：侧壁 = 精修层墙缓冲 + 墙顶跟随后处理面（关闭时透传）
    const walls = buildPostSideWalls(this.raster, cx, cz, maps.albedo, maps.lightmap, matCfg, bundle);
    if (walls.mesh) group.add(walls.mesh);
    // ★ 调试线框（弧边记号/侧壁/邻居边）：默认关闭；设全局 __PP_DEBUG_LINES=true 开启
    if ((globalThis as { __PP_DEBUG_LINES?: boolean }).__PP_DEBUG_LINES) {
      const dbgBevel = buildBevelWallDebug(this.raster, cx, cz);
      if (dbgBevel) group.add(dbgBevel);
    }
    group.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);

    // ---- ★ 装饰层装配（计划在预渲染前已放置，此处直接消费同一份） ----
    // 贴图已在烘焙时印进 albedo 纹理（无需运行时步骤）；
    // 装饰物 → buildDecorLayer → 挂进 chunk group
    const propLayer = this.buildDecorLayer(cx, cz, decor);
    if (propLayer) group.add(propLayer);

    // ---- ★ 测试地图：地块名标注层（调试陈列馆；无碰撞） ----
    if (this.testChunk && chunkDataForMat) {
      group.add(buildTileLabelLayer(chunkDataForMat, (x, z) => postSurfaceHeightAt(this.raster, x, z)));
    }

    // ---- ★ 物理 trimesh：顶面 + 断崖墙合并（精修层统一产出地形物理；
    //      trimesh 无体积，cliff 边无墙则低侧物体穿入高板下方坠落）----
    // 顶面 = 精修层定型快照的 top；墙 = 精修层墙缓冲；合并 = Refinements
    // 统一地形物理（《精修层与定型快照架构.md》§3）。此处不含实体/装饰碰撞。
    // ★ 后处理层路由：物理 trimesh = 渲染顶面(后处理顶点) + 墙缓冲合并
    //   （关闭时 surf.vertices ≡ finalTerrain.top.vertices，逐位一致）
    const phys = mergeTerrainPhysics(
      { vertices: surf.vertices, indices: surf.indices },
      walls.buffers,
    );

    this.replaceChunk(
      chunkKeyOf(cx, cz), group, cx, cz,
      phys.vertices,
      phys.indices,
    );

    // ---- ★ 装饰物碰撞体（独立阶段：地形快照后补装饰物理，不依赖视觉层）----
    // 必须在 replaceChunk 之后创建（replaceChunk 会销毁旧 propBodies）。
    // 不再被 if(propLayer) 门控——物理的存在性不与"网格是否生成"绑定，
    // 避免渲染层偶发失败时装饰碰撞连同静默丢失（角色能穿、子弹不能）。
    this.createDecorColliders(cx, cz, decor);
  }

  /**
   * ★ 表驱动装配（默认路径；架构权威：《地形表驱动管线重构设计.md》定稿）：
   *   顶面 = 表驱动 coarse/fine（bevel 弧带 + weld 坡脚/角脊 0.125m，无坑裂）；
   *   侧壁 = 表驱动（顶沿 = 顶网格边界折线同位节点列，闭合）。
   *   物理 = 顶面 + 侧壁同一份缓冲合并同源（无墙缓冲中间物）。
   */
  private finishStandardChunkTable(cx: number, cz: number, maps: ChunkMaps, decor: DecorPlan): void {
    const src = this.raster.chunkSource(cx, cz);
    const palette = this.chunkPalette(cx, cz);
    const chunkDataForMat = this.raster.getChunkData(cx, cz);
    const matCfg = chunkDataForMat ? buildTileRenderConfig(chunkDataForMat, palette) : undefined;
    const table = buildFaceTable(src, cx, cz);
    // ★ 地形补丁（§14.10）：补丁覆盖 → 深度场堆积（坑缘坡降）+ 坑壁剔除 + 补丁色
    const patchArr = this.patches.get(chunkKeyOf(cx, cz));
    const patch = patchArr ? buildPatchOverlay(patchArr, cx, cz) : undefined;
    const topG = buildTopGeometry(table, src, undefined, patch);
    const wallG = buildWallGeometry(table, src, undefined, patch);

    const toGeo = (g: FaceGeometry, withColor: boolean): THREE.BufferGeometry => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(g.vertices, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(g.normals, 3));
      if (g.uvs) geo.setAttribute("uv", new THREE.BufferAttribute(g.uvs, 2));
      if (g.colors) geo.setAttribute("color", new THREE.BufferAttribute(g.colors, 3));
      if (withColor) {
        if (g.shade) geo.setAttribute("shade", new THREE.BufferAttribute(g.shade, 1));
      }
      geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
      return geo;
    };

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
    if (this.boss4D) return false;
    const ccx = Math.floor(px / CHUNK_SIZE);
    const cra = Math.floor(pz / CHUNK_SIZE);
    const arr = this.patches.get(chunkKeyOf(ccx, cra));
    if (!arr) return false;
    let lx = px - ccx * CHUNK_SIZE;
    let lz = pz - cra * CHUNK_SIZE;
    lx = Math.min(CHUNK_SIZE - 1, Math.max(0, Math.floor(lx)));
    lz = Math.min(CHUNK_SIZE - 1, Math.max(0, Math.floor(lz)));
    return arr[lz * CHUNK_SIZE + lx] === 1;
  }

  /**
   * ★ 子弹撞地 → 一次性地形扣补丁（§14.10 轻量档 R=0.6/D=0.2）：
   *   1) 水平圆与 coarse cell AABB 判交 → 标记补丁（幂等：重复命中不重建）
   *   2) 有新标记才重建受影响 chunk（表烘焙缓存命中 → 同步 finishStandardChunkTable；
   *      patch-aware 构建：区域内顶/壁统一下挖 depth + 换补丁色，边界外原样）
   *   3) chunk 未建成（未达构建半径）只登记 → 将来烘焙自然带补丁
   */
  playBulletImpact(px: number, _py: number, pz: number): void {
    if (this.boss4D) return; // 四维空间不扣地形
    const R = 0.6; // §14.10 T2 轻量档（破坏小）
    const touched = new Set<number>();
    let added = 0;
    for (const c of circleCells(px, pz, R, CHUNK_SIZE)) {
      const key = chunkKeyOf(c.cx, c.cz);
      let arr = this.patches.get(key);
      if (!arr) { arr = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE); this.patches.set(key, arr); }
      if (arr[c.lz * CHUNK_SIZE + c.lx] !== 1) { arr[c.lz * CHUNK_SIZE + c.lx] = 1; added++; }
      touched.add(key);
    }
    if (added === 0) return; // 幂等：无新 cell → 不重建
    for (const key of touched) {
      const ccx = Math.floor(key / 8192) - 4096;
      const cra = (key % 8192) - 4096;
      if (this.meshes.has(key) || this.voidKeys.has(key)) this.requestStandardBake(ccx, cra);
    }
    console.log(
      `[PATCH] 命中(${px.toFixed(1)},${pz.toFixed(1)}) r=${R} 新增cell=${added} 影响chunk=${touched.size}`,
    );
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
