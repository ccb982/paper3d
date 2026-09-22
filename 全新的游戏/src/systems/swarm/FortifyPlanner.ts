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
  /** 队→扇区认领（一队一区，不重合） */
  readonly claims = new Map<number, number>();
  /** 各队当前施工点 */
  readonly spots = new Map<number, FortifyPick & { sector: number }>();
  private cursor = 0;
  readonly dbg = { sweeps: 0, injected: 0, assigned: '-' };

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

  /** 分配：每队取"未被认领的最低安全值扇区"；扇区达标（≥doneScore）→ 释放换下一个。
   *  顺带产出各队施工点（spots）。 */
  assign(builderIds: readonly number[], doneScore = 0): void {
    for (const [sid, sec] of [...this.claims]) {
      if (this.safety[sec] >= doneScore) this.claims.delete(sid);   // 该区已修好 → 释放
    }
    const used = new Set(this.claims.values());
    this.spots.clear();
    for (const sid of builderIds) {
      let sec = this.claims.get(sid);
      if (sec === undefined) {
        sec = undefined;
        let bs = Infinity;
        for (let i = 0; i < FORTIFY_SECTORS; i++) {
          if (used.has(i)) continue;
          const v = this.safety[i];
          if (Number.isFinite(v) && v < bs) { bs = v; sec = i; }
        }
        if (sec === undefined) break;   // 未认领的有效区已空
        this.claims.set(sid, sec);
        used.add(sec);
      }
      const w = this.worst[sec];
      if (Number.isFinite(w.score) && w.score < doneScore) {
        this.spots.set(sid, { ...w, sector: sec });
      }
    }
    this.dbg.assigned = [...this.spots].map(([id, p]) =>
      `#${id}→区${p.sector}:${p.x | 0},${p.z | 0}(${p.score.toFixed(1)})`).join(' ');
  }

  clear(): void {
    this.claims.clear();
    this.spots.clear();
    this.safety.fill(Infinity);
    for (const w of this.worst) w.score = Infinity;
    this.cursor = 0;
  }
}
