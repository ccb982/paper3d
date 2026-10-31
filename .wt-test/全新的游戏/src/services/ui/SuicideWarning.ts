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
/** 接近预警半径（米）：这么远就开始盯“正在接近” */
export const SUICIDE_APPROACH_R = 26;
/** 接近速度阈值（m/s）：超过即报警（越快越红） */
export const SUICIDE_APPROACH_SPEED = 0.8;

/** 上一帧最近距离（接近速度推算；无目标 = Infinity） */
let prevDist = Infinity;

/** 每帧：最近自爆单位距离 + 接近速度 → UI 红晕强度（0~1） */
export function updateSuicideWarning(
  ui: { setDangerVignette(v: number): void } | null | undefined,
  pool: AgentPool,
  enemies: EnemyBase[],
  px: number,
  pz: number,
  dt: number,
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
  // 接近速度（正 = 正在拉近）
  const closing = Number.isFinite(prevDist) && dt > 0 ? (prevDist - d) / dt : 0;
  prevDist = Number.isFinite(d) ? d : Infinity;
  // ① 近距预警：随距离逐强
  let intensity = d < SUICIDE_WARN_R ? 1 - d / SUICIDE_WARN_R : 0;
  // ② 接近预警：更远就提醒（越近、越快 → 越红）
  if (d < SUICIDE_APPROACH_R && closing > SUICIDE_APPROACH_SPEED) {
    const near = 1 - d / SUICIDE_APPROACH_R;
    const fast = Math.min(1, (closing - SUICIDE_APPROACH_SPEED) / 3);
    intensity = Math.max(intensity, 0.35 + 0.5 * Math.max(near, fast));
  }
  ui.setDangerVignette(Math.min(1, intensity));
}
