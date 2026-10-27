// ============================================================
// WaterStore —— 水体独立存储（2026-10-27 架构收敛 · P1-1）
// ============================================================
// ★ 为什么要有它（现状的病根）：
//   水面 mesh 是 **chunk group 的子节点**
//     ⇒ chunk destroy → disposeVisual(group) → 水几何被 dispose → 水面消失
//     ⇒ 水体没有独立身份 ⇒ 做不了 LOD，也没法「跨 chunk 算一处」
//   独立后：水 mesh 挂自己的 group；chunk 封存/销毁**不再牵连它**。
//
// ★ 本阶段（P1-1）只做「存储位置 + 生命周期归属」：
//   · 水网格的创建 / 替换 / 释放 / 显隐全部由本类负责
//   · chunk 封存（park）只通知「这块别渲染」，**不删几何**；销毁（destroy）也不删
//   · 水网格自带世界平移（不再依赖 chunk group 的 position ⇒ 不再被 chunk 变换牵连）
//
// ★ 不动：求解算法 · 水位语义 · 材质 · 玩法查询 · 挖坑联动 · worker 协议
// ★ 下一步（P1-2）：body 归并（union-find）+ 唯一水位 body.L ⇒ 跨 chunk 算一处
// ============================================================

import * as THREE from 'three';
import { createWaterMesh } from '../WaterMaterial';
import { WATER_Y_EPS } from '../WaterSurface';
import type { WaterSurfaceRaw } from '../WaterSurface';
import { CHUNK_SIZE } from '../ChunkGenerator';

/** 水网格保留上限（超出按最久未用淘汰；防长时间漫游后内存膨胀） */
const MAX_CACHED_WATER = 160;

/** ★ 水体（body）—— 一片连续水域（**跨 chunk 算一片**） */
export interface WaterBody {
  /** 身份 = 连通分量的**代表块 key**（union-by-min ⇒ 与加载顺序无关 ⇒ 稳定可复现） */
  id: number;
  /** 成员世界块（4m 块） */
  blocks: Set<number>;
  /** 成员 chunk（chunkKey） */
  chunks: Set<number>;
  /** 包围盒（世界米） */
  minX: number; minZ: number; maxX: number; maxZ: number;
}

/** 世界 4m 块 key（与 WaterSurface.worldBlockKey 同编码；可逆） */
function blockKey(bx: number, bz: number): number {
  return (bx + 4096) * 8192 + (bz + 4096);
}
function keyToX(k: number): number { return Math.floor(k / 8192) - 4096; }
function keyToZ(k: number): number { return (k % 8192) - 4096; }

export class WaterStore {
  /** ★ 独立容器（挂 scene；**不属于任何 chunk group** ⇒ chunk 卸载不牵连水） */
  readonly group = new THREE.Group();
  /** chunkKey → 水网格（几何私有；材质是全局单例，不释放） */
  private readonly meshes = new Map<number, THREE.Mesh>();
  /** chunkKey → 该块的渲染开关（park/unpark 用；默认 true） */
  private readonly chunkVisible = new Map<number, boolean>();
  /** 显隐总开关（航行期隐藏水面；停靠恢复） */
  private visible = true;

  // ============================================================
  // ★ 水体身份（body）：跨 chunk 连通归并（2026-10-27 架构收敛 P1-2a）
  // ============================================================
  /** union-find 父表（blockKey → 父块 key；**union-by-min** ⇒ 父永远更小） */
  private readonly parent = new Map<number, number>();
  /** bodyId → 成员块集合 */
  private readonly bodyBlocks = new Map<number, Set<number>>();
  /** bodyId → 成员 chunk 集合 */
  private readonly bodyChunks = new Map<number, Set<number>>();
  /** bodyId → 包围盒（世界米） */
  private readonly bodyBounds = new Map<number, { minX: number; minZ: number; maxX: number; maxZ: number }>();
  /** ★ 某 chunk 水面解算完成的回调（唇候选上报；由 ChunkManager 接管 body 水位协调） */
  onChunkSolved: ((chunkKey: number, lip: number) => void) | null = null;
  /**
   * ★ 某 chunk 落地后**与所属 body 的统一水位不一致**（且它不是被强制过的）⇒ 回调。
   * 触发场景：chunk 被重建（地形细化/风格切换/接缝重建/挖坑重建）时，
   *   worker 产出的水是**各自算的唇** ⇒ 会盖掉 forcedLevel 统一的成果 ⇒ 又参差。
   * ⇒ 由外部排一次 forcedLevel 重发（收敛：重发后 levelIsForced ⇒ 不再触发）。
   */
  onMisaligned: ((chunkKey: number, bodyId: number, level: number) => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.group.name = 'WaterStore';
    scene.add(this.group);
  }

  // ============================================================
  // ★ 水体归属：跨 chunk 连通归并
  // ============================================================

  /**
   * 登记某 chunk 的水块（世界 4m 块坐标），并与**已登记的邻块**合并。
   *
   * ★★ **分组语义（2026-10-27 用户定，修正之前的 4 邻域连通分量口径）**：
   *   · **一个 chunk 内的所有水 = 一体**（不再按岛/沙洲的连通性再切）
   *     —— 岛只是湖里的陆地，不该把一片湖分裂成 9 个水体（实测：一个带岛的湖被切成
   *        9 个 body ⇒ 各自算水位 ⇒「各降各的」）。
   *   · **相邻 chunk 之间有水相接 ⇒ 合成一体**（一个水体可以跨越多个 chunk）
   *   ⇒ body = 「chunk 内的水簇」按跨 chunk 连通合并。
   *
   * ★ 跨 chunk 归并的关键：**union-by-min** —— 合并时永远让块坐标字典序小的当 root
   *   ⇒ 最终 root 与登记顺序无关 ⇒ 同一片海，**无论先加载东边还是西边，bodyId 都一样**。
   *   （否则"一片海被切成 N 个 body"取决于玩家的漫游方向，不可复现。）
   *
   * @param chunkKey 该 chunk 的 key
   * @param worldBlocks 世界 4m 块坐标列表（形如 [bx*8192+bz 编码后的 key]）
   */
  registerChunkWater(chunkKey: number, worldBlocks: number[], lipCandidates?: number[], edgeBlocks?: number[]): void {
    if (worldBlocks.length === 0) return;
    // ① 逐块登记（幂等：已登记的只补 chunk 归属）
    for (const bk of worldBlocks) {
      if (!this.parent.has(bk)) {
        this.parent.set(bk, bk);
        this.bodyBlocks.set(bk, new Set([bk]));
        this.bodyChunks.set(bk, new Set([chunkKey]));
        const bx = keyToX(bk), bz = keyToZ(bk);
        this.bodyBounds.set(bk, { minX: bx * 4, minZ: bz * 4, maxX: (bx + 1) * 4, maxZ: (bz + 1) * 4 });
      }
    }
    // ①b ★★ **本 chunk 的所有水块合成一体**（chunk 内一体 ⇒ 岛/沙洲不再分裂水体）
    //     （旧口径：逐块按 4 邻域连通 ⇒ 带岛的湖被切成多个 body ⇒ 各降各的）
    let rep = -1;
    for (const bk of worldBlocks) {
      const root = this.find(bk);
      if (rep < 0) rep = root; else this.union(rep, root);
    }
    rep = rep < 0 ? -1 : this.find(rep);
    if (rep >= 0) this.bodyChunks.get(rep)?.add(chunkKey);
    // ①c ★★ **登记时写入唇候选（块精度估计，零成本）**
    //   ⇒ body.L 在**装配/求解之前**就可用 ⇒ 首次求解直接用 body.L ⇒ **第一次就统一**。
    //   （否则求解器各自算唇 ⇒ 必然不齐 ⇒ 只能事后拉平）
    // ①d ★ 记录**贴岸块**（与陆地相邻）⇒ body 几何据此把贴岸顶点钉死（不参与 FFT 位移）
    if (edgeBlocks && edgeBlocks.length > 0) {
      let eb = this.bodyEdges.get(chunkKey);
      if (!eb) { eb = new Set<number>(); this.bodyEdges.set(chunkKey, eb); }
      for (const k of edgeBlocks) eb.add(k);
    }
    if (lipCandidates && lipCandidates.length > 0) {
      const lip = Math.min(0, Math.min(...lipCandidates));
      this.setChunkLip(chunkKey, lip);
      this.onChunkSolved?.(chunkKey, lip);
    }
    // ② 与 4 邻方向的**已登记**块合并（跨 chunk 的连通就在这里合上）
    for (const bk of worldBlocks) {
      const bx = keyToX(bk), bz = keyToZ(bk);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nk = blockKey(bx + dx, bz + dz);
        if (!this.parent.has(nk)) continue;   // 邻居还没加载 → 等它来时再合
        this.union(bk, nk);
      }
    }
  }

  /** 某水块所属的 bodyId（未登记 ⇒ -1） */
  bodyIdOf(bk: number): number {
    if (!this.parent.has(bk)) return -1;
    return this.find(bk);
  }

  /** 某水块所属的水体（未登记 ⇒ null） */
  bodyOf(bk: number): WaterBody | null {
    const id = this.bodyIdOf(bk);
    if (id < 0) return null;
    return this.bodyOfId(id);
  }

  /** 按 id 取水体 */
  bodyOfId(id: number): WaterBody | null {
    const blocks = this.bodyBlocks.get(id);
    if (!blocks) return null;
    const b = this.bodyBounds.get(id);
    return {
      id,
      blocks,
      chunks: this.bodyChunks.get(id) ?? new Set(),
      minX: b?.minX ?? 0, minZ: b?.minZ ?? 0, maxX: b?.maxX ?? 0, maxZ: b?.maxZ ?? 0,
    };
  }

  /** 全部水体（遍历用） */
  allBodies(): WaterBody[] {
    const out: WaterBody[] = [];
    for (const id of this.bodyBlocks.keys()) {
      const b = this.bodyOfId(id);
      if (b) out.push(b);
    }
    return out;
  }

  // ============================================================
  // ★ body 级水面几何（一个 body 一个 mesh；跨 chunk；世界坐标）
  // ============================================================
  /** bodyId → 水面 mesh */
  private readonly bodyMeshes = new Map<number, THREE.Mesh>();

  /** 某水体的成员水块集合 */
  blocksOfBody(bodyId: number): Set<number> | undefined {
    return this.bodyBlocks.get(bodyId);
  }

  /** 某块是否贴岸（贴岸 ⇒ 顶点钉死） */
  isEdgeBlock(chunkKey: number, bk: number): boolean {
    return this.bodyEdges.get(chunkKey)?.has(bk) === true;
  }

  /** 设定某水体的水面几何（★ 按 body 存；raw = null ⇒ 撤掉） */
  setBodyGeometry(bodyId: number, raw: WaterSurfaceRaw | null): void {
    const old = this.bodyMeshes.get(bodyId);
    if (!raw || raw.indices.length === 0) {
      if (old) { this.group.remove(old); old.geometry.dispose(); this.bodyMeshes.delete(bodyId); }
      return;
    }
    const m = createWaterMesh(raw);
    m.visible = this.visible;
    this.group.add(m);
    this.bodyMeshes.set(bodyId, m);
    if (old) { this.group.remove(old); old.geometry.dispose(); }
  }

  /** 水面 mesh 数（诊断用） */
  get bodyMeshCount(): number { return this.bodyMeshes.size; }

  /** 水体总数（诊断用） */
  get bodyCount(): number { return this.bodyBlocks.size; }

  // ============================================================
  // ★ body 级统一水位（2026-10-27）
  // ============================================================
  // 用户设计：「**整个连通的 body 水位一起下降**」。
  //   现状：求解 per-chunk ⇒ 挖一处只有 4×4 范围降，其余 chunk 水位不变 ⇒ 出现台阶。
  //   改后：每个 chunk 求解后报告自己的「唇候选」⇒ body.L = min(所有成员的唇)
  //        ⇒ L 变了就把 body 内**所有 chunk** 用同一个 forcedLevel 重发 ⇒ 整个水体一起升降。

  /** chunkKey → 该 chunk 的唇候选（= min(0, 岸唇)；缺省 = 未知） */
  private readonly chunkLips = new Map<number, number>();
  /** ★ chunkKey → 该 chunk **实际渲染**的水位（自算唇 或 被强制的 body.L） */
  private readonly chunkRendered = new Map<number, number>();
  /** chunkKey → 贴岸块集合（与陆地相邻；body 几何据此钉死顶点） */
  private readonly bodyEdges = new Map<number, Set<number>>();

  /** 记录某 chunk 的唇候选（求解完成后调用） */
  setChunkLip(chunkKey: number, lip: number): void {
    this.chunkLips.set(chunkKey, lip);
  }

  /**
   * ★ 某水体的**统一水位** —— **唯一真源**：min(所有成员的唇候选)。
   *   （用户定：「body 内最终的高度是各个 chunk 中水位最低的那个」）
   *   ⇒ 精细面与粗面都用它 ⇒ 同一 body 内所有水面高度**天然一致**。
   */
  bodyLevel(bodyId: number): number {
    return this.bodyLevelOf(bodyId) ?? 0;
  }

  /** 该水体是否已确定过水位（是否有成员报告过唇） */
  hasBodyLevel(bodyId: number): boolean {
    return this.bodyLevelOf(bodyId) !== undefined;
  }

  /**
   * ★ 水位变化后的钩子（几何由调用方重建；粗细统一按 body 存 ⇒ 这里不再单独管粗面）
   */
  refreshBodyGeometry(bodyId: number): void {
    // 粗/细几何同属 bodyMeshes（一个 body 一个 mesh），换档 = setBodyGeometry(新 raw)
    void bodyId;
  }

  /**
   * ★ 该水体里**实际渲染水位与 body.L 不一致**的 chunk 数（诊断「齐平没齐平」）。
   * 0 = 全部齐平；>0 = 统一动作没落地（或还有 chunk 没重发）。
   */
  misalignedCount(bodyId: number): number {
    const members = this.bodyChunks.get(bodyId);
    if (!members) return 0;
    const lvl = this.bodyLevel(bodyId);
    let n = 0;
    for (const chunkKey of members) {
      const r = this.chunkRendered.get(chunkKey);
      if (r !== undefined && Math.abs(r - lvl) > 1e-4) n++;
    }
    return n;
  }

  /**
   * ★ 只**报告**某 chunk 的唇候选（不建任何几何）。
   *   用途：per-chunk 的求解保留（它是"唇"的来源），但**几何按 body 存**
   *   ⇒ 装配时拿 raw.level 上报唇即可，per-chunk 的水面 mesh 一律不建。
   */
  reportLip(chunkKey: number, lip: number): void {
    this.setChunkLip(chunkKey, lip);
    this.onChunkSolved?.(chunkKey, lip);
  }

  /** 某 chunk 所属的水体集合（一个 chunk 里可能有多个水体：海 + 湖） */
  bodiesOfChunk(chunkKey: number): Set<number> {
    const out = new Set<number>();
    for (const [bodyId, chunks] of this.bodyChunks) {
      if (chunks.has(chunkKey)) out.add(bodyId);
    }
    return out;
  }

  /** 某水体的成员 chunk 集合 */
  chunksOfBody(bodyId: number): Set<number> {
    return this.bodyChunks.get(bodyId) ?? new Set();
  }

  /**
   * ★ 某水体的统一水位 = min(所有成员的唇候选)。
   * @returns undefined = 该水体还没有任何成员报告过唇（无法定水位）
   */
  bodyLevelOf(bodyId: number): number | undefined {
    const chunks = this.bodyChunks.get(bodyId);
    if (!chunks || chunks.size === 0) return undefined;
    let min = 0;
    let known = false;
    for (const chunkKey of chunks) {
      const lip = this.chunkLips.get(chunkKey);
      if (lip === undefined) continue;
      // ★ 水位 = min(0, 各成员唇)（水位不高于 0）
      const v = Math.min(0, lip);
      if (!known || v < min) { min = v; known = true; }
    }
    return known ? min : undefined;
  }

  /** 某 chunk 当前记录的唇（缺省 undefined） */
  lipOfChunk(chunkKey: number): number | undefined {
    return this.chunkLips.get(chunkKey);
  }

  // ============================================================
  // ★ 粗块水（远景静水）按 body 聚合 —— **每 chunk 一张 60×60 quad**
  // ============================================================
  // 旧实现（2026-10-27 删除）：每 4m 液块一张平 quad、每 chunk 一张 mesh
  //   ⇒ 粗块环（±6，航行前向 ±12）最多 **625 个水 draw call + 14 万 quad**。
  // 新实现：**每个粗块 chunk 一张 60×60 quad，按 body 合并成 1 个 mesh**
  //   ⇒ draw call 625 → 每片水体 1 个；顶点 14 万 → 4/块（非精细块）。
  //
  // ★★ 粗/细水面**统一按 body 存**（2026-10-27 用户定：「粗水块也按body
  //   / 是粗水块创建好后再改为细水块」）：
  //   · 一个 body 一个 mesh（bodyMeshes），粗细只是**几何精度不同**（step 4 / 1）。
  //   · 档位切换 = 用新的 raw 替换同一个 mesh（setBodyGeometry）。
  //   ⇒ 不再有「per-chunk 粗面 quad 合并」那套（已删）。

  /** 精细水面 mesh 数（诊断用） */
  get fineMeshCount(): number { return this.meshes.size; }

  /** union-find 查找（路径压缩） */
  private find(k: number): number {
    let root = k;
    for (;;) {
      const p = this.parent.get(root);
      if (p === undefined || p === root) break;
      root = p;
    }
    // 路径压缩
    let cur = k;
    while (cur !== root) {
      const nxt = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = nxt;
    }
    return root;
  }

  /** 合并两个块所属的水体（union-by-min：小的当 root ⇒ 与登记顺序无关） */
  private union(a: number, b: number): number {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return ra;
    const lo = ra < rb ? ra : rb;
    const hi = ra < rb ? rb : ra;
    this.parent.set(hi, lo);
    // 成员集合
    const mb = this.bodyBlocks.get(hi);
    if (mb) {
      const ma = this.bodyBlocks.get(lo)!;
      for (const k of mb) ma.add(k);
      this.bodyBlocks.delete(hi);
    }
    // 成员 chunk
    const mc = this.bodyChunks.get(hi);
    if (mc) {
      const ca = this.bodyChunks.get(lo)!;
      for (const c of mc) ca.add(c);
      this.bodyChunks.delete(hi);
    }
    // 包围盒
    const bb = this.bodyBounds.get(hi);
    if (bb) {
      const ba = this.bodyBounds.get(lo)!;
      ba.minX = Math.min(ba.minX, bb.minX);
      ba.minZ = Math.min(ba.minZ, bb.minZ);
      ba.maxX = Math.max(ba.maxX, bb.maxX);
      ba.maxZ = Math.max(ba.maxZ, bb.maxZ);
      this.bodyBounds.delete(hi);
    }
    return lo;
  }

  // ============================================================
  // 网格归属
  // ============================================================

  /**
   * 设定某 chunk 的水面网格。
   * @param raw `undefined` = **不更新**（保持旧水面，等异步水结果覆盖）
   *             `null` 或空网格 = **拆掉**旧水面
   */
  set(key: number, raw: WaterSurfaceRaw | null | undefined): void {
    if (raw === undefined) return;
    const old = this.meshes.get(key);
    if (raw && raw.indices.length > 0) {
      const m = createWaterMesh(raw);
      // ★ 水网格自带世界平移（chunk group 不再承载它）
      const cx = Math.floor(key / 8192) - 4096;
      const cz = (key % 8192) - 4096;
      m.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, cz * CHUNK_SIZE + CHUNK_SIZE / 2);
      // ★ 本次是「该 chunk 重建好了」⇒ 复位为可见（此前可能因 park/destroy 被隐藏）
      this.chunkVisible.set(key, true);
      m.visible = this.visible;
      this.group.add(m);
      this.meshes.set(key, m);
      if (old) { this.group.remove(old); old.geometry.dispose(); }
      this.touch(key);
      // ★ 粗/细水面统一按 body 存（一个 body 一个 mesh）⇒ 这里不需要区分处理粗面。
      // ★★ **所有**精细水都要报告唇候选（不只挖坑路径！）：
      //   初次加载走 terrainPatch worker（不走 applyWaterResult）⇒ 之前完全不报告
      //   ⇒ body.L 拿不到全局信息 ⇒ 各 chunk 各自算水位 ⇒ 水面残差不齐。
      const lip = raw.level ?? 0;
      // ★ 该 chunk **实际渲染**的水位（不管是不是被强制的）—— 诊断「是否真的齐平」用
      this.chunkRendered.set(key, lip);
      // ★★ 但**forcedLevel 的重发不能当唇**（那是被强制的值，不是真实岸唇）
      //   ⇒ 否则会把真实唇覆盖成 body.L ⇒ body.L 的 min 汇总被污染（更低的唇丢失）。
      if (!raw.levelIsForced) {
        this.setChunkLip(key, lip);          // ★ 自持记录（bodyLevelOf 可自洽计算）
        this.onChunkSolved?.(key, lip);      // ★ 再通知外部（触发 body 级重建）
      }
    } else if (old) {
      this.group.remove(old);
      old.geometry.dispose();
      this.meshes.delete(key);
    }
  }

  /** 取某 chunk 的水面网格（无则 null） */
  get(key: number): THREE.Mesh | null {
    return this.meshes.get(key) ?? null;
  }

  /** 摘下某 chunk 的水网格（**不释放**；用于换装前暂存） */
  detach(key: number): THREE.Mesh | null {
    const m = this.meshes.get(key);
    if (!m) return null;
    this.group.remove(m);
    this.meshes.delete(key);
    return m;
  }

  /** 挂回暂存的水网格（换装后回填） */
  attach(key: number, m: THREE.Mesh): void {
    m.visible = this.visible && (this.chunkVisible.get(key) ?? true);
    this.group.add(m);
    this.meshes.set(key, m);
    this.touch(key);
  }

  // ============================================================
  // 显隐
  // ============================================================

  /** 总开关（航行期隐藏整片水面；停靠恢复） */
  setVisible(v: boolean): void {
    if (this.visible === v) return;
    this.visible = v;
    for (const [key, m] of this.meshes) m.visible = v && (this.chunkVisible.get(key) ?? true);
  }

  /** 读取总开关 */
  get isVisible(): boolean { return this.visible; }

  /**
   * 单块显隐（chunk park/unpark 用）。
   * ★ park 只隐藏、**不删几何** ⇒ 回程瞬间恢复，且回程不必重解水面。
   */
  setChunkVisible(key: number, v: boolean): void {
    if ((this.chunkVisible.get(key) ?? true) === v) return;
    this.chunkVisible.set(key, v);
    const m = this.meshes.get(key);
    if (m) m.visible = this.visible && v;
  }

  // ============================================================
  // 生命周期
  // ============================================================

  /** 全部释放（模式退出） */
  dispose(): void {
    for (const m of this.meshes.values()) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes.clear();
    this.chunkVisible.clear();
    for (const m of this.bodyMeshes.values()) { this.group.remove(m); m.geometry.dispose(); }
    this.bodyMeshes.clear();
    this.bodyEdges.clear();
    this.parent.clear();
    this.bodyBlocks.clear();
    this.bodyChunks.clear();
    this.bodyBounds.clear();
    this.group.removeFromParent();
  }

  /** ★ 清空全部水面网格（风格切换用：地形换代 ⇒ 旧水面全部作废，重建时再 set） */
  clear(): void {
    for (const m of this.meshes.values()) { this.group.remove(m); m.geometry.dispose(); }
    this.meshes.clear();
    this.chunkVisible.clear();
  }

  /** 当前持有的水网格数（诊断用） */
  get count(): number { return this.meshes.size; }

  // ============================================================
  // 内部
  // ============================================================

  /** LRU 触碰（Map 保持插入序 ⇒ 第一个即最久未用）+ 超限淘汰 */
  private touch(key: number): void {
    const m = this.meshes.get(key);
    if (!m) return;
    this.meshes.delete(key);
    this.meshes.set(key, m);          // 移到末尾 = 最近用过
    while (this.meshes.size > MAX_CACHED_WATER) {
      const oldest = this.meshes.keys().next();
      if (oldest.done) break;
      const k = oldest.value;
      const om = this.meshes.get(k);
      if (om) { this.group.remove(om); om.geometry.dispose(); }
      this.meshes.delete(k);
      this.chunkVisible.delete(k);
    }
  }
}
