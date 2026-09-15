// ============================================================
// ExploredMask —— 探索记忆（稠密区块位图 + 越界稀疏回退）
// ============================================================
// 动机（2026-09-15 性能）：小地图 / 大地图的"已探明"查询是**逐像素热路径**
//   （小地图跨格重绘 160×160 = 25,600 次；大地图整屏 1,000×620/scale 可达 6.9 万次），
//   原先用 `Map<cellKey, boolean>` 表达无限空间：
//     · 单次 has ≈ 30ns（Map 查找），且开雾全扫 32,761 格时 2.5 万次 set 触发 rehash
//       → 首次 reveal 实测 27.7ms，是"停靠/打坑"冷帧最大单项。
//     · 预加载无从下手：把 Map 复制给下一个小地图实例 = 2.5 万次插入（≈3ms，仍在关键帧上）。
// 结构：
//   · 稠密区 rect [x0, x0+w) × [z0, z0+h)：`Uint8Array` 位图。
//       has  = 2 次区间比较 + 1 次数组成员读（≈3ns）
//       mark = 1 次字节写（含计数）
//       尺寸取"可视半径圆盘(90m)的外接方" = 181×181 = 32,761 字节（32KB）。
//   · 越界：回退稀疏 `Map`（无限空间语义完全不变）。
//   · 稠密区可被预加载（见 MinimapWarmup）一次性填满 → 开局点亮零成本；
//     交接给新实例 = 一次 `new Uint8Array(bits)`（32KB 拷贝 ≈ 0.01ms）。
//
// 语义契约：坐标一律是**整数格**坐标（调用方自行 floor）。mark 幂等；
//   size = 已标记格数（与旧实现 visited.size 同义）。
// ============================================================

import { cellKeyOf } from './RasterMap';

export class ExploredMask {
  private bits: Uint8Array;
  private sparse: Map<number, boolean>;
  private n: number;

  /**
   * @param x0/z0 稠密区原点（格，含）
   * @param w/h   稠密区宽高（格）；传 0 表示"无稠密区"（全部走稀疏，等价旧行为）
   * @param bits  稠密位图（预加载交接用；长度须 = w*h）
   * @param count 已标记数（提供 bits 时须一并给出）
   */
  constructor(
    readonly x0: number,
    readonly z0: number,
    readonly w: number,
    readonly h: number,
    bits?: Uint8Array,
    count = 0,
    sparse?: Map<number, boolean>,
  ) {
    this.bits = bits ?? new Uint8Array(w * h);
    this.n = count;
    this.sparse = sparse ?? new Map<number, boolean>();
  }

  /** 是否已探明（幂等、无副作用） */
  has(x: number, z: number): boolean {
    const ix = x - this.x0;
    const iz = z - this.z0;
    if (ix >= 0 && iz >= 0 && ix < this.w && iz < this.h) {
      return this.bits[iz * this.w + ix] !== 0;
    }
    return this.sparse.has(cellKeyOf(x, z));
  }

  /** 标记已探明（幂等） */
  mark(x: number, z: number): void {
    const ix = x - this.x0;
    const iz = z - this.z0;
    if (ix >= 0 && iz >= 0 && ix < this.w && iz < this.h) {
      const i = iz * this.w + ix;
      if (this.bits[i] === 0) {
        this.bits[i] = 1;
        this.n++;
      }
      return;
    }
    const k = cellKeyOf(x, z);
    if (!this.sparse.has(k)) {
      this.sparse.set(k, true);
      this.n++;
    }
  }

  /** 已探明格数（面板信息行） */
  get size(): number {
    return this.n;
  }

  /** 稠密区位图（只读；预加载填充用，外部不得改内容） */
  get denseBits(): Uint8Array {
    return this.bits;
  }

  /** 克隆：稠密区一次字节拷贝（32KB ≈ 0.01ms），稀疏区浅拷贝 */
  clone(): ExploredMask {
    return new ExploredMask(
      this.x0, this.z0, this.w, this.h,
      new Uint8Array(this.bits), this.n, new Map(this.sparse),
    );
  }
}
