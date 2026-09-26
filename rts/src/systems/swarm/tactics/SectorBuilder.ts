// ============================================================
// tactics/SectorBuilder —— 全新的扇区构建系统（《RTS架构.md》§2.12 ④；用户定 2026-09-26）
// ============================================================
// 基准：以角色（舰船）所在位置/层为圆心，全环 8 个扇区（角度均分）。
// 可部署面：**作战/施工带内 ∧ 非坑/水/硬墙**；
//   **排除“舰船所在位置关联的一片高地”**（用户定 2026-09-26 修正）——
//   高地及**高地里的坑洞/凹陷**（四周均为舰船层高、自身深陷）一律不算防区；
//   **没有主角 → 正常占领**（不做高度排除，只排除坑/水/硬墙）。
// 产物（每扇区）：可部署点集（带地表高/到舰距）· 容量 · 距离带。
// 用法：摊销构建（每拍刷 1 区，~4s 一轮）；部署器用 selectMain(k) 选主攻扇区（占位策略：
//   容量优先；待用户 chunk 战术策略 ① 覆盖）。
// 纪律：只读地形/表，不写任何裁决；不直接发令。
// ============================================================

/** 扇区数（全环；用户定：仍 8 个） */
export const SECTOR_COUNT = 8;
/** 部署点采样格（米，与可行性表同格） */
export const SECTOR_CELL = 4;
/** 采样上限（每扇区保留点数；防内存/摊销成本失控） */
export const SECTOR_POINT_CAP = 600;
/** 低于舰船层多少米才算"山脚"（排除舰船所在高地；用户定 2026-09-26） */
export const HEIGHT_EPS = 0.5;

export interface DeployPoint {
  x: number;
  z: number;
  /** 地表高（米） */
  h: number;
  /** 到舰距（米） */
  d: number;
}

export interface SectorInfo {
  idx: number;
  /** 可部署点（未扫描 = 空） */
  points: DeployPoint[];
  /** 距离带（点集 rLo/rHi 实测；无点 = -1） */
  dMin: number;
  dMax: number;
  scanned: boolean;
}

export class SectorBuilder {
  readonly sectors: SectorInfo[] = Array.from({ length: SECTOR_COUNT }, (_, i) => ({
    idx: i, points: [], dMin: -1, dMax: -1, scanned: false,
  }));
  private cursor = 0;
  readonly dbg = { builds: 0, points: 0, scanned: 0, last: '' };

  /** 摊销构建：每次刷新一个扇区（cursor 轮转）。
   *  @param surfaceAt 地表高（单源：raster/表）
   *  @param blockedAt 硬通行裁决（坑/水/硬墙 = true 排除；可选） */
  buildOne(
    cx: number, cz: number, shipY: number | null, rLo: number, rHi: number,
    surfaceAt: (x: number, z: number) => number,
    blockedAt?: (x: number, z: number) => boolean,
  ): void {
    const si = this.cursor;
    this.cursor = (this.cursor + 1) % SECTOR_COUNT;
    this.buildSector(si, cx, cz, shipY, rLo, rHi, surfaceAt, blockedAt);
  }

  /** 全量构建（初始化/舰迁移；8 区一次） */
  buildAll(
    cx: number, cz: number, shipY: number | null, rLo: number, rHi: number,
    surfaceAt: (x: number, z: number) => number,
    blockedAt?: (x: number, z: number) => boolean,
  ): void {
    for (let i = 0; i < SECTOR_COUNT; i++) {
      this.buildSector(i, cx, cz, shipY, rLo, rHi, surfaceAt, blockedAt);
    }
  }

  private buildSector(
    si: number, cx: number, cz: number, shipY: number | null, rLo: number, rHi: number,
    surfaceAt: (x: number, z: number) => number,
    blockedAt?: (x: number, z: number) => boolean,
  ): void {
    const info = this.sectors[si] as SectorInfo;
    info.points.length = 0;
    info.scanned = true;
    const TAU = Math.PI * 2;
    const a0 = (si / SECTOR_COUNT) * TAU;
    const a1 = ((si + 1) / SECTOR_COUNT) * TAU;
    const rLoC = Math.max(0, rLo);
    let dMin = Infinity, dMax = -Infinity;
    for (let dz = -rHi; dz <= rHi; dz += SECTOR_CELL) {
      for (let dx = -rHi; dx <= rHi; dx += SECTOR_CELL) {
        const d = Math.hypot(dx, dz);
        if (d > rHi || d < rLoC) continue;
        let ang = Math.atan2(dz, dx);
        if (ang < 0) ang += TAU;
        if (ang < a0 || ang >= a1) continue;
        const x = cx + dx, z = cz + dz;
        const h = surfaceAt(x, z);
        if (!Number.isFinite(h)) continue;
        if (blockedAt && blockedAt(x, z)) continue;
        // ★ 地形高度硬规则（用户定 2026-09-26 修正）：排除“主角关联的一片高地”
        //   （高地本体 ∥ 高地里的坑洞/凹陷）；**无舰船（shipY=null）→ 正常占领**。
        if (shipY !== null && this.onShipHighland(x, z, shipY, surfaceAt)) continue;
        info.points.push({ x, z, h, d });
        if (info.points.length >= SECTOR_POINT_CAP) break;
      }
      if (info.points.length >= SECTOR_POINT_CAP) break;
    }
    for (const p of info.points) {
      if (p.d < dMin) dMin = p.d;
      if (p.d > dMax) dMax = p.d;
    }
    info.dMin = info.points.length ? dMin : -1;
    info.dMax = info.points.length ? dMax : -1;
    this.dbg.builds++;
    this.dbg.points = this.sectors.reduce((n, s) => n + s.points.length, 0);
    this.dbg.scanned = this.sectors.reduce((n, s) => n + (s.scanned ? 1 : 0), 0);
    this.dbg.last = `sec${si} pts=${info.points.length}`;
  }

  /** ★ “舰船关联高地”判定（用户定 2026-09-26）：
   *  ① 高度 ≥ shipY-HEIGHT_EPS → 高地本体（同层/更高）；
   *  ② 自身深陷（shipY-h＞1.2m）但 **8 方向 8m 内 ≥6 个方向是舰船层高** → 高地里的坑洞/凹陷（不算防区）。 */
  private onShipHighland(
    x: number, z: number, shipY: number,
    surfaceAt: (x: number, z: number) => number,
  ): boolean {
    const h = surfaceAt(x, z);
    if (h >= shipY - HEIGHT_EPS) return true;
    if (shipY - h > 1.2) {
      let hi = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const hs = surfaceAt(x + Math.cos(a) * 8, z + Math.sin(a) * 8);
        if (hs >= shipY - HEIGHT_EPS) hi++;
      }
      if (hi >= 6) return true;
    }
    return false;
  }

  /** 主攻扇区选择（占位策略：可部署容量优先；待用户 chunk 战术覆盖）。
   *  k ≤ 0 或 > 8 → 夹到 [1, SECTOR_COUNT]。 */
  selectMain(k: number): number[] {
    const kk = Math.max(1, Math.min(SECTOR_COUNT, Math.floor(k)));
    return this.sectors
      .filter((s) => s.scanned && s.points.length > 0)
      .sort((a, b) => b.points.length - a.points.length)
      .slice(0, kk)
      .map((s) => s.idx);
  }

  clear(): void {
    for (const s of this.sectors) { s.points.length = 0; s.dMin = -1; s.dMax = -1; s.scanned = false; }
    this.cursor = 0;
    this.dbg.builds = 0; this.dbg.points = 0; this.dbg.scanned = 0; this.dbg.last = '';
  }
}
