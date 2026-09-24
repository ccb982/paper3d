// ============================================================
// engine/Spread.ts —— 同兵种目标间距（OrderValidator ② 的实现；用户定）
// ============================================================
// 命令两体系（用户定 2026-09-24）：
//   · **径向**（飞船方向）：管 前近 / 拉开距离——沿"中心→点"的径向增/减 r；
//   · **切向**：管 同兵种间距——垂直于径向滑动，**径向距离不变**。
// 本文件只做切向：同兵种目标太近（< MIN=40m）→ 沿"对中点切向"对称推开，
// 保证"前近"（径向）与"拉开"（切向）互不干扰。
// 纯函数（无状态、零分配；center=null 时退化为沿连线推开）→ 可独立自检。
// ============================================================

export const SPREAD = {
  /** 同兵种目标最小间距（米） */
  MIN: 40,
  /** 迭代遍数（三遍收敛） */
  PASSES: 3,
} as const;

/** 极坐标滑动：绕中心转 dθ=push/r，半径不变；绕向 = 背离对方（由对方所在侧决定） */
function polarSlide(
  out: SpreadFix[], idx: number, center: { x: number; z: number },
  otherX: number, otherZ: number, push: number,
): void {
  const p = out[idx];
  const rx = p.x - center.x;
  const rz = p.z - center.z;
  const r = Math.hypot(rx, rz);
  if (r < 1e-3) {
    // 在圆心上：退化为沿"离开对方"的直线推
    const dx = p.x - otherX;
    const dz = p.z - otherZ;
    const d = Math.hypot(dx, dz) || 1;
    p.x += (dx / d) * push;
    p.z += (dz / d) * push;
    return;
  }
  const th = Math.atan2(rz, rx);
  const cross = rx * (otherZ - p.z) - rz * (otherX - p.x);   // 对方在自己哪一侧
  const s = cross >= 0 ? 1 : -1;
  const th2 = th - (push / r) * s;   // 往"对方的反侧"转（双方各自背离）
  p.x = center.x + Math.cos(th2) * r;
  p.z = center.z + Math.sin(th2) * r;
}

export interface SpreadPt {
  id: number;
  role: string;
  x: number;
  z: number;
}

export interface SpreadFix {
  id: number;
  x: number;
  z: number;
  /** 本点被推开的距离（米；0 = 未动） */
  moved: number;
}

/** 校验并修正同兵种目标点：返回修正后的点（异兵种互不约束）
 *  center：径向中心（玩家/飞船位置；给 → 切向推开保径向距离，不给 → 沿连线推开） */
export function spreadFix(
  pts: readonly SpreadPt[],
  center: { x: number; z: number } | null = null,
  min: number = SPREAD.MIN,
): SpreadFix[] {
  const out: SpreadFix[] = pts.map((p) => ({ id: p.id, x: p.x, z: p.z, moved: 0 }));
  const n = pts.length;
  for (let pass = 0; pass < SPREAD.PASSES; pass++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (pts[i].role !== pts[j].role) continue;   // 只约束同兵种
        const relx = out[j].x - out[i].x;
        const relz = out[j].z - out[i].z;
        const d = Math.hypot(relx, relz);
        if (d >= min) continue;
        const push = (min - d) / 2;
        if (center) {
          // ★ 极坐标切向：**半径严格不变，只改角**（径向=前近/拉开，切向=间距）
          polarSlide(out, i, center, out[j].x, out[j].z, push);
          polarSlide(out, j, center, out[i].x, out[i].z, push);
        } else {
          const dl = d > 1e-3 ? d : 1e-3;
          const ux = d > 1e-3 ? relx / dl : 1;
          const uz = d > 1e-3 ? relz / dl : 0;
          out[i].x -= ux * push;
          out[i].z -= uz * push;
          out[j].x += ux * push;
          out[j].z += uz * push;
        }
        out[i].moved += push;
        out[j].moved += push;
      }
    }
  }
  return out;
}
