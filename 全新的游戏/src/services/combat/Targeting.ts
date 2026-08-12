// ============================================================
// Targeting —— 瞄准/射线检测（公共服务，任何发射者共用）
// ============================================================
// 主角/敌人/友军射击前的"准星射线 → 落点"判定统一走这里：
//   ① 实体优先：射线路径分块遍历（SpatialGrid.queryRay）→ 3D 射线-碰撞体测试
//      → 命中目标必中（辅助瞄准，不受几何盲区影响）
//   ② 物理兜底：rapier castRay（地面/墙落点）
// 输出命中信息（落点/目标/距离），发射系统据此定向/结算。

import type { EntityManager } from '../../entity/EntityManager';
import type { EntityBase } from '../../entity/EntityBase';

export interface AimHit {
  /** 落点（世界坐标） */
  point: { x: number; y: number; z: number };
  /** 命中实体（null = 静态世界：地面/墙） */
  target: EntityBase | null;
  /** 距离（沿射线） */
  distance: number;
}

export interface AimOptions {
  /** 射线起点（世界） */
  origin: { x: number; y: number; z: number };
  /** 射线方向（单位向量） */
  dir: { x: number; y: number; z: number };
  /** 最大距离 */
  maxDist?: number;
  /** 排除实体（发射者自身） */
  exclude?: EntityBase;
  /** 附加过滤（如只锁定敌对阵营）；默认排除飞行中的子弹 */
  filter?: (e: EntityBase) => boolean;
}

/** ★ 公共射线检测：实体优先 → 物理兜底（见文件头注释） */
export function aimRaycast(em: EntityManager, opts: AimOptions): AimHit | null {
  const maxDist = opts.maxDist ?? 200;
  const o = opts.origin;
  const d = opts.dir;
  const filter = opts.filter ?? ((e) => e.entity.kind !== 'bullet');

  // ① 实体优先（分块遍历射线路径上的块 → 3D 射线-碰撞体测试）
  let bestPoint: { x: number; y: number; z: number } | null = null;
  let bestTarget: EntityBase | null = null;
  let bestT = Infinity;
  const candidates = em.queryRay({ x: o.x, z: o.z }, { x: d.x, z: d.z }, maxDist);
  for (const b of candidates) {
    if (b === opts.exclude) continue;
    if (!filter(b)) continue;
    const cv = b.collisionVolume;
    if (!cv) continue;
    // 球近似：中心 = 实体位置 + offsetY；半径按碰撞体类型估
    const center = { x: b.position.x, y: b.position.y + cv.offsetY, z: b.position.z };
    let radius: number;
    switch (cv.shape.type) {
      case 'ball': radius = cv.shape.radius * 2; break;
      case 'capsule': radius = cv.offsetY + cv.shape.radius; break;
      case 'cuboid': radius = Math.hypot(cv.shape.hx, cv.shape.hy, cv.shape.hz); break;
    }
    const t = raySphereHit(o, d, center, radius);
    if (t !== null && t > 0.1 && t < bestT) {
      bestT = t;
      bestTarget = b;
      bestPoint = {
        x: o.x + d.x * t,
        y: o.y + d.y * t,
        z: o.z + d.z * t,
      };
    }
  }
  if (bestPoint) {
    // ★ 遮挡校验：物理射线确认目标之前无遮挡（墙后目标不算命中）
    const rb = opts.exclude?.entity.rigidBody;
    const wallHit = em.physics?.castRay(o, d, bestT + 0.1, rb?.handle);
    if (wallHit) {
      const dWall = Math.hypot(wallHit.point.x - o.x, wallHit.point.y - o.y, wallHit.point.z - o.z);
      if (dWall < bestT) {
        // 墙/其他实体挡在目标前 → 落点 = 遮挡物
        return { point: wallHit.point, target: null, distance: dWall };
      }
    }
    return { point: bestPoint, target: bestTarget, distance: bestT };
  }

  // ② 物理兜底（地面/墙）
  const rb = opts.exclude?.entity.rigidBody;
  const hit = em.physics?.castRay(o, d, maxDist, rb?.handle);
  if (!hit) return null;
  const dist = Math.hypot(hit.point.x - o.x, hit.point.y - o.y, hit.point.z - o.z);
  return { point: hit.point, target: null, distance: dist };
}

/** ★ 射线 vs 球（二次方程）：返回 t（沿射线距离）；null = 不交 */
export function raySphereHit(
  o: { x: number; y: number; z: number },
  d: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
  r: number,
): number | null {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const a = d.x * d.x + d.y * d.y + d.z * d.z;
  const b = 2 * (ox * d.x + oy * d.y + oz * d.z);
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const sqrtD = Math.sqrt(disc);
  const t1 = (-b - sqrtD) / (2 * a);
  const t2 = (-b + sqrtD) / (2 * a);
  if (t1 >= 0) return t1;
  if (t2 >= 0) return t2;
  return null;
}
