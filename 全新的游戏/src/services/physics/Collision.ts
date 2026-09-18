// ============================================================
// Collision —— 公共碰撞规则库（形状工具 + 可调参的碰撞判定）
// ============================================================
// 各实体基类/瞄准服务复用的碰撞函数：
//   - shapeExtents：碰撞形状 → 三轴半宽（球/胶囊/长方体统一）
//   - estimateRadius：形状 → 球近似半径（射线命中/距离判定）
//   - overlapXZ / separateXZ：水平重叠判定与最小分离轴推开（角色间推挤）
// 可调参：separateXZ 由调用方决定推挤分配（各半/单向），本库只算位移量。

import type { ColliderShape } from './PhysicsWorld';

/** 碰撞形状 → 三轴半宽 { hx, hy, hz }（球/胶囊：半径；cuboid：hx/hy/hz） */
export function shapeExtents(shape: ColliderShape): { hx: number; hy: number; hz: number } {
  switch (shape.type) {
    case 'ball':
      return { hx: shape.radius, hy: shape.radius, hz: shape.radius };
    case 'capsule':
      // 胶囊总半长 = 半高 + 半径（含半球帽）
      return { hx: shape.radius, hy: shape.halfHeight + shape.radius, hz: shape.radius };
    case 'cuboid':
      return { hx: shape.hx, hy: shape.hy, hz: shape.hz };
    case 'cylinder':
      // 圆柱（轴 = Y）：水平取半径、竖直取半高（横放旋转不在本近似内）
      return { hx: shape.radius, hy: shape.halfHeight, hz: shape.radius };
    case 'trimesh':
      // 地形网格：无规则包围体 → 0（角色推挤/距离判定不涉及地形）
      return { hx: 0, hy: 0, hz: 0 };
  }
}

/** 形状 → 球近似半径（射线命中/邻近查询用；略大于真实形状，保守不漏判） */
export function estimateRadius(shape: ColliderShape): number {
  const e = shapeExtents(shape);
  return Math.hypot(e.hx, e.hy, e.hz);
}

/** 水平（xz 平面）AABB 重叠判定 */
export function overlapXZ(
  ax: number, az: number, ahx: number, ahz: number,
  bx: number, bz: number, bhx: number, bhz: number,
): boolean {
  return Math.abs(ax - bx) < ahx + bhx && Math.abs(az - bz) < ahz + bhz;
}

/** ★ 水平最小分离轴：返回两方的推挤位移（各推一半）；null = 不重叠。
 *   调用方可按权重调整分配（目前各半） */
export function separateXZ(
  ax: number, az: number, ahx: number, ahz: number,
  bx: number, bz: number, bhx: number, bhz: number,
): { ax: number; az: number; bx: number; bz: number } | null {
  const dx = ax - bx;
  const dz = az - bz;
  const overlapX = ahx + bhx - Math.abs(dx);
  const overlapZ = ahz + bhz - Math.abs(dz);
  if (overlapX <= 0 || overlapZ <= 0) return null;
  if (overlapX < overlapZ) {
    const dir = dx >= 0 ? 1 : -1;
    return { ax: dir * overlapX / 2, az: 0, bx: -dir * overlapX / 2, bz: 0 };
  }
  const dir = dz >= 0 ? 1 : -1;
  return { ax: 0, az: dir * overlapZ / 2, bx: 0, bz: -dir * overlapZ / 2 };
}

/** ★ 圆 vs 定向矩形（OBB，水平面）：相交则返回把圆心推出矩形的世界位移；null = 不相交。
 *   矩形局部 +z = yaw 方向（与舰船 forward 同口径），hw/hl = 半宽/半长。 */
export function pushOutOBB(
  px: number, pz: number, r: number,
  ox: number, oz: number, hw: number, hl: number, yaw: number,
): { dx: number; dz: number } | null {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);   // 局部 +z（前）
  const rx = fz, rz = -fx;                         // 局部 +x（右）
  const ddx = px - ox, ddz = pz - oz;
  const lx = ddx * rx + ddz * rz;
  const lz = ddx * fx + ddz * fz;
  const cx = Math.max(-hw, Math.min(hw, lx));
  const cz = Math.max(-hl, Math.min(hl, lz));
  const ex = lx - cx, ez = lz - cz;
  const d2 = ex * ex + ez * ez;
  let px2: number, pz2: number;
  if (d2 > 1e-8) {
    if (d2 >= r * r) return null;                  // 圆与矩形不相交
    const d = Math.sqrt(d2);
    const push = r - d;
    px2 = (ex / d) * push;
    pz2 = (ez / d) * push;
  } else {
    // 圆心在矩形内：沿最小穿透轴推出
    const penX = hw - Math.abs(lx) + r;
    const penZ = hl - Math.abs(lz) + r;
    if (penX < penZ) { px2 = (lx >= 0 ? 1 : -1) * penX; pz2 = 0; }
    else { px2 = 0; pz2 = (lz >= 0 ? 1 : -1) * penZ; }
  }
  return { dx: px2 * rx + pz2 * fx, dz: px2 * rz + pz2 * fz };
}
