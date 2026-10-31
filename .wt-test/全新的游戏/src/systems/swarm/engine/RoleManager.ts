// ============================================================
// engine/RoleManager —— 兵种管理器基类（重写 2026-09-27；用户定）
// ============================================================
// ★ 架构第 9 条（定稿）：**管理器只管生成兵、补兵，没有决策权**。
//   · 编成/补兵：sync（编成缓存） + ensureSquads（按节拍补兵）——仅此。
//   · **不得产出任何“选位/目标/战术”**；移动只由**引擎命令标签 + 数据载荷**驱动
//     （唯一兜底 = 行军↔巡逻交替）；开火独立实现。“选位/风筝/抑制/射程环/护卫”等
//     一律不存在。唯一例外：工兵管理器产出**活源目标（纯数据）**（施工任务），
//     不是战术决策。
//   · 位置只从 Positions 单源取（G4）。
// ============================================================

import type { MobRole } from './contracts';
import { SquadCreation, type CreationPort } from './SquadCreation';
import type { SquadManager } from './SquadManager';
import type { Positions } from './Positions';

/** 管理器上下文：只给只读输入（位置/时钟）；**不含任何战术输入** */
export interface RoleCtx {
  pos: Positions;
  now: number;
}

export interface Target {
  x: number;
  z: number;
}

export abstract class RoleManager {
  protected readonly squads = new Set<number>();
  /** 本兵种当前分配结果（squadId → 目标点；**仅工兵活源使用**） */
  readonly targets = new Map<number, Target>();
  readonly dbg = { squads: 0, assigned: 0, last: '' };

  /** ★ 统一创建接口（用户定 2026-09-26：只建本兵种 ∧ 只在对应防区） */
  readonly creation: SquadCreation;
  constructor(
    readonly role: MobRole,
    protected readonly mgr: SquadManager,
    /** 创建端口取用（接线层注入；未接线 = 不创建） */
    private readonly creationOf: () => CreationPort | null = () => null,
    creationPerSector = 0,
  ) {
    this.creation = new SquadCreation(role, creationPerSector);
  }

  /** ★ 补兵节拍（用户定 2026-09-26：策略在兵种管理器；事态驱动——越后越频繁） */
  protected replenishSlowS = 15;
  protected replenishFastS = 3;

  /** 每拍检查对应防区：缺就补、有就不放（节拍 + 占比目标 + 优先并队） */
  protected ensureSquads(now: number): void {
    const port = this.creationOf();
    if (!port) return;
    const p01 = Math.max(0, Math.min(1, port.posture ? port.posture() : 0));
    const every = this.replenishSlowS + (this.replenishFastS - this.replenishSlowS) * p01;
    this.creation.tick(now, port, every);
  }

  /** 引擎每拍同步编成（SquadManager 是编成真源；这里只缓存本兵种子集） */
  sync(): void {
    this.squads.clear();
    for (const r of this.mgr.all()) if (r.role === this.role) this.squads.add(r.id);
    this.dbg.squads = this.squads.size;
  }

  ids(): ReadonlySet<number> {
    return this.squads;
  }

  /** 编成与补兵（子类只能做这件事；返回分配数——固定为 0，工兵除外） */
  abstract assign(ctx: RoleCtx): number;

  clear(): void {
    this.squads.clear();
    this.targets.clear();
    this.dbg.squads = 0;
  }
}
