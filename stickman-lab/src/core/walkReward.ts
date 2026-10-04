// walkReward —— 走路奖励的**唯一**真源：11 项，全部对应经典配方里的某一项。
//
// ★ 为什么推倒重来（用户 2026-10-01："整个奖励机制是不是乱成一锅粥了"）：
//   旧版一个 total 里塞了 30 个手调权重 + 21 个记账器 + 23 个步态旋钮，
//   而且"换脚/站稳/抢步"和"逐关节程序"两套系统互相耦合（前进奖励的门 = 旧状态机
//   打开的 holdWindow），改 A 影响 B、无法预测组合结果。
//   现在：**一个函数、一张表、一个标量**，每一项都能说出它对应哪篇文献的哪一项。
//
// ★ 主干来自 Rudin, Hoeller, Reist, Hutter, CoRL 2022（"Learning to Walk in Minutes
//   Using Massively Parallel Deep RL"，ANYmal；后被 Cassie 双足复用）。原文明确写了
//   "neither the reward function nor the action space has any gait-dependent elements"
//   —— 没有步态时钟、没有相位、没有换脚检测；**交替步态是"足端腾空时间"这一项
//   自己长出来的**。他们换到双足 Cassie 时必须**额外加一项"鼓励单脚支撑"**才走出
//   走路步态 —— 这就是"一次抬一条"的正式版本，本文件的 `single` 就是它。
//
// 目标速度固定 0.5 m/s（用户 2026-10-01 定的），角速度目标 0。

/** Rudin 的核函数：φ(x) = exp(−x²/0.25)，即"误差 0.5 以内都还有明显梯度" */
export function phi(err: number): number {
  return Math.exp(-(err * err) / 0.25);
}

/**
 * ══════════════════════════════════════════════════════════════════
 * 📌 **原 `WALK_TERMS` 规格表已删除**（本轮审计清掉）
 * ══════════════════════════════════════════════════════════════════
 *
 * 它列了 11 项奖励的 key / weight / sign / 文献出处，看上去是奖励的**真源**，
 * 但 `sim.ts` 的实现**根本不用它** —— 实现读的是 `STAND_W`（`sim.ts:81`）
 * 与 `SimConfig.w`，逐项硬写。两边的权重**早已不一致**：
 *
 *     项          WALK_TERMS     实际实现（STAND_W / 实现注释）
 *     lateral        4.0    vs      6.0
 *     upright        0.5    vs      0.8
 *     height         0.8    vs      1.2
 *     yawTrack       0.5    vs     「默认权重 0」
 *
 * ⇒ 这是一张**过期且误导**的表：照它调权重不会有任何效果。
 *   这正是"同一决策写两遍"的典型危害 —— 本轮已因此出了三次实测故障。
 *
 * ✅ **文献出处保留在这里**（原本只存在于这张死表里，直接删会丢）：
 *
 *   · `velTrack`   φ(v*−v_x)，v*=0.5 m/s —— Rudin 线性速度跟踪，
 *                  **唯一说"往哪儿走"的一项**（替代旧的 distance/step/step2）
 *   · `yawTrack`   φ(ω*−ω_y)，ω*=0 —— Rudin 角速度跟踪（不许自转）
 *   · `lateral`    −v_z² —— Rudin 侧向速度罚（任务沿 +X，横向漂移直接罚）
 *   · `tiltRate`   −(ω_x²+ω_z²) —— Rudin 角速度罚（不许翻滚/俯仰）
 *   · `lift`       Σ_脚 min(1, 腾空时间/目标腾空时间)·dt —— 改造版 Rudin feet
 *                  air time。**抬腿项**，站桩得 0。原式 Σ(t_air−0.5) 在双足下会
 *                  退化成"两脚一起飞"（跳），故改成饱和形式。
 *   · `single`     恰好一脚着地的时间积分 —— **主项**，本模式存在理由是"金鸡独立"
 *   · `jointMove`  骨盆与膝要动（用户硬需求）
 *   · `upright`    −(躯干倾角²)·dt，别弯腰驼背
 *   · `height`     −(身高 − y)²·dt，别塌下去
 *   · `jointMotion` −Σ(ċ_j)²·dt，关节别乱抖
 *   · `torque`     −Στ_j²·dt，省力
 *   · `actRate`    −Σ|Δq*_j|²·dt —— Rudin action rate，电机指令别阶跃。
 *                  **替代旧的 accSmooth**；旧版符号写反过一次，"疯狂抽风"反而
 *                  加分，把总分顶到 800~1400。
 *
 * 要改奖励，请改 `sim.ts` 里真正被读的那份（`STAND_W` / `SimConfig.w`）。
 */

/** 抬腿项的目标腾空时间（秒）。0.5 s @ 1.5 步频 ≈ 一次完整摆动。 */
export const AIR_TARGET = 0.5;
/** 逐关节"要动"的目标角速度（rad/s）。实测能走的步态：髋 ~0.6、膝 ~0.9。 */
export const JOINT_MOVE_TARGET = 1.0;
/** 固定目标前进速度（m/s），用户 2026-10-01 定 */
export const TARGET_VX = 0.5;

/** 要"鼓励移动"的关节（其余关节只吃 jointMotion 罚） */
export const MOVE_JOINTS: readonly string[] = ['hip_l', 'hip_r', 'knee_l', 'knee_r'];
