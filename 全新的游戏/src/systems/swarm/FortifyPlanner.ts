// ============================================================
// FortifyPlanner —— 工事规划（《敌人管线设计.md》§13.3/§13.4）
// ============================================================
// 固定分区（性能纪律，用户定 2026-09-23）：
//   · 环状包围舰船 → 固定 **8 个扇区**（不再每队手扫全环）
//   · 每扇区一个**安全值**（区内最低评分）+ 最危险点
//   · 摊销刷新：每次只重算 1 个扇区（调用方 2Hz → 全区 ~4s 一轮）
//   · 分配：每工兵队取**未被认领的最低安全值扇区**（一队一区，不重合）
//   · 施工点注入 EngineerCorps.pieces（既有分派/施工链接走）；评分达标 → 释放扇区换下一个
// 评分与贪心寻路同源：直接用 TerrainScore。
// ============================================================

export const FORTIFY_SECTORS = 8;

export interface FortifyPick {
  x: number;
  z: number;
  score: number;
}

export class FortifyPlanner {
  /** 每扇区安全值（= 区内最低评分；∞ = 未知/无格） */
  readonly safety: number[] = Array(FORTIFY_SECTORS).fill(Infinity);
  /** 每扇区最危险点（安全值对应格） */
  readonly worst: FortifyPick[] = Array.from({ length: FORTIFY_SECTORS }, () => ({ x: 0, z: 0, score: Infinity }));
  /** 队→扇区认领（一队一区，不重合；**最危险优先，逐个分配**） */
  readonly claims = new Map<number, number>();
  /** 各队当前施工点 */
  readonly spots = new Map<number, FortifyPick & { sector: number }>();
  private cursor = 0;
  readonly dbg = { sweeps: 0, injected: 0, connected: 0, sectors: FORTIFY_SECTORS, builders: 0, claimsN: 0, spotsN: 0, assigned: '-' };

  /** 摊销刷新：本次只重算第 cursor 个扇区（环带 [rLo,rHi]；角度 [si,si+1)/8·2π） */
  refreshOne(
    cx: number, cz: number, rLo: number, rHi: number,
    scoreAt: (x: number, z: number) => number | null,
  ): void {
    const si = this.cursor;
    this.cursor = (this.cursor + 1) % FORTIFY_SECTORS;
    const TAU = Math.PI * 2;
    const a0 = (si / FORTIFY_SECTORS) * TAU;
    const a1 = ((si + 1) / FORTIFY_SECTORS) * TAU;
    let best: FortifyPick | null = null;
    for (let dz = -rHi; dz <= rHi; dz += 4) {
      for (let dx = -rHi; dx <= rHi; dx += 4) {
        const d2 = dx * dx + dz * dz;
        if (d2 > rHi * rHi || d2 < rLo * rLo) continue;
        let ang = Math.atan2(dz, dx);
        if (ang < 0) ang += TAU;
        if (ang < a0 || ang >= a1) continue;
        const s = scoreAt(cx + dx, cz + dz);
        if (s === null || s <= -1e8) continue;
        if (!best || s < best.score) best = { x: cx + dx, z: cz + dz, score: s };
      }
    }
    this.worst[si] = best ?? { x: 0, z: 0, score: Infinity };
    this.safety[si] = best ? best.score : Infinity;
    this.dbg.sweeps++;
  }

  /** ★ 统一目标函数（用户定）：扇区**未达标** → 最危险点（补评分）；**已达标** → 扇区内随机位置（继续干）。
   *  ★ 选点必须过**道路可行性**（canReach：从队位直达可走）——走不到的点不派，否则原地打转。 */
  targetOf(
    cx: number, cz: number, sec: number, rLo: number, rHi: number,
    scoreAt: (x: number, z: number) => number | null, doneScore: number,
    canReach?: (x: number, z: number) => boolean,
  ): FortifyPick | null {
    const w = this.worst[sec];
    if (Number.isFinite(w.score) && w.score < doneScore
      && (!canReach || canReach(w.x, w.z))) {
      return { x: w.x, z: w.z, score: w.score };
    }
    const TAU = Math.PI * 2;
    const a0 = (sec / FORTIFY_SECTORS) * TAU;
    const a1 = ((sec + 1) / FORTIFY_SECTORS) * TAU;
    for (let k = 0; k < 10; k++) {
      const a = a0 + Math.random() * (a1 - a0);
      const rr = rLo + Math.random() * (rHi - rLo);
      const x = Math.round((cx + Math.cos(a) * rr) / 4) * 4;
      const z = Math.round((cz + Math.sin(a) * rr) / 4) * 4;
      const s = scoreAt(x, z);
      if (s === null || s <= -1e8) continue;
      if (canReach && !canReach(x, z)) continue;   // ★ 道路可行性
      return { x, z, score: s };
    }
    if (Number.isFinite(w.score) && (!canReach || canReach(w.x, w.z))) return { x: w.x, z: w.z, score: w.score };
    // ★ 最终兜底：扇区中点（评分不可用也返回）——**每队必有目标，spotFor 永不 null**
    const mid = (a0 + a1) / 2;
    const rm = (rLo + rHi) / 2;
    return { x: Math.round((cx + Math.cos(mid) * rm) / 4) * 4, z: Math.round((cz + Math.sin(mid) * rm) / 4) * 4, score: 0 };
  }

  /** 统一取点：**仅限本队认领的防区（扇区）**；无认领 → null（不跨区、不帮忙） */
  spotFor(
    sid: number, cx: number, cz: number, rLo: number, rHi: number,
    scoreAt: (x: number, z: number) => number | null, doneScore: number,
    canReach?: (x: number, z: number) => boolean,
  ): (FortifyPick & { sector: number }) | null {
    const sec = this.claims.get(sid);
    if (sec === undefined) return null;
    const p = this.targetOf(cx, cz, sec, rLo, rHi, scoreAt, doneScore, canReach);
    return p ? { ...p, sector: sec } : null;
  }

  /** 分配：每队取"未被认领的最低安全值扇区"（**一队一队一区**）；**仅在队阵亡时释放**——
   *  （施工点由 `spotFor` / Commander 每拍统一取） */
  assign(builderIds: readonly number[], doneScore = 0): void {
    const alive = new Set(builderIds);
    for (const [sid] of [...this.claims]) {
      if (!alive.has(sid)) this.claims.delete(sid);   // 阵亡 → 释放（达标不释放：继续补）
    }
    const used0 = new Set(this.claims.values());
    // ★ 抢占换区（"干到引擎调走"）：存在**未认领且明显更危险（低 ≥ MARGIN）**的扇区 → 调队过去；否则一直干
    const MARGIN = 1.0;
    for (const [sid, sec] of [...this.claims]) {
      let bestSec = -1;
      let bestV = this.safety[sec] - MARGIN;
      for (let i = 0; i < FORTIFY_SECTORS; i++) {
        if (used0.has(i)) continue;
        const v = this.safety[i];
        if (Number.isFinite(v) && v < bestV) { bestV = v; bestSec = i; }
      }
      if (bestSec >= 0) {
        used0.delete(sec);
        used0.add(bestSec);
        this.claims.set(sid, bestSec);
      }
    }
    // ★ 逐个分配（用户定）：无区队按"**最危险优先**"认领未认领扇区 → 每队必有独立区
    for (const sid of builderIds) {
      if (this.claims.has(sid)) continue;
      let bestSec = -1;
      let bestV = Infinity;
      for (let i = 0; i < FORTIFY_SECTORS; i++) {
        if (used0.has(i)) continue;
        const v = this.safety[i];
        if (Number.isFinite(v) && v < bestV) { bestV = v; bestSec = i; }
      }
      if (bestSec < 0) {
        // 安全值还没刷新到的（或全 Infinity）→ 先随便认一个未认领区，刷新后由抢占纠正
        for (let i = 0; i < FORTIFY_SECTORS; i++) if (!used0.has(i)) { bestSec = i; break; }
      }
      if (bestSec < 0) break;   // 8 区已满（队数 > 8）
      this.claims.set(sid, bestSec);
      used0.add(bestSec);
    }
    void doneScore;
  }

  /** ★ 连通阶段（§13.4）：相邻扇区**均已达标** → 两点之间取中点注入连接战壕（把工事连成一片）。
   *  @param cap 本次最多返回几个连接点（调用方限流） */
  connect(doneScore = 0, cap = 1): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (let i = 0; i < FORTIFY_SECTORS && out.length < cap; i++) {
      const j = (i + 1) % FORTIFY_SECTORS;
      if (!Number.isFinite(this.safety[i]) || !Number.isFinite(this.safety[j])) continue;
      if (this.safety[i] < doneScore || this.safety[j] < doneScore) continue;
      const a = this.worst[i];
      const b = this.worst[j];
      if (!Number.isFinite(a.score) || !Number.isFinite(b.score)) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) > 40) continue;   // 距离过远不连
      out.push({ x: Math.round((a.x + b.x) / 8) * 4, z: Math.round((a.z + b.z) / 8) * 4 });
    }
    return out;
  }

  clear(): void {
    this.claims.clear();
    this.spots.clear();
    this.safety.fill(Infinity);
    for (const w of this.worst) w.score = Infinity;
    this.cursor = 0;
  }
}
