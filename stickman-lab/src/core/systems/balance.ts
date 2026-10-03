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
  /**
   * 膝的**屈曲限位**（deg）—— 超过就顶回来。
   * ★ 不是目标角：站立时膝角近似恒定（Li & Levine 2010），零输出时 PD 已保持绑定角。
   *   实测把它当目标用 ⇒ 只留膝这一条就把存活从"站满 8s"打成 2.6s。
   */
  kneeHoldDeg: number;
  kKnee: number;
  kHipUpright: number;
  maxHip: number;
  maxKnee: number;
  maxTorso: number;
  // ── 踝（CoP 策略）─────────────────────────────────────────
  /** 矢状面：踝 CoP 比例增益（rad per m）。目标量是**捕获点**，不是躯干角 */
  kCopSag: number;
  kCopSagD: number;
  /** 额状面：踝内/外翻的 CoP 增益（实测权限很弱，只作微调） */
  kCopLat: number;
  /** 蹬离（PUSH 相）跖屈幅度（deg）—— 前 Neurorob 2022 预摆动跖屈 17.2° */
  pushDeg: number;
  maxAnkleSag: number;
  maxAnkleLat: number;
  /**
   * ★ 通道消融（诊断用）：要**关掉**的通道名逗号分隔。
   *   空 = 全开。`probe-balsweep` 用它回答"是哪一条在 destabilize"。
   *   ⚠ 关掉之后其余通道照旧，所以这是"逐条摘除"而不是"单条测试"。
   */
  ablate?: string;
}

export const DEFAULT_BALANCE_PARAMS: BalanceParams = {
  kSagP: 2.2,
  kSagD: 0.0,
  kTorsoAlign: 1.0,
  // ★★ 默认 0：横向回路目前**不稳定**。实测 kLatP = ±0.6 / ±1.2 全部发散
  //   （com.z → −528 / +814 mm，ξz 峰 −790 / +1065 mm），且**正负号结果与支撑腿是哪条无关**
  //   ⇒ 这个回路既没稳定、也没在跟踪"支撑脚"。
  //   根因：额状面只有 spine1/0 一个通道，实测权限仅 **35 mm**（见 probe-authority），
  //   而单腿站立要把重心横移约 **100 mm**（半个站距）⇒ 需求是权限的 3 倍。
  //   ⇒ 先置 0（等价于不主动横移），等摆动腿配重方案落地再开。
  kLatP: 0.0,
  kLatD: 0.0,
  kneeHoldDeg: 15,
  kKnee: 0.6,
  kHipUpright: 0.8,
  maxHip: 0.52,
  maxKnee: 0.35,
  maxTorso: 0.14,
  // ★ 符号由实测定（tools/probe-authority.ts，ANKLE=1）：
  //   foot_l/2 目标角 +7.2° ⇒ ΔCoM_x = +22 mm
  //   ⇒ **正角（跖屈，脚尖下压）把 CoP / CoM 往前推**
  //   LIPM：CoP 在 CoM **前方** ⇒ 力矩把 CoM 往**后**拉
  //   ⇒ 要把 ξ 拉回 0（ζ 超前）就要 CoP 前移 ⇒ 踝角 = +k·ξ
  // 闭环在 CoP 上：单位是 m/m = 无量纲 ⇒ 增益就是"角度/误差"
  kCopSag: 6,
  kCopSagD: 0.0,
  kCopLat: 2.0,
  pushDeg: 12,
  maxAnkleSag: 0.20,
  maxAnkleLat: 0.12,
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
  // ★ 踝（`ankleEnabled=false` 时 jointIndexByName 返回 -1 ⇒ 自然跳过，不静默假装在控制）
  const jAnk = jointIndexByName(sk, sup === 'l' ? 'foot_l' : 'foot_r');
  // ★ 不静默失败：这几个关节由 rig.ts 的启动断言保证存在
  if (jHip < 0 || jKnee < 0 || jSp1 < 0) {
    rs.request(-1, 0, 0, 'balance', '骨架缺支撑腿/腰关节');
    return;
  }

  const clamp = (v: number, m: number): number => (v > m ? m : v < -m ? -m : v);
  const D2R = Math.PI / 180;
  const OFF = new Set((p.ablate ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  const on = (ch: string): boolean => !OFF.has(ch);

  // ══════════════════════════════════════════════════════════════
  // ① 矢状面：髋策略。x_com > 0 ⇒ 髋伸，把躯干往回拉。
  // ══════════════════════════════════════════════════════════════
  // ★ 命令的是**目标角**（不是 PD 输出）——`requestAngle` 内部按该轴量程归一化。
  //   髋：偏前 ⇒ 往髋伸方向顶（把躯干拉回支撑脚上方）
  const ex = rs.com.x;
  let hipTgt = -p.kSagP * ex - p.kSagD * rs.com.vx;
  hipTgt = clamp(hipTgt, p.maxHip);
  if (on('hip')) rs.requestAngle(jHip, 2, hipTgt, 'balance', '髋策略');

  // ══════════════════════════════════════════════════════════════
  // ② 膝：锁在轻微屈曲。⚠ 本 rig 膝限位 [-145°, +2°] ⇒ **负 = 屈**
  // ══════════════════════════════════════════════════════════════
  // 膝：直接命令到轻微屈曲的**目标角**。kKnee 现在是"偏离目标时往回顶的比例"
  //   ⚠⚠ **膝是单侧守卫，不是"驱向屈曲目标"**（消融实测：只留膝 ⇒ 2.6s 倒；
  //      零输出/只留髋/只留躯干 ⇒ 站满 8s、倾角 0.5°）。
  //   Li & Levine 2010：站立时"膝角近似恒定"；股四头肌**共同收缩**提供腿部刚性
  //   ——那是**刚度**，不是目标角。
  //   而零输出时关节 PD 已经把膝保持在绑定角（本 rig ≈0°），**本来就不需要管**。
  //   ⇒ 只需在**超过屈曲限位**时顶回来，绝不主动命令弯曲。
  const kneeNow = rs.angle(jKnee, 2);
  const kneeLimit = -Math.abs(p.kneeHoldDeg) * D2R;
  if (on('knee') && kneeNow < kneeLimit) {
    // 越过了限位 ⇒ 顶回限位（kk 决定顶多硬）
    const kk = Math.max(0, Math.min(1, p.kKnee));
    rs.requestAngle(jKnee, 2, kneeLimit + (kneeNow - kneeLimit) * (1 - kk), 'balance', '膝守卫');
  }

  // ══════════════════════════════════════════════════════════════
  // ③ 躯干姿态（平衡维持独占，优先级 1）
  //   ③a 对齐 GRF 力线 ⇒ 髋的力臂归零，不必扛全部屈曲力矩
  // ══════════════════════════════════════════════════════════════
  const grfAng = Math.atan2(rs.grf.x, Math.max(0.2, rs.grf.y));
  const sp1Sag = clamp(-grfAng * p.kTorsoAlign - ex * 0.8, p.maxTorso);
  if (on('torso')) rs.requestAngle(jSp1, 2, sp1Sag, 'balance', '躯干力线');

  // ══════════════════════════════════════════════════════════════
  // ④ 额状面：**唯一通道 spine1/0**（实测 Δz = 35 mm；髋外展 = 0）
  //   z_com > 支撑域中心 ⇒ 躯干往支撑脚侧倾，把重心搬回来
  // ══════════════════════════════════════════════════════════════
  // ★★ 横向目标必须是**支撑脚自己**，不是支撑域中心。
  //   两只脚在 Z 向分开（z ≈ ±0.10），所以**左右载荷分配由 CoM.z 决定**。
  //   `support.cz` 是两脚中点（≈0）⇒ 用它当目标时 com.z≈0.003 ⇒ **一条指令都不发**
  //   ⇒ 载荷永远 50/50 ⇒ B2 永不达标 ⇒ 迈步许可 P1 永远 false ⇒ 摆动腿抬不起来
  //   （实测：单腿站满 6s、单支撑占比 0.0%、摆动脚离地 0mm）。
  //   单腿站立要的正是"把重心横移到**支撑脚**上"，目标取支撑脚。
  const stanceZ = sup === 'l' ? rs.soleZ.l : rs.soleZ.r;
  const ez = rs.com.z - stanceZ;
  const lat = clamp(-(p.kLatP * ez + p.kLatD * rs.com.vz), p.maxTorso);
  if (on('lat')) rs.requestAngle(jSp1, 0, lat, 'balance', '躯干额状');

  // ══════════════════════════════════════════════════════════════
  // ⑤ 腰上段：只跟下段走一小段，避免"折腰"全堆在 spine1
  // ══════════════════════════════════════════════════════════════
  if (jSp2 >= 0 && on('torso')) rs.requestAngle(jSp2, 2, clamp(sp1Sag * 0.4, p.maxTorso * 0.6), 'balance', '腰上段');

  // ══════════════════════════════════════════════════════════════
  // ⑥ ★★★ **踝：CoP 策略 —— 整条力链的起点**（用户 2026-10-03：
  //        「力是自下往上传导的」「脚踝关节应该写的，足部还要学会发力」）
  //
  //   力链：地面反力(足底某点) → 踝力矩 τ=F_z×(CoP−踝) → 膝 → 髋 → 骨盆 → 脊柱 → 躯干
  //
  //   这里用的是 **LIPM 捕获点**（Hof 2005 / Prince 1994）：
  //       ξ = x_com + ẋ_com/ω        CoP 放在 ξ 处 ⇒ CoM 恰好停住
  //   符号（实测）：正踝角（跖屈）⇒ CoP 前移 ⇒ CoM 被往**后**拉 ⇒ 用来消 ξ。
  // ══════════════════════════════════════════════════════════════
  if (jAnk >= 0) {
    // ★★★ **CoP 直接调节器**（不是"猜符号的踝角 PD"）
    //
    //   实测（tools/probe-copauth）：刚性/柔性足上 **正踝角 ⇒ CoP 后移**（−5.2mm @ +12°）。
    //   机理：平底绕踝转 ⇒ 脚尖离地、脚跟吃重 ⇒ 接触形心自然后退。
    //   ⇒ 要让 CoP **前移**必须给**负**角。所以：
    //
    //       目标：CoP → 捕获点 ξ（放 ξ 处 ⇒ CoM 恰好停住，Hof 2005）
    //       律：  θ_ref = −k · (ξ − CoP_实测) − kd·(CoP 移动速度)
    //
    //   ★ 为什么必须闭环在 CoP 上而不是"角度 PD"：
    //     角度 PD 在平衡点自然停下（实测只出 1 N·m ⇒ CoP 只移 1.5mm），
    //     而 CoP 是**力**的直接读数，闭环在它上面才既有的放矢又不用猜符号。
    const cop = rs.cop[sup];
    const copErr = rs.dcm.x - cop.x;
    let ankSag = -p.kCopSag * copErr - p.kCopSagD * rs.com.vx;
    // 蹬离相：跖屈把地面反力斜向前 ⇒ 这是**前进的唯一来源**
    if (rs.phase === 'PUSH') ankSag += Math.abs(p.pushDeg) * D2R;
    // ★ 斜率限制：踝有力矩了（护栏修好后权限 1.0），必须限速否则一帧砸下去
    ankSag = clamp(ankSag, p.maxAnkleSag);
    rs.requestAngle(jAnk, 2, ankSag, 'balance', '踝CoP调节');

    // 额状面同样闭环在实测 CoP 上（目标 = 侧向捕获点）
    const latErr = rs.dcm.z - cop.z;
    rs.requestAngle(jAnk, 0, clamp(p.kCopLat * latErr, p.maxAnkleLat), 'balance', '踝额状CoP');
  }
}