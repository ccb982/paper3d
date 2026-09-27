// ============================================================
// engine/RoleManager —— 兵种管理器基类（重写 P3）
// ============================================================
// 四兵种（工兵/近战/远程/飞天）共享：本兵种编成缓存 + 目标分配 + 刷怪执行 + 探针 dbg。
// 子类只写"本兵种策略参数与目标选择"，**互不越权**；位置只从 Positions 单源取（G4）。
// ============================================================

import type { MobRole } from './contracts';
import { SquadCreation, type CreationPort } from './SquadCreation';
import type { SquadManager } from './SquadManager';
import type { Positions } from './Positions';

export interface RoleCtx {
  pos: Positions;
  /** 事态函数给的环（目标必须夹进 [ringMin, ringMax]；0=不限制） */
  ringMin: number;
  ringMax: number;
  now: number;
  /** ★ 事态进度 0~1（用户定 2026-09-26：作为变量参与下令：高→总攻冲锋） */
  posture?: number;
  /** ★ 工兵友军位置（供近战护卫派份；可选） */
  engineers?: ReadonlyArray<{ x: number; z: number }>;
  /** ★ 本队防区的**前沿推进点**（可选；取自防区可部署点最远处） */
  frontOf?: (squadId: number) => { x: number; z: number } | null;
  /** ★ 敌方掩体（可选；远程“躲掩体”用：静态坐标即可） */
  covers?: ReadonlyArray<{ x: number; z: number }>;
}

export interface Target {
  x: number;
  z: number;
}

export abstract class RoleManager {
  protected readonly squads = new Set<number>();
  /** 本兵种当前分配结果（squadId → 目标点；引擎/校验链消费） */
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

  /** ★ 推进/驻守（用户定 2026-09-26：选主攻区 → 派兵 → **向前推进** → 到头就巡逻/驻守）
   *  · 前沿点取自防区可部署点（SectorBuilder；高原/坑水已排除）——**不是新机制，就是推进目标点**；
   *  · 到达（≤ HOLD_R）→ 目标 = 自身（**驻守**；无前沿点 → 站住等回收。
   *  无接线（自检）：保持旧行为（向舰压进/保距）。 */
  protected static readonly HOLD_R = 8;
  protected frontOfSquad(id: number, ctx: RoleCtx): { x: number; z: number } | null {
    return ctx.frontOf ? ctx.frontOf(id) : null;
  }
  /** 推进目标：未到→前沿点；到了→自身（驻守） */
  protected advanceTarget(id: number, s: { x: number; z: number }, ctx: RoleCtx): { x: number; z: number } | null {
    const f = this.frontOfSquad(id, ctx);
    if (!f) return null;
    return Math.hypot(s.x - f.x, s.z - f.z) <= RoleManager.HOLD_R ? { x: s.x, z: s.z } : f;
  }

  /** 每拍检查对应防区：缺就补、有就不放（本兵种策略：节拍 + 占比目标 + 优先并队） */
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

  /** 目标分配：子类实现本兵种策略；返回分配数。位置只从 ctx.pos 取 */
  abstract assign(ctx: RoleCtx): number;

  /** 把目标夹进环（事态范围；与 OrderValidator ① 同口径） */
  protected clampToRing(s: Target, ctx: RoleCtx): Target {
    const p = ctx.pos.ship() ?? ctx.pos.player();   // ★ 环以舰为心（用户定）
    if (!p || ctx.ringMax <= 0) return { x: s.x, z: s.z };
    const dx = s.x - p.x;
    const dz = s.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d <= 1e-3) return { x: s.x, z: s.z };
    const lo = ctx.ringMin > 0 ? ctx.ringMin : 0;
    const hi = ctx.ringMax;
    if (d >= lo && d <= hi) return { x: s.x, z: s.z };
    const k = (d < lo ? lo : hi) / d;
    return { x: p.x + dx * k, z: p.z + dz * k };
  }

  clear(): void {
    this.squads.clear();
    this.targets.clear();
    this.dbg.squads = 0;
  }
}
