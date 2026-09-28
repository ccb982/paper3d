// ============================================================
// FortifyPlanner —— 工事规划（《RTS架构.md》§13.3/§13.4）
// ============================================================
// ★ 工兵评分体系（2026-09-23 大改；用户定）：
//   读表口径 = **要塞需求 need**（不是最低分）：
//     need(x) = scoreForUnit('defense', feats) × (1 − cover/COVER_FULL)
//     水/坑/硬边（blockedAt）直接排除 → 治"被极负分吸走成簇"
//   · 固定 8 扇区（环状包围舰船；摊销刷新：每次 1 区）
//   · 每扇区记 **峰值需求** + **需求降序候选表**（都在扇区内 ∧ 带内）；需求 ≥ NEED_DONE = 该区仍缺工事
//   ★ 旧“一队一区认领（claims/assign）”**已删**（用户定 2026-09-26）：队→扇区改由
//   **大队管理器**（`tactics/BattalionManager.deployPlan`）给定；本文件只保留**建造位置查询**与需求数据。
//
// ★★ 施工目标获取契约（用户设计 2026-09-25；本文件是唯一口径）★★
//   输入：队所属扇区 sec（认领层给）· 当前带 [rLo,rHi] · 可达判定
//   输出：**扇区内 ∧ 带内 ∧ 可达 ∧ 需求最高** 的点；高位不可达 → **扇区内次高可达**；
//         全不可达 → **null**（无件，交给认领/机动/无件期，不许越界兜底）
//   纪律：**绝不出扇区、绝不出带**（废止 2026-09-23"允许出扇区"旧兜底）；
//         确定性（不掷随机数）；返回前以**当前带/扇区**复检（候选是摊销刷新的）。
// ============================================================

export const FORTIFY_SECTORS = 8;
/** 扇区需求达标线（need < 此值 = 该区已够工事；调参入口） */
export const NEED_DONE = 0.6;
/** 每扇区保留的候选点数（需求降序；供"次高可达"回退；上限 = 摊销成本封顶） */
export const CAND_K = 24;

export interface FortifyPick {
  x: number;
  z: number;
  /** 需求值（越大越缺工事） */
  score: number;
}

export class FortifyPlanner {
  /** 每扇区峰值需求（-∞ = 未知/无格） */
  readonly safety: number[] = Array(FORTIFY_SECTORS).fill(-Infinity);
  /** ★ 每扇区是否已扫描（区分"未扫描"与"扫描后无可行点"——后者不阻塞前推） */
  readonly scanned: boolean[] = Array(FORTIFY_SECTORS).fill(false);
  /** ★ 每扇区候选点（需求降序；仅扇区内 ∧ 带内；targetOf 逐个试可达） */
  readonly candidates: FortifyPick[][] = Array.from({ length: FORTIFY_SECTORS }, () => []);
  private cursor = 0;
  readonly dbg = { sweeps: 0, sectors: FORTIFY_SECTORS };

  /** 摊销刷新：本次只重算第 cursor 个扇区（**扇区内 ∧ 带内**；角度 [si,si+1)/8·2π）
   *  产出：`safety[si]`（峰值分）· `candidates[si]`（需求降序候选，≤CAND_K） */
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
    const list = this.candidates[si];
    list.length = 0;
    for (let dz = -rHi; dz <= rHi; dz += 4) {
      for (let dx = -rHi; dx <= rHi; dx += 4) {
        const d2 = dx * dx + dz * dz;
        if (d2 > rHi * rHi || d2 < rLo * rLo) continue;
        let ang = Math.atan2(dz, dx);
        if (ang < 0) ang += TAU;
        if (ang < a0 || ang >= a1) continue;
        const sc = needAt(cx + dx, cz + dz);
        if (sc === null) continue;
        FortifyPlanner.insertCandidate(list, { x: cx + dx, z: cz + dz, score: sc });
      }
    }
    const best = list[0] as FortifyPick | undefined;
    this.safety[si] = best ? best.score : -Infinity;
    this.dbg.sweeps++;
  }

  /** 需求降序插入（同分保序；超 CAND_K 截尾） */
  private static insertCandidate(list: FortifyPick[], c: FortifyPick): void {
    if (list.length >= CAND_K && c.score <= (list[list.length - 1] as FortifyPick).score) return;
    let i = list.length;
    while (i > 0 && (list[i - 1] as FortifyPick).score < c.score) i--;
    list.splice(i, 0, c);
    if (list.length > CAND_K) list.pop();
  }

  /** ★ 施工目标获取（唯一口径；见文件头契约）：
   *  候选 = refreshOne 预排的**扇区内 ∧ 带内**需求降序表；返回前以**当前带/扇区**复检。
   *  ① 需求 ≥ doneScore 的**带内**可达最高位；② 否则**带内**可达次高；
   *  ③ 否则**带外兜底**（仍限本扇区 ∧ 可达 ∧ 不排除；用户定 2026-09-26：分到区就去造）；④ 全不行 → null。 */
  targetOf(
    cx: number, cz: number, sec: number, rLo: number, rHi: number,
    doneScore: number,
    canReach?: (x: number, z: number) => boolean,
    /** ★ 新（2026-09-26）：排除集（已预约/已建/黑名单点）——防多队同点 */
    exclude?: (x: number, z: number) => boolean,
    /** ★★ 新（2026-09-27）：施工者位置——**朝前方（舰侧）优先**：优先选比工兵更靠舰的点 */
    from?: { x: number; z: number },
  ): FortifyPick | null {
    const list = this.candidates[sec];
    if (!list || list.length === 0) return null;
    const TAU = Math.PI * 2;
    const a0 = (sec / FORTIFY_SECTORS) * TAU;
    const a1 = (sec + 1 === FORTIFY_SECTORS) ? TAU : ((sec + 1) / FORTIFY_SECTORS) * TAU;
    const dFrom = from ? Math.hypot(from.x - cx, from.z - cz) : -1;
    let fallback: FortifyPick | null = null;
    let outBand: FortifyPick | null = null;
    let bestDone: FortifyPick | null = null;       // 无 from：需求最高（原行为）
    let fwdDone: FortifyPick | null = null;        // 有 from：朝舰侧最远（最推进）且达标
    let fwdDoneD = Infinity;
    let fwdAny: FortifyPick | null = null;         // 有 from：朝舰侧最远（任意分）
    let fwdAnyD = Infinity;
    for (const c of list) {
      // ★ 复检②：本扇区角度内（保证"在扇区之内"）
      let ang = Math.atan2(c.z - cz, c.x - cx);
      if (ang < 0) ang += TAU;
      if (ang < a0 || ang >= a1) continue;
      if (canReach && !canReach(c.x, c.z)) continue;
      if (exclude && exclude(c.x, c.z)) continue;
      const d = Math.hypot(c.x - cx, c.z - cz);
      const inBand = d >= rLo - 1 && d <= rHi + 1;
      if (!inBand) { if (!outBand) outBand = { x: c.x, z: c.z, score: c.score }; continue; }
      // ★★ 朝前方（用户定 2026-09-27）：比工兵更靠舰（+2m 容差）的点优先——工事向舰推进。
      if (dFrom >= 0 && d <= dFrom + 2) {
        if (c.score >= doneScore && d < fwdDoneD) { fwdDoneD = d; fwdDone = { x: c.x, z: c.z, score: c.score }; }
        if (d < fwdAnyD) { fwdAnyD = d; fwdAny = { x: c.x, z: c.z, score: c.score }; }
      }
      if (c.score >= doneScore) { if (!bestDone) bestDone = { x: c.x, z: c.z, score: c.score }; continue; }
      if (!fallback) fallback = { x: c.x, z: c.z, score: c.score };
    }
    // ★ 有 from：朝舰侧优先；无：原行为（需求最高）
    if (dFrom >= 0) return fwdDone ?? fwdAny ?? bestDone ?? fallback ?? outBand;
    // ★ 带内无件 → 带外兜底（用户定：分到区就去造）
    return bestDone ?? fallback ?? outBand;
  }

  clear(): void {
    this.safety.fill(-Infinity);
    for (const l of this.candidates) l.length = 0;
    this.scanned.fill(false);
    this.cursor = 0;
  }
}

/** ★ I15 掩体检测（用户定 2026-09-29）：**要造的掩体能不能保护 protectee**——
 *  与舰共线（到 舰→protectee 连线距离 ≤ tol）∧ 在 protectee 的**舰侧前部**（front ∈ [minFront, maxFront]）。
 *  保护对象 = 工兵自己，或工兵负责掩护的远程兵（总攻期掩护施工）。 */
export function coverProtects(
  ship: { x: number; z: number },
  protectee: { x: number; z: number },
  cand: { x: number; z: number },
  tol = 1.8,
  minFront = 0.6,
  maxFront = 4.5,
): boolean {
  const vx = protectee.x - ship.x, vz = protectee.z - ship.z;
  const d = Math.hypot(vx, vz);
  if (d < 1e-3) return false;
  const ux = vx / d, uz = vz / d;              // 舰 → protectee 单位向量
  const wx = cand.x - protectee.x, wz = cand.z - protectee.z;
  const dist = Math.hypot(wx, wz);
  if (dist < minFront || dist > maxFront) return false;
  const front = -(wx * ux + wz * uz);          // >0 = 在 protectee 的舰侧
  if (front < minFront || front > d - 0.5) return false;   // 前部且不得越过舰
  const cross = Math.abs(wx * uz - wz * ux);   // 到 舰→protectee 连线的垂距
  return cross <= tol;
}
