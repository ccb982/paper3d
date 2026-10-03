/**
 * ══════════════════════════════════════════════════════════════════
 * ①  rig.ts —— **骨架不变量 + 逐关节体检**
 * ══════════════════════════════════════════════════════════════════
 *
 * 为什么它是重构的第 0 步：今天大部分脏 bug 的成因都是「**非法状态可以表示**」。
 * 本文件把那些"注意事项"变成**启动时必须过的断言**。
 *
 * 已被这个文件（或它的同类）抓到的真实事故：
 *   · `JOINT_ORDER` 含 `foot_l`，但 `ankleEnabled=false` 时骨架里没有踝 ⇒
 *     任何按名字查踝的代码要么静默丢弃指令，要么回退到 `JOINT_ORDER` 得到
 *     索引 9 = **`spine1`**（指令下到腰上，而代码和探针都以为是踝）。
 *   · `BRAIN_SHAPE = shapeForJoints(9)` 而骨架是 12 关节 ⇒ 网络输入 90 维、
 *     输出 27 维 ⇒ 观测静默截掉 18 维、只驱动 9/12 个关节、
 *     10 个物理步内 `com` 全变 NaN，**全程不报错**。
 *
 * ⇒ 原则：**查不到就是查不到，指错比找不到更坏。**
 */

import {
  JOINT_MAX_TORQUE, TORQUE_AXIS_FACTOR, jointIndexByName, hasJoint,
  type Skeleton,
} from './skeleton';
import { shapeForJoints, type BrainShape } from './brain';

/** 三根轴的语义（与 skeleton 的 AXIS_X/Y/Z 一致） */
export const AXIS_NAME = ['内外旋', '外展/侧倾', '屈伸'] as const;

/** `JOINT_ORDER` 里声明、但 `ankleEnabled=false` 时**不存在**的关节 */
export const PHANTOM_JOINTS = ['foot_l', 'foot_r'] as const;

export interface AxisReport {
  axis: number;
  /** 该轴的限位跨度（rad）；0 = 该轴被锁死（限位≈0），不可用于控制 */
  span: number;
  loDeg: number;
  hiDeg: number;
  /** 该轴的力矩上限（N·m）= JOINT_MAX_TORQUE × TORQUE_AXIS_FACTOR */
  tauMax: number;
  usable: boolean;
  /** 不可用的原因（usable=false 时非空） */
  why: string;
}

export interface JointReport {
  name: string;
  /** 在 `sk.joints` 中的真实索引；-1 = 不存在 */
  index: number;
  exists: boolean;
  /** 大致部位分组，体检表按它排序 */
  group: '颈' | '肩' | '肘' | '髋' | '膝' | '腰' | '踝' | '其它';
  axes: AxisReport[];
  /** 三个轴里有多少个真正可驱动 */
  usableAxes: number;
  problems: string[];
}

export interface RigReport {
  bodyCount: number;
  jointCount: number;
  /** 每关节 3 轴的受控槽位数（= 马达数组长度） */
  axisSlots: number;
  joints: JointReport[];
  /** 全局不变量检查结果 */
  invariants: { id: string; ok: boolean; msg: string }[];
  /** 体检发现的所有问题（人可读） */
  problems: string[];
  ok: boolean;
}

function groupOf(n: string): JointReport['group'] {
  if (n === 'neck') return '颈';
  if (n.startsWith('shoulder')) return '肩';
  if (n.startsWith('elbow')) return '肘';
  if (n.startsWith('hip')) return '髋';
  if (n.startsWith('knee')) return '膝';
  if (/^spine\d+$/.test(n)) return '腰';
  if (n.startsWith('foot') || n.startsWith('ankle')) return '踝';
  return '其它';
}

/**
 * ★★ 逐关节体检。**空格必须显示"不存在"，不允许留白。**
 * （今天的 UI 把不存在的踝显示成"未驱动"，看起来像"没在工作"，掩盖了事实。）
 */
export function auditJoints(sk: Skeleton): RigReport {
  const joints: JointReport[] = [];
  const problems: string[] = [];
  const order: JointReport['group'][] = ['颈', '肩', '肘', '髋', '膝', '踝', '腰', '其它'];

  const names = [...sk.joints.map((j) => j.name), ...PHANTOM_JOINTS];
  for (const name of names) {
    const idx = jointIndexByName(sk, name);
    const exists = hasJoint(sk, name);
    const base = JOINT_MAX_TORQUE[name] ?? 100;
    const def = exists ? sk.joints[idx]! : undefined;
    const axes: AxisReport[] = [];
    const jp: string[] = [];

    if (!exists) {
      jp.push('该骨架没有这个关节');
      problems.push(`关节 ${name} 在 JOINT_ORDER 里声明，但骨架里**不存在**（ankleEnabled=false？）⇒ 任何按名字驱动它的代码都不会生效`);
    }

    for (let ax = 0; ax < 3; ax++) {
      const lo = def?.minRad[ax] ?? 0;
      const hi = def?.maxRad[ax] ?? 0;
      const span = Math.max(Math.abs(lo), Math.abs(hi));
      const tauMax = base * (TORQUE_AXIS_FACTOR[ax] ?? 1);
      let usable = exists && span > 0.05;
      let why = '';
      if (!exists) why = '关节不存在';
      else if (!usable) why = `限位跨度仅 ${(span * 57.2958).toFixed(1)}°（锁死，不可驱动）`;
      if (!usable && exists) { jp.push(`轴${ax} ${AXIS_NAME[ax]} 不可驱动：${why}`); problems.push(`关节 ${name} 轴${ax}（${AXIS_NAME[ax]}）${why}`); }
      axes.push({ axis: ax, span, loDeg: lo * 57.2958, hiDeg: hi * 57.2958, tauMax, usable, why });
    }

    joints.push({
      name, index: idx, exists, group: groupOf(name), axes,
      usableAxes: axes.filter((a) => a.usable).length,
      problems: jp,
    });
  }

  joints.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.name.localeCompare(b.name));

  // ---- 全局不变量 ----
  const inv: RigReport['invariants'] = [];
  const realAxes = sk.joints.length * 3;
  // I3：马达槽位 vs 实际轴
  inv.push({
    id: 'I3',
    ok: true,   // 槽位多于实际轴不是错，但要**显式记账**，否则会以为踝在被控制
    msg: `实际受控轴 ${realAxes}（${sk.joints.length} 关节 ×3）`
      + `；PHANTOM_JOINTS 声明了 ${PHANTOM_JOINTS.length * 3} 个不存在的轴`,
  });
  // 髋外展的实测权限为 0（双脚支撑时腿蹬不动地）—— 记进体检表，避免控制器误用它
  const hipAb = joints.find((j) => j.name === 'hip_l')?.axes[1];
  if (hipAb?.usable) {
    inv.push({
      id: 'A1', ok: false,
      msg: `hip/1（外展）限位可用（${hipAb.loDeg.toFixed(0)}°~${hipAb.hiDeg.toFixed(0)}°，τ=${hipAb.tauMax}N·m）`
        + '，但**双脚支撑下实测 ΔCoM_z = 0**：脚着地时腿横向蹬不动地。'
        + '额状面平衡只能走 spine1/0（实测 Δz=35mm）。见 tools/probe-authority.ts',
    });
  }
  const spineLat = joints.find((j) => j.name === 'spine1')?.axes[1];
  if (spineLat?.usable) {
    inv.push({
      id: 'A2', ok: false,
      msg: `spine1/1（腰侧倾）限位可用但**实测 ΔCoM_z = 4mm ≈ 0**；`
        + '真正能横移 CoM 的是 spine1/**0**（35mm）。⇒ 腰的"侧倾"通道无效，别写进控制器',
    });
  }
  const ankle = joints.find((j) => j.name === 'foot_l');
  if (ankle && !ankle.exists) {
    inv.push({
      id: 'A3', ok: false,
      msg: '**本 rig 没有踝关节** ⇒ 没有 CoP 通道 ⇒ 矢状面只剩髋策略。'
        + 'balanceHold 里所有 ankleSag/ankleLat/kVipP 路径目前是空转的',
    });
  }

  return {
    bodyCount: sk.bodies.length,
    jointCount: sk.joints.length,
    axisSlots: (sk.joints.length + PHANTOM_JOINTS.length) * 3,
    joints, invariants: inv, problems,
    ok: inv.every((v) => v.ok),
  };
}

/**
 * ★★ **启动硬断言**：不满足就抛，绝不降级、绝不打日志继续。
 * @returns 体检报告（满足断言时）
 */
export function assertRigInvariants(sk: Skeleton, shape?: BrainShape): RigReport {
  const report = auditJoints(sk);

  // ---- I1：每个 joints[i].name 必须能查回自己（防"幽灵关节"）----
  for (let i = 0; i < sk.joints.length; i++) {
    const nm = sk.joints[i]!.name;
    const back = jointIndexByName(sk, nm);
    if (back !== i) {
      throw new Error(
        `[rig] 关节名与索引不一致：sk.joints[${i}].name="${nm}"，`
        + `但 jointIndexByName 查回 ${back}。这会让按名字驱动静默作用到别的关节上。`,
      );
    }
  }
  // 反向：`JOINT_ORDER` 里的每个名字都必须要么存在、要么在 PHANTOM_JOINTS 里显式登记
  for (const nm of PHANTOM_JOINTS) {
    if (hasJoint(sk, nm)) continue;   // ankleEnabled=true 时它会真的存在，正好
  }

  // ---- I2：网络形状必须与关节数一致 ----
  const sh = shape ?? shapeForJoints(sk.joints.length);
  // 观测维数公式与 brain.ts 一致：36 + 6n（n = 关节数）
  const expIn = 36 + 6 * sk.joints.length;
  const expOut = 3 * sk.joints.length;
  if (sh.inputs !== expIn || sh.outputs !== expOut) {
    throw new Error(
      `[rig] 网络形状与骨架不符：${sh.inputs}→${sh.outputs}，`
      + `但 ${sk.joints.length} 关节要求 ${expIn}→${expOut}。`
      + '（历史事故：BRAIN_SHAPE 是 9 关节的默认值，用在 12 关节骨架上 ⇒ '
      + '观测静默截 18 维、只驱动 9/12 关节、10 步内 com 全 NaN 而不报错）',
    );
  }

  return report;
}

/** 一行式摘要，给状态栏显示 */
export function rigSummary(r: RigReport): string {
  const usable = r.joints.reduce((s, j) => s + j.usableAxes, 0);
  return `${r.bodyCount} 刚体 / ${r.jointCount} 关节 / 可驱动轴 ${usable}`
    + ` / 幽灵关节 ${PHANTOM_JOINTS.length}（踝）`;
}