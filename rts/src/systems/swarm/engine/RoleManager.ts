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

  /** ★ 稳定锚位（防绕圈；用户定 2026-09-26）：按 squadId 哈希定角，环上固定点；**不随位置重算** */
  private readonly anchors = new Map<number, { x: number; z: number }>();
  protected anchorOfSquad(id: number, ctx: RoleCtx): { x: number; z: number } | null {
    if (ctx.ringMax <= 0) return null;
    const p = ctx.pos.ship() ?? ctx.pos.player();   // ★ 舰为参照（用户定 2026-09-26）
    if (!p) return null;
    let a = this.anchors.get(id);
    if (!a) {
      const ang = ((id * 137.508) % 360) * Math.PI / 180;
      const r = ctx.ringMin > 0 ? (ctx.ringMin + ctx.ringMax) / 2 : ctx.ringMax * 0.75;
      a = { x: p.x + Math.cos(ang) * r, z: p.z + Math.sin(ang) * r };
      this.anchors.set(id, a);
    }
    return a;
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
    this.anchors.clear();
    this.squads.clear();
    this.targets.clear();
    this.dbg.squads = 0;
  }
}
