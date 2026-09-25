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
  /** 迭代遍数（切向极坐标收敛较慢，八遍足够） */
  PASSES: 8,
} as const;

/** 极坐标滑动：绕中心按角差 dAng 转动（半径严格不变；side=±1 决定绕向） */
function polarSlide(
  out: SpreadFix[], idx: number, center: { x: number; z: number },
  ang: number, side: number, dAng: number,
): void {
  const p = out[idx];
  const r = Math.hypot(p.x - center.x, p.z - center.z);
  if (r < 1e-3) return;
  const th2 = ang - side * dAng;   // 双方各自背离（side 相反）
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
 *  center：径向中心（玩家/飞船位置；给 → 切向推开保径向距离，不给 → 沿连线推开）
 *  ★ id 定序：与输入顺序无关 → 各队各自校验也能得到同一全局解（确定性、可复现） */
export function spreadFix(
  pts: readonly SpreadPt[],
  center: { x: number; z: number } | null = null,
  min: number = SPREAD.MIN,
): SpreadFix[] {
  const out = pts.map((p) => ({ ...p, moved: 0 })).sort((a, b) => a.id - b.id);
  const n = out.length;
  for (let pass = 0; pass < SPREAD.PASSES; pass++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (out[i].role !== out[j].role) continue;   // 只约束同兵种
        const relx = out[j].x - out[i].x;
        const relz = out[j].z - out[i].z;
        const d = Math.hypot(relx, relz);
        if (d >= min) continue;
        const push = (min - d) / 2;
        if (center) {
          // ★ 极坐标切向：**半径严格不变，只改角**（径向=前近/拉开，切向=间距）
          const r1 = Math.hypot(out[i].x - center.x, out[i].z - center.z);
          const r2 = Math.hypot(out[j].x - center.x, out[j].z - center.z);
          if (r1 < 1e-3 || r2 < 1e-3) {
            const dl = d > 1e-3 ? d : 1e-3;
            const ux = d > 1e-3 ? relx / dl : 1;
            const uz = d > 1e-3 ? relz / dl : 0;
            out[i].x -= ux * push;
            out[i].z -= uz * push;
            out[j].x += ux * push;
            out[j].z += uz * push;
            out[i].moved += push;
            out[j].moved += push;
          } else {
            // ★ 目标角差（余弦定理，弦长 = min）——**只解 θ，半径严格不变**（行进目标点 = 径向 r ⊗ 切向 θ）。
            //   几何不可满足（min ≥ r1+r2，即目标点都在 min/2 环内）→ θ 差拉满 π（能散多大散多大，
            //   不引入径向推力/不越环）。此时弦长上限 = r1+r2，属物理上限，由兵种策略的 r 负责。
            const want = min >= r1 + r2
              ? Math.PI
              : Math.acos(Math.max(-1, Math.min(1,
                (r1 * r1 + r2 * r2 - min * min) / (2 * r1 * r2))));
            const a1 = Math.atan2(out[i].z - center.z, out[i].x - center.x);
            const a2 = Math.atan2(out[j].z - center.z, out[j].x - center.x);
            let cur = Math.abs(a1 - a2);
            if (cur > Math.PI) cur = Math.PI * 2 - cur;
            const dAng = Math.max(0, want - cur) * 0.5;
            if (dAng > 1e-6) {
              const tie = out[i].id < out[j].id ? 1 : -1;
              polarSlide(out, i, center, a1, tie, dAng);
              polarSlide(out, j, center, a2, -tie, dAng);
              out[i].moved += dAng * r1;
              out[j].moved += dAng * r2;
            }
          }
        } else {
          const dl = d > 1e-3 ? d : 1e-3;
          const ux = d > 1e-3 ? relx / dl : 1;
          const uz = d > 1e-3 ? relz / dl : 0;
          out[i].x -= ux * push;
          out[i].z -= uz * push;
          out[j].x += ux * push;
          out[j].z += uz * push;
          out[i].moved += push;
          out[j].moved += push;
        }
      }
    }
  }
  return out;
}
