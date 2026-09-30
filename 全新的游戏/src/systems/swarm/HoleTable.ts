// ============================================================
// HoleTable —— 敌用工事公式表（《RTS架构.md》§1.3 工事层·动态表）
// ============================================================
// 敌人真正读的"工事"在这里：坑洞（1m 深度场）与**构造掩体**（活注册表）都**动态计算**。
//   · 精度：**1m×1m 二维网格**（288×288，与 HoleMask 同窗同格），坑洞条目存深度；
//   · 打分：坑洞分 = 深度因子 × 距离因子 —— **只有距离够近且挖得够深的坑洞
//     才算有效高分坑洞**（成分取积：浅 / 远其一为零，分即塌为 0）；
//   · 条目：连通块（1m 4 邻）合并成 Hole{ 稳定 id, 面积 m², 最深, 平均深, 分 }；
//   · 稳定 id = 块内最小格索引（重排不漂移，AI 可跨拍持有）；
//   · 占用：claim(holeId, squadId, ttl) / claimedBy；过期自动释放（条目带 claimedBy）；
//   · "动态不断修改"：每个低频拍重排（2Hz）——玩家移动→距离因子变、
//     新挖坑出现→新条目、坑被填/塌→条目消失；排序随分数变化持续更新。
//   · 掩体同拍从 CoverEntity 活注册表快照重算（新增/摧毁/遮蔽变化即时反映）：
//     掩体分 = 遮蔽因子（挡玩家射界 1 / 暴露 0.35）× 距离因子 × 血量因子（残墙分低）。
//   距离参考 = 玩家（威胁方向；L2 防护向量同口径"对玩家"）。
// ============================================================

import { L1_R, type TerrainSemantics } from './TerrainSemantics';
import { HoleMask, MASK_SIDE } from './HoleMask';
import { simNow } from '../../services/SimClock';

/** 打分门槛：深度低于此值，任何坑都不是有效坑洞（分恒 0） */
export const HOLE_MIN_DEPTH = 0.30;
/** 满分布深：深度 ≥ 此值 → 深度因子 = 1（5 层真壕） */
export const HOLE_FULL_DEPTH = 1.00;
/** 距离满值半径（距玩家 ≤ 此值 → 距离因子 1） */
export const HOLE_NEAR_R = 40;
/** 距离归零半径（距玩家 ≥ 此值 → 距离因子 0） */
export const HOLE_FAR_R = 90;
/** 掩体满血基准（与 CoverEntity.COVER_HP 一致；仅在 rec 未给 maxHp 时兜底） */
export const COVER_FULL_HP = 400;
/** 遮蔽因子：挡玩家射界 / 暴露 */
export const COVER_HIDDEN_W = 1.0;
export const COVER_OPEN_W = 0.35;
/** 掩体血量因子权重：score ×= (1 - w) + w × hpRatio */
export const COVER_HP_W = 0.5;

/** 构造工事·掩体条目（动态：每次重排从活注册表取数） */
export interface CoverWork {
  x: number; z: number;
  hp: number; maxHp: number;
  variant: string; heading: number;
  /** 是否挡住"玩家 → 掩体"的射界（随玩家移动/墙倒动态变） */
  hidden: boolean;
  /** 距玩家（米） */
  dist: number;
  /** ★ 掩体分 = 遮蔽因子 × 距离因子 × 血量因子 */
  score: number;
}

/** 掩体输入记录（调用方从 CoverEntity 注册表快照 + 现场判遮蔽） */
export interface CoverRec {
  x: number; z: number; hp: number; variant: string; heading: number; hidden: boolean;
  /** 满血基准（缺省 = COVER_FULL_HP） */
  maxHp?: number;
}

/** 一个坑洞（1m 连通破坏块） */
export interface Hole {
  /** ★ 稳定 id = 块内最小格索引（跨重排不漂移） */
  id: number;
  /** 面积（m²，= 1m 格数） */
  cells: number;
  /** 最深（米）/ 平均深 */
  maxDepth: number;
  avgDepth: number;
  /** 代表点（世界坐标；= 该块分数最高的格心） */
  cx: number;
  cz: number;
  /** 质心（世界坐标） */
  mx: number;
  mz: number;
  /** ★ 坑洞分 = 深度因子 × 距离因子（0..1；只有近+深才有高分） */
  score: number;
  /** 到玩家距离（米；代表点） */
  dist: number;
  /** 占用小队 id（0 = 空闲；过期自动释放） */
  claimedBy: number;
}

function perfNow(): number {
  // ★ 工事占用计时 = 模拟时钟（毫秒；倍速同步）
  return simNow() * 1000;
}

export class HoleTable {
  private readonly scores = new Float32Array(MASK_SIDE * MASK_SIDE);   // per-cell 分（>0 = 有效坑；-1 = 非坑）
  private readonly region = new Int32Array(MASK_SIDE * MASK_SIDE);    // BFS 复用暂存（万能：索引可到 82943，Int16 会回卷成负 → 死循环）
  private holesArr: Hole[] = [];
  private coversArr: CoverWork[] = [];
  private readonly claims = new Map<number, { squad: number; until: number }>();
  private lastSx = NaN;
  private lastSz = NaN;

  get isReady(): boolean { return Number.isFinite(this.lastSx); }
  get holes(): readonly Hole[] { return this.holesArr; }
  get covers(): readonly CoverWork[] { return this.coversArr; }

  /** 清空（退出模式/换落点前） */
  clear(): void {
    this.scores.fill(-1); this.holesArr = []; this.coversArr = [];
    this.claims.clear(); this.lastSx = NaN; this.lastSz = NaN;
  }

  /** ★ 占用坑洞（squadId 领取，ttl 毫秒后过期自动释放） */
  claim(holeId: number, squad: number, ttlMs = 15000, nowMs = perfNow()): void {
    this.claims.set(holeId, { squad, until: nowMs + ttlMs });
  }

  /** 释放占用 */
  release(holeId: number): void {
    this.claims.delete(holeId);
  }

  /** 占用查询（0 = 空闲/已过期） */
  claimedBy(holeId: number, nowMs = perfNow()): number {
    const c = this.claims.get(holeId);
    return c && c.until > nowMs ? c.squad : 0;
  }

  /** ★★ 重排（每个低频拍调一次 = "动态不断修改"）：
   *  1m 深度场 → 逐格打分（深×近）→ 连通块合并成坑洞 → 按分降序；
   *  掩体（构造工事）同拍从输入快照重算（遮蔽×近×血量）。
   *  @param nowMs 占用过期判定时钟（测试可注入） */
  rebuild(mask: HoleMask | null, sem: TerrainSemantics | null, px: number, pz: number,
    covers: readonly CoverRec[] = [], nowMs = perfNow()): void {
    this.scores.fill(-1);
    // ★ 掩体：动态重算（活注册表快照；遮蔽随玩家移动实时变 + 残墙降权）
    this.coversArr = covers.map((c) => {
      const maxHp = c.maxHp ?? COVER_FULL_HP;
      const hpRatio = Math.max(0, Math.min(1, c.hp / (maxHp || COVER_FULL_HP)));
      const dist = Math.hypot(c.x - px, c.z - pz);
      const prox = Math.min(1, Math.max(0, (HOLE_FAR_R - dist) / (HOLE_FAR_R - HOLE_NEAR_R)));
      const hpF = (1 - COVER_HP_W) + COVER_HP_W * hpRatio;
      return { x: c.x, z: c.z, hp: c.hp, maxHp, variant: c.variant, heading: c.heading,
        hidden: c.hidden, dist, score: (c.hidden ? COVER_HIDDEN_W : COVER_OPEN_W) * prox * hpF };
    }).sort((a, b) => b.score - a.score);
    // 占用过期清理
    for (const [id, c] of this.claims) if (c.until <= nowMs) this.claims.delete(id);
    if (!mask || !mask.isReady || !sem || !sem.isReady) { this.holesArr = []; return; }
    const sx = mask.anchor.x - L1_R, sz = mask.anchor.z - L1_R;
    this.lastSx = sx; this.lastSz = sz;

    // ① 逐格打分（1m 格心）
    for (let iz = 0; iz < MASK_SIDE; iz++) {
      for (let ix = 0; ix < MASK_SIDE; ix++) {
        const i = iz * MASK_SIDE + ix;
        const wx = sx + ix + 0.5, wz = sz + iz + 0.5;
        const depth = mask.depthAt(wx, wz);
        if (depth < HOLE_MIN_DEPTH) continue;                     // 不够深 → 非坑
        if (!sem.isPassableAt(wx, wz)) continue;                  // 坑/崖等不可站 → 非坑
        const dist = Math.hypot(wx - px, wz - pz);
        const depthF = Math.min(1, Math.max(0, (depth - HOLE_MIN_DEPTH) / (HOLE_FULL_DEPTH - HOLE_MIN_DEPTH)));
        const proxF = Math.min(1, Math.max(0, (HOLE_FAR_R - dist) / (HOLE_FAR_R - HOLE_NEAR_R)));
        this.scores[i] = depthF * proxF;                          // 乘积：浅或远 → 0
      }
    }

    // ② 连通块合并成坑洞（4 邻；id = 块内最小格索引 → 稳定）
    this.region.fill(-1);
    const list: Hole[] = [];
    for (let iz = 0; iz < MASK_SIDE; iz++) {
      for (let ix = 0; ix < MASK_SIDE; ix++) {
        const start = iz * MASK_SIDE + ix;
        if (this.scores[start] <= 0 || this.region[start] >= 0) continue;
        const que: number[] = [start];
        this.region[start] = start;
        let q = 0, n = 0, sumD = 0, maxD = 0, sumX = 0, sumZ = 0;
        let best = -1, bx = 0, bz = 0;
        while (q < que.length) {
          if (que.length > MASK_SIDE * MASK_SIDE) throw new Error('[HoleTable] BFS 队列爆炸（region 标记失效）');
          const c = que[q++];
          const cix = c % MASK_SIDE, ciz = (c - cix) / MASK_SIDE;
          const wx = sx + cix + 0.5, wz = sz + ciz + 0.5;
          const d = mask.depthAt(wx, wz);
          n++; sumD += d; sumX += wx; sumZ += wz;
          if (d > maxD) maxD = d;
          if (this.scores[c] > best) { best = this.scores[c]; bx = wx; bz = wz; }
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nxi = cix + dx, nzi = ciz + dz;
            if (nxi < 0 || nzi < 0 || nxi >= MASK_SIDE || nzi >= MASK_SIDE) continue;
            const ni = nzi * MASK_SIDE + nxi;
            if (this.scores[ni] > 0 && this.region[ni] < 0) { this.region[ni] = start; que.push(ni); }
          }
        }
        const dist = Math.hypot(bx - px, bz - pz);
        list.push({
          id: start, cells: n, maxDepth: maxD, avgDepth: sumD / n,
          cx: bx, cz: bz, mx: sumX / n, mz: sumZ / n,
          score: Math.max(0, best), dist,
          claimedBy: this.claimedBy(start, nowMs),
        });
      }
    }
    this.holesArr = list.sort((a, b) => b.score - a.score);
  }

  /** 读点：坑洞分（世界坐标；非坑/表外 = 0） */
  scoreAt(x: number, z: number): number {
    if (!Number.isFinite(this.lastSx)) return 0;
    const ix = Math.floor(x - this.lastSx), iz = Math.floor(z - this.lastSz);
    if (ix < 0 || iz < 0 || ix >= MASK_SIDE || iz >= MASK_SIDE) return 0;
    return Math.max(0, this.scores[iz * MASK_SIDE + ix]);
  }

  /** ★ 敌人取坑：分数最高的 n 个坑洞（可加半径筛选 / 只看空闲） */
  topHoles(k: number, maxDist = Infinity, freeOnly = false): Hole[] {
    const out: Hole[] = [];
    for (const h of this.holesArr) {
      if (h.dist > maxDist) continue;
      if (freeOnly && h.claimedBy !== 0) continue;
      out.push(h);
      if (out.length >= k) break;
    }
    return out;
  }
}