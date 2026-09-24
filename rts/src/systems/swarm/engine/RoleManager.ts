// ============================================================
// engine/RoleManager —— 兵种管理器基类（重写 P3）
// ============================================================
// 四兵种（工兵/近战/远程/飞天）共享：本兵种编成缓存 + 目标分配 + 刷怪执行 + 探针 dbg。
// 子类只写"本兵种策略参数与目标选择"，**互不越权**；位置只从 Positions 单源取（G4）。
// ============================================================

import type { MobRole } from './contracts';
import type { SquadManager } from './SquadManager';
import type { Positions } from './Positions';

export interface RoleCtx {
  pos: Positions;
  /** 事态函数给的环（目标必须夹进 [ringMin, ringMax]；0=不限制） */
  ringMin: number;
  ringMax: number;
  now: number;
}

export interface Target {
  x: number;
  z: number;
}

export abstract class RoleManager {
  protected readonly squads = new Set<number>();
  /** 本兵种当前分配结果（squadId → 目标点；引擎/校验链消费） */
  readonly targets = new Map<number, Target>();
  readonly dbg = { squads: 0, assigned: 0, spawning: 0, spawned: 0, last: '' };

  constructor(readonly role: MobRole, protected readonly mgr: SquadManager) {}

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
    const p = ctx.pos.player();
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

  /** 刷怪执行（引擎决策"要多少/何时" → 本管理器生成投放；onSpawn 由引擎注入） */
  requestSpawn(n: number, onSpawn?: (role: MobRole) => void): void {
    if (n <= 0) return;
    this.dbg.spawning = n;
    for (let i = 0; i < n; i++) onSpawn?.(this.role);
    this.dbg.spawned += n;
    this.dbg.last = `spawn+${n}`;
  }

  clear(): void {
    this.squads.clear();
    this.targets.clear();
    this.dbg.squads = 0;
  }
}
