// ============================================================
// squad/Follow —— 成员跟队长（唯一跟随语义；用户定 2026-09-24；★ 重写 P2 归位）
// ============================================================
//   近：直线走向队长；到位（5~8m 滞回）即停。
//   远且直线被挡（崖/墙/单向边）→ **长寻路找队长**：沿队走廊（队长正在走的同一条
//   可行走廊）的前瞻点绕行——不另起炉灶、不花每帧 A*。
//   依赖铁律：只读 SquadTactics/走廊（无状态、零分配）。

import { SquadTactics } from '../SquadTactics';

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

/** 跟班停步半径：队长未真到位（离锚 >8m）→ 压到 2m；否则动 5m / 停 8m 滞回 */
export function followStopR(stopped: boolean, leadX: number, leadZ: number, ox: number, oz: number): number {
  return Math.hypot(leadX - ox, leadZ - oz) > 8 ? 2 : (stopped ? 8 : 5);
}

/** 跟队长方向；null = 已到位（应停）。stopR = 停步半径（滞回由调用方给） */
export function followDir(
  tactics: SquadTactics,
  squadId: number,
  px: number,
  pz: number,
  lx: number,
  lz: number,
  stopR: number,
  walkable: (ax: number, az: number, bx: number, bz: number) => boolean,
): FollowDir | null {
  const tx = lx - px, tz = lz - pz;
  const td = Math.hypot(tx, tz);
  if (td <= stopR) return null;
  // ★ 掉队/被挡 → 沿走廊前瞻点走（长寻路；走廊即队长的长路）
  if (td > 12 && !walkable(px, pz, lx, lz)) {
    const ahead = SquadTactics.corridorAhead(tactics.board.get(squadId), px, pz, 4);
    if (ahead) {
      const ax = ahead.x - px, az = ahead.z - pz;
      const al = Math.hypot(ax, az);
      if (al > 1e-3) return { x: ax / al, z: az / al };
    }
  }
  return { x: tx / td, z: tz / td };
}
