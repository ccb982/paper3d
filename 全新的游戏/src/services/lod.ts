// ============================================================
// lod —— LOD 距离分级（服务层，架构 3.10）
// ============================================================
// ★ 2026-11-07 架构重构：本文件改为**转发层**。
//   真正的定义搬到 `services/visibility.ts`（可见性判据单一事实源）——
//   因为「距离 → 表现强度」与「视锥裁剪」必须同源：
//   旧实现里 LOD 档位（services/lod.ts）和视锥判据（RasterMap 梯形）是两套，
//   于是「渲染看得见」与「LOD 以为看不见」结论不一致 ⇒ 闪烁 + 鬼影。
//   保留本文件是为了不破坏既有 import 路径。
//
// 分级决策：xz 距离 → lodLevel（可调参，集中一处）
// 渲染遍历（EntityManager.renderAll）消费；未来小地图/其他系统也可用。

export { LOD_RANGES, LOD_MAX_DIST, levelForDistance, fadeForDistance } from './visibility';
