// ============================================================
// squad/SquadRegistry —— 实机队长核登记处（重写 P2；铁律 1/7）
// ============================================================
// 每支实机小队一个 SquadCore：接令（唯一来源）→ 分流（行军/行动）→ 汇报（唯一接收器）。
// 命令只给队长，成员不接令（成员一律跟队长）。nav/role/report/alive 由调用方注入，
// 本文件不依赖旧路径——旧板只作寻路/走廊缓存。
// ============================================================

import { SquadCore, type SquadNav } from './SquadCore';
import type { MobRole, SquadOrder, SquadReport } from '../engine/contracts';

export class SquadRegistry {
  private readonly cores = new Map<number, SquadCore>();
  private nowS = 0;
  /** 探针契约（G9） */
  readonly dbg = { n: 0, accepted: 0, reports: 0, last: '' };

  constructor(
    private readonly navOf: (id: number) => SquadNav,
    private readonly roleOf: (id: number) => MobRole,
    private readonly report: (r: SquadReport, now: number) => void,
    private readonly alive: (id: number) => number,
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

  /** 发令 → 队长（唯一入口；与旧板镜像并行——队长读同一目标） */
  accept(id: number, order: SquadOrder): void {
    this.ensure(id).accept(order);
    this.dbg.accepted++;
    this.dbg.last = `#${id} ${order.kind}→${order.target.x | 0},${order.target.z | 0}`;
  }

  /** 每帧：刷新队长位置（信息单源）→ 推进 → 汇报 */
  tick(dt: number, now: number, posOf: (id: number) => { x: number; z: number } | null): void {
    this.nowS = now;
    for (const c of this.cores.values()) {
      const p = posOf(c.id);
      if (!p) continue;
      c.x = p.x; c.z = p.z;
      c.tick(dt);
    }
  }

  get(id: number): SquadCore | undefined { return this.cores.get(id); }
  drop(id: number): void { this.cores.delete(id); this.dbg.n = this.cores.size; }
}
