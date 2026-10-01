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

/** 奖励项定义（名字 = 分项键 = UI 滑块 id 的来源） */
export interface WalkTerm {
  key: string;
  /** 单位时间权重（乘 dt 积分，量纲 = 分/秒） */
  weight: number;
  /** 方向：+1 加分项、-1 罚项 */
  sign: 1 | -1;
  doc: string;
  /** 对应文献/设计决定 */
  from: string;
}

/**
 * ★ 11 项。前 9 项直接对应 Rudin 的 9 项（顺序也按他的表），
 *   后两项是本项目的硬需求（"骨盆和膝盖要动"）。
 */
export const WALK_TERMS: readonly WalkTerm[] = [
  { key: 'velTrack', weight: 1.0, sign: 1, from: 'Rudin 线性速度跟踪',
    doc: 'φ(v*−v_x)，v*=0.5 m/s。**唯一说"往哪儿走"的一项**，替代旧的 distance/step/step2。' },
  { key: 'yawTrack', weight: 0.5, sign: 1, from: 'Rudin 角速度跟踪',
    doc: 'φ(ω*−ω_y)，ω*=0（不许自转）。' },
  { key: 'lateral', weight: 4.0, sign: -1, from: 'Rudin 侧向速度罚',
    doc: '−v_z²。任务沿 +X，横向漂移直接罚。' },
  { key: 'tiltRate', weight: 0.05, sign: -1, from: 'Rudin 角速度罚',
    doc: '−(ω_x²+ω_z²)：不许翻滚/俯仰。' },
  { key: 'lift', weight: 1.0, sign: 1, from: '★ Rudin feet air time（改造版）',
    doc: 'Σ_脚 min(1, 腾空时间/目标腾空时间)·dt。**抬腿项**：站桩得 0。'
      + 'Rudin 原式是 Σ(t_air−0.5)，双足会退化成"两脚一起飞"（跳），所以这里改成饱和形式，'
      + '再用下面的 single 挡住"两脚同时离地"。' },
  { key: 'single', weight: 1.5, sign: 1, from: '★ Rudin 双足补充项（"encourage standing on a single foot"）',
    doc: '**恰好一脚着地 +1**；两脚都离地 −0.5（跳/摔）；**两脚都着地 −0.15**（站桩/蹭地滑行）。'
      + '**这就是"一次抬一条"**，替代旧的 alt/excl/overlap/hold/rush/still 那一整串。'
      + '"两脚都着地"给负分是实测逼出来的（否则 ES 会找到"两脚不离地滑行"）。' },
  { key: 'jointMove', weight: 1.0, sign: 1, from: '本项目需求（"鼓励盆骨和膝盖骨的移动"）',
    doc: '**逐关节** min(1, |q̇_j|/目标角速度)·dt，每关节一个独立分项与滑块。'
      + '腾空时间只管"脚离地了"，管不了骨盆摆没摆，所以这一项必须留。' },
  { key: 'upright', weight: 0.5, sign: -1, from: '本项目（姿态正则）',
    doc: '∫(cos(tilt)−1)dt ≤ 0：不许弯腰驼背。' },
  { key: 'height', weight: 0.8, sign: -1, from: '本项目（姿态正则）',
    doc: '∫|胸腔高度−初始|dt：别塌下去也别跳起来。' },
  { key: 'jointMotion', weight: 0.001, sign: -1, from: 'Rudin joint motion',
    doc: '−(Σ|q̇_j|² + Σ|q̈_j|²)·dt：关节别乱抖。' },
  { key: 'torque', weight: 0.00002, sign: -1, from: 'Rudin joint torques',
    doc: '−Στ_j²·dt：省力。' },
  { key: 'actRate', weight: 0.25, sign: -1, from: 'Rudin action rate',
    doc: '−Σ|Δq*_j|²·dt：电机指令别阶跃（这一项替代旧的 accSmooth，'
      + '而且旧版符号写反过一次，"疯狂抽风"反而加分，把总分顶到 800~1400）。' },
];

/** 抬腿项的目标腾空时间（秒）。0.5 s @ 1.5 步频 ≈ 一次完整摆动。 */
export const AIR_TARGET = 0.5;
/** 逐关节"要动"的目标角速度（rad/s）。实测能走的步态：髋 ~0.6、膝 ~0.9。 */
export const JOINT_MOVE_TARGET = 1.0;
/** 固定目标前进速度（m/s），用户 2026-10-01 定 */
export const TARGET_VX = 0.5;

/** 要"鼓励移动"的关节（其余关节只吃 jointMotion 罚） */
export const MOVE_JOINTS: readonly string[] = ['hip_l', 'hip_r', 'knee_l', 'knee_r'];
