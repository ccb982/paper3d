// ============================================================
// MemberTaskBoard —— 成员级任务（taskX/Z）唯一写入口
// ============================================================
// 施工分块 / 护卫扇区等"每个成员一个目标点"的任务通道：
//   · 写：只经本板（引擎任务布置层；队长层不写 taskX/Z —— 《工兵架构.md》§7）
//   · 读：SwarmSystem.move（task 优先于小队指令；≤1.2m 停；走廊绕障）
//   · 存：AgentPool.taskX/Z（SoA 位置列；0,0 = 无任务）
// ============================================================

import type { AgentPool } from './AgentPool';

/** 可接管任务列的小队（队形数据面） */
export interface TaskSquad {
  id: number;
  members: Map<number, { x: number; z: number }>;
}

export class MemberTaskBoard {
  /** 当前使用任务列的小队（清任务时的幂等守卫） */
  private readonly tasked = new Set<number>();

  constructor(private readonly pool: AgentPool) {}

  /** 写一个成员的任务目标（uid → 池下标扫描；0,0 = 清除） */
  write(uid: number, x: number, z: number): void {
    const p = this.pool;
    for (let i = 0; i < p.count; i++) {
      if (p.swarmUid[i] !== uid) continue;
      p.taskX[i] = x; p.taskZ[i] = z;
      return;
    }
  }

  /** 读成员当前任务目标（池列；无 → null） */
  taskOf(uid: number): { x: number; z: number } | null {
    const p = this.pool;
    for (let i = 0; i < p.count; i++) {
      if (p.swarmUid[i] !== uid) continue;
      const x = p.taskX[i], z = p.taskZ[i];
      return x !== 0 || z !== 0 ? { x, z } : null;
    }
    return null;
  }

  /** 标记小队接管任务列（之后 clear 才有意义） */
  own(squadId: number): void {
    this.tasked.add(squadId);
  }

  /** 清一小队全部成员任务（幂等） */
  clear(squad: TaskSquad): void {
    if (!this.tasked.has(squad.id)) return;
    for (const uid of squad.members.keys()) this.write(uid, 0, 0);
    this.tasked.delete(squad.id);
  }

  /** 全部清零（换落点 / 清场；不逐成员写池，池随 spawn/clear 自理） */
  clearAll(): void {
    this.tasked.clear();
  }
}
