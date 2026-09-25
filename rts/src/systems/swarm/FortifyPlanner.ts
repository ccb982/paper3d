// ============================================================
// FortifyPlanner —— 工事规划（《RTS架构.md》§13.3/§13.4）
// ============================================================
// ★ 工兵评分体系（2026-09-23 大改；用户定）：
//   读表口径 = **要塞需求 need**（不是最低分）：
//     need(x) = scoreForUnit('defense', feats) × (1 − cover/COVER_FULL)
//     水/坑/硬边（blockedAt）直接排除 → 治"被极负分吸走成簇"
//   · 固定 8 扇区（环状包围舰船；摊销刷新：每次 1 区）
//   · 每扇区记 **峰值需求** + 对应点（peak）；需求 ≥ NEED_DONE = 该区仍缺工事
//   · 分配：**需求最高优先逐个分配**（一队一区、不重合）；粘性；更缺的未占区可抢占
//   · 目标函数（工兵专属）：缺 → 峰值点；不缺 → 扇区**弧线链采样**（约 12m 间距，天然成圈可连）
//   · 连通：相邻扇区均不缺 → 中点串战壕
// ============================================================

export const FORTIFY_SECTORS = 8;
/** 扇区需求达标线（need < 此值 = 该区已够工事；调参入口） */
export const NEED_DONE = 0.6;

export interface FortifyPick {
  x: number;
  z: number;
  /** 需求值（越大越缺工事） */
  score: number;
}

export class FortifyPlanner {
  /** 每扇区峰值需求（-∞ = 未知/无格） */
  readonly safety: number[] = Array(FORTIFY_SECTORS).fill(-Infinity);
  /** 每扇区峰值需求点 */
  readonly worst: FortifyPick[] = Array.from({ length: FORTIFY_SECTORS }, () => ({ x: 0, z: 0, score: -Infinity }));
  /** ★ 每扇区是否已扫描（区分"未扫描"与"扫描后无可行点"——后者不阻塞前推） */
  readonly scanned: boolean[] = Array(FORTIFY_SECTORS).fill(false);
  /** 队→扇区认领（一队一区，不重合；**需求最高优先，逐个分配**） */
  readonly claims = new Map<number, number>();
  /** 各队当前施工点 */
  readonly spots = new Map<number, FortifyPick & { sector: number }>();
  private cursor = 0;
  readonly dbg = { sweeps: 0, injected: 0, connected: 0, sectors: FORTIFY_SECTORS, builders: 0, claimsN: 0, spotsN: 0, assigned: '-' };

  /** 摊销刷新：本次只重算第 cursor 个扇区（环带 [rLo,rHi]；角度 [si,si+1)/8·2π） */
  refreshOne(
    cx: number, cz: number, rLo: number, rHi: number,
    needAt: (x: number, z: number) => number | null,
  ): void {
    const si = this.cursor;
    this.cursor = (this.cursor + 1) % FORTIFY_SECTORS;
    this.scanned[si] = true;
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
        const s = needAt(cx + dx, cz + dz);
        if (s === null) continue;
        if (!best || s > best.score) best = { x: cx + dx, z: cz + dz, score: s };   // ★ 最高需求
      }
    }
    this.worst[si] = best ?? { x: 0, z: 0, score: -Infinity };
    this.safety[si] = best ? best.score : -Infinity;
    this.dbg.sweeps++;
  }

  /** ★ 统一目标函数（工兵专属）：
   *  该区**仍缺**（峰值需求 ≥ NEED_DONE）→ 峰值点；**不缺** → 扇区**弧线链采样**（12m 间距，天然成圈可连）。
   *  选点必须过道路可行性（canReach：从队长位直达可走）。 */
  targetOf(
    cx: number, cz: number, sec: number, rLo: number, rHi: number,
    needAt: (x: number, z: number) => number | null, doneScore: number,
    canReach?: (x: number, z: number) => boolean,
  ): FortifyPick | null {
    const w = this.worst[sec];
    if (Number.isFinite(w.score) && w.score >= doneScore
      && (!canReach || canReach(w.x, w.z))) {
      return { x: w.x, z: w.z, score: w.score };
    }
    // 弧线链采样：扇区中弧半径 ~ (rLo+rHi)/2，±6m 抖动；沿弧每 12m 取点
    const TAU = Math.PI * 2;
    const a0 = (sec / FORTIFY_SECTORS) * TAU;
    const a1 = ((sec + 1) / FORTIFY_SECTORS) * TAU;
    const rm = (rLo + rHi) / 2;
    const arcLen = rm * (a1 - a0);
    const steps = Math.max(1, Math.round(arcLen / 12));
    for (let k = 0; k < steps; k++) {
      const a = a0 + ((k + 0.5) / steps) * (a1 - a0) + (Math.random() - 0.5) * 0.12;
      const rr = Math.max(rLo, Math.min(rHi, rm + (Math.random() - 0.5) * 12));   // ★ 夹在环带内（不进闸门内界）
      const x = Math.round((cx + Math.cos(a) * rr) / 4) * 4;
      const z = Math.round((cz + Math.sin(a) * rr) / 4) * 4;
      const s = needAt(x, z);
      if (s === null) continue;
      if (canReach && !canReach(x, z)) continue;
      return { x, z, score: s };
    }
    if (Number.isFinite(w.score) && (!canReach || canReach(w.x, w.z))) return { x: w.x, z: w.z, score: w.score };
    // ★ 兜底（用户定 2026-09-23：**取点/寻路允许出扇区**）：以中弧点为中心螺旋外扩，
    //   找"合法需求 + 可达"的点（可越出本扇区/环带）；找不到 → null（宁可不发令，也不发不可达目标）
    const mid = (a0 + a1) / 2;
    const mx0 = cx + Math.cos(mid) * rm, mz0 = cz + Math.sin(mid) * rm;
    for (let r = 0; r <= rHi + 60; r += 4) {
      const n = r === 0 ? 1 : Math.max(8, Math.round((Math.PI * 2 * r) / 8));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        const x = Math.round((mx0 + Math.cos(a) * r) / 4) * 4;
        const z = Math.round((mz0 + Math.sin(a) * r) / 4) * 4;
        if (Math.hypot(x - cx, z - cz) < rLo) continue;   // ★ 允许出扇区，但**不许进闸门内界**（防冲家）
        const s = needAt(x, z);
        if (s === null) continue;
        if (canReach && !canReach(x, z)) continue;
        return { x, z, score: s };
      }
    }
    return null;
  }

  /** 分配：**需求最高优先逐个分配**（一队一区）；仅阵亡释放；更缺的未占区（差 ≥ MARGIN）可抢占 */
  assign(builderIds: readonly number[], doneScore = 0): void {
    const alive = new Set(builderIds);
    for (const [sid] of [...this.claims]) {
      if (!alive.has(sid)) this.claims.delete(sid);
    }
    const used0 = new Set(this.claims.values());
    const MARGIN = 0.8;
    for (const [sid, sec] of [...this.claims]) {
      let bestSec = -1;
      let bestV = this.safety[sec] + MARGIN;   // 需**高**于现区 +余量
      for (let i = 0; i < FORTIFY_SECTORS; i++) {
        if (used0.has(i)) continue;
        const v = this.safety[i];
        if (Number.isFinite(v) && v > bestV) { bestV = v; bestSec = i; }
      }
      if (bestSec >= 0) {
        used0.delete(sec);
        used0.add(bestSec);
        this.claims.set(sid, bestSec);
      }
    }
    for (const sid of builderIds) {
      if (this.claims.has(sid)) continue;
      let bestSec = -1;
      let bestV = -Infinity;
      for (let i = 0; i < FORTIFY_SECTORS; i++) {
        if (used0.has(i)) continue;
        const v = this.safety[i];
        if (Number.isFinite(v) && v > bestV) { bestV = v; bestSec = i; }
      }
      if (bestSec < 0) {
        for (let i = 0; i < FORTIFY_SECTORS; i++) if (!used0.has(i)) { bestSec = i; break; }
      }
      if (bestSec < 0) break;
      this.claims.set(sid, bestSec);
      used0.add(bestSec);
    }
    void doneScore;
  }

  /** ★ 连通阶段：相邻扇区**均不缺**（需求 < NEED_DONE）→ 中点注入连接战壕 */
  connect(doneScore = 0, cap = 1): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (let i = 0; i < FORTIFY_SECTORS && out.length < cap; i++) {
      const j = (i + 1) % FORTIFY_SECTORS;
      if (!Number.isFinite(this.safety[i]) || !Number.isFinite(this.safety[j])) continue;
      if (this.safety[i] >= doneScore || this.safety[j] >= doneScore) continue;
      const a = this.worst[i];
      const b = this.worst[j];
      if (!Number.isFinite(a.score) || !Number.isFinite(b.score)) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) > 40) continue;
      out.push({ x: Math.round((a.x + b.x) / 8) * 4, z: Math.round((a.z + b.z) / 8) * 4 });
    }
    return out;
  }

  clear(): void {
    this.claims.clear();
    this.spots.clear();
    this.safety.fill(-Infinity);
    for (const w of this.worst) w.score = -Infinity;
    this.scanned.fill(false);
    this.cursor = 0;
  }
}
