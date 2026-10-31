// ============================================================
// SteerPick —— 仅保留**表桥**（M0 退役文件；用户定 2026-09-27）
// ============================================================
// 历史：本件曾是"16 向软转向"（移动方向选择）。**已全部退役**：
//   · 移动方向只来自长寻路（走廊/成员路线）+ 短寻路（LocalStep/格边步）；
//   · 硬边/坡面侧壁的接触修正在内核（CharacterCore：分量清零/表斥力/weld/脱埋）；
//   · 本文件只剩 `SteerTable` 接口 + 全局表桥（TerrainAssist/RasterProbe/EnemyLocomotion 消费）。
// 禁止再往这里加"选向/打分"逻辑（architecture: 移动执行重写.md M0/M6）。
// ============================================================

/** 表只读接口（data/SwarmData 实现；避免 entity 层依赖） */
export interface SteerTable {
  scoreAt(x: number, z: number): number | null;
  /** ★ L3 兵种分（可选）：有则按该兵种打分，无则回退 scoreAt */
  scoreTypeAt?(type: string, x: number, z: number): number | null;
  /** ★ 水域查询（可选）：水中提高"上岸"权重 */
  isWaterAt?(x: number, z: number): boolean;
  /** ★ 爬山/涉水基础方法（可选；TerrainAssist 消费）：坡梯度 / 硬边界 / 掩体脚印 */
  slopeGradAt?(x: number, z: number): { gx: number; gz: number; mag: number };
  blockedAt?(x: number, z: number): boolean;
  heightAt?(x: number, z: number): number;
  /** ★ 上坡点（表预处理；可爬坡边的连续段中心、坡面前 1m） */
  climbRunAt?(x: number, z: number, dx: number, dz: number): { x: number; z: number; ux: number; uz: number; width: number; rise: number; lx: number; lz: number } | null;
  /** ★ 可行性表查询（实体层硬墙斥力用；生产 = PassTable.canStep） */
  canStep?(x: number, z: number, dx: number, dz: number): boolean;
}

/** ★ 全局表桥（模式/引擎侧调用 setSteerTable；实体不依赖 systems，靠这个拿表分） */
let globalTable: SteerTable | null = null;

/** 取全局表桥（实体侧 TerrainAssist 用；未接入 → null） */
export function getSteerTable(): SteerTable | null {
  return globalTable;
}

export function setSteerTable(t: SteerTable | null): void {
  globalTable = t;
}
