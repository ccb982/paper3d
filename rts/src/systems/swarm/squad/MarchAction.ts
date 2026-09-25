// ============================================================
// squad/MarchAction —— 行军(长寻路) / 行动(短跳) 的任务分流（重写 P2）
// ============================================================
// ★ 仅**降级兜底**（自检/未 drive）：按距离分流计数；实机执行侧 = 按距离选寻路
//   （>40m 长=可行性表路线 / ≤40m 短=LocalStep——《RTS架构.md》§6 / 方案 §4.4）。
// 把队长的寻路能力包成 SquadNav 端口供每队 SquadCore 注入；算法沿用 nav/，不改地形（G7）。
// ============================================================

import { MARCH_DIST, type SquadNav } from './SquadCore';

export interface MarchPorts {
  /** 队长当前位置（信息单源；无 → null） */
  leaderPos(id: number): { x: number; z: number } | null;
  /** LOS 直线可行（短跳核验；nav 层提供） */
  walkableLine(ax: number, az: number, bx: number, bz: number): boolean;
  /** 长寻路可达（走廊核验；缺省 = 用 walkableLine 近似） */
  reachable?(ax: number, az: number, bx: number, bz: number): boolean;
}

/** 造某队的 SquadNav：行军 = 长寻路可达性；行动 = LOS 直线 */
export function createSquadNav(ports: MarchPorts, id: number): SquadNav {
  const from = (): { x: number; z: number } | null => ports.leaderPos(id);
  return {
    longPath(x: number, z: number): number {
      const p = from();
      if (!p) return -1;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d <= MARCH_DIST) return d;
      const ok = ports.reachable ? ports.reachable(p.x, p.z, x, z) : ports.walkableLine(p.x, p.z, x, z);
      return ok ? d : -1;
    },
    canHop(x: number, z: number): boolean {
      const p = from();
      return !!p && ports.walkableLine(p.x, p.z, x, z);
    },
  };
}
