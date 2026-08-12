// ============================================================
// SpatialGrid —— 实体空间索引（均匀网格，分块遍历）
// ============================================================
// 动机（架构 4.1a）：EntityManager 全量遍历随实体增长失控
//   - 渲染：视野外实体也走 billboard + 绘制管线
//   - AI 索敌 / 子弹 / 技能：范围查询需全量距离计算
// 选型：均匀网格（运动实体多 → 换块 O(1) 哈希移动，树结构重）
// 更新：EntityBase.update 末尾集中刷新（onEntityMoved），哈希比较，变化才移块

import * as THREE from 'three';

/** 有 xz 坐标的对象（EntityBase 满足） */
export interface SpatialPosition {
  position: { x: number; z: number };
}

export class SpatialGrid<T extends SpatialPosition> {
  /** 块内实体（key → Set） */
  private blocks = new Map<number, Set<T>>();
  /** 实体当前块（移块判定） */
  private cellOf = new Map<T, number>();

  constructor(private blockSize = 8, private maxQueryRange = 128) {}

  /** 块 key（负数安全：偏移编码） */
  private keyOf(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  /** 坐标 → 块 key */
  private cellKey(x: number, z: number): number {
    return this.keyOf(Math.floor(x / this.blockSize), Math.floor(z / this.blockSize));
  }

  /** 注册（EntityManager.register 调用） */
  insert(e: T): void {
    const key = this.cellKey(e.position.x, e.position.z);
    let set = this.blocks.get(key);
    if (!set) {
      set = new Set();
      this.blocks.set(key, set);
    }
    set.add(e);
    this.cellOf.set(e, key);
  }

  /** 注销（EntityManager.unregister 调用） */
  remove(e: T): void {
    const key = this.cellOf.get(e);
    if (key === undefined) return;
    this.blocks.get(key)?.delete(e);
    this.cellOf.delete(e);
  }

  /** ★ 集中刷新：位置已更新后调用（EntityBase.update 末尾）；
   *   只比较块 key，变化才移块（静止实体零成本） */
  move(e: T): void {
    const newKey = this.cellKey(e.position.x, e.position.z);
    const oldKey = this.cellOf.get(e);
    if (newKey === oldKey) return;
    if (oldKey !== undefined) this.blocks.get(oldKey)?.delete(e);
    let set = this.blocks.get(newKey);
    if (!set) {
      set = new Set();
      this.blocks.set(newKey, set);
    }
    set.add(e);
    this.cellOf.set(e, newKey);
  }

  /** 清空（场景卸载） */
  clear(): void {
    this.blocks.clear();
    this.cellOf.clear();
  }

  /** ★ 范围查询：圆覆盖的所有块 → 块内实体距离过滤 */
  querySphere(x: number, z: number, r: number): T[] {
    const out: T[] = [];
    const r2 = r * r;
    const minX = Math.floor((x - r) / this.blockSize);
    const maxX = Math.floor((x + r) / this.blockSize);
    const minZ = Math.floor((z - r) / this.blockSize);
    const maxZ = Math.floor((z + r) / this.blockSize);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const set = this.blocks.get(this.keyOf(cx, cz));
        if (!set) continue;
        for (const e of set) {
          const dx = e.position.x - x;
          const dz = e.position.z - z;
          if (dx * dx + dz * dz <= r2) out.push(e);
        }
      }
    }
    return out;
  }

  /** 区域查询：矩形覆盖的所有块 */
  queryRect(x0: number, z0: number, x1: number, z1: number): T[] {
    const out: T[] = [];
    const minX = Math.floor(Math.min(x0, x1) / this.blockSize);
    const maxX = Math.floor(Math.max(x0, x1) / this.blockSize);
    const minZ = Math.floor(Math.min(z0, z1) / this.blockSize);
    const maxZ = Math.floor(Math.max(z0, z1) / this.blockSize);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const set = this.blocks.get(this.keyOf(cx, cz));
        if (!set) continue;
        for (const e of set) {
          if (e.position.x >= Math.min(x0, x1) && e.position.x <= Math.max(x0, x1) &&
              e.position.z >= Math.min(z0, z1) && e.position.z <= Math.max(z0, z1)) {
            out.push(e);
          }
        }
      }
    }
    return out;
  }

  /** ★ 射线路径遍历（DDA 网格采样）：只返回射线经过的块内的实体（去重）
   *   瞄准检测用：先收窄候选集，再做 3D 射线-碰撞体测试 */
  queryRay(origin: { x: number; z: number }, dir: { x: number; z: number }, maxDist: number): T[] {
    const out: T[] = [];
    const seen = new Set<T>();
    const bs = this.blockSize;
    const x0 = origin.x, z0 = origin.z;
    const dx = dir.x, dz = dir.z;
    // DDA 初始化：各轴到下一个块边界的 t（沿射线参数）
    let tMaxX: number;
    let tMaxZ: number;
    if (dx > 0) tMaxX = ((Math.floor(x0 / bs) + 1) * bs - x0) / dx;
    else if (dx < 0) tMaxX = (Math.floor(x0 / bs) * bs - x0) / dx;
    else tMaxX = Infinity;
    if (dz > 0) tMaxZ = ((Math.floor(z0 / bs) + 1) * bs - z0) / dz;
    else if (dz < 0) tMaxZ = (Math.floor(z0 / bs) * bs - z0) / dz;
    else tMaxZ = Infinity;
    const tDeltaX = dx !== 0 ? Math.abs(bs / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(bs / dz) : Infinity;
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    let x = x0, z = z0, t = 0;
    // 步数上限（防死循环）：路径块数 = maxDist/bs + 2
    const maxSteps = Math.ceil(maxDist / bs) + 2;
    for (let i = 0; i < maxSteps; i++) {
      if (t > maxDist) break;
      const set = this.blocks.get(this.keyOf(Math.floor(x / bs), Math.floor(z / bs)));
      if (set) {
        for (const e of set) {
          if (!seen.has(e)) {
            seen.add(e);
            out.push(e);
          }
        }
      }
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        x += stepX * bs;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        z += stepZ * bs;
      }
    }
    return out;
  }

  /** ★ 视野查询：视锥 8 角点投影到 y=0 平面 → AABB → 覆盖块集合
   *   保守（投影比视锥更大），不误剔除
   *   ★ 必须先 updateMatrixWorld：renderAll 在 renderer.render 之前调用，
   *     矩阵未更新则 unproject 用上一帧姿态 → 边缘实体闪没 */
  queryVisible(camera: THREE.Camera): T[] {
    camera.updateMatrixWorld();
    const tmp = new THREE.Vector3();
    const corners: THREE.Vector3[] = [];
    const ndc = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [nx, ny] of ndc) {
      // far 平面角点（世界）
      tmp.set(nx, ny, 1).unproject(camera);
      const dir = tmp.sub(camera.position);
      if (Math.abs(dir.y) < 1e-6) dir.y = 1e-6; // 视线平行地面（极端）兜底
      const t = -camera.position.y / dir.y;
      if (t <= 0) {
        // 射线向上（相机下方不可见，仰视/平视的上角）：钳制到最大查询范围，
        // 防止天上点把 AABB 拉到失控（覆盖失控 = 裁剪失效）
        corners.push(camera.position.clone().addScaledVector(dir.normalize(), this.maxQueryRange));
      } else {
        corners.push(camera.position.clone().addScaledVector(dir, t));
      }
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of corners) {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
    }
    // 相机后方（俯视时的近角）也纳入
    minX = Math.min(minX, camera.position.x - this.blockSize);
    maxX = Math.max(maxX, camera.position.x + this.blockSize);
    minZ = Math.min(minZ, camera.position.z - this.blockSize);
    maxZ = Math.max(maxZ, camera.position.z + this.blockSize);
    return this.queryRect(minX, minZ, maxX, maxZ);
  }

  /** 当前实体数（调试） */
  get size(): number {
    return this.cellOf.size;
  }
}
