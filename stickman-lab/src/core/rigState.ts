/**
 * ══════════════════════════════════════════════════════════════════
 * ②  rigState.ts —— **唯一的关节状态**（承重标识 / 锁定 / 需求 / 仲裁）
 * ══════════════════════════════════════════════════════════════════
 *
 * 存在的理由：现在每个模块各自持一份数据副本（`BalanceHoldInput` 一份、
 * `StepSystemInput` 一份、`teacher.ts` 还有 45 个可变 `let`），
 * 于是"同一根轴被两个模块各写一次"这件事在**物理上无法避免**
 * —— 实测 `hip_l/0` 一格里 `balance` 与 `step` 同时在写。
 *
 * 本文件把三件事收敛成**一份**：
 *   1. **身份**：承重腿（达标授予的标识）、锁定腿（触地置位的闸门）
 *   2. **仲裁**：两系统**并发**提需求，按固定优先级合并成唯一的 target
 *   3. **快照**：不可变、每拍整体替换 ⇒ UI 与冒烟测试读的是同一份
 *
 * ── 两个关键区分（用户 2026-10-03 的核心要求）────────────────────
 *   **承重腿 ≠ 锁定腿**
 *     · 承重腿 = 标识，必须**检测达标**才授予
 *     · 锁定腿 = 闸门，**触地瞬间**无条件获得，禁止再抬
 *   两者是**独立字段**。用同一个 bool 表达它们 ⇒ 永远分不开。
 */

import type { Skeleton } from './skeleton';
import { jointIndexByName } from './skeleton';

// ─────────────────────────────────────────────────── 身份

export type Side = 'l' | 'r';
/** 四相状态机（交换协议见 gaitState.ts） */
export type Phase = 'DOUBLE' | 'SHIFT' | 'SINGLE' | 'STEP';

/** 两套系统的标识 */
export type SystemId = 'balance' | 'step';

/** 三类系统标签（UI 上色用） */
export type SystemTag = 'hold' | 'step' | 'servo' | 'none';

// ─────────────────────────────────────────────────── 判据（逐条可回读）

export interface Criteria {
  /** 逐条真假，UI 直接显示 ⇒ "为什么没迈步"不用推断 */
  flags: Record<string, boolean>;
  /** 逐条数值 */
  values: Record<string, number>;
  all: boolean;
}

// ─────────────────────────────────────────────────── 需求与仲裁

export interface AxisRequest {
  value: number;
  system: SystemId;
  /** 短标签（机制名），供 UI 显示 */
  label: string;
}

export interface AxisTarget {
  value: number;
  owner: SystemId | 'bind' | 'none';
  ownerLabel: string;
  tag: SystemTag;
  /** 被压制的需求（可见！不允许静默取优先级） */
  suppressed: { system: SystemId; label: string }[];
  /** 被锁定闸门否决的 */
  vetoed: { system: SystemId; label: string }[];
  clamped: boolean;
}

/** 固定优先级（§6.2）。索引小 = 优先。 */
const PRIORITY: Record<SystemId, number> = { balance: 0, step: 1 };

export interface RigStateConfig {
  /** 目标角变化率上限（单位：目标比例/秒）。防止抖。 */
  slewLimit: number;
  /** 腰的"受限修正槽"最大幅度（rad）—— 文献：骨盆横断面旋转 6° */
  waistSlotMax: number;
  /**
   * ★ 迈步系统在腰上允许的**捕获点余量**预算（m）。
   *   依据：好的单腿保持 MoS 侧向 −0.025 m（arXiv:2608.00500），取 10%。
   *   **注意：没有任何文献规定次级系统的权限上限，这个数是我们自己推的。**
   */
  mosBudgetZ: number;
}

export const DEFAULT_RIGSTATE_CONFIG: RigStateConfig = {
  slewLimit: 8.0,
  waistSlotMax: 6 * Math.PI / 180,
  mosBudgetZ: 0.0025,
};

// ─────────────────────────────────────────────────── 快照（唯一可读出口）

export interface AxisSnapshot {
  key: string;
  joint: number;
  axis: number;
  pos: number;
  vel: number;
  target: number;
  owner: AxisTarget['owner'];
  ownerLabel: string;
  tag: SystemTag;
  suppressed: AxisTarget['suppressed'];
  vetoed: AxisTarget['vetoed'];
  clamped: boolean;
  limitHit: boolean;
}

export interface SideSnapshot {
  side: Side;
  grounded: boolean;
  loadFrac: number;
  /** 离地高度（m，脚底相对地面） */
  soleY: number;
  /** 是否为前腿（实测脚 x，不是硬编码左右） */
  isFront: boolean;
  isBack: boolean;
  isBearer: boolean;
  locked: boolean;
}

export interface RigSnapshot {
  /** 拍号（单调递增，用于判断快照新鲜度） */
  tick: number;
  t: number;
  phase: Phase;
  phaseT: number;
  loadBearer: Side | null;
  supportLeg: Side;
  swingLeg: Side;
  locked: { l: boolean; r: boolean };
  /** 迈步系统的腰修正权限预算 α(t) ∈ [0,1] */
  authority: number;
  com: { x: number; y: number; z: number; vx: number; vy: number; vz: number };
  dcm: { x: number; z: number };
  support: { cx: number; cz: number; halfX: number; halfZ: number; contactN: number };
  mos: number;
  grf: { x: number; y: number };
  torsoY: number;
  tiltDeg: number;
  legs: Record<Side, SideSnapshot>;
  axes: AxisSnapshot[];
  criteria: {
    bearer: Criteria;
    unlock: Criteria;
    stepPermit: Criteria;
  };
  /** 事件（每拍增量） */
  events: { touchdownL: boolean; touchdownR: boolean; lockReleasedL: boolean; lockReleasedR: boolean };
}

// ─────────────────────────────────────────────────── 主体

export class RigState {
  readonly sk: Skeleton;
  readonly cfg: RigStateConfig;

  // ── 身份（唯一真源）
  loadBearer: Side | null = null;
  readonly locked: { l: boolean; r: boolean } = { l: false, r: false };
  phase: Phase = 'DOUBLE';
  phaseT = 0;
  authority = 0;

  // ── 读数（每拍从物理回读一次，两系统共享）
  readonly pos: Float64Array;
  readonly vel: Float64Array;
  readonly loadFrac: Record<Side, number> = { l: 0, r: 0 };
  readonly grounded: Record<Side, boolean> = { l: false, r: false };
  com = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  dcm = { x: 0, z: 0 };
  support = { cx: 0, cz: 0, halfX: 0, halfZ: 0, halfZActive: 0, contactN: 0 };
  mos = 0;
  grf = { x: 0, y: 0 };
  torsoY = 0;
  tiltDeg = 0;
  soleX: Record<Side, number> = { l: 0, r: 0 };
  /** 脚底离地高度（m）。UI 显示用；必须与快照同源，所以存在状态里 */
  readonly soleY: Record<Side, number> = { l: 0, r: 0 };

  // ── 仲裁
  //  ⚠⚠ 用**固定长度 + fill(undefined)** 清空，**不要**用 `length = 0`：
  //     那会把数组真的清空，于是 `i >= this.req.length` 恒成立 ⇒
  //     `request()` 全部静默 return ⇒ 控制器退化成开环，而所有指标看起来"正常"，
  //     只有增益扫描会暴露（16 行逐位相同）。已踩过。
  private readonly req: (AxisRequest | undefined)[] = [];
  /** 本拍真正被登记的需求数（诊断用：0 ⇒ 控制器根本没在控制） */
  requestCount = 0;
  /** 越界请求累计（应当恒为 0；非 0 说明有调用方用了不存在的关节/轴） */
  badRequests = 0;
  private readonly nAxes: number;
  private readonly tgt: AxisTarget[] = [];
  private readonly prevTarget: Float32Array;

  // ── 事件
  touchdown: Record<Side, boolean> = { l: false, r: false };
  lockReleased: Record<Side, boolean> = { l: false, r: false };

  // ── 判据（由 gaitState 写入，逐条回读）
  bearerCriteria: Criteria = { flags: {}, values: {}, all: false };
  unlockCriteria: Criteria = { flags: {}, values: {}, all: false };
  stepPermit: Criteria = { flags: {}, values: {}, all: false };

  private tickNo = 0;
  private tSec = 0;
  /** 上一拍的 target，供斜率限制 */
  private readonly prevOut: Float32Array;

  constructor(sk: Skeleton, cfg: RigStateConfig = DEFAULT_RIGSTATE_CONFIG) {
    this.sk = sk;
    this.cfg = cfg;
    const n = sk.joints.length * 3;
    this.nAxes = n;
    this.pos = new Float64Array(n);
    this.vel = new Float64Array(n);
    this.prevTarget = new Float32Array(n);
    this.prevOut = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.tgt.push({
        value: 0, owner: 'none', ownerLabel: '—', tag: 'none',
        suppressed: [], vetoed: [], clamped: false,
      });
    }
  }

  // ── 读写接口（两系统只能用这些）────────────────────────────

  bearer(): Side | null { return this.loadBearer; }

  /**
   * 承重腿；**没有标识时退化为"当前实际在承重的那条"**。
   *
   * ⚠ 双支撑时**必须取载荷大的那条**，不能写死 `'l'`：
   *   曾写死左脚，于是判据在评估一条只承担 29% 的腿，而右腿承担 71%
   *   ⇒ B2 永远不达标 ⇒ 承重标识永远授不出来 ⇒ 迈步许可 P1 永远为 false
   *   ⇒ 表现是"控制器完全不动"，但所有指标看起来都在正常回读。
   */
  supportLeg(): Side {
    if (this.loadBearer) return this.loadBearer;
    if (this.grounded.l && !this.grounded.r) return 'l';
    if (this.grounded.r && !this.grounded.l) return 'r';
    if (this.grounded.l && this.grounded.r) {
      // 双支撑：取载荷大的那条（相等时取已锁定的那条，再相等取 l）
      if (this.loadFrac.l > this.loadFrac.r + 1e-3) return 'l';
      if (this.loadFrac.r > this.loadFrac.l + 1e-3) return 'r';
      if (this.locked.l) return 'l';
      if (this.locked.r) return 'r';
      return 'l';
    }
    return 'l';
  }

  swingLeg(): Side { return this.supportLeg() === 'l' ? 'r' : 'l'; }
  isLocked(s: Side): boolean { return this.locked[s]; }

  jointPos(joint: number, axis: number): number { return this.pos[joint * 3 + axis] ?? 0; }
  /** 按真实索引取角（重构后的内部统一用这个；名字查询只用于外部配置） */
  angle(joint: number, axis = 2): number { return this.pos[joint * 3 + axis] ?? 0; }
  jointVel(joint: number, axis: number): number { return this.vel[joint * 3 + axis] ?? 0; }
  /** 按名字取当前角；关节不存在返回 NaN（**调用方必须处理，不许静默当 0**） */
  angleOf(name: string, axis = 2): number {
    const i = jointIndexByName(this.sk, name);
    if (i < 0) return NaN;
    return this.pos[i * 3 + axis] ?? 0;
  }

  /**
   * ★ 提需求。两个系统**并发**调用同一个 `rigState`，由 `arbitrate()` 合并。
   *   注意语义：这是"登记意图"，**不直接改 target**。
   */
  request(joint: number, axis: number, value: number, system: SystemId, label: string): void {
    const i = joint * 3 + axis;
    if (i < 0 || i >= this.nAxes) {
      // ★ 越界必须可见：说明调用方传了不存在的关节/轴（rig.ts 的断言本该拦住）
      this.badRequests++;
      return;
    }
    const cur = this.req[i];
    this.requestCount++;
    if (cur && PRIORITY[cur.system] <= PRIORITY[system]) {
      // 已有更高（或同）优先级的需求：新需求直接记为被压制
      this.tgt[i]!.suppressed.push({ system, label });
      return;
    }
    if (cur) this.tgt[i]!.suppressed.push({ system: cur.system, label: cur.label });
    this.req[i] = { value, system, label };
  }

  /**
   * ★★ 按**角度**提需求（内部换算成该轴量程的比例）。
   *
   *   为什么需要它：`request()` 收的是**目标角比例**（`-1..1`，映射到该轴量程），
   *   直接传 PD 的输出是**量纲错误** —— 会把"膝该往回顶一点"变成
   *   "命令膝弯 46°"，实测开局就深蹲塌下去。
   *   ⇒ 控制器里凡是"我要这个角"的语义，都必须走这个接口。
   */
  requestAngle(joint: number, axis: number, rad: number, system: SystemId, label: string): void {
    const def = this.sk.joints[joint];
    if (!def) { this.badRequests++; return; }
    const span = Math.max(Math.abs(def.minRad[axis]), Math.abs(def.maxRad[axis]));
    if (span <= 1e-6) { this.badRequests++; return; }
    // 与 ragdoll.posRefScale（0.9）保持一致：目标不占满量程
    this.request(joint, axis, (rad * 0.9) / span, system, label);
  }

  /** 锁定闸门：被锁定腿上的抬腿需求**直接丢弃**（不是加权、不是夹紧） */
  requestSwingLeg(side: Side, joint: number, axis: number, value: number, label: string, isLift: boolean): void {
    if (isLift && this.locked[side]) {
      const i = joint * 3 + axis;
      if (i >= 0 && i < this.nAxes) this.tgt[i]!.vetoed.push({ system: 'step', label });
      return;
    }
    this.request(joint, axis, value, 'step', label);
  }

  /** 同上，但按**角度**提需求 */
  requestSwingLegAngle(side: Side, joint: number, axis: number, rad: number, label: string, isLift: boolean): void {
    const def = this.sk.joints[joint];
    if (!def) { this.badRequests++; return; }
    if (isLift && this.locked[side]) {
      const i = joint * 3 + axis;
      if (i >= 0 && i < this.nAxes) this.tgt[i]!.vetoed.push({ system: 'step', label });
      return;
    }
    this.requestAngle(joint, axis, rad, 'step', label);
  }

  /**
   * ★ 腰的**受限修正槽**：迈步系统只能提一个**有界**的修正量。
   *   幅度上限 `waistSlotMax`（文献：骨盆横断面旋转 6°）
   *   且乘上权限预算 α(t)。
   *   超出部分被夹住并标记 —— 可见，不静默。
   */
  requestWaistSlot(joint: number, axis: number, rad: number, label: string): void {
    const def = this.sk.joints[joint];
    if (!def) { this.badRequests++; return; }
    const span = Math.max(Math.abs(def.minRad[0]), Math.abs(def.maxRad[0]));
    if (span <= 1e-6) { this.badRequests++; return; }
    const capRad = this.cfg.waistSlotMax * this.authority;
    const v = Math.max(-capRad, Math.min(capRad, rad));
    this.requestAngle(joint, axis, v, 'step',
      label + (Math.abs(v - rad) > 1e-9 ? `(夹到${(capRad * 57.3).toFixed(1)}°)` : ''));
  }

  // ── 仲裁 ────────────────────────────────────────────────

  /** 每拍开始：清空需求与仲裁痕迹 */
  beginTick(dt: number): void {
    this.tickNo++;
    this.tSec += dt;
    this.req.fill(undefined);
    this.requestCount = 0;
    for (let i = 0; i < this.tgt.length; i++) {
      const t = this.tgt[i]!;
      t.suppressed.length = 0; t.vetoed.length = 0; t.clamped = false;
      t.owner = 'none'; t.ownerLabel = '—'; t.tag = 'none'; t.value = 0;
    }
    this.touchdown.l = false; this.touchdown.r = false;
    this.lockReleased.l = false; this.lockReleased.r = false;
  }

  /** 每拍结束：合并成唯一的 target，返回可直接喂给 `setMotorTargets` 的数组 */
  arbitrate(dt: number): Float32Array {
    const out = this.prevOut;
    const maxStep = this.cfg.slewLimit * dt;
    for (let i = 0; i < this.nAxes; i++) {
      const r = this.req[i];
      const t = this.tgt[i];
      if (!r || !t) { out[i] = this.prevTarget[i] ?? 0; continue; }
      t.value = r.value; t.owner = r.system; t.ownerLabel = r.label;
      t.tag = r.system === 'balance' ? 'hold' : 'step';
      // 斜率限制
      const prev = this.prevTarget[i] ?? 0;
      const d = r.value - prev;
      if (Math.abs(d) > maxStep) {
        out[i] = prev + Math.sign(d) * maxStep;
        t.clamped = true;
      } else {
        out[i] = r.value;
      }
    }
    // 没被任何系统提的轴：回退到"保持上一拍"（= 绑定姿态附近），owner 记为 bind
    for (let i = 0; i < out.length; i++) {
      if (!this.req[i]) { out[i] = this.prevTarget[i] ?? 0; const t = this.tgt[i]!; if (t.owner === 'none') { t.owner = 'bind'; t.ownerLabel = '保持'; t.tag = 'servo'; } }
    }
    for (let i = 0; i < out.length; i++) this.prevTarget[i] = out[i]!;
    return out;
  }

  targets(): readonly AxisTarget[] { return this.tgt; }

  // ── 快照（唯一可读出口）─────────────────────────────────

  /** 每拍产出一次，**整体替换** ⇒ 持有旧快照不会被后续 tick 改变 */
  snapshot(limitHit: boolean[] = []): RigSnapshot {
    const footL = this.soleX.l, footR = this.soleX.r;
    const front: Side = footL >= footR ? 'l' : 'r';
    const axes: AxisSnapshot[] = [];
    for (let j = 0; j < this.sk.joints.length; j++) {
      for (let a = 0; a < 3; a++) {
        const i = j * 3 + a;
        const t = this.tgt[i]!;
        axes.push({
          key: `${this.sk.joints[j]!.name}/${a}`,
          joint: j, axis: a,
          pos: this.pos[i] ?? 0, vel: this.vel[i] ?? 0,
          target: this.prevTarget[i] ?? 0,
          owner: t.owner, ownerLabel: t.ownerLabel, tag: t.tag,
          suppressed: t.suppressed.map((x) => ({ ...x })),
          vetoed: t.vetoed.map((x) => ({ ...x })),
          clamped: t.clamped,
          limitHit: !!limitHit[i],
        });
      }
    }
    return {
      tick: this.tickNo, t: this.tSec,
      phase: this.phase, phaseT: this.phaseT,
      loadBearer: this.loadBearer, supportLeg: this.supportLeg(), swingLeg: this.swingLeg(),
      locked: { ...this.locked }, authority: this.authority,
      com: { ...this.com }, dcm: { ...this.dcm }, support: { ...this.support },
      mos: this.mos, grf: { ...this.grf },
      torsoY: this.torsoY, tiltDeg: this.tiltDeg,
      legs: {
        l: {
          side: 'l', grounded: this.grounded.l, loadFrac: this.loadFrac.l, soleY: this.soleY.l,
          isFront: front === 'l', isBack: front !== 'l',
          isBearer: this.loadBearer === 'l', locked: this.locked.l,
        },
        r: {
          side: 'r', grounded: this.grounded.r, loadFrac: this.loadFrac.r, soleY: this.soleY.r,
          isFront: front === 'r', isBack: front !== 'r',
          isBearer: this.loadBearer === 'r', locked: this.locked.r,
        },
      },
      axes,
      criteria: {
        bearer: cloneCriteria(this.bearerCriteria),
        unlock: cloneCriteria(this.unlockCriteria),
        stepPermit: cloneCriteria(this.stepPermit),
      },
      events: {
        touchdownL: this.touchdown.l, touchdownR: this.touchdown.r,
        lockReleasedL: this.lockReleased.l, lockReleasedR: this.lockReleased.r,
      },
    };
  }
}

function cloneCriteria(c: Criteria): Criteria {
  return { flags: { ...c.flags }, values: { ...c.values }, all: c.all };
}

export function makeCriteria(flags: Record<string, boolean>, values: Record<string, number>): Criteria {
  const ks = Object.keys(flags);
  return { flags, values, all: ks.length > 0 && ks.every((k) => flags[k]) };
}