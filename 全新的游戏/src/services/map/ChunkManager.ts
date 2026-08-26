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
import { TerrainMaterial } from './TerrainMaterial';
import { buildChunkSideWalls } from './ChunkWalls';
import {
  buildBoss4DChunk, buildBoss4DChunkPhysics, isBoss4DVoidChunk,
} from './Boss4DArena';

/**
 * 地面刚体宿主接口。
 * chunk 的物理碰撞体必须进实体/物理体系（碰撞分发按 userData=id 找实体），
 * 本服务不直接持有 EntityManager，由模式层注入两个回调即可。
 */
export interface ChunkGroundHost {
  /** 为 chunk 创建 fixed trimesh 地面刚体，返回可销毁的 id */
  createGround(cx: number, cz: number, vertices: Float32Array, indices: Uint32Array): number;
  destroyGround(id: number): void;
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
  /** ★ 地图风格：false=标准外观 / true=四维空间（最终 Boss 战地图，Boss4DArena） */
  private boss4D = false;

  // ---- ★ 构建预算队列：跨区爆发不再同帧全部构建 ----
  private queue: { cx: number; cz: number; rebuild: boolean }[] = [];
  private queuedKeys = new Set<number>();
  /** 每帧构建时间预算（毫秒）；单帧最多消耗这么多，剩余下帧继续 */
  private static readonly BUILD_BUDGET_MS = 8;

  // ---- ★ 异步烘焙管线：重计算在 Worker，主线程零尖峰 ----
  /** 在途烘焙（key→请求；t=发起时刻供看门狗超时判定） */
  private pendingBakes = new Map<number, { cx: number; cz: number; gen: number; t: number }>();
  /** 烘焙换代计数：dispose / 切地图风格时自增，使在途结果全部作废 */
  private bakeGen = 0;
  /** 看门狗节拍累加器 */
  private watchdogAccum = 0;
  /** 已激活 chunk 集合（激活回调只触发一次） */
  private activated = new Set<number>();
  /** 激活回调（玩家进入半径/首个网格落地时；特殊事件预留） */
  private onChunkActivated?: (cx: number, cz: number, key: number) => void;

  constructor(
    scene: THREE.Scene, raster: RasterMap, host: ChunkGroundHost,
    opts?: { onChunkActivated?: (cx: number, cz: number, key: number) => void },
  ) {
    this.scene = scene;
    this.raster = raster;
    this.host = host;
    this.onChunkActivated = opts?.onChunkActivated;
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
    for (const v of this.meshes.values()) {
      this.scene.remove(v);
      this.disposeVisual(v);
    }
    this.meshes.clear();
    this.voidKeys.clear();
    this.activated.clear();
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
   * ★ 标准风格构建①：缓存查询 → 快照投给 Worker（无 Worker 时同步回退直建）。
   * 同 key 已在途则跳过；缓存命中则跳过烘焙直接装配。
   */
  private requestStandardBake(cx: number, cz: number): void {
    const key = chunkKeyOf(cx, cz);
    if (this.pendingBakes.has(key)) return;
    const seed = this.raster.worldSeed;

    // ★ 烘焙缓存命中：接缝重建 / 风格切换往返零重烘（纹理复用）
    const cached = getCachedChunkMaps(seed, cx, cz);
    if (cached) {
      this.finishStandardChunk(cx, cz, cached);
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
    );
    if (!p) {
      // Worker 不可用（如微信端未适配）：主线程同步烘 + 入缓存 + 立即建
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) this.raster.ensureData(cx + dx, cz + dz);
      const maps = bakeChunkMaps(this.raster, cx, cz);
      cacheChunkMaps(seed, cx, cz, maps);
      this.finishStandardChunk(cx, cz, maps);
      return;
    }
    this.pendingBakes.set(key, { cx, cz, gen, t: performance.now() });
    p.then((bufs) => {
      if (this.pendingBakes.get(key)?.gen !== gen) return; // 换代（切风格/dispose）已作废
      this.pendingBakes.delete(key);
      this.completeStandardBake(cx, cz, seed, bufs);
    });
  }

  /**
   * ★ 烘焙完成落地（组装+入缓存+建网格）。
   * 任何一步异常都回退主线程同步烘焙——绝不让 chunk 因单次失败而
   * 永久消失（"整片区域踩虚空"bug 的根因即此处的无兜底 rejection）。
   */
  private completeStandardBake(cx: number, cz: number, seed: number, bufs: BakeResult | null): void {
    try {
      const maps = bufs ? assembleChunkMaps(bufs.albedo, bufs.light) : null;
      if (maps) {
        cacheChunkMaps(seed, cx, cz, maps);
        this.finishStandardChunk(cx, cz, maps);
        return;
      }
      throw new Error('空结果');
    } catch (e) {
      console.error(`[ChunkManager] chunk(${cx},${cz}) 异步装配失败，回退主线程同步烘焙`, e);
      try {
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) this.raster.ensureData(cx + dx, cz + dz);
        const maps = bakeChunkMaps(this.raster, cx, cz);
        cacheChunkMaps(seed, cx, cz, maps);
        this.finishStandardChunk(cx, cz, maps);
      } catch (e2) {
        // 不入缓存：看门狗 sweep 会在下个周期重新走完整请求
        console.error(`[ChunkManager] chunk(${cx},${cz}) 同步回退也失败，交由看门狗重试`, e2);
      }
    }
  }

  /** ★ 标准风格构建②：像素就绪 → 几何/材质/物理（原 buildStandardChunk 后半） */
  private finishStandardChunk(cx: number, cz: number, maps: ChunkMaps): void {
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    // ★ 外观 UV：与 ChunkAppearance 像素映射约定配套（文件头有推导），flipY=false
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i) + CHUNK_SIZE / 2;
      const lz = pos.getZ(i) + CHUNK_SIZE / 2;
      const wx = cx * CHUNK_SIZE + lx;
      const wz = cz * CHUNK_SIZE + lz;
      pos.setY(i, this.raster.vertexHeightAt(wx, wz));
      uvs[i * 2] = lx / CHUNK_SIZE;
      uvs[i * 2 + 1] = lz / CHUNK_SIZE;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const mat = new TerrainMaterial(maps.albedo, maps.lightmap);
    // lightmap 挂 userData 供 disposeVisual 一并释放（.map 只登记 albedo）；
    // cached = 纹理归烘焙缓存所有，chunk 销毁时跳过纹理释放（releaseBakeCache 统一管）
    (mat as unknown as { userData: { lightMap?: THREE.Texture; cached?: boolean } }).userData =
      { lightMap: maps.lightmap, cached: true };

    const top = new THREE.Mesh(geo, mat);
    const group = new THREE.Group();
    group.add(top);
    // ★ 断崖侧壁：独立几何 + 顶点色（避免地面贴图被拉伸成墙面的纵向渐变）
    const walls = buildChunkSideWalls(this.raster, cx, cz);
    if (walls) group.add(walls);
    group.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);

    this.replaceChunk(
      chunkKeyOf(cx, cz), group, cx, cz,
      pos.array as Float32Array,
      new Uint32Array(geo.index!.array),
    );
  }

  /**
   * Boss4D 风格 chunk 同步构建（标准风格走 requestStandardBake 异步管线）。
   * ★ 虚空地块（isBoss4DVoidChunk 命中）：只建物理不建视觉——
   *   复刻"chunk 有碰撞无纹理"的历史 bug，主题化为四维空间的一部分。
   */
  private buildChunkMesh(cx: number, cz: number): void {
    const key = chunkKeyOf(cx, cz);
    if (this.boss4D && isBoss4DVoidChunk(this.raster.worldSeed, cx, cz)) {
      const b = buildBoss4DChunkPhysics(this.raster, cx, cz);
      this.replaceChunk(key, null, cx, cz, b.trimeshVertices, b.trimeshIndices);
      return;
    }
    const b = buildBoss4DChunk(this.raster, cx, cz);
    this.replaceChunk(key, b.group, cx, cz, b.trimeshVertices, b.trimeshIndices);
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
      m.geometry.dispose();
      const mm = m.material as THREE.MeshStandardMaterial | undefined;
      if (!mm) return;
      // ★ 双纹理方案：lightmap 挂在材质 userData 上；cached = 纹理归烘焙
      //   缓存所有（接缝重建/风格切换要复用），跳过纹理释放，材质照常销毁
      const extra = (mm as unknown as { userData?: { lightMap?: THREE.Texture; cached?: boolean } }).userData;
      if (!extra?.cached) {
        mm.map?.dispose();
        extra?.lightMap?.dispose();
      }
      mm.dispose();
    });
  }
}
