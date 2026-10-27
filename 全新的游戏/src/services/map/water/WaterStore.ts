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
   * ★ 跨 chunk 归并的关键：**union-by-min** —— 合并时永远让块坐标字典序小的当 root
   *   ⇒ 最终 root 与登记顺序无关 ⇒ 同一片海，**无论先加载东边还是西边，bodyId 都一样**。
   *   （否则"一片海被切成 N 个 body"取决于玩家的漫游方向，不可复现。）
   *
   * @param chunkKey 该 chunk 的 key
   * @param worldBlocks 世界 4m 块坐标列表（形如 [bx*8192+bz 编码后的 key]）
   */
  registerChunkWater(chunkKey: number, worldBlocks: number[]): void {
    // ① 逐块登记（幂等：已登记的只补 chunk 归属）
    for (const bk of worldBlocks) {
      if (!this.parent.has(bk)) {
        this.parent.set(bk, bk);
        this.bodyBlocks.set(bk, new Set([bk]));
        this.bodyChunks.set(bk, new Set([chunkKey]));
        const bx = keyToX(bk), bz = keyToZ(bk);
        this.bodyBounds.set(bk, { minX: bx * 4, minZ: bz * 4, maxX: (bx + 1) * 4, maxZ: (bz + 1) * 4 });
      } else {
        const root = this.find(bk);
        this.bodyChunks.get(root)?.add(chunkKey);
      }
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

  /** 水体总数（诊断用） */
  get bodyCount(): number { return this.bodyBlocks.size; }

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
