// ============================================================
// engine/EngineerManager —— 工兵管理器（重写 P3；用户定）
// ============================================================
// 策略：分区 / 派件数据 / 施工编排；**本兵种刷怪**（引擎只下达"补几队"）。
// 工兵的派件（危险点优先 → 扇区弧链随机可达点）在队长层（FortifyPlanner），
// 本管理器只负责：编成、分区数据、把"引擎要的工兵队"生成投放。
// 位置只从 Positions 单源取；不越权管其他兵种。
// ============================================================

import { RoleManager, type RoleCtx } from './RoleManager';
import type { SquadManager } from './SquadManager';

/** 工兵策略参数（集中可调） */
export const ENGINEER_POLICY = {
  /** 每防区工兵小队数（引擎按需调 requestSpawn） */
  PER_SECTOR: 1,
  /** 施工件到件半径（米；与 EngineerCorps.WORK_R2 同口径） */
  WORK_R: 3,
} as const;

export class EngineerManager extends RoleManager {
  /** 引擎给的分区数据（sectorId → 该区工兵小队） */
  private readonly sectors = new Map<number, number[]>();

  constructor(mgr: SquadManager) {
    super('engineer', mgr);
  }

  /** 分区登记（引擎的防区决策结果；本管理器只存不算） */
  assignSector(sectorId: number, squadId: number): void {
    const arr = this.sectors.get(sectorId);
    if (arr) {
      if (!arr.includes(squadId)) arr.push(squadId);
    } else {
      this.sectors.set(sectorId, [squadId]);
    }
    this.dbg.last = `sector#${sectorId}<-${squadId}`;
  }

  sectorOf(squadId: number): number {
    for (const [sid, arr] of this.sectors) if (arr.includes(squadId)) return sid;
    return -1;
  }

  /** 工兵目标分配：保持当前站位（派件在队长层）；返回在册数 */
  assign(ctx: RoleCtx): number {
    void ctx;
    this.targets.clear();
    for (const id of this.squads) {
      const s = ctx.pos.squad(id);
      if (s) this.targets.set(id, { x: s.x, z: s.z });
    }
    this.dbg.assigned = this.targets.size;
    return this.targets.size;
  }

  override clear(): void {
    super.clear();
    this.sectors.clear();
  }
}
