/**
 * ══════════════════════════════════════════════════════════════════
 *  jointQuery.ts —— **关节回读唯一网关**（状态机持有，两系统只查询）
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-06 定调：
 *   「我想把唯一的各个关节回读权限给状态机，**两套系统都从状态机做查询**。」
 *
 * ── 为什么值得做成硬约束（治的是同一类错误的四次复发）────────────
 *   ① 轴索引错位：侧向通道曾写在 `axis 1`（扭转）而不是 `axis 0`（外展）
 *      ⇒ 力矩差 10 倍（实测 −1.15 vs −11.88 N·m）。
 *   ② 符号相反：本 rig 髋/膝**负 = 屈**，踝**正 = 跖屈**；照抄别人的约定即翻转。
 *   ③ 量纲错：把"目标角比例"当力矩传；腰阻尼项量纲不平衡单独饱和。
 *   ④ 单位混用：Perry 表是 **deg**，`rs.angle()` 是 **rad** ⇒ 阈值形同虚设。
 *
 * ── 它同时解决一件更麻烦的事 ────────────────────────────────
 *   「**验收用的量**」与「**控制用的量**」必须来自同一处。
 *   否则会出现"状态机说合格、控制器在往外推"这种无法归因的局面。
 *
 * ── 三条所有权规则（`架构_v2_三模块协作.md` §18.2）──────────────
 *   R1 唯一读者：`rs.pos`/`rs.vel` 只允许**物理写 → 本网关读**；
 *      `balance.ts` / `step.ts` **禁止**直读（门禁 `probe-readback` 静态断言）。
 *   R2 只读：本文件**没有任何 setter**，也不含任何 `request*` 通道
 *      ⇒ 状态机"纯判据"的性质不被破坏（与 `probe-pure-sm` 一致）。
 *   R3 第二条读通道：**物理量**（`loadFrac`/`readCoP`/`soleBlockLoad`/`com`/`dcm`）
 *      仍由 `RigState` 持有 —— 它由物理写、不由控制器写，是唯一的另一条通道。
 */

import type { RigState, Side, StateViolation } from './rigState';
import type { WalkState } from './rigState';
import { STATE_DOMAINS, type StateDomain } from './keyframe';

/** 帧域项的轴口径（与 `STATE_DOMAINS[].axis` 同一套名字） */
export type DomainAxis = StateDomain['axis'];
export type DomainLeg = StateDomain['leg'];

export interface DomainResult {
  ok: boolean;
  /** 越界量（deg）；在区间内为 0 */
  errDeg: number;
  /** 实际用的容差（deg） */
  tolDeg: number;
}

export interface JointQuery {
  // ── 状态机输出（只读镜像）────────────────────────────────────
  readonly state: WalkState;
  readonly verified: boolean;
  readonly safe: boolean;
  readonly violations: readonly StateViolation[];

  /** 关节角（**deg**）。轴口径唯一真源：0=绕X(外展) 1=绕Y(扭转) 2=绕Z(屈伸) */
  angleDeg(joint: string | number, axis: 0 | 1 | 2): number;
  /** 关节角速度（**deg/s**） */
  velDegPerSec(joint: string | number, axis: 0 | 1 | 2): number;

  /** 本状态对该腿/轴的帧域区间（常量表的只读视图；找不到 = 不受约束） */
  band(leg: DomainLeg, axis: DomainAxis): StateDomain | undefined;
  /**
   * 帧域验收结果。
   * @param strict true = 用**严**容差 `tolIn`（评估"能否进入下一态"）；
   *              false = 用**松**容差 `tolOut`（评估"是否还保持得住"）。
   */
  inDomain(leg: DomainLeg, axis: DomainAxis, strict?: boolean): DomainResult;
  /** 承重腿当前该状态的**最差**越界量（deg，0 = 全部在域内） */
  worstSupportErrDeg(strict?: boolean): number;
  /** 摆动腿同上 */
  worstSwingErrDeg(strict?: boolean): number;

  supportLeg(): Side;
  swingLeg(): Side;
  trunkPitchDeg(): number;
  trunkRollDeg(): number;
}

/** 索引缓存：名字 → 关节号（构造一次，之后零分配） */
function buildIndex(rs: RigState): Map<string, number> {
  const m = new Map<string, number>();
  rs.sk.joints.forEach((j, i) => {
    if (!m.has(j.name)) m.set(j.name, i);
  });
  return m;
}

/** 关节基名（`hip_l` → `hip`），用于查帧域常量表 */
const base = (n: string): string => n.replace(/_[lr]$/, '');

/**
 * 帧域项 → 该腿/轴的实测角（deg）。符号口径在这里**唯一**定义一次。
 *
 * ⚠ 三个符号都是**实测**来的（`tools/probe-readback.ts` C 段），不是抄注释：
 *   · 髋/膝：关节空间 **正 = 伸**（实测 +0.25rad 使膝后移 / 脚前移）
 *           ⇒ 域口径「正 = 屈」必须**取负**。
 *   · 踝：关节空间 **正 = 背屈**（实测 +0.20rad 使足长轴 heel→ toe 端抬升 46mm；
 *       局部 +X 的方向由 `skeleton.ts` 的鞋底块定义确认：足跟 fx=−1、趾 fx=+1）
 *           ⇒ 域口径「正 = 跖屈」同样**取负**。
 *   · 髋外展（轴 0）：直取（`HIP_ABD_AXIS = 0`，轴向语义由骨架定义）。
 *
 * ⚠ 与 `balance.ts:743 / 1565` 的注释**相反**：那两处写「正踝角（跖屈）⇒ CoP 前移」，
 *   实测是「正踝角 = 背屈」。已按实测为准；该注释待修（见文档 §12）。
 */
function degOf(rs: RigState, idx: Map<string, number>, leg: Side, axis: DomainAxis): number {
  const DEG = 180 / Math.PI;
  switch (axis) {
    case 'hipFlex': return -rs.angle(idx.get(`hip_${leg}`) ?? -1, 2) / DEG;
    case 'hipAbd': return rs.angle(idx.get(`hip_${leg}`) ?? -1, 0) / DEG;
    case 'kneeFlex': return -rs.angle(idx.get(`knee_${leg}`) ?? -1, 2) / DEG;
    case 'ankle': return -rs.angle(idx.get(`foot_${leg}`) ?? -1, 2) / DEG;
    case 'trunkPitch': return rs.pitchDeg;
    case 'trunkLat': return rs.rollDeg;
    default: return 0;
  }
}

/**
 * ★ 构造网关。**只有 `GaitState` 调用**（它才是回读权限的持有者）。
 */
export function createJointQuery(rs: RigState, host: {
  readonly state: WalkState;
  readonly verified: boolean;
  readonly safe: boolean;
  readonly violations: readonly StateViolation[];
  supportLeg(): Side;
  swingLeg(): Side;
}): JointQuery {
  const idx = buildIndex(rs);

  /**
   * 关节名 → 索引。**未知名字直接抛错**。
   *
   * ⚠ 为什么不能像原来那样 `?? -1`：那样拼错名字会得到 `rs.angle(-1, …)`，
   *   而 `angle()` 对越界索引返回 **0** ⇒ 读数看起来"正常但是假的"。
   *   实测踩过：遥测里写成 `l_hip`（skeleton 的真名是 `hip_l`），
   *   于是面板上 `髋 0.0° 膝 0.0° 踝 0.0°` —— 一路"通过"到 UI 门禁。
   *   本项目栽过好几次静默失效（`onAxisMarkers`、滑块标签、`ready=false` 显示 0）。
   *   ⇒ 名字错必须是**响的**。
   */
  const resolve = (j: string | number): number => {
    if (typeof j === 'number') return j;
    const i = idx.get(j) ?? idx.get(base(j));
    if (i === undefined) throw new Error(`[jointQuery] 未知关节名 "${j}"（skeleton 里没有；已知如 hip_l / knee_l / foot_l）`);
    return i;
  };

  const one = (leg: DomainLeg, axis: DomainAxis, strict: boolean): DomainResult => {
    const d = STATE_DOMAINS.find((x) => x.state === host.state && x.leg === leg && x.axis === axis);
    if (!d) return { ok: true, errDeg: 0, tolDeg: 0 };   // 该组合不受约束
    const side: Side = rs.loadBearer ?? rs.supportLeg();
    const q = degOf(rs, idx, side, axis);
    const tol = strict ? d.tolIn : d.tolOut;
    const err = Math.max(d.lo - q, q - d.hi, 0);
    return { ok: err <= tol, errDeg: err, tolDeg: tol };
  };

  const worst = (leg: 'support' | 'swing' | 'trunk', strict: boolean): number => {
    let w = 0;
    for (const d of STATE_DOMAINS) {
      if (d.state !== host.state || d.leg !== leg) continue;
      const side = leg === 'swing'
        ? (host.supportLeg() === 'l' ? 'r' : 'l')
        : host.supportLeg();
      const q = degOf(rs, idx, side, d.axis);
      const tol = strict ? d.tolIn : d.tolOut;
      w = Math.max(w, Math.max(d.lo - q, q - d.hi, 0) - tol);
    }
    return Math.max(0, w);
  };

  return {
    get state() { return host.state; },
    get verified() { return host.verified; },
    get safe() { return host.safe; },
    get violations() { return host.violations; },

    angleDeg(joint, axis) { return (rs.angle(resolve(joint), axis) * 180) / Math.PI; },
    velDegPerSec(joint, axis) { return (rs.jointVel(resolve(joint), axis) * 180) / Math.PI; },

    band(leg, axis) {
      return STATE_DOMAINS.find((x) => x.state === host.state && x.leg === leg && x.axis === axis);
    },
    inDomain(leg, axis, strict = true) { return one(leg, axis, strict); },
    worstSupportErrDeg(strict = true) { return worst('support', strict); },
    worstSwingErrDeg(strict = true) { return worst('swing', strict); },

    supportLeg: () => host.supportLeg(),
    swingLeg: () => host.swingLeg(),
    trunkPitchDeg: () => rs.pitchDeg,
    trunkRollDeg: () => rs.rollDeg,
  };
}
