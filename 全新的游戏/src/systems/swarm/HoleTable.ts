// ============================================================
// HoleTable —— 敌用坑洞公式表（《敌人管线设计.md》§1.4 工事层·动态表）
// ============================================================
// 敌人真正读的"工事"在这里：坑洞（独立掩码）与**构造掩体**（活注册表）都**动态计算**。
//   · 打分：坑洞分 = 深度因子 × 距离因子 —— **只有距离够近且挖得够深的坑洞
//     才算有效高分坑洞**（成分取积：浅 / 远其一为零，分即塌为 0，不会被累加掩盖）；
//   · 坑洞条目：掩码上 ≥ 挖深阈值 且 可站 的连通块合并成一个 Hole
//     { 质心, 面积, 最深, 平均深, 分 }；
//   · "动态不断修改"：每个低频拍重排（2Hz）——玩家移动→距离因子变、
//     新挖坑出现→新条目、坑被填/塌→条目消失；排序随分数变化持续更新。
//   · 掩体同拍从 CoverEntity 活注册表快照重算（新增/摧毁/遮蔽变化即时反映，
//     不存手工列表）：掩体分 = 遮蔽因子（挡玩家射界 1 / 暴露 0.35）× 距离因子。
//   距离参考 = 玩家（威胁方向；L2 防护向量同口径"对玩家"）。
// ============================================================

import { L1_CELL, L1_R, SIDE, type TerrainSemantics } from './TerrainSemantics';
import type { HoleMask } from './HoleMask';

/** 打分门槛：深度低于此值，任何坑都不是有效坑洞（分恒 0） */
export const HOLE_MIN_DEPTH = 0.30;
/** 满分布深：深度 ≥ 此值 → 深度因子 = 1（5 层真壕） */
export const HOLE_FULL_DEPTH = 1.00;
/** 距离满值半径（距玩家 ≤ 此值 → 距离因子 1） */
export const HOLE_NEAR_R = 40;
/** 距离归零半径（距玩家 ≥ 此值 → 距离因子 0） */
export const HOLE_FAR_R = 90;

/** 构造工事·掩体条目（动态：每次重排从活注册表取数） */
export interface CoverWork {
  x: number; z: number;
  hp: number; variant: string; heading: number;
  /** 是否挡住"玩家 → 掩体"的射界（随玩家移动/墙倒动态变） */
  hidden: boolean;
  /** 距玩家（米） */
  dist: number;
  /** ★ 掩体分 = 遮蔽因子 × 距离因子 */
  score: number;
}

/** 掩体输入记录（调用方从 CoverEntity 注册表快照 + 现场判遮蔽） */
export interface CoverRec {
  x: number; z: number; hp: number; variant: string; heading: number; hidden: boolean;
}

/** 遮蔽因子：挡住玩家射界 / 暴露 */
export const COVER_HIDDEN_W = 1.0;
export const COVER_OPEN_W = 0.35;

/** 一个坑洞（连通破坏块） */
export interface Hole {
  id: number;
  /** 代表点（世界坐标；= 该块分数最高的格） */
  cx: number;
  cz: number;
  /** 质心（世界坐标） */
  mx: number;
  mz: number;
  /** 块的 4m 格数 */
  cells: number;
  /** 最深（掩码米数）/ 平均深 */
  maxDepth: number;
  avgDepth: number;
  /** ★ 坑洞分 = 深度因子 × 距离因子（0..1；只有近+深才有高分） */
  score: number;
  /** 到玩家距离（米；代表点） */
  dist: number;
}

export class HoleTable {
  private readonly scores = new Float32Array(SIDE * SIDE);   // per-cell 分（>0 = 有效坑；-1 = 非坑）
  private holesArr: Hole[] = [];
  private coversArr: CoverWork[] = [];

  get isReady(): boolean { return Number.isFinite(this.lastSx); }
  get holes(): readonly Hole[] { return this.holesArr; }
  get covers(): readonly CoverWork[] { return this.coversArr; }

  /** 清空（退出模式/换落点前） */
  clear(): void {
    this.scores.fill(-1); this.holesArr = []; this.coversArr = [];
    this.lastSx = NaN; this.lastSz = NaN;
  }

  /** ★★ 重排（每个低频拍调一次 = "动态不断修改"）：
   *  掩码入口 → 逐格打分（深×近）→ 连通块合并成坑洞 → 按分降序。 */
  rebuild(mask: HoleMask | null, sem: TerrainSemantics | null, px: number, pz: number,
    covers: readonly CoverRec[] = []): void {
    this.scores.fill(-1);
    // ★ 掩体（构造工事）：动态重算（活注册表快照；遮蔽随玩家移动实时变）
    this.coversArr = covers.map((c) => {
      const dist = Math.hypot(c.x - px, c.z - pz);
      const prox = Math.min(1, Math.max(0, (HOLE_FAR_R - dist) / (HOLE_FAR_R - HOLE_NEAR_R)));
      return { ...c, dist, score: (c.hidden ? COVER_HIDDEN_W : COVER_OPEN_W) * prox };
    }).sort((a, b) => b.score - a.score);
    if (!mask || !mask.isReady || !sem || !sem.isReady) { this.holesArr = []; return; }
    const R = L1_R, CELL = L1_CELL;
    const sx = mask.anchor.x - R, sz = mask.anchor.z - R;
    this.lastSx = sx; this.lastSz = sz;

    // ① 逐格打分
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const i = iz * SIDE + ix;
        const wx = sx + ix * CELL + CELL / 2;
        const wz = sz + iz * CELL + CELL / 2;
        const depth = mask.depthAt(wx, wz);
        if (depth < HOLE_MIN_DEPTH) continue;                     // 不够深 → 非坑
        if (!sem.isPassableAt(wx, wz)) continue;                  // 坑/崖等不可站 → 非坑
        const dist = Math.hypot(wx - px, wz - pz);
        const depthF = Math.min(1, Math.max(0, (depth - HOLE_MIN_DEPTH) / (HOLE_FULL_DEPTH - HOLE_MIN_DEPTH)));
        const proxF = Math.min(1, Math.max(0, (HOLE_FAR_R - dist) / (HOLE_FAR_R - HOLE_NEAR_R)));
        this.scores[i] = depthF * proxF;                          // 乘积：浅或远 → 0
      }
    }

    // ② 连通块合并成坑洞
    const region = new Int16Array(SIDE * SIDE);
    region.fill(-1);
    const list: Hole[] = [];
    let nextId = 0;
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const start = iz * SIDE + ix;
        if (this.scores[start] <= 0 || region[start] >= 0) continue;
        const que: number[] = [start];
        region[start] = nextId;
        let q = 0, n = 0, sumD = 0, maxD = 0, sumX = 0, sumZ = 0;
        let best = -1, bx = 0, bz = 0;
        while (q < que.length) {
          const c = que[q++];
          const cix = c % SIDE, ciz = (c - cix) / SIDE;
          const wx = sx + cix * CELL + CELL / 2;
          const wz = sz + ciz * CELL + CELL / 2;
          const d = mask.depthAt(wx, wz);
          n++; sumD += d; sumX += wx; sumZ += wz;
          if (d > maxD) maxD = d;
          if (this.scores[c] > best) { best = this.scores[c]; bx = wx; bz = wz; }
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nxi = cix + dx, nzi = ciz + dz;
            if (nxi < 0 || nzi < 0 || nxi >= SIDE || nzi >= SIDE) continue;
            const ni = nzi * SIDE + nxi;
            if (this.scores[ni] > 0 && region[ni] < 0) { region[ni] = nextId; que.push(ni); }
          }
        }
        const dist = Math.hypot(bx - px, bz - pz);
        list.push({
          id: nextId, cx: bx, cz: bz, mx: sumX / n, mz: sumZ / n,
          cells: n, maxDepth: maxD, avgDepth: sumD / n,
          score: Math.max(0, best), dist,
        });
        nextId++;
      }
    }
    this.holesArr = list.sort((a, b) => b.score - a.score);
  }

  /** 读点：坑洞分（世界坐标；非坑/表外 = 0） */
  scoreAt(x: number, z: number): number {
    if (!Number.isFinite(this.lastSx)) return 0;
    const ix = Math.floor((x - this.lastSx) / L1_CELL);
    const iz = Math.floor((z - this.lastSz) / L1_CELL);
    if (ix < 0 || iz < 0 || ix >= SIDE || iz >= SIDE) return 0;
    return Math.max(0, this.scores[iz * SIDE + ix]);
  }
  private lastSx = NaN;
  private lastSz = NaN;

  /** ★ 敌人取坑：分数最高的 n 个坑洞（可加半径筛选） */
  topHoles(k: number, maxDist = Infinity): Hole[] {
    return this.holesArr.filter((h) => h.dist <= maxDist).slice(0, k);
  }
}