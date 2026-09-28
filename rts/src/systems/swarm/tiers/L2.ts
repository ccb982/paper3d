// ============================================================
// swarm/tiers/L2 —— L2 档：队长 + 代理（只在地图数据上走；用户定 2026-09-27）
// ============================================================
// 归属（《移动执行重写.md》§7.5）：
//   · 拥有：队长 + 代理（沿用 SoA 存储，但**行为只在本模块**）；执行队令
//     （队长核 → 槽位指令 `directiveTargetX/Z`）；`CharacterCore/canShift` + 侧向避让由移动层共用。
//   · 不做：段进-巡逻/停滞救援（**兜底唯一归属 = L3**）；走廊/掩体/攻击槽（L3 的事）。
// P-L2：把池 think 里的"令执行"整段搬进本模块（行为搬家，不改语义）。
// ============================================================

import type { AgentPool } from '../AgentPool';
import { SWARM } from '../SwarmConfig';

/**
 * L2 令执行：活跃指令 + 距槽位目标 > 到位半径 → 朝目标行军（家随目标迁移，防边界震荡）。
 * @returns true = 本拍已接管移动（调用方跳过游走）；false = 无令/已到位 → 交回游走。
 */
export function l2ExecuteDirective(
  pool: AgentPool, i: number, px: number, pz: number, now: number,
): boolean {
  if (pool.directiveKind[i] === 0) return false;
  if (pool.directiveUntil[i] !== 0 && now >= pool.directiveUntil[i]) return false;
  const dtx = pool.directiveTargetX[i], dtz = pool.directiveTargetZ[i];
  const gdx = dtx - px, gdz = dtz - pz;
  const gd = Math.hypot(gdx, gdz);
  if (gd <= SWARM.L2_EXEC_ARRIVE_R) return false;
  pool.homeX[i] = dtx; pool.homeZ[i] = dtz;   // 家随目标（到位后围绕岗位驻守）
  pool.curSpeed[i] = pool.speed[i] * (pool.directiveSpeedMul[i] > 0 ? pool.directiveSpeedMul[i] : 1);
  pool.dirX[i] = gdx / gd;
  pool.dirZ[i] = gdz / gd;
  return true;
}
