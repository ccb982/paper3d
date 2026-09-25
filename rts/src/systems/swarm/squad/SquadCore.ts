// ============================================================
// squad/SquadCore.ts —— 队长核心（重写 P2/P4；铁律 1）
// ============================================================
// 队长只做三件事：
//   ① 接令：命令唯一来源 = SquadOrderStore（引擎/玩家同源）
//   ② 复合→原子：`squad/AtomicSelect` 条件表选 **行军/行动/驻守/巡逻**；
//      走廊锚点 → 队长走；成员**围队长**（阵型槽位）——队长不给代理下战术命令
//   ③ 汇报：唯一接收器 SquadManager.report（进度/位置/原子/阶段）
// 纯逻辑（寻路/指令落地由端口注入）→ 可独立自检。
// ============================================================

import type { MobTactics, TacticalOrder, UnitDirective } from '../../../entity/SwarmUnit';
import { squadBucket } from '../../../entity/SwarmUnit';
import type { AtomicKind, MobRole, OrderPhase, SquadOrder, SquadReport } from '../engine/contracts';
import type { Squad } from '../SquadTable';
import type { TerrainCover } from '../UnitTactics';
import { onArriveAtom } from './Abilities';
import { stateFromOrder, ORDER_TTL_DEFAULT, type SquadOrderState } from './State';
import { formationOffset } from './Formation';
import { decompose } from './Decompose';
import { selectAtomic, MARCH_DIST, ARRIVE_R } from './AtomicSelect';

// 距离分流阈值单源在 AtomicSelect（兼容旧引用：再导出）
export { MARCH_DIST, ARRIVE_R } from './AtomicSelect';

export interface SquadNav {
  /** 长寻路：返回路径长度（米）；-1 = 不可达 */
  longPath(x: number, z: number): number;
  /** 短跳：LOS 直线可行 */
  canHop(x: number, z: number): boolean;
}

/** 队长驱动端口（执行落地；由接线层注入） */
export interface SquadDrivePorts {
  /** 长/短寻路求解（走廊写入 state） */
  ensurePath(state: SquadOrderState, squad: Squad, now: number): void;
  /** 队长站位锚（保护/驻守/巡逻 + 走廊前瞻；由接线层提供 resolveAnchor） */
  leaderTarget(state: SquadOrderState, squad: Squad, lx: number, lz: number, now: number): { x: number; z: number; climb?: boolean } | null;
  /** 事态环夹取（队长目标/指令目标同门） */
  clampRing(x: number, z: number): { x: number; z: number };
  terrain(): TerrainCover | null;
  mobTactics(mobIndex: number): MobTactics | null;
  /** 开火闩锁（引擎）：false → 软禁火（fire=hold） */
  fireAllowed(uid: number): boolean;
  /** 成员指令落地（池列 / L3 onDirective）；ax/az = 队长锚点（orderTarget 列） */
  applyDirective(uid: number, order: TacticalOrder, directive: UnitDirective, until: number, ax: number, az: number): void;
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

  /** 本队执行态（路径缓存/锚点滞回；真源=引擎令） */
  state: SquadOrderState | null = null;
  /** 最近一次接令（待建态） */
  private pending: SquadOrder | null = null;
  private order: SquadOrder | null = null;
  /** 接令时到目标的距离（进度分母；队长自报） */
  private d0 = 0;
  /** 上一拍位置（静止计时用） */
  private lastX = 0;
  private lastZ = 0;
  /** 指令序号（队内单调） */
  private seq = 1;
  /** 是否已 drive 过（原子由 selectAtomic 决定；tick 只在从未 drive 时按距离兜底） */
  private hasDrive = false;

  constructor(readonly id: number, readonly role: MobRole, private readonly ports: SquadPorts) {}

  /** 接令（引擎/玩家 → 队长；只给队长，成员不接令） */
  accept(order: SquadOrder, now = 0): void {
    this.order = order;
    this.pending = order;
    this.phase = 'issued';
    this.progress = 0;
    this.stillS = 0;
    this.d0 = Math.hypot(order.target.x - this.x, order.target.z - this.z);
    this.lastX = this.x;
    this.lastZ = this.z;
    this.dbg.orders++;
    this.dbg.last = `#${this.id} ${order.kind}→${order.target.x.toFixed(0)},${order.target.z.toFixed(0)}`;
    void now;
  }

  current(): SquadOrder | null {
    return this.order;
  }

  /** 队长驱动（每帧；执行层调遣——复合→原子 + 走廊锚点 + 成员围队长 + 指令落地） */
  drive(squad: Squad, now: number, port: SquadDrivePorts): void {
    const o = this.order;
    if (!o) return;
    if (this.pending) {
      this.state = stateFromOrder(this.id, o, this.state, now, ORDER_TTL_DEFAULT);
      this.pending = null;
    }
    const st = this.state;
    if (!st) return;
    // ★ 玩家令优先：store 侧已保证（引擎不覆盖）；此处只看执行态是否过期
    if (st.until > 0 && now > st.until && st.source !== 'player') return;
    const lead = squad.members.get(squad.leaderUid);
    const lx = lead?.x ?? this.x, lz = lead?.z ?? this.z;
    // ① 站位锚（defend/act/patrol 经 resolveAnchor；protect 走 blockCheck 调整点，不用锚）
    let anchor: { x: number; z: number } | null = null;
    if (st.order.kind !== 'protect') {
      port.ensurePath(st, squad, now);   // 寻路轨：队长走廊（长行军 A* / 短跳贪心）
      anchor = port.leaderTarget(st, squad, lx, lz, now);
    }
    // ② 复合 → 原子（条件表 = `squad/AtomicSelect.ts`；protect 用 blockCheck 调整点）
    const sel = selectAtomic(st, lx, lz, anchor);
    // ③ protect：**调整点即寻路目标**（覆盖执行副本目标 → 走廊朝调整点；到点再校验，收敛）
    if (st.order.kind === 'protect' && sel.atom !== 'garrison') {
      st.order.target = { x: sel.x, z: sel.z };
      port.ensurePath(st, squad, now);
    }
    // ④ 队长目标（protect 已挡住 → 原地驻守；其余 = 原子目标）→ 环夹取
    let ax = sel.x;
    let az = sel.z;
    if (sel.atom === 'garrison' && st.order.kind === 'protect') { ax = lx; az = lz; }
    const c = port.clampRing(ax, az);
    ax = c.x; az = c.z;
    this.atom = sel.atom;   // 原子自报（tick 不再按距离覆盖）
    this.hasDrive = true;
    // ⑤ 成员调遣：分解矩阵 + 开火门 + 围队长（队长走原子目标）
    const bucket = squadBucket(squad.type);
    const uids: number[] = [];
    for (const uid of squad.members.keys()) uids.push(uid);
    const fl = Math.hypot(ax - lx, az - lz);
    const fx = fl > 1e-3 ? (ax - lx) / fl : 1;
    const fz = fl > 1e-3 ? (az - lz) / fl : 0;
    const atTarget = { x: ax, z: az };
    let rank = 0;
    for (const uid of uids) {
      const info = squad.members.get(uid);
      if (!info) continue;
      const hpRatio = info.maxHp > 0 ? info.hp / info.maxHp : 1;
      const dir = decompose(squad, st, bucket, now, hpRatio, () => this.seq++,
        atTarget, port.mobTactics(squad.mobKind));
      if (!port.fireAllowed(uid)) dir.fire = 'hold';
      if (!squad.singleton) {
        if (uid === squad.leaderUid) {
          dir.targetX = ax;
          dir.targetZ = az;
        } else {
          const off = formationOffset(squad.type, rank);
          dir.targetX = lx + fx * off.fx - fz * off.fz;
          dir.targetZ = lz + fz * off.fx + fx * off.fz;
        }
      }
      rank++;
      port.applyDirective(uid, st.order, dir, st.until, ax, az);
    }
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
    // 从未 drive（自检/降级）时按距离兜底；实机原子由 drive 的 selectAtomic 决定
    if (!this.hasDrive) {
      if (d > MARCH_DIST) {
        this.atom = 'march';
        if (this.ports.nav.longPath(o.target.x, o.target.z) > 0) this.dbg.long++;
      } else {
        this.atom = 'act';
        if (this.ports.nav.canHop(o.target.x, o.target.z)) this.dbg.short++;
      }
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
