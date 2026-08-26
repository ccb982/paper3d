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
import { planChunkDecals, type PlannedDecal } from './decor/TileDecalBase';
import {
  planChunkProps, buildPropLayer, computePropVolumes, mapDecorByKey, groupPropsByKey,
  type ChunkGroundHost, type PlannedProp,
} from './decor/MapEntityDecorBase';

/** ?dbgdecor=1 时开启装饰管线详细调试（分阶段计数 + 位置可视标记） */
const DBG_DECOR = typeof location !== 'undefined' && /[?&]dbgdecor=1/.test(location.search);

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
   * ★ 装饰计划（预渲染前完成放置）：
   * 贴图 + 装饰物都在烘焙【之前】放置——装饰物高度参与预渲染结构
   * （其阴影体积随快照进 Worker 印进光照图；贴图印进 albedo）。
   * 确定性：同 seed 同 chunk 结果恒定，烘焙与装配两侧消费同一份计划。
   */
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
      surfaceHeightAt: (x, z) => this.raster.surfaceHeightAt(x, z),
      debug: DBG_DECOR
        ? (stage, pass, total) => console.info(`[装饰][漏斗] chunk(${cx},${cz}) ${stage}: ${pass}/${total}`)
        : undefined,
    });
    const vols = computePropVolumes(props, cx, cz);
    console.info(
      `[ChunkManager][装饰] chunk(${cx},${cz}) 组=${chunkData.groupKey} ` +
      `贴图=${decals.length} 装饰物=${props.length} 阴影体积=${vols.length} ` +
      `种子=${this.raster.worldSeed}${DBG_DECOR ? ' [调试模式]' : ''}`,
    );
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
      if (DBG_DECOR) console.info(`[装饰][路径] chunk(${cx},${cz}) 缓存命中（装饰随纹理复用）`);
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
      if (DBG_DECOR) console.warn(`[装饰][路径] chunk(${cx},${cz}) Worker 不可用 → 同步回退`);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) this.raster.ensureData(cx + dx, cz + dz);
      const maps = bakeChunkMaps(this.raster, cx, cz, {
        propVolumes: decor.propVolumes, decals: decor.decals,
      });
      cacheChunkMaps(seed, cx, cz, maps);
      this.finishStandardChunk(cx, cz, maps, decor);
      return;
    }
    if (DBG_DECOR) console.info(`[装饰][路径] chunk(${cx},${cz}) Worker 在途（propVolumes=${decor.propVolumes.length / 5}）`);
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
        });
        cacheChunkMaps(seed, cx, cz, maps);
        this.finishStandardChunk(cx, cz, maps, decor);
      } catch (e2) {
        // 不入缓存：看门狗 sweep 会在下个周期重新走完整请求
        console.error(`[ChunkManager] chunk(${cx},${cz}) 同步回退也失败，交由看门狗重试`, e2);
      }
    }
  }

  /** ★ 标准风格构建②：像素就绪 → 几何/材质/物理（原 buildStandardChunk 后半） */
  private finishStandardChunk(cx: number, cz: number, maps: ChunkMaps, decor: DecorPlan): void {
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

    // ---- ★ 装饰层装配（计划在预渲染前已放置，此处直接消费同一份） ----
    // 贴图已在烘焙时印进 albedo 纹理（无需运行时步骤）；
    // 装饰物 → buildPropLayer → 挂进 chunk group
    let propLayer: THREE.Object3D | null = null;
    if (decor.props.length > 0) {
      propLayer = buildPropLayer(decor.props);
      if (propLayer) {
        // ★ 对齐 chunk 角：PlannedProp.x/z 是 chunk 角落坐标(0~60)，而 chunk
        //   group 原点在 chunk 中心——不偏移会整体错位半块（30m），
        //   影子/碰撞体与可见网格三者错位（踩过的坑）
        propLayer.position.set(-CHUNK_SIZE / 2, 0, -CHUNK_SIZE / 2);
        group.add(propLayer);
      } else {
        console.warn(`[ChunkManager][装饰] chunk(${cx},${cz}) 有 ${decor.props.length} 个装饰物但 buildPropLayer 返回 null（渲染器未注册？）`);
      }
      // ★ 调试可视标记：?dbgdecor=1 时把装饰物位置用高亮线框标出来
      if (DBG_DECOR && propLayer) {
        const markerGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true });
        const markers = new THREE.InstancedMesh(markerGeo, markerMat, decor.props.length);
        const mm = new THREE.Matrix4();
        const mv = new THREE.Vector3();
        for (let i = 0; i < decor.props.length; i++) {
          mv.set(decor.props[i].x, decor.props[i].y + 0.5, decor.props[i].z);
          mm.setPosition(mv);
          markers.setMatrixAt(i, mm);
        }
        markers.instanceMatrix.needsUpdate = true;
        propLayer.add(markers);
        console.info(`[装饰][标记] chunk(${cx},${cz}) 位置标记 ${decor.props.length} 个（品红线框）`);
      }
    }

    this.replaceChunk(
      chunkKeyOf(cx, cz), group, cx, cz,
      pos.array as Float32Array,
      new Uint32Array(geo.index!.array),
    );

    // ---- ★ 装饰物碰撞体：必须在 replaceChunk 之后创建 ----
    // （replaceChunk 会销毁 propBodies[key] 的"旧"碰撞体——若先创建，
    //   刚建的会被当旧体立刻销毁，物理实体永不存在。踩过的坑）
    // 创建走基类统一实现：createColliders（半径/高度来自表内 physics）
    if (propLayer && this.host.createPropBody) {
      const ids: number[] = [];
      for (const [key, list] of groupPropsByKey(decor.props)) {
        const def = mapDecorByKey(key);
        if (!def?.isCollidable) continue;
        ids.push(...def.createColliders(this.host, list, cx, cz));
      }
      if (ids.length > 0) {
        this.propBodies.set(chunkKeyOf(cx, cz), ids);
        if (DBG_DECOR) console.info(`[装饰][物理] chunk(${cx},${cz}) 创建碰撞体 ${ids.length} 个（fixed cuboid）`);
      } else if (decor.props.some((p) => mapDecorByKey(p.propKey)?.isCollidable)) {
        console.warn(`[装饰][物理] chunk(${cx},${cz}) 有可碰撞装饰物但 createPropBody 返回空（宿主未实现？）`);
      }
    }
    if (propLayer || decor.decals.length > 0) {
      console.info(`[ChunkManager][装饰] chunk(${cx},${cz}) 装配完成：贴图 ${decor.decals.length}（已印入albedo）/ 装饰物网格 ${propLayer ? propLayer.children.length : 0} 组`);
    }
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
