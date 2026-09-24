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
import { onArriveAtom } from './Abilities';

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
  /** 接令时到目标的距离（进度分母；队长自报） */
  private d0 = 0;
  /** 上一拍位置（静止计时用） */
  private lastX = 0;
  private lastZ = 0;

  constructor(readonly id: number, readonly role: MobRole, private readonly ports: SquadPorts) {}

  /** 接令（引擎/玩家 → 队长；只给队长，成员不接令） */
  accept(order: SquadOrder): void {
    this.order = order;
    this.phase = 'issued';
    this.progress = 0;
    this.stillS = 0;
    this.d0 = Math.hypot(order.target.x - this.x, order.target.z - this.z);
    this.lastX = this.x;
    this.lastZ = this.z;
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
    // ★ 静止计时（队长自报；稳定门"卡住 ≥25s 可换令"用）
    if (Math.hypot(this.x - this.lastX, this.z - this.lastZ) > 0.05) this.stillS = 0;
    else this.stillS += dt;
    this.lastX = this.x;
    this.lastZ = this.z;
    // ★ 进度 = 起始距离收敛比（命令过半 → 可换令）
    this.progress = this.d0 > 1 ? Math.max(0, Math.min(1, 1 - d / this.d0)) : 1;
    if (d <= ARRIVE_R) {
      if (this.phase !== 'done') {
        this.phase = 'done';
        this.dbg.done++;
        this.dbg.last = `#${this.id} done ${o.kind}`;
      }
      this.atom = onArriveAtom(o.kind);   // ★ 稳定层（squad/Abilities）：到位驻留口径单源
      this.report();
      return;
    }
    if (d > MARCH_DIST) {
      // 行军：长寻路（不可达 → 原地待报，引擎换点/缩近）
      this.atom = 'march';
      if (this.ports.nav.longPath(o.target.x, o.target.z) > 0) this.dbg.long++;
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
      progress: this.progress,
      stillS: this.stillS,
    });
  }
}
