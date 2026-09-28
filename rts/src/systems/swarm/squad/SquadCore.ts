// ============================================================
// squad/SquadCore.ts —— 队长核心（重写 2026-09-27；用户定稿九条）
// ============================================================
// ★ 队长核只做一件事：**按标签 + 数据，不停调用长/短寻路走向该状态目标**。
//   · 标签**只由蜂群引擎给**（只读 `order.state`；核内不自设/不自动转标）；
//   · 数据载荷 = `order.target`（巡逻时=锚点，队长自维持腿）；
//   · 运动单源：非巡逻状态 → 位移目标 = 令目标/路点；巡逻状态 → 当前腿（patrolNext）；
//   · 开火独立（成员指令里的火力/阵型由分解矩阵给；位移槽位围绕队长）。
//   其余一切机制不存在（原子解释器/掩体选位/环夹/自动转巡…已删）。
// 汇报：唯一接收器 SquadManager.report（进度/位置/原子/阶段）。
// ============================================================

import type { MobTactics, TacticalOrder, UnitDirective } from '../../../entity/SwarmUnit';
import { squadBucket } from '../../../entity/SwarmUnit';
import type { MobRole, OrderPhase, SquadMode, SquadOrder, SquadReport } from '../engine/contracts';
import type { Squad } from '../SquadTable';
import { onArriveAtom } from './Abilities';
import { stateFromOrder, type SquadOrderState } from './State';
import { formationOffset } from './Formation';
import { decompose } from './Decompose';
import { interpretLeader, MARCH_DIST, ARRIVE_R } from './CommandLang';

// 距离分流阈值单源在 CommandLang（兼容旧引用：再导出）
export { MARCH_DIST, ARRIVE_R } from './CommandLang';

/** 队长驱动端口（执行落地；由接线层注入） */
export interface SquadDrivePorts {
  /** ★ 巡逻腿查询（用户口径：查询可行移动目标点 → 长/短寻路走过去）；无可行点 → null */
  patrolNext?(id: number, x: number, z: number, ax: number, az: number, r: number, leg: number): { x: number; z: number } | null;
  /** ★ 掩体检测（保护/驻守取目标用）：(x,z) 是否被 (tx,tz) 方向的掩体挡住 */
  coverFrom?(tx: number, tz: number, x: number, z: number): boolean;
  /** 长/短寻路求解（走廊写入 state） */
  ensurePath(state: SquadOrderState, squad: Squad, now: number): void;
  /** 队长站位锚（走廊前瞻路点/令目标；由接线层提供 currentTargetOf） */
  leaderTarget(state: SquadOrderState, squad: Squad, lx: number, lz: number, now: number): { x: number; z: number; climb?: boolean } | null;
  /** 事态环夹取（队长目标/指令目标同门） */
  clampRing?(x: number, z: number): { x: number; z: number };
  mobTactics(mobIndex: number): MobTactics | null;
  /** 开火闩锁（引擎）：false → 软禁火（fire=hold） */
  fireAllowed(uid: number): boolean;
  /** 成员指令落地（池列 / L3 onDirective）；ax/az = 队长锚点（orderTarget 列） */
  applyDirective(uid: number, order: TacticalOrder, directive: UnitDirective, until: number, ax: number, az: number): void;
}

export interface SquadPorts {
  /** 汇报（唯一接收器：SquadManager.report） */
  report(r: SquadReport): void;
  alive(): number;
}

export class SquadCore {
  /** 队长位置（实机每帧由载体写） */
  x = 0;
  z = 0;
  /** 当前原子能力（**表现/判官用**；不驱动位移） */
  atom: SquadMode = 'garrison';
  /** 命令阶段 */
  phase: OrderPhase = 'issued';
  /** 进度 0~1（HUD/判官） */
  progress = 0;
  /** 静止时长（实秒；HUD/判官） */
  stillS = 0;
  /** 探针契约（G9） */
  readonly dbg = { orders: 0, long: 0, short: 0, done: 0, last: '' };

  /** 本队执行态（路径缓存/锚点滞回；真源=引擎令） */
  state: SquadOrderState | null = null;
  private pending: SquadOrder | null = null;
  private order: SquadOrder | null = null;
  /** 接令时到目标的距离（进度分母） */
  private d0 = 0;
  private lastGainProg = 0;
  private seq = 1;
  /** ★ 巡逻（状态）：锚点（引擎令目标，捕获一次）/ 当前腿目标 / 腿方向（±1 交替） */
  private patrolAnchor: { x: number; z: number } | null = null;
  private patrolGoal: { x: number; z: number } | null = null;
  private patrolLeg = 1;
  /** 是否已 drive 过（tick 降级兜底用） */
  private hasDrive = false;

  constructor(readonly id: number, readonly role: MobRole, private readonly ports: SquadPorts) {}

  /** 接令（引擎/玩家 → 队长；只给队长，成员不接令） */
  accept(order: SquadOrder, now = 0): void {
    this.order = order;
    this.pending = order;
    this.phase = 'issued';
    this.progress = 0;
    this.stillS = 0;
    this.lastGainProg = 0;
    this.d0 = Math.hypot(order.target.x - this.x, order.target.z - this.z);
    this.dbg.orders++;
    this.dbg.last = `#${this.id} ${order.kind}→${order.target.x.toFixed(0)},${order.target.z.toFixed(0)}`;
    void now;
  }

  current(): SquadOrder | null {
    return this.order;
  }

  /** 队长驱动（每帧）：标签 → 长/短寻路 → 路点 → 成员围队长 + 指令落地 */
  drive(squad: Squad, now: number, port: SquadDrivePorts): void {
    const o = this.order;
    if (!o) return;
    if (this.pending) {
      this.state = stateFromOrder(this.id, o, this.state, now, 0);   // ★ 无 TTL
      this.pending = null;
      this.patrolAnchor = null;
      this.patrolGoal = null;
      this.patrolLeg = 1;
    }
    const st = this.state;
    if (!st) return;
    const lead = squad.members.get(squad.leaderUid);
    const lx = lead?.x ?? this.x, lz = lead?.z ?? this.z;
    // ★ 标签只读（唯一来源=引擎令；缺失旧令 → 按 kind 退化）
    const label: NonNullable<SquadOrder['state']> = o.state
      ?? (o.kind === 'protect' ? 'protect' : o.kind === 'defend' || o.kind === 'garrison' ? 'hold'
        : o.kind === 'patrol' ? 'patrol' : 'march');
    st.execState = label;
    const engT = o.target;
    // ---- 运动单源 ----
    // 巡逻（状态）：不停调用长/短寻路取下一腿；锚点=引擎令目标（捕获一次）
    if (label === 'patrol' && o.kind !== 'protect') {
      if (!this.patrolAnchor) this.patrolAnchor = { x: engT.x, z: engT.z };
      let pg = this.patrolGoal;
      if (!pg || Math.hypot(pg.x - lx, pg.z - lz) <= ARRIVE_R) {
        pg = port.patrolNext?.(this.id, lx, lz, this.patrolAnchor.x, this.patrolAnchor.z, 18, this.patrolLeg)
          ?? { x: this.patrolAnchor.x, z: this.patrolAnchor.z };
        this.patrolGoal = pg;
        this.patrolLeg = -this.patrolLeg;
      }
      st.order.target = { x: pg.x, z: pg.z };
    } else {
      // 行军/驻守/保护/总攻：目标 = 引擎令目标（载荷）
      st.order.target = { x: engT.x, z: engT.z };
    }
    // ---- 不停调用长/短寻路（唯一方向来源） ----
    port.ensurePath(st, squad, now);
    const anchor = port.leaderTarget(st, squad, lx, lz, now);
    // ---- 复合 → 原子（解释器 = `squad/CommandLang.ts`；保护用 blockCheck 调整点） ----
    const sel = interpretLeader(st, lx, lz, anchor, port.coverFrom);
    // ★ 保护：**调整点即寻路目标**（覆盖执行副本目标 → 走廊朝调整点；到点再校验，收敛）
    if (st.order.kind === 'protect' && sel.atom !== 'garrison') {
      st.order.target = { x: sel.x, z: sel.z };
      port.ensurePath(st, squad, now);
    }
    // ★ 队长位移目标（单源）：保护=调整点（sel）；其余=路点/令目标（anchor）
    let ax = st.order.kind === 'protect' ? sel.x : (anchor ? anchor.x : lx);
    let az = st.order.kind === 'protect' ? sel.z : (anchor ? anchor.z : lz);
    if (sel.atom === 'garrison' && st.order.kind === 'protect') { ax = lx; az = lz; }
    if (port.clampRing) { const c = port.clampRing(ax, az); ax = c.x; az = c.z; }
    this.atom = sel.atom;
    this.hasDrive = true;
    // ---- 成员调遣：分解矩阵（火力/低血）+ 围队长（位移=槽位） ----
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
      if (uid === squad.leaderUid) {
        dir.targetX = ax;
        dir.targetZ = az;
      } else {
        const off = formationOffset(squad.type, rank);
        dir.targetX = lx + fx * off.fx - fz * off.fz;
        dir.targetZ = lz + fz * off.fx + fx * off.fz;
      }
      rank++;
      port.applyDirective(uid, st.order, dir, st.until, ax, az);
    }
  }

  /** 每拍推进：进度/到位 → 汇报（引擎只记录，不逐拍指挥） */
  tick(dt: number): void {
    const o = this.order;
    if (!o) return;
    const dx = o.target.x - this.x;
    const dz = o.target.z - this.z;
    const d = Math.hypot(dx, dz);
    // 停滞口径：progress = 高水位（不回落）；每涨 ≥2% 算真推进并清零停滞
    const prog = this.d0 > 1 ? Math.max(0, Math.min(1, 1 - d / this.d0)) : 1;
    if (prog > this.progress) {
      this.progress = prog;
      if (prog - this.lastGainProg >= 0.02) { this.lastGainProg = prog; this.stillS = 0; }
      else this.stillS += dt;
    } else {
      this.stillS += dt;
    }
    if (d <= ARRIVE_R) {
      if (this.phase !== 'done') {
        this.phase = 'done';
        this.dbg.done++;
        this.dbg.last = `#${this.id} done ${o.kind}`;
      }
      this.atom = onArriveAtom(o.kind);
      this.report();
      return;
    }
    if (!this.hasDrive) this.atom = d > MARCH_DIST ? 'march' : 'act';
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
