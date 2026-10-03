/**
 * ══════════════════════════════════════════════════════════════════
 * ④  systems/balance.ts —— **平衡维持系统**（重构版）
 *     作用对象：一条支撑腿 + 腰
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数 + 无状态。输入来自 `rigState`（唯一真源），输出是**对 rigState 的需求**，
 * 不直接设 target。合并由 `rigState.arbitrate()` 负责。
 *
 * ── ⚠⚠ 本 rig 的通道权限（`tools/probe-authority.ts` 实测，1 s 开环恒定目标角）
 *   **没有踝关节**（`ankleEnabled=false`）⇒ **没有 CoP 通道**。
 *     矢状面 ΔCoM_x：hip/2 = 363 mm（强）、spine1/2 = 98 mm、knee/2 = 55 mm、肩 = 66 mm
 *     额状面 ΔCoM_z：**只有 spine1/0 = 35 mm**；hip/1（外展）= **0**
 *   ⇒ 矢状面走**髋策略**；额状面只能走**躯干**。
 *   ⇒ **本文件不写踝**。写了也是空转，而且会掩盖"额状面没通道"这个事实。
 *
 *   为什么 hip/1 外展在双脚支撑下 Δz = 0：脚着地时腿横向蹬不动地。
 *   单支撑时摆动腿变成配重，髋外展才可能有权限 —— 但那条腿归迈步系统管，本文件不越界。
 *
 * ── 文献 ────────────────────────────────────────────────────
 *   · 矢状面髋策略：Morasso, Front Comput Neurosci 2022，K_crit = m·g·h，
 *     踝欠临界时由髋（>K_crit 被动刚度）接管。
 *   · 额状面：Liu, J Biomech 2012（髋外展由踝内/外翻平衡；本 rig 无踝 ⇒ 只剩躯干）；
 *     Herr, J Exp Biol 2008：全身角动量靠段间抵消，额状 ~95%、矢状 ~70%。
 *   · 优先级栈：Focchi, Front Robot AI 2020 —— Contact(1) → **Trunk(2)** → Posture(3)。
 *   · 膝近似刚性：Li & Levine, ICRA 2010（小扰动下膝角近似恒定）。
 *   · 单腿保持目标余量：MoS 侧向 −0.025 m、捕获点出域 0.09 s/3.3 s（arXiv:2608.00500）。
 */

import { jointIndexByName } from '../skeleton';
import type { RigState, Side } from '../rigState';

export interface BalanceParams {
  /** 矢状面：髋策略比例增益（rad/s per m） */
  kSagP: number;
  /** 矢状面：髋策略阻尼。★ 实测纯 P 已足够，加 D 会共振 */
  kSagD: number;
  /** 矢状面：躯干对齐 GRF 力线的增益 */
  kTorsoAlign: number;
  /** 额状面：躯干（唯一通道 spine1/0）比例增益 */
  kLatP: number;
  kLatD: number;
  /** 膝锁定目标屈角（deg）。文献：单腿站立标准姿势带轻微屈膝 */
  kneeHoldDeg: number;
  kKnee: number;
  kHipUpright: number;
  maxHip: number;
  maxKnee: number;
  maxTorso: number;
}

export const DEFAULT_BALANCE_PARAMS: BalanceParams = {
  kSagP: 2.2,
  kSagD: 0.0,
  kTorsoAlign: 1.0,
  kLatP: 6.0,
  kLatD: 0.0,
  kneeHoldDeg: 15,
  kKnee: 2.0,
  kHipUpright: 0.8,
  maxHip: 0.52,
  maxKnee: 0.35,
  maxTorso: 0.14,
};

/**
 * ★ 平衡维持系统。**并发**每拍跑一次，只提需求。
 * @param rs 唯一状态（读判据/读数，写需求）
 */
export function balanceSystem(rs: RigState, p: BalanceParams = DEFAULT_BALANCE_PARAMS): void {
  const sk = rs.sk;
  const sup: Side = rs.supportLeg();
  const jHip = jointIndexByName(sk, sup === 'l' ? 'hip_l' : 'hip_r');
  const jKnee = jointIndexByName(sk, sup === 'l' ? 'knee_l' : 'knee_r');
  const jSp1 = jointIndexByName(sk, 'spine1');
  const jSp2 = jointIndexByName(sk, 'spine2');
  // ★ 不静默失败：这几个关节由 rig.ts 的启动断言保证存在
  if (jHip < 0 || jKnee < 0 || jSp1 < 0) {
    rs.request(-1, 0, 0, 'balance', '骨架缺支撑腿/腰关节');
    return;
  }

  const clamp = (v: number, m: number): number => (v > m ? m : v < -m ? -m : v);
  const D2R = Math.PI / 180;

  // ══════════════════════════════════════════════════════════════
  // ① 矢状面：髋策略。x_com > 0 ⇒ 髋伸，把躯干往回拉。
  // ══════════════════════════════════════════════════════════════
  // ★ 命令的是**目标角**（不是 PD 输出）——`requestAngle` 内部按该轴量程归一化。
  //   髋：偏前 ⇒ 往髋伸方向顶（把躯干拉回支撑脚上方）
  const ex = rs.com.x;
  let hipTgt = -p.kSagP * ex - p.kSagD * rs.com.vx;
  hipTgt = clamp(hipTgt, p.maxHip);
  rs.requestAngle(jHip, 2, hipTgt, 'balance', '髋策略');

  // ══════════════════════════════════════════════════════════════
  // ② 膝：锁在轻微屈曲。⚠ 本 rig 膝限位 [-145°, +2°] ⇒ **负 = 屈**
  // ══════════════════════════════════════════════════════════════
  // 膝：直接命令到轻微屈曲的**目标角**。kKnee 现在是"偏离目标时往回顶的比例"
  const kneeNow = rs.angle(jKnee, 2);
  const kneeTgt = -Math.abs(p.kneeHoldDeg) * D2R;
  rs.requestAngle(jKnee, 2, kneeTgt + (kneeNow - kneeTgt) * (1 - p.kKnee), 'balance', '膝锁定');

  // ══════════════════════════════════════════════════════════════
  // ③ 躯干姿态（平衡维持独占，优先级 1）
  //   ③a 对齐 GRF 力线 ⇒ 髋的力臂归零，不必扛全部屈曲力矩
  // ══════════════════════════════════════════════════════════════
  const grfAng = Math.atan2(rs.grf.x, Math.max(0.2, rs.grf.y));
  const sp1Sag = clamp(-grfAng * p.kTorsoAlign - ex * 0.8, p.maxTorso);
  rs.requestAngle(jSp1, 2, sp1Sag, 'balance', '躯干力线');

  // ══════════════════════════════════════════════════════════════
  // ④ 额状面：**唯一通道 spine1/0**（实测 Δz = 35 mm；髋外展 = 0）
  //   z_com > 支撑域中心 ⇒ 躯干往支撑脚侧倾，把重心搬回来
  // ══════════════════════════════════════════════════════════════
  const ez = rs.com.z - rs.support.cz;
  const lat = clamp(-(p.kLatP * ez + p.kLatD * rs.com.vz), p.maxTorso);
  rs.requestAngle(jSp1, 0, lat, 'balance', '躯干额状');

  // ══════════════════════════════════════════════════════════════
  // ⑤ 腰上段：只跟下段走一小段，避免"折腰"全堆在 spine1
  // ══════════════════════════════════════════════════════════════
  if (jSp2 >= 0) rs.requestAngle(jSp2, 2, clamp(sp1Sag * 0.4, p.maxTorso * 0.6), 'balance', '腰上段');
}