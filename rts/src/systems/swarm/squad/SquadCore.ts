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
import { HOLD_COVER, stepHoldCover, newHoldCoverState, type HoldCoverState } from './HoldCover';

// 距离分流阈值单源在 CommandLang（兼容旧引用：再导出）
export { MARCH_DIST, ARRIVE_R } from './CommandLang';

/** 队长驱动端口（执行落地；由接线层注入） */
export interface SquadDrivePorts {
  /** ★ 巡逻腿查询（用户口径：查询可行移动目标点 → 长/短寻路走过去）；无可行点 → null */
  patrolNext?(id: number, x: number, z: number, ax: number, az: number, r: number, leg: number): { x: number; z: number } | null;
  /** ★★ 保护腿专用查询（用户定 2026-09-29）：**绕锚点、半径原样、BFS 必须 'ok'**（严格可达）——
   *  通用巡逻口会把半径抬到 ≥24 且用宽松门，保护圈"限死半径 + 真可达"必须走这个口。 */
  protectNext?(id: number, x: number, z: number, ax: number, az: number, r: number, leg: number): { x: number; z: number } | null;
  /** ★ 驻守（队长状态）：舰位（自主掩体循环的方向参照） */
  shipPoint?(): { x: number; z: number } | null;
  /** ★ 驻守：附近掩体查询（掩体表；毁件自然消失 → 触发后撤） */
  coversNear?(x: number, z: number, r: number): { x: number; z: number }[];
  /** ★ 驻守：玩家位（近旁时用玩家做参照 + 掩体检测） */
  playerPoint?(): { x: number; z: number } | null;
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
  /** ★ 驻守状态（自主掩体循环：藏/毁/撤/再进） */
  private hold: HoldCoverState = newHoldCoverState(0);
  /** ★ protect 短寻路巡逻（用户定 2026-09-29）：保护圈=范围限定死——
   *  圈中心 A=G 朝威胁方向 min(NEAR_G, |PG|−STANDOFF) 处；进圈后绕 A 的 LOOP_R 短寻路巡逻腿。 */
  private static readonly PROTECT_NEAR_G = 12;   // 保护圈中心离 G 的上限（米）
  private static readonly PROTECT_RANGE = 20;    // 进入圈内的判定（米）；超过 → 先走向 A
  private static readonly PROTECT_LOOP_R = 6;    // 圈内巡逻腿半径（米；范围限定死；对穿跨度≈12m>判官4m）
  private static readonly PROTECT_HOP_R = 6;     // 圈心无腿 → 绕自身的短跳半径（米；仍限死）
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
      this.hold = newHoldCoverState(now);   // ★ 新令 → 驻守循环重开
    }
    const st = this.state;
    if (!st) return;
    // ★ 保护 G 还原（用户定 2026-09-29）：引擎载荷 target=**被保护点 G** 恒真——
    //   上一拍的"调整点/横移点"只作本拍运动目标，不许污染下一拍的 G（否则 blockCheck 锚点漂移）。
    if (o.kind === 'protect') st.order.target = { x: o.target.x, z: o.target.z };
    const lead = squad.members.get(squad.leaderUid);
    const lx = lead?.x ?? this.x, lz = lead?.z ?? this.z;
    // ★ 标签只读（唯一来源=引擎令；缺失旧令 → 按 kind 退化）
    const label: NonNullable<SquadOrder['state']> = o.state
      ?? (o.kind === 'protect' ? 'protect' : o.kind === 'defend' || o.kind === 'garrison' ? 'hold'
        : o.kind === 'patrol' ? 'patrol' : 'march');
    st.execState = label;
    const engT = o.target;
    // ---- 运动单源 ----
    // 掩体点=纯行军目标（建造位置由管理器按当前位置向参照侧决定；用户定 2026-09-29）
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
    } else if (label === 'hold') {
      // ★★ 驻守 = 队长状态（用户定 2026-09-29）：**不钉死一点**——自主掩体循环：
      //   藏（更靠舰掩体背舰侧）→ 毁（掩体没了）→ 撤（更安全的掩体/背舰脱离）→ 过段时间再进。
      //   引擎给坐标（> 搜索半径 → 先到坐标；≤ → 就地起循环）；只给驻守（目标≈自身）→ 立起循环。
      const shipPt = port.shipPoint?.() ?? null;
      // ★ 锚点（引擎令目标）也要能取到——件在锚旁，可能超出 leader 的 40m 搜索圈
      const covers = port.coversNear?.(lx, lz, HOLD_COVER.SEARCH_R + HOLD_COVER.ANCHOR_R + 4) ?? [];
      if (shipPt && Math.hypot(engT.x - lx, engT.z - lz) <= HOLD_COVER.SEARCH_R) {
        const t = stepHoldCover(this.hold, now, { x: lx, z: lz }, shipPt, covers, {
          player: port.playerPoint?.() ?? null,
          coverFrom: port.coverFrom,
          anchor: { x: engT.x, z: engT.z },   // ★ 指定驻守件点：走进岗哨（用户定 2026-09-30）
        });
        st.order.target = { x: t.x, z: t.z };
      } else {
        st.order.target = { x: engT.x, z: engT.z };   // 先到引擎坐标（锚），进场再循环
      }
    } else {
      // 行军/保护/总攻：目标 = 引擎令目标（载荷）
      st.order.target = { x: engT.x, z: engT.z };
    }
    // ---- 不停调用长/短寻路（唯一方向来源） ----
    port.ensurePath(st, squad, now);
    const anchor = port.leaderTarget(st, squad, lx, lz, now);
    // ---- 复合 → 原子（解释器 = `squad/CommandLang.ts`；保护走保护圈逻辑） ----
    const sel = interpretLeader(st, lx, lz, anchor, port.coverFrom);
    // ★★ 保护（用户定 2026-09-29）：**不断调用短寻路、类似巡逻、范围限定死**——
    //   圈中心 A = G 朝威胁方向 min(PROTECT_NEAR_G, |PG|−STANDOFF) 处（玩家贴近 → 自然退化为 7m 拦截）；
    //   离 A 超过 PROTECT_RANGE → 走向 A；进圈 → 绕 A 半径 PROTECT_LOOP_R 的**短寻路巡逻腿**，
    //   换腿即清路重建（不走 3s 停等）；无腿 → 原位（不硬发不可走点）。
    let ax: number;
    let az: number;
    if (st.order.kind === 'protect') {
      const G = o.target;
      const P = port.playerPoint?.() ?? (st.order.threatX !== undefined
        ? { x: st.order.threatX, z: st.order.threatZ ?? G.z } : null);
      const dGP = P ? Math.hypot(G.x - P.x, G.z - P.z) : 0;
      const dFromG = P && dGP > 1e-3 ? Math.min(SquadCore.PROTECT_NEAR_G, Math.max(0, dGP - 7)) : 0;
      const ux = P && dGP > 1e-3 ? (P.x - G.x) / dGP : 0;
      const uz = P && dGP > 1e-3 ? (P.z - G.z) / dGP : 0;
      const A = { x: G.x + ux * dFromG, z: G.z + uz * dFromG };
      const dA = Math.hypot(A.x - lx, A.z - lz);
      if (dA > SquadCore.PROTECT_RANGE) {
        this.patrolGoal = null;   // 走向圈心（短/长分流在 ensurePath）
        st.order.target = { x: A.x, z: A.z };
        port.ensurePath(st, squad, now);
        ax = A.x; az = A.z;
      } else {
        if (!this.patrolAnchor || Math.hypot(this.patrolAnchor.x - A.x, this.patrolAnchor.z - A.z) > 2) {
          this.patrolAnchor = { x: A.x, z: A.z }; this.patrolGoal = null;
        }
        let pg = this.patrolGoal;
        if (!pg || Math.hypot(pg.x - lx, pg.z - lz) <= ARRIVE_R) {
          // 腿序：绕圈心 A → 圈心无腿 → **绕自身短跳**（保底：保证移动；仍限死在保护范围内）
          // ★ 严格口（protectNext=nav.patrolNext：绕锚点、半径原样、BFS 'ok'）；无此口才回退通用口
          const legQ = port.protectNext ?? port.patrolNext;
          pg = legQ?.(this.id, lx, lz, A.x, A.z, SquadCore.PROTECT_LOOP_R, this.patrolLeg)
            ?? legQ?.(this.id, lx, lz, lx, lz, SquadCore.PROTECT_HOP_R, this.patrolLeg)
            ?? null;
          this.patrolGoal = pg;
          this.patrolLeg = -this.patrolLeg;
          if (pg) { st.corridor = undefined; st.followIdx = undefined; st.tgtIdx = undefined; st.mvAt = undefined; }
        }
        if (pg) {
          st.order.target = { x: pg.x, z: pg.z };
          port.ensurePath(st, squad, now);
          ax = pg.x; az = pg.z;
        } else {
          ax = lx; az = lz;   // 无可行腿 → 原位（下一拍再试；不硬发不可走点）
        }
      }
    } else {
      // 行军/总攻/驻守：队长位移目标 = 路点/令目标（anchor）
      ax = anchor ? anchor.x : lx;
      az = anchor ? anchor.z : lz;
    }
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
