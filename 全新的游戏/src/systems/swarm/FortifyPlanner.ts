// ============================================================
// FortifyPlanner —— 工事规划（《敌人管线设计.md》§13.3/§13.4）
// ============================================================
// 每队工兵的工作循环（贪心，不全局规划）：
//   ① 选**最危险区域**（评分最低格，聚类去重）
//   ② 派一队去修（工兵多队 → 各选各的 = 多线程）
//   ③ 该区安全度到阈值 → 扩大范围修 / 连通战壕
//   ④ **直到新任务出现**（威胁/低分格刷新/阶段变化）
// 评分与贪心寻路同源：直接用 TerrainScore（外部注入 scoreAt 回调）。
// ============================================================

export interface FortifyPick {
  x: number;
  z: number;
  score: number;
  /** 与上一个选点的距离（用于"新任务"抑制：同点抖动不算新任务） */
  moved: number;
}

export class FortifyPlanner {
  /** 当前锁定的最危险区域（sticky：同区评分未抬到阈值前不换） */
  target: FortifyPick | null = null;
  /** 探针 */
  readonly dbg = { scans: 0, picks: 0, kept: 0, worst: '-' as string };

  /** 找最危险格（4m 网格扫描；scoreAt 未就绪/不可站 → null 跳过）。
   *  ★ 环状扫描：围绕玩家（包围玩家）——只取 `[rLo, rHi]` 环带内的格。
   *  @param scoreAt 评分查询（commander.scoreAt；未就绪返回 null）
   *  @param keepR 同区粘滞半径（米；目标在半径内且未达标 → 不换区）
   *  @param doneScore 达标线（≥ 此分视为该区已修好 → 允许换区） */
  scan(
    cx: number, cz: number, rHi: number,
    scoreAt: (x: number, z: number) => number | null,
    keepR = 24, doneScore = 0, rLo = 0,
  ): void {
    this.dbg.scans++;
    let best: FortifyPick | null = null;
    for (let dz = -rHi; dz <= rHi; dz += 4) {
      for (let dx = -rHi; dx <= rHi; dx += 4) {
        const d2 = dx * dx + dz * dz;
        if (d2 > rHi * rHi || d2 < rLo * rLo) continue;   // ★ 环带
        const x = cx + dx, z = cz + dz;
        const s = scoreAt(x, z);
        if (s === null || s <= -1e8) continue;
        if (!best || s < best.score) {
          best = { x, z, score: s, moved: this.target ? Math.hypot(x - this.target.x, z - this.target.z) : 1e9 };
        }
      }
    }
    if (!best) return;
    // ★ 并行语义：执行轨（修/扩大/连通）与监测轨（找新任务）同跑——
    //   监测到"明显更危险"（低 0.5 分以上）的新区 → 立即抢占换区；否则保持粘滞（防抖动）。
    const cur = this.target;
    const urgent = cur && best.score < cur.score - 0.5;
    const keep = cur && cur.score < doneScore && best.moved <= keepR && !urgent;
    if (keep) {
      this.dbg.kept++;
      this.dbg.worst = `keep ${cur!.x | 0},${cur!.z | 0} s=${cur!.score.toFixed(2)}`;
      return;
    }
    this.dbg.picks++;
    this.target = best;
    this.dbg.worst = `${urgent ? '抢占!' : ''}${best.x | 0},${best.z | 0} s=${best.score.toFixed(2)}`;
  }

  clear(): void {
    this.target = null;
  }
}
