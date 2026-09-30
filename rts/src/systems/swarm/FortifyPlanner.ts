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

// ============================================================
// ★ 掩体/工事加成（原 TerrainScoring.buildBonus；D3 随整文件迁移至此）
// ============================================================
/** 工事网格边长（米；与地形块同网格） */
export const CELL = 4;
/** ★ 已建工事加成半径（米；用户定 2026-09-29）：**邻域铺开**——
 *  只写自己那一格会让相邻 4m 格需求不降（实测：点=0.0、东4=18.9）→ 取点继续挑隔壁 → 工兵挨着造。 */
export const COVER_SPREAD_R = 10;

/** 掩体加成键（同 TERRAIN 网格） */
export function bonusKey(x: number, z: number): string {
  return `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
}

/** ★ 掩体/制高加成表（扫描产物 + 已建掩体）：掩体 2.5 / 坑洞 1.2，按 COVER_SPREAD_R 线性铺开 */
export function buildBonus(
  plan: { posts: readonly { x: number; z: number; kind?: string }[] },
  built: readonly { x: number; z: number; kind?: string }[],
): Map<string, number> {
  const bonus = new Map<string, number>();
  for (const p of plan.posts) bonus.set(bonusKey(p.x, p.z), p.kind === 'cover' ? 1.2 : 0.8);
  const stamp = (x: number, z: number, base: number): void => {
    for (let dx = -COVER_SPREAD_R; dx <= COVER_SPREAD_R; dx += CELL) {
      for (let dz = -COVER_SPREAD_R; dz <= COVER_SPREAD_R; dz += CELL) {
        const d = Math.hypot(dx, dz);
        if (d > COVER_SPREAD_R) continue;
        const b = base * (1 - d / COVER_SPREAD_R);
        const k = bonusKey(x + dx, z + dz);
        if (b > (bonus.get(k) ?? 0)) bonus.set(k, b);
      }
    }
  };
  for (const c of built) stamp(c.x, c.z, c.kind === 'trench' ? 1.2 : 2.5);
  return bonus;
}

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
  /** ★ 扇区脏标记（用户定 2026-09-29）：事态系数变化/掩体表变动 → 查询前按需重算 */
  readonly dirty: boolean[] = Array(FORTIFY_SECTORS).fill(true);
  /** ★ 每扇区候选点（需求降序；仅扇区内 ∧ 带内；targetOf 逐个试可达） */
  readonly candidates: FortifyPick[][] = Array.from({ length: FORTIFY_SECTORS }, () => []);
  private cursor = 0;
  readonly dbg = { sweeps: 0, sectors: FORTIFY_SECTORS };

  /** 摊销刷新：本次只重算第 cursor 个扇区（**扇区内 ∧ 带内**；角度 [si,si+1)/8·2π）
   *  产出：`safety[si]`（峰值分）· `candidates[si]`（**全量**需求降序候选；不截尾） */
  refreshOne(
    cx: number, cz: number, rLo: number, rHi: number,
    needAt: (x: number, z: number) => number | null,
  ): void {
    const si = this.cursor;
    this.cursor = (this.cursor + 1) % FORTIFY_SECTORS;
    this.refreshAt(si, cx, cz, rLo, rHi, needAt);
  }

  /** ★ 立即重算指定扇区（查询期按需刷新；用户定 2026-09-29）——
   *  评分读的是"刷新时刻"的事态权重 + 三张表；轮询刷新会让查询吃到最多 ~4s 的旧分。 */
  refreshAt(
    si: number, cx: number, cz: number, rLo: number, rHi: number,
    needAt: (x: number, z: number) => number | null,
  ): void {
    this.scanned[si] = true;
    this.dirty[si] = false;
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
        list.push({ x: cx + dx, z: cz + dz, score: sc });
      }
    }
    // ★ 全量候选按需求降序（用户定 2026-09-29：**不再 CAND_K 截尾**——否则高分地建完后
    //   低分可建点（如水）根本不在候选表里 → 工兵"没活"发呆）。targetOf 逐个试可达/排除。
    list.sort((a, b) => b.score - a.score);
    const best = list[0] as FortifyPick | undefined;
    this.safety[si] = best ? best.score : -Infinity;
    this.dbg.sweeps++;
  }

  /** ★ 标脏（位移/掩体表变化；按 角度→扇区 归属；用户定 2026-09-29） */
  markDirty(x: number, z: number, cx: number, cz: number): void {
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) { this.dirty.fill(true); return; }
    const TAU = Math.PI * 2;
    let ang = Math.atan2(z - cz, x - cx);
    if (ang < 0) ang += TAU;
    const si = Math.min(FORTIFY_SECTORS - 1, Math.floor((ang / TAU) * FORTIFY_SECTORS));
    this.dirty[si] = true;
  }

  /** ★ 建造账本（不依赖懒物化；做"掩体加成"与密度判定的真源；用户定 2026-09-29） */
  private readonly builtCovers = new Map<string, { x: number; z: number; kind: 'cover' | 'trench' }>();
  private postureMark = Number.NaN;

  recordBuilt(x: number, z: number, kind: 'cover' | 'trench'): void {
    this.builtCovers.set(`${Math.round(x / 4)},${Math.round(z / 4)}`, { x, z, kind });
  }

  builtList(): Iterable<{ x: number; z: number; kind: 'cover' | 'trench' }> {
    return this.builtCovers.values();
  }

  /** ★ 已建件总数（缓存键用；2026-09-30） */
  get builtCount(): number {
    return this.builtCovers.size;
  }

  /** ★ 已建工事计数（密度门用；单一账本） */
  /** ★ 附近**已建掩体**数（密度门用；用户定 2026-09-29：只数掩体——坑洞不算，
   *  否则一条壕多笔挖掘把密度顶满 → 永远挖壕、不造掩体） */
  countNear(x: number, z: number, r: number): number {
    let n = 0;
    for (const c of this.builtCovers.values()) if (c.kind === 'cover' && Math.hypot(c.x - x, c.z - z) <= r) n++;
    return n;
  }

  /** ★ 查询期保新（用户定 2026-09-29）：扇区标脏 或 事态系数变化 → 立即重算该扇区；
   *  否则查询会吃到轮询刷新的旧分（评分读的是刷新时刻的 事态权重 + 三张表）。 */
  ensureFresh(
    sec: number, cx: number, cz: number, rLo: number, rHi: number,
    needAt: (x: number, z: number) => number | null, posture: number,
  ): void {
    if (!this.dirty[sec] && this.postureMark === posture) return;
    this.refreshAt(sec, cx, cz, rLo, rHi, needAt);
    this.postureMark = posture;
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
      if (exclude && exclude(c.x, c.z)) continue;   // 便宜的排除先做（不跑到达核验）
      if (canReach && !canReach(c.x, c.z)) continue;
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
