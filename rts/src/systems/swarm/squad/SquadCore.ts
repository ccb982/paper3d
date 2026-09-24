// ============================================================
// squad/SquadCore.ts —— 队长核心（重写 P2；铁律 1）
// ============================================================
// 队长只做三件事：
//   ① 接令：命令唯一来源 = SquadOrderStore（只给队长；引擎/玩家同源）
//   ② 导航：按距离选 **行军**（长寻路）/ **行动**（短跳）——原子能力四件套的推进器
//   ③ 汇报：唯一接收器 SquadManager.report（进度/位置/原子/阶段）
// 队长**不给代理下命令**——成员一律跟队长走。
// 纯逻辑（寻路/汇报由端口注入）→ 可独立自检。
// ============================================================

import type { AtomicKind, MobRole, OrderPhase, SquadOrder, SquadReport } from '../engine/contracts';

/** 距离分流阈值（米；用户定：行军=距离长→长寻路，行动=距离短→短跳） */
export const MARCH_DIST = 40;
/** 到位半径（米） */
export const ARRIVE_R = 1.5;

export interface SquadNav {
  /** 长寻路：返回路径长度（米）；-1 = 不可达 */
  longPath(x: number, z: number): number;
  /** 短跳：LOS 直线可行 */
  canHop(x: number, z: number): boolean;
}

export interface SquadPorts {
  nav: SquadNav;
  /** 汇报（唯一接收器：SquadManager.report） */
  report(r: SquadReport): void;
  alive(): number;
}

export class SquadCore {
  /** 队长位置（实机每帧由载体写） */
  x = 0;
  z = 0;
  /** 当前原子能力（执行层自报） */
  atom: AtomicKind = 'garrison';
  /** 命令阶段 */
  phase: OrderPhase = 'issued';
  /** 进度 0~1（换令稳定门用：≥0.5 可换） */
  progress = 0;
  /** 静止时长（实秒；≥ORDER_STABLE.STUCK_S 可换） */
  stillS = 0;
  /** 探针契约（G9） */
  readonly dbg = { orders: 0, long: 0, short: 0, done: 0, last: '' };

  private order: SquadOrder | null = null;

  constructor(readonly id: number, readonly role: MobRole, private readonly ports: SquadPorts) {}

  /** 接令（引擎/玩家 → 队长；只给队长，成员不接令） */
  accept(order: SquadOrder): void {
    this.order = order;
    this.phase = 'issued';
    this.progress = 0;
    this.stillS = 0;
    this.dbg.orders++;
    this.dbg.last = `#${this.id} ${order.kind}→${order.target.x.toFixed(0)},${order.target.z.toFixed(0)}`;
  }

  current(): SquadOrder | null {
    return this.order;
  }

  /** 每拍推进：按距离选 行军/行动 → 到位 → 汇报（引擎只记录，不逐拍指挥） */
  tick(dt: number): void {
    const o = this.order;
    if (!o) return;
    const dx = o.target.x - this.x;
    const dz = o.target.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d <= ARRIVE_R) {
      if (this.phase !== 'done') {
        this.phase = 'done';
        this.dbg.done++;
        this.dbg.last = `#${this.id} done ${o.kind}`;
      }
      this.atom = o.kind === 'patrol' || o.kind === 'defend' || o.kind === 'protect' ? 'patrol' : 'garrison';
      this.report();
      return;
    }
    if (d > MARCH_DIST) {
      // 行军：长寻路（不可达 → 原地待报，引擎换点/缩近）
      this.atom = 'march';
      const len = this.ports.nav.longPath(o.target.x, o.target.z);
      if (len > 0) {
        this.dbg.long++;
        this.progress = Math.max(0, Math.min(1, 1 - d / len));
      }
    } else {
      // 行动：短跳（LOS 直线）
      this.atom = 'act';
      if (this.ports.nav.canHop(o.target.x, o.target.z)) this.dbg.short++;
    }
    this.phase = 'executing';
    this.report();
  }

  /** 汇报（唯一接收器） */
  private report(): void {
    this.ports.report({
      squadId: this.id,
      x: this.x,
      z: this.z,
      alive: this.ports.alive(),
      atom: this.atom,
      phase: this.phase,
    });
  }
}
