// ============================================================
// squad/SquadRegistry —— 实机队长核登记处（重写 P2/P4；铁律 1/7）
// ============================================================
// 每支实机小队一个 SquadCore：接令（唯一来源）→ 驱动（导航+调遣）→ 汇报（唯一接收器）。
// 命令只给队长，成员不接令（成员一律跟队长）。nav/role/report/alive/drive 由调用方注入，
// 本文件不依赖旧路径——旧黑板只作 UI/探针镜像。
// ============================================================

import { SquadCore, type SquadDrivePorts, type SquadNav } from './SquadCore';
import type { SquadOrderState } from './State';
import type { Squad } from '../SquadTable';
import type { MobRole, SquadOrder, SquadReport } from '../engine/contracts';

/** 驱动端口（实机接线：SwarmSystem/Commander 提供） */
export interface RegistryDrive extends SquadDrivePorts {
  /** 队对象（含成员；帧间可变） */
  squadOf(id: number): Squad | null;
}

export class SquadRegistry {
  private readonly cores = new Map<number, SquadCore>();
  private nowS = 0;
  /** ★ 队长驱动节拍（10Hz；汇报/推进仍每帧） */
  private lastDrive = -1e9;
  /** 探针契约（G9） */
  readonly dbg = { n: 0, accepted: 0, reports: 0, last: '' };

  constructor(
    private readonly navOf: (id: number) => SquadNav,
    private readonly roleOf: (id: number) => MobRole,
    private readonly report: (r: SquadReport, now: number) => void,
    private readonly alive: (id: number) => number,
    private readonly drive: RegistryDrive,
  ) {}

  ensure(id: number): SquadCore {
    let c = this.cores.get(id);
    if (!c) {
      c = new SquadCore(id, this.roleOf(id), {
        nav: this.navOf(id),
        report: (r) => { this.report(r, this.nowS); this.dbg.reports++; },
        alive: () => this.alive(id),
      });
      this.cores.set(id, c);
      this.dbg.n = this.cores.size;
    }
    return c;
  }

  /** 发令 → 队长（唯一入口；引擎/玩家同源）。**同签名重发不重置进度/静止**（每拍续期用） */
  accept(id: number, order: SquadOrder, now = 0): void {
    const core = this.ensure(id);
    const cur = core.current();
    if (cur && cur.kind === order.kind && (cur.mission ?? '') === (order.mission ?? '')
      && Math.hypot(cur.target.x - order.target.x, cur.target.z - order.target.z) <= 2) {
      return;
    }
    core.accept(order, now);
    this.dbg.accepted++;
    this.dbg.last = `#${id} ${order.kind}→${order.target.x | 0},${order.target.z | 0}`;
  }

  /** 每帧：刷新队长位置（信息单源）→ 驱动（导航/调遣）→ 推进（汇报） */
  tick(dt: number, now: number, posOf: (id: number) => { x: number; z: number } | null): void {
    this.nowS = now;
    const doDrive = now - this.lastDrive >= 0.1;   // ★ 驱动节流 10Hz（decompose/寻路端口开销）
    if (doDrive) this.lastDrive = now;
    for (const c of this.cores.values()) {
      const p = posOf(c.id);
      if (!p) continue;
      c.x = p.x; c.z = p.z;
      if (doDrive) {
        const sq = this.drive.squadOf(c.id);
        if (sq) c.drive(sq, now, this.drive);
      }
      c.tick(dt);
    }
  }

  get(id: number): SquadCore | undefined { return this.cores.get(id); }

  /** 执行态（执行层读走廊/锚点；唯一来源 = 队长核） */
  stateOf(id: number): SquadOrderState | null { return this.cores.get(id)?.state ?? null; }

  drop(id: number): void { this.cores.delete(id); this.dbg.n = this.cores.size; }
}
