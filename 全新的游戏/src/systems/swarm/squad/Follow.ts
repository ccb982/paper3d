// ============================================================
// squad/Follow —— 成员跟队长（唯一跟随语义；用户定 2026-09-24；★ 重写 P2 归位）
// ============================================================
//   近：直线走向队长；到位（5~8m 滞回）即停。
//   远且直线被挡（崖/墙/单向边）→ **长寻路找队长**：沿队走廊（队长正在走的同一条
//   可行走廊）的前瞻点绕行——不另起炉灶、不花每帧 A*。
//   依赖铁律：只读队长执行态走廊（无状态、零分配）。
export interface FollowDir {
  x: number;
  z: number;
}

/** 队长（无任务）方向：先到指令锚点；离锚（队级目标）仍远 → 不停、直接朝锚；null = 真到位。
 *  ★ 到位校验（用户定 2026-09-24）：防"槽位到位、离队令目标还远"冻住全队。 */
export function leaderDir(
  dx: number, dz: number, ox: number, oz: number,
): FollowDir | null {
  const ad = Math.hypot(dx, dz);
  if (ad > 2) return { x: dx / ad, z: dz / ad };
  const od = Math.hypot(ox, oz);
  if (od > 8) return { x: ox / od, z: oz / od };
  return null;
}
