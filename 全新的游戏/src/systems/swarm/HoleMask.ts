// ============================================================
// HoleMask —— 地形坑洞掩码（独立模块；《敌人管线设计.md》§1.4 工事层·坑洞数据源）
// ============================================================
// 只干一件事：把"地形破坏"沉淀成一张 4m 格掩码（每格 = 挖掘深度米数）。
//   · 真源 = RasterMap.levelDepthAt（或任意外部注入的 digDepthAt 闭包）；
//   · **独立**：不修改 L1 语义类、不参与打分、不依赖 TerrainSemantics 逻辑；
//   · 网格与 L1 对齐（同 CELL 4m / 同一锚窗口），方便敌人在同一坐标下读表。
// 敌人实际读的不是这张原始掩码，而是另一个**动态坑洞公式表 HoleTable**
// （对掩码做深×近打分、合并出坑洞条目、每个 tick 持续刷新）。
// ============================================================

import { L1_CELL, L1_R, SIDE } from './TerrainSemantics';

/** 挖掘深度阈值（米；digCells 一层 = 0.2m，≥ 此值才算"挖了个坑"） */
export const HOLE_MIN_MARK = 0.15;

/** 掩码数据源（游戏内 = RasterMap.levelDepthAt；测试 = 合成闭包） */
export interface HoleDepthSource {
  /** 世界坐标 (米格中心) 处的挖掘深度（米；未挖 = 0；自然凹陷 = 0 不误判） */
  digDepthAt(x: number, z: number): number;
}

export class HoleMask {
  private sx = 0;
  private sz = 0;
  private ready = false;
  private src: HoleDepthSource | null = null;
  private readonly depth = new Float32Array(SIDE * SIDE);

  get isReady(): boolean { return this.ready; }
  get anchor(): { x: number; z: number } { return { x: this.sx + L1_R, z: this.sz + L1_R }; }

  /** 建立掩码窗口（跟随落点；同锚窗口）并做首扫 */
  build(src: HoleDepthSource, cx: number, cz: number): void {
    this.src = src;
    this.sx = cx - L1_R;
    this.sz = cz - L1_R;
    this.ready = true;
    this.refresh(cx, cz, L1_R + 16);   // 全表首扫：接管"落地前已存在"的破坏
  }

  /** 掩码读取（世界坐标；表外/未就绪 → 0） */
  depthAt(x: number, z: number): number {
    if (!this.ready) return 0;
    const ix = Math.floor((x - this.sx) / L1_CELL);
    const iz = Math.floor((z - this.sz) / L1_CELL);
    if (ix < 0 || iz < 0 || ix >= SIDE || iz >= SIDE) return 0;
    return this.depth[iz * SIDE + ix];
  }

  /** 该格是否算破坏（深度 ≥ 挖深阈值） */
  isDug(x: number, z: number): boolean {
    return this.depthAt(x, z) >= HOLE_MIN_MARK;
  }

  /** ★★ 刷新（任何挖掘后调用；只扫脏窗，免全表）：
   *  @returns 该窗内"新达到挖深阈值"的格数 */
  refresh(x: number, z: number, r = 16): number {
    if (!this.ready || !this.src) return 0;
    let ix0 = Math.max(0, Math.floor((x - r - this.sx) / L1_CELL));
    let iz0 = Math.max(0, Math.floor((z - r - this.sz) / L1_CELL));
    let ix1 = Math.min(SIDE - 1, Math.ceil((x + r - this.sx) / L1_CELL));
    let iz1 = Math.min(SIDE - 1, Math.ceil((z + r - this.sz) / L1_CELL));
    let n = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * SIDE + ix;
        const wx = this.sx + ix * L1_CELL + L1_CELL / 2;
        const wz = this.sz + iz * L1_CELL + L1_CELL / 2;
        const d = this.src.digDepthAt(wx, wz);
        if (d >= HOLE_MIN_MARK && this.depth[i] < HOLE_MIN_MARK) n++;
        this.depth[i] = d;
      }
    }
    return n;
  }
}