// ============================================================
// swarm/tiers/L1 —— L1 档：队长单点 + 预留阵型槽位（用户定 2026-09-27）
// ============================================================
// 归属（《移动执行重写.md》§7.4/§7.5）：
//   · 拥有：每队**一个队长逻辑点**（地图数据）+ 成员**名册**（计数+血+槽位）；
//     移动只过 `PassTable` 格级可行性（1~2Hz 路点），不建代理/实体。
//   · 不做：追击/开火/兜底（兜底唯一归属 = L3）；成员物化由 Flux（L1→L2）负责。
// 本文件目前提供名册/槽位工具（P-L1 接线移动与生成）。
// ============================================================

import type { TierCarry } from './contracts';

/** L1 移动端口（用户定 2026-09-27：L1/L2 只走可行性）：格级可行步进（不走走廊/掩体）。
 *  `canStep`（PassTable 同源）由接线层注入；返回**新位置**（不可行/零距 → 原地）。 */
export interface L1MovePort {
  canStep(x: number, z: number, dx: number, dz: number): boolean;
}

/** L1 队长单步：朝目标轴对齐走一格（4m 格心，同 PassTable CELL）；不可行 → 尝试另一轴；都不行 → 原地。
 *  纯函数（航向即目标方向），供 L1 driver / 自检用。 */
export function l1Step(c: TierCarry, tx: number, tz: number, port: L1MovePort, cell = 4): { x: number; z: number } {
  const dx = tx - c.leader.x, dz = tz - c.leader.z;
  if (Math.hypot(dx, dz) <= 0.5) return { x: c.leader.x, z: c.leader.z };
  const sx = Math.abs(dx) >= Math.abs(dz) ? Math.sign(dx) : 0;
  const sz = sx === 0 ? Math.sign(dz) : 0;
  if (port.canStep(c.leader.x, c.leader.z, sx, sz)) {
    return { x: c.leader.x + sx * cell, z: c.leader.z + sz * cell };
  }
  const ax = sx === 0 ? Math.sign(dx) : 0;
  const az = sz === 0 ? Math.sign(dz) : 0;
  if ((ax !== 0 || az !== 0) && port.canStep(c.leader.x, c.leader.z, ax, az)) {
    return { x: c.leader.x + ax * cell, z: c.leader.z + az * cell };
  }
  return { x: c.leader.x, z: c.leader.z };
}
