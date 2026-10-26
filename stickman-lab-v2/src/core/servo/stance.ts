/**
 * stance.ts —— 蹲姿侧向安全区（**动态、零标定**的纯观测器）
 *
 *  用户（2026-10-26）：『安全区**动态计算**，随动作变』『我们只做的蹲姿伺服啊』
 *  ⇒ 只算**侧向一个标量**，只服务蹲姿回正力；矢状面不动（基础力够用）。
 *
 *  为什么不需要标定任何"速率"：
 *    净 CoP 的侧向位置有一条**恒等式**（力矩平衡，不是近似）：
 *
 *        z_p = (fz_L·z_L + fz_R·z_R)/W  +  (τ_L + τ_R)/W
 *              └──── 载荷加权脚心 ────┘     └── 踝 roll 直接给的 ──┘
 *
 *    ② 项里 τ 的上限**当场可算**：`min(τmax, fz_side·半脚宽)` ——
 *      后一项就是"CoP 不能跑到鞋底外面"，是几何硬约束。
 *    于是"当前这一瞬间还能把 CoP 往侧向推多远"= `r = Σ(上限 − 已用)/W`，
 *    **全部来自实测值**（fz、已用力矩、力矩上限、脚宽），没有任何需要标定的常数。
 *
 *  代价（必须写清楚）：这是**瞬时可达**口径，**故意保守**。
 *    它**不包含**"靠差动卸载把 CoP 摊到整个支撑面"那部分（实测 ±0.070 → ±0.266 的差额），
 *    因为那需要"卸载速率 ρ"这个额外量。宁可低估：低估只会让回正力更早介入，
 *    高估会让它以为还救得回来（现在 `fall=3.98s` 就是这么来的）。
 *    以后若确认太保守（表现为长期贴在边界上），再按 4.2.3 ② 把 ρ 项加回来。
 *
 *  文献：Hof 2005（XCoM / 时间裕度 τ）· Patton 1999（CoP 安全裕度与力矩余量高度相关）
 *        · HULK 2026 arXiv:2610.08970（安全函数 h = 到可行域的距离，当 CBF 用）。
 *
 *  ★ 本模块**不 propose、不写任何寄存器**，纯读。加进来物理逐位不变（指纹可证）。
 */

import type { World } from '../world';
import type { ControlModule } from '../control';

const G = 9.81;
/** 半脚宽（m）—— CoP 不能越过鞋底边缘。来源：`supportClean` 的 `fw=0.045`（半个支撑面）。 */
const FOOT_HALF_W = Number(
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.STANCE_FOOT_HALF_W ?? 0.045,
);

export interface StanceObs {
  /** √(g/z_c)，随蹲深实时变 */
  omega: number;
  /** 侧向 DCM（Hof 的 XCoM），世界 z */
  xiZ: number;
  /** 实测净 CoP 侧向（按 fz 加权） */
  zCop: number;
  /** 零踝力矩时的净 CoP（= 载荷加权脚心） */
  zCop0: number;
  /** 侧向还能推多远（m）：Σ(力矩上限 − 已用)/W */
  reach: number;
  /** 安全函数 h = reach − |ξ_z − zCop0|。h ≤ 0 ⇒ 已经出可达域 */
  h: number;
  /** Hof 时间裕度（s）；出界或方向相反时给 +Inf / 0 */
  tauMargin: number;
  /** 两脚 roll 通道的剩余力矩合计（N·m），证据用 */
  tauRemain: number;
}

const INF = Number.POSITIVE_INFINITY;

/**
 * 读一帧的侧向安全区。**纯函数**：不写任何东西，可以每帧随便调。
 * 必须在 `world.advance()`（= `executor.applyAll`）之后调用，这样才能读到本步真正下发的力矩。
 */
export function stanceObserve(w: World, ctl: ControlModule): StanceObs {
  const sen = ctl.sensors;
  const body = w.body;
  const W = Math.max(1, w.sk.massTotal * G);

  const zc = Math.max(0.3, sen.com[1]!);
  const omega = Math.sqrt(G / zc);
  const xiZ = sen.com[2]! + sen.comVel[2]! / omega;

  const fl = sen.feet[0]!;   // l
  const fr = sen.feet[1]!;   // r
  const sumFz = fl.fz + fr.fz;

  // ① 实测净 CoP（fz 加权）；没有接触就用 CoM 投影兜底
  const zCop = sumFz > 1 ? (fl.fz * fl.copZ + fr.fz * fr.copZ) / sumFz : sen.com[2]!;
  // ② 零踝力矩时的净 CoP = 载荷加权脚心
  const zCop0 = sumFz > 1 ? (fl.fz * fl.z + fr.fz * fr.z) / sumFz : sen.com[2]!;

  // ③ 两脚 roll 通道剩余力矩：上限 = min(τmax, fz·半脚宽)，再减掉已经用掉的
  const led = w.executor.ledger;
  let tauRemain = 0;
  for (const [side, foot] of [['l', fl] as const, ['r', fr] as const]) {
    const di = body.dofByName(`foot_${side}`, 0);
    if (di < 0) continue;
    const d = body.dofs[di]!;
    const used = Math.abs(led[di]?.applied ?? 0);
    // 几何上限：脚上的垂直力 × 半脚宽（CoP 不能出鞋底）；再与执行器上限取小
    const budget = Math.min(d.tauMax, Math.max(0, foot.fz) * FOOT_HALF_W);
    tauRemain += Math.max(0, budget - used);
  }
  const reach = tauRemain / W;

  // ④ 安全函数：从"零力矩 CoP"往目标方向还剩多远
  const h = reach - Math.abs(xiZ - zCop0);

  // ⑤ Hof 时间裕度：ξ̇ = ω(ξ − p)，边界 b = zCop0 ± reach
  const dir = xiZ >= zCop0 ? 1 : -1;
  const b = zCop0 + dir * reach;
  const den = xiZ - zCop;
  let tauMargin: number;
  if (Math.sign(b - zCop) !== Math.sign(den) || Math.abs(den) < 1e-9) {
    // 边界与 CoP 在 ξ 的两侧 ⇒ 判据退化（不收敛方向），给保守值
    tauMargin = Math.abs(xiZ - zCop0) <= reach ? INF : 0;
  } else {
    tauMargin = Math.max(0, Math.log((b - zCop) / den) / omega);
  }

  return { omega, xiZ, zCop, zCop0, reach, h, tauMargin, tauRemain };
}
