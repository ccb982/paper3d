// ============================================================
// SuicideWarning —— 自爆单位逼近提醒（UI 边框红晕；2026-09-19）
// ============================================================
// 每帧扫描最近的自爆单位（代理池 + L3 实体）→ 驱动 UI 红晕强度（0~1）。
// 半径内越近越红，UI 侧做脉冲；出圈即灭。
// ============================================================

import type { AgentPool } from '../../systems/swarm/AgentPool';
import type { EnemyBase } from '../../entity/EnemyBase';

/** 预警半径（米）：进入后边框红晕随距离增强 */
export const SUICIDE_WARN_R = 14;

/** 每帧：最近自爆单位距离 → UI 红晕强度（0~1） */
export function updateSuicideWarning(
  ui: { setDangerVignette(v: number): void } | null | undefined,
  pool: AgentPool,
  enemies: EnemyBase[],
  px: number,
  pz: number,
): void {
  if (!ui) return;
  let best = Infinity;
  for (let i = 0; i < pool.count; i++) {
    if (pool.suicide[i] !== 1) continue;
    const dx = pool.x[i] - px, dz = pool.z[i] - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  for (const e of enemies) {
    if (!e.suicide) continue;
    const dx = e.position.x - px, dz = e.position.z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  const d = Math.sqrt(best);
  const intensity = d < SUICIDE_WARN_R ? Math.max(0, 1 - d / SUICIDE_WARN_R) : 0;
  ui.setDangerVignette(intensity);
}
