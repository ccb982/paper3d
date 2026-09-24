// ============================================================
// entity/base/Locomotion —— 移动内核统一出口（重写 P1；算法全部沿用现有）
// ============================================================
// 归口三件（L2/L3 共用同一份，禁各写各的）：
//   · 16 向 pickSteer + 承诺反向保护 + 转向惯性（SteerPick）
//   · 坡正面混合 fallLineBlend / 危险点 dangerPointAt / 上岸 SHORE_CLIMB_MAX（TerrainAssist）
//   · 位置推进 / 爬坡 / 立面 / 贴地（CharacterCore，见同目录）
// 目录归位完成后，外部引用统一改从本文件走（现有路径保留，迁移期双通道）。
// ============================================================

export * from '../SteerPick';
export * from '../TerrainAssist';
export { CharacterCore, CLIMB_TIMEOUT_S } from './CharacterCore';
export type { TerrainProbe, StepInput, StepResult } from './CharacterCore';
