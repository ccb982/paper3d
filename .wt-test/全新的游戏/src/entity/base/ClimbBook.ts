// ============================================================
// entity/base/ClimbBook —— 上坡点统一管理（用户定 2026-09-26）
// ============================================================
// 认领制：**一个单位同一时刻只归一个上坡点**（别的点不得抢）。
//   · 抓上时认领；到落点/弃约/走远（>12m）才释放；
//   · 点用坐标身份（可行性表里同一点唯一）。
// 配合 CharacterCore 的 10s 兜底：任何兵（无论凭证）移动中卡在同一
//   坡点旁满 10s → 无条件送上坡（强制认领 + 放宽入区）。
// ============================================================

export interface ClimbRun {
  x: number;
  z: number;
  ux: number;
  uz: number;
  width?: number;
  w?: number;
  rise?: number;
  lx?: number;
  lz?: number;
  /** ★ 被动爬掩体（用户定 2026-09-27）：顶面世界高（免凭证/免认领，靠近就爬） */
  top?: number;
  passive?: boolean;
}

const claims = new Map<number, ClimbRun>();

export const climbBook = {
  claimed(uid: number): ClimbRun | null {
    return uid ? (claims.get(uid) ?? null) : null;
  },
  claim(uid: number, run: ClimbRun): void {
    if (uid) claims.set(uid, run);
  },
  release(uid: number): void {
    if (uid) claims.delete(uid);
  },
  clear(): void {
    claims.clear();
  },
  get size(): number {
    return claims.size;
  },
};
