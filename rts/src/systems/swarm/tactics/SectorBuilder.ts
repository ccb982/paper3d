// ============================================================
// tactics/SectorBuilder —— 全新的扇区构建系统（《RTS架构.md》§2.12 ④；用户定 2026-09-26）
// ============================================================
// 基准：以角色（舰船）所在位置/层为圆心，全环 8 个扇区（角度均分）。
// 可部署面：**作战/施工带内 ∧ 非坑/水/硬墙**；
//   **排除“与角色相连的整片高原”**（用户定 2026-09-27 修正②）：从角色格出发**连通泛洪**
//   （层高 ≥ 舰Y-0.5 的格 + 被高原包住的坑洞/凹陷）→ 整片相连高原都不算防区；
//   **断开的高地照常占领**并标 `high`（优先占位）；**没有主角 → 不排除**（只排除坑/水/硬墙）。
//   · 每个点带 `high` 标记（该扇区**中位高 +1m 以上**）——防区内高地**优先占领**（远程上高地狙击，用户定）。
// 产物（每扇区）：可部署点集（带地表高/到舰距）· 容量 · 距离带。
// 用法：摊销构建（每拍刷 1 区，~4s 一轮）；部署器用 selectMain(k) 选主攻扇区（占位策略：
//   容量优先；待用户 chunk 战术策略 ① 覆盖）。
// 纪律：只读地形/表，不写任何裁决；不直接发令。
// ============================================================

/** 扇区数（全环；用户定：仍 8 个） */
import { CHUNK_SIZE } from '../../../services/map/ChunkGenerator';

export const SECTOR_COUNT = 8;
/** 部署点采样格（米，与可行性表同格） */
export const SECTOR_CELL = 4;
/** 采样上限（每扇区保留点数；防内存/摊销成本失控） */
export const SECTOR_POINT_CAP = 600;
/** 低于舰船层多少米才算"山脚"（排除舰船所在高地；用户定 2026-09-26） */
/** 高地标记阈值（相对该扇区点集中位高；米） */
export const HIGHLAND_MARK = 1.0;

export interface DeployPoint {
  x: number;
  z: number;
  /** 地表高（米） */
  h: number;
  /** 到舰距（米） */
  d: number;
  /** ★ 高地（该扇区中位高 +1m 以上）→ 优先占领（远程狙击位；用户定 2026-09-27） */
  high?: boolean;
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

/** ★★ “与主角相连的高原”判定（用户定 2026-09-27 修正②）：
 *  从主角格出发对 "层高 ≥ shipY-0.5" 的格做**连通泛洪**（4m 格），再收编**被高原包住的坑洞**
 *  （≥6/8 邻域在高原内）→ 整片相连高原（含坑）都算“主角所在高原”，不算防区。
 *  断开的高地不在连通域内 → 照常占领（并标 `high` 优先占位）。
 *  缓存按 (shipX|0, shipZ|0, shipY) —— 主角不动不重算。共享：防区构建 + 工兵建造点查询。 */
export class ShipHighland {
  private key = '';
  private cells = new Set<number>();
  private readonly R = 260;   // 泛洪半径（米；覆盖带内所有点与连通路径）

  private ensure(shipX: number, shipZ: number, shipY: number, surfaceAt: (x: number, z: number) => number): void {
    const k = `${shipX | 0},${shipZ | 0},${shipY.toFixed(1)}`;
    if (k === this.key) return;
    this.key = k;
    this.cells.clear();
    const cs = SECTOR_CELL;
    const hi = (x: number, z: number): boolean => {
      const h = surfaceAt(x, z);
      return Number.isFinite(h) && h >= shipY - 0.5;
    };
    const keyOf = (gx: number, gz: number): number => gx * 100000 + gz;
    const g0x = Math.floor(shipX / cs), g0z = Math.floor(shipZ / cs);
    const rCells = Math.ceil(this.R / cs);
    const q: Array<[number, number]> = [[g0x, g0z]];
    this.cells.add(keyOf(g0x, g0z));
    while (q.length) {
      const [gx, gz] = q.pop() as [number, number];
      const cx = gx * cs + cs / 2, cz = gz * cs + cs / 2;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = gx + ox, nz = gz + oz;
        if (Math.abs(nx - g0x) > rCells || Math.abs(nz - g0z) > rCells) continue;
        const kk = keyOf(nx, nz);
        if (this.cells.has(kk)) continue;
        const px = nx * cs + cs / 2, pz = nz * cs + cs / 2;
        if (!hi(px, pz)) continue;
        this.cells.add(kk);
        q.push([nx, nz]);
      }
      void cx; void cz;
    }
    // 收编被高原包住的坑洞/凹陷（≥6/8 邻域在高原内；迭代两轮足够）
    for (let pass = 0; pass < 2; pass++) {
      const add: Array<[number, number]> = [];
      for (const kk of this.cells) {
        const gx = Math.floor(kk / 100000), gz = kk % 100000;
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = gx + ox, nz = gz + oz;
          const nk = keyOf(nx, nz);
          if (this.cells.has(nk)) continue;
          const px = nx * cs + cs / 2, pz = nz * cs + cs / 2;
          const h = surfaceAt(px, pz);
          if (!Number.isFinite(h) || h >= shipY - 0.5) continue;
          let cnt = 0;
          for (let k2 = 0; k2 < 8; k2++) {
            const a2 = (k2 / 8) * Math.PI * 2;
            const qx = px + Math.cos(a2) * 4, qz = pz + Math.sin(a2) * 4;
            if (this.cells.has(keyOf(Math.floor(qx / cs), Math.floor(qz / cs)))) cnt++;
          }
          if (cnt >= 6) add.push([nx, nz]);
        }
      }
      for (const [ax, az] of add) {
        const kk = keyOf(ax, az);
        if (!this.cells.has(kk)) { this.cells.add(kk); }
      }
      if (add.length === 0) break;
    }
  }

  /** 该点是否属于“与主角相连的高原”（含被包住的坑洞） */
  contains(shipX: number, shipZ: number, shipY: number, x: number, z: number,
    surfaceAt: (x: number, z: number) => number): boolean {
    this.ensure(shipX, shipZ, shipY, surfaceAt);
    return this.cells.has(Math.floor(x / SECTOR_CELL) * 100000 + Math.floor(z / SECTOR_CELL));
  }
}

export class SectorBuilder {
  readonly sectors: SectorInfo[] = Array.from({ length: SECTOR_COUNT }, (_, i) => ({
    idx: i, points: [], dMin: -1, dMax: -1, scanned: false,
  }));
  private cursor = 0;
  readonly dbg = { builds: 0, points: 0, scanned: 0, last: '' };
  /** ★ 与主角相连高原缓存（连通泛洪；用户定 2026-09-27） */
  readonly shipHighland = new ShipHighland();

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
        if (shipY !== null && this.shipHighland.contains(cx, cz, shipY, x, z, surfaceAt)) continue;   // ★ 连通高原整片排除（用户定 2026-09-27②）
        info.points.push({ x, z, h, d });
        if (info.points.length >= SECTOR_POINT_CAP) break;
      }
      if (info.points.length >= SECTOR_POINT_CAP) break;
    }
    for (const p of info.points) {
      if (p.d < dMin) dMin = p.d;
      if (p.d > dMax) dMax = p.d;
    }
    // ★ 高地标记（该扇区点集中位高 +1m 以上）→ 优先占领（远程狙击位；用户定 2026-09-27）
    if (info.points.length > 1) {
      const hs = info.points.map((p) => p.h).sort((a, b) => a - b);
      const med = hs[Math.floor(hs.length / 2)] as number;
      for (const p of info.points) p.high = p.h >= med + HIGHLAND_MARK;
    }
    info.dMin = info.points.length ? dMin : -1;
    info.dMax = info.points.length ? dMax : -1;
    this.dbg.builds++;
    this.dbg.points = this.sectors.reduce((n, s) => n + s.points.length, 0);
    this.dbg.scanned = this.sectors.reduce((n, s) => n + (s.scanned ? 1 : 0), 0);
    this.dbg.last = `sec${si} pts=${info.points.length}`;
  }


  /** 主攻扇区选择（占位策略：可部署容量优先；待用户 chunk 战术覆盖）。
   *  k ≤ 0 或 > 8 → 夹到 [1, SECTOR_COUNT]。 */
  /** ★ 主攻选择（用户定 2026-09-30）：**随机 1~3 个方向**（不再按容量占位）——
   *  在"已扫描 ∧ 有点"的扇区里洗牌取前 kk；seed 固定 → 可复现。 */
  selectMain(k: number, seed = 0): number[] {
    const kk = Math.max(1, Math.min(SECTOR_COUNT, Math.floor(k)));
    const cand = this.sectors.filter((s) => s.scanned && s.points.length > 0).map((s) => s.idx);
    if (cand.length === 0) return [];
    let s = (seed >>> 0) || 0x9e3779b9;
    const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = cand.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = cand[i]; cand[i] = cand[j]; cand[j] = t;
    }
    return cand.slice(0, kk).sort((a, b) => a - b);
  }

  clear(): void {
    for (const s of this.sectors) { s.points.length = 0; s.dMin = -1; s.dMax = -1; s.scanned = false; }
    this.cursor = 0;
    this.dbg.builds = 0; this.dbg.points = 0; this.dbg.scanned = 0; this.dbg.last = '';
  }
}
