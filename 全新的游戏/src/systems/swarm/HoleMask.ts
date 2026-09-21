// ============================================================
// HoleMask —— 地形坑洞掩码（独立模块；《敌人管线设计.md》§1.3 工事层·坑洞数据源）
// ============================================================
// 只干一件事：把"地形破坏"沉淀成一张 **1m×1m 的二维深度场**（每格 = 挖掘深度米数）。
//   · 真源 = RasterMap.levelDepthAt（或任意外部注入的 digDepthAt 闭包）；
//   · **独立**：不修改 L1 语义类、不参与打分、不依赖 TerrainSemantics 逻辑；
//   · 窗口与 L1 对齐（±144m → 288×288 = 82,944 格），粒度 1m——够细腻地分辨
//     坑缘 / 半格挖掘（旧 4m 格心采样实测会低估：格心 0.148m vs 实际 0.4m）。
//   · 全表首扫只发生在落地时；运行期任何挖掘走**窗扫**（r 米窗口）。
// 敌人实际读的不是这张原始深度场，而是另一个**动态坑洞公式表 HoleTable**
// （在 1m 深度场上逐格打分、合并坑洞条目、每个低频拍重算）。
// ============================================================

import { L1_R } from './TerrainSemantics';

/** 掩码格边长（米）：1m × 1m 二维深度场 */
export const MASK_CELL = 1;
/** 掩码边长（格）＝ 288（±144m） */
export const MASK_SIDE = (L1_R * 2) / MASK_CELL;
/** "算作破坏"的深度阈值（米；digCells 一层 = 0.2m） */
export const HOLE_MIN_MARK = 0.15;

/** 掩码数据源（游戏内 = RasterMap.levelDepthAt；测试 = 合成闭包） */
export interface HoleDepthSource {
  /** 世界坐标 (x,z) 处的挖掘深度（米；未挖 = 0；自然凹陷 = 0 不误判） */
  digDepthAt(x: number, z: number): number;
}

export class HoleMask {
  private sx = 0;
  private sz = 0;
  private ready = false;
  private src: HoleDepthSource | null = null;
  private readonly depth = new Float32Array(MASK_SIDE * MASK_SIDE);

  get isReady(): boolean { return this.ready; }
  get side(): number { return MASK_SIDE; }
  get anchor(): { x: number; z: number } { return { x: this.sx + L1_R, z: this.sz + L1_R }; }

  /** 建立掩码窗口（跟随落点）并全表首扫（接管"落地前已存在"的初始破坏） */
  build(src: HoleDepthSource, cx: number, cz: number): void {
    this.src = src;
    this.sx = cx - L1_R;
    this.sz = cz - L1_R;
    this.ready = true;
    this.refresh(cx, cz, L1_R + 2);
  }

  /** 深度读取（世界坐标 → 所在 1m 格；表外/未就绪 → 0） */
  depthAt(x: number, z: number): number {
    if (!this.ready) return 0;
    const ix = Math.floor(x - this.sx), iz = Math.floor(z - this.sz);
    if (ix < 0 || iz < 0 || ix >= MASK_SIDE || iz >= MASK_SIDE) return 0;
    return this.depth[iz * MASK_SIDE + ix];
  }

  /** 该格是否算破坏（深度 ≥ 挖深阈值） */
  isDug(x: number, z: number): boolean {
    return this.depthAt(x, z) >= HOLE_MIN_MARK;
  }

  /** ★★ 窗扫（任何挖掘后调用；r = 破坏半径米）：逐 1m 格点采样真源。
   *  @returns 该窗内新达到"破坏阈值"的格数 */
  refresh(x: number, z: number, r = 16): number {
    if (!this.ready || !this.src) return 0;
    const ix0 = Math.max(0, Math.floor(x - r - this.sx));
    const iz0 = Math.max(0, Math.floor(z - r - this.sz));
    const ix1 = Math.min(MASK_SIDE - 1, Math.ceil(x + r - this.sx));
    const iz1 = Math.min(MASK_SIDE - 1, Math.ceil(z + r - this.sz));
    let n = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * MASK_SIDE + ix;
        const d = this.src.digDepthAt(this.sx + ix + 0.5, this.sz + iz + 0.5);
        if (d >= HOLE_MIN_MARK && this.depth[i] < HOLE_MIN_MARK) n++;
        this.depth[i] = d;
      }
    }
    return n;
  }
}