// ============================================================
// sim —— 一个火柴人 + 一个世界 + 适应度累计
// ============================================================
// 职责边界：
//   物理归 Ragdoll，网络归 brain，进化归 evolution。本文件只做"把三者接起来，
//   并按给定基因组把一次评估跑完、算出分数"。
//
// ★ 时间切片：Sim 不自己开 rAF。外部（trainer）每帧给一个"物理步预算"，
//   advance() 消耗预算直到用完或用完评估。这样一个 World 跑 32 个个体也能
//   把帧内耗时压在预算内，且个体之间不会互相饿死。
//
// ★ 每个个体独占一个 World。理由：它们要在同一条跑道上各跑各的，
//   塞进同一个 World 就得给每人分一段互不干扰的地面 + 碰撞分组隔离，
//   复杂度远高于多建一个 World 的开销（12 刚体的小世界很轻）。
//
// ★ 绝不读 body.handle（本体踩过 0.14.0 返回坏 handle 的坑），全程用对象引用。

import RAPIER from '@dimforge/rapier3d';
import { Ragdoll, type RagdollOptions } from './ragdoll';
import { BRAIN_SHAPE, brainParamCount, brainForward, type BrainShape } from './brain';
import {
  dcm, dcmExcess, newCom, newSupport, omegaAt, readCom, readSupport,
} from './posture';
import { phaseProgram, targetAngle, TAU, type GaitProgram } from './jointProgram';
import { JOINT_ORDER, type Skeleton } from './skeleton';

export type SimMode = 'walk' | 'fight';

export interface SimConfig {
  /** ★ 走"关节程序"奖励（逐关节跟踪 + 腿部交替 + 移动鼓励），而不是笼统分数 */
  programMode: boolean;
  /** 关节程序（null = 用默认的相位步态程序 phaseProgram()） */
  program: GaitProgram | null;
  /** 物理步频，越大越稳越贵（120 是刚体-马达链的稳妥档） */
  physicsHz: number;
  /** 控制（决策）频率；网络只在控制周期被调用 */
  controlHz: number;
  /** 单次评估时长（秒） */
  duration: number;
  mode: SimMode;
  /** 步态时钟频率（Hz）：给网络一个节拍输入，让它更容易长出周期步态 */
  gaitHz: number;
  /**
   * ★ 换脚计数的**前进速度门槛**（m/s，默认 0.05）：换脚瞬间躯干的前向速度必须超过它，
   *   否则这次换脚不计入步数。用来堵住"原地抖腿刷步数"的奖励劫持（见 controlTick）。
   */
  stepVMin: number;
  /**
   * ★★ **有效迈步**的三条门槛（用户 2026-10-01 定调）：
   *   "奖励改为迈一个脚后再次迈另一个脚，同时位移为直线，而且大位移才有奖励"
   *
   *   ① 左右**交替**：`stance` 必须严格 l→r 或 r→l（连续两次同脚不算"迈另一个脚"）
   *   ② 这一脚是**直线**：本步期间横向漂移 `|Δz| ≤ stepMaxDz`
   *   ③ **大位移**：本步净前进 `Δx ≥ stepMinDx`，且累计前进超过 `stepMinTotal` 才开始计分
   *
   *   奖励 = `W.step · 本步前进距离`（米）⇒ 走得越远拿得越多，而不是"数了几次脚"。
   *   这么设计的动因见 §5.15：数脚步能被"原地抖腿"劫持（实测 6 次换脚 +12 分却 1.05s 就摔），
   *   而"位移计价 + 直线门槛"让**只有真的走出去**才有分。
   */
  stepMinDx: number;
  stepMaxDz: number;
  stepMinTotal: number;
  /**
   * ★★ 位移门槛的**课程上限**（默认 0.30 m）。`stepMinDx` 从**当前值**按代次线性升到这里
   *   （Trainer 每代调 `Sim.setStepMinDx`，见 evolution.ts 的 recordAndBreed）。
   *   用户 2026-10-01："这个奖励机制是有效的，位移奖励阈值可以逐步增大" + "现在先用更小的阈值"
   *   ⇒ 起步用 0.05 m（够得着），随训练推进自动抬到 0.30 m（要求越走越远）。
   *   设在 0 = 不抬升（永远用 stepMinDx）。
   */
  stepMinDxMax: number;
  /** 一次有效迈步打开的**稳定窗口**上限（秒）：窗口内站稳就计时给分 —— 见 W.hold */
  holdMaxSec: number;
  /** 每多迈一步，保持段速率与步数分打的折扣（stepDecay^n，n = 已迈步数） */
  stepDecay: number;
  /** 两次有效迈步的**最小间隔**（s）：小于它按抢步罚（见 W.rush） */
  stepMinGap: number;
  /** 静止罚的**宽限**（s）：循环外先免费站这么久，之后开始扣 */
  stillGrace: number;
  /** 静止罚速率爬满所用的时间（s）：从宽限点起线性升到 1×，之后到 3× 封顶 */
  stillRamp: number;
  /**
   * 求解器迭代次数。
   * ★ 3D 之后**必须**提高：球关节的锚点约束刚度直接由它决定。
   *   probe-ball E 段（同一 5.0 N·m·s 冲量下锚点漂移）：
   *     iters 4 → 486 mm（撕裂）  8 → 65 mm  16 → 29 mm  32 → 9.5 mm
   *   而 MuJoCo gear 的髋 200 N·m 换算成每步冲量 = 1.67 N·m·s，正落在"偏软"区。
   *   代价（probe-ball F 段，单世界 2000 步）：4→10.6µs 8→10.5µs 16→14.2µs 32→23.6µs。
   *   16 是默认档；要更硬的关节就 32（物理开销 +66%）。
   */
  solverIterations: number;
  /** 摔倒判定：躯干高度低于初始的该比例 */
  fallHeightRatio: number;
  /** 摔倒判定：躯干"上方向"偏离世界竖直超过该值（弧度） */
  fallAngle: number;
  /**
   * ★ 覆盖适应度权重（默认全用 W）。
   *
   * 存在的意义：**站桩考核**与**课程学习**。想单独问"它到底会不会站"，
   * 就得把 `distance` / `velocity` 关掉 —— 否则"往前扑倒滑出去"也会得分，
   * 测出来的不是站立能力。用法：
   *     new Sim(sk, shape, { ...DEFAULT_SIM, weights: { distance: 0, velocity: 0 } })
   */
  weights?: Partial<FitnessWeights>;
  /**
   * ★ 透传给 Ragdoll 的选项（kP / kD / motorAlpha / torqueScale …）。
   *
   * 存在的意义 = **让"执行器够不够力"变成可扫描的实验变量**，而不是埋在常量里。
   * 典型用法（probe-posture 的权限扫描）：
   *     new Sim(sk, shape, { ...DEFAULT_SIM, doll: { motorAlpha: 1.2, kP: 9 } })
   * 注意：这份选项会成为**考核口径的一部分** —— 训练用的 cfg 和考核用的 cfg 必须一致，
   * 否则等于在 A 硬件上训练、在 B 硬件上打分。
   */
  doll?: RagdollOptions;
}

export const DEFAULT_SIM: SimConfig = {
  programMode: true,
  program: null,
  physicsHz: 120,
  controlHz: 60,
  duration: 6,
  mode: 'walk',
  gaitHz: 1.15,
  stepVMin: 0.05,
  stepMinDx: 0.05,     // ★ 一次有效迈步至少净前进 5 cm（**先用小阈值**，见 stepMinDxMax 课程）
  stepMaxDz: 0.06,     // 同一步内横向漂移上限 6 cm（约 27° 航向角 ⇒ 算"直线"）
  stepMinTotal: 0.15,  // 累计前进不足 15 cm 时一律不给步数分
  stepMinDxMax: 0.30,
  holdMaxSec: 1.2,    // ★ 收紧：每迈一步最多换 1.2 s 的"站稳"分 ⇒ 循环要快
  stepDecay: 0.6,     // 第 2 步 ×0.6、第 3 步 ×0.36 …（"逐渐减弱"）
  stepMinGap: 0.20,   // ★ 收紧：两步至少隔 0.20 s，否则算"抢步"扣分（稳住加分与抢步扣分的间隔要小）
  stillGrace: 0.25,   // ★ 收紧：循环外只免费站 0.25 s，静止罚很快就上
  stillRamp: 1.5,     // 之后 1.5 s 内扣分速率爬到 1×，再往上封 3×   // 位移门槛课程上限（见 SimConfig.stepMinDxMax）
  solverIterations: 16,
  fallHeightRatio: 0.62,
  fallAngle: 1.25,
};

/**
 * 适应度权重（集中在一处，方便调参时一眼看全）。
 *
 * ★ 相对 2D 版的三处**修正**（原来的分数与距离脱节，是"学不出走路"的第二大原因）：
 *   1) distance 从"评估期内最远距离"改成**净位移** —— 用最远距离时，
 *      往前扑倒滑出去也算分，于是 ES 学会了"扑"而不是"走"
 *      （实测：最优个体直立占比 97% 却只前进 0.28 m，而当代最佳全程"摔倒=是"）。
 *   2) upright 从"奖励直立"改成**惩罚不直立**：W.upright × ∫(cos(tilt) − 1)dt ≤ 0，
 *      全程笔直才为 0。★ 为什么不做成 +1.2×∫cos：那样"站着不动 6 秒"就白拿 7.2 分，
 *      会形成一个离"走得一般"很近的局部最优，ES 会直接卡在那里。
 *      改成惩罚后，站桩总分 = 0，任何倾斜/扑倒都从 0 往下扣，梯度方向正确。
 *   3) 新增 lateral（∫|z|dt）：任务要求沿 +X 直走，偏出去要扣。
 *
 * ★★ 4) 新增 balance（DCM 越界积分）—— 见 W.balance 的注释。这是本轮最关键的修正。
 */
export const W = {
  /**
   * 净前进距离（x 位移）。★ 用户 2026-10-01："前进奖励要弱" ⇒ 3.0 → **0.5**。
   *   原来 3.0 太大，ES 只要"整体往前蹭"就能拿分，于是**迈步本身反而不值钱**
   *   （实测：最优个体 6 s 只走 −0.24 m，`step` 分却是 0）。
   *   0.5 削弱后又太弱（策略连方向都找不着了），按用户要求**再增大到 1.5** ——
   *   仍显著低于 3.0，但足以提供"往 +X 走"的方向梯度。
   */
  distance: 1.5,
  // ══ 关节程序模式（用户 2026-10-01："不写笼统的奖励分数了，精确控制各个关节"）══
  /** 逐关节跟踪误差系数：−w.joint · ∫(实际角−程序目标角)²dt（每关节还有自己的 w） */
  joint: 1.0,
  /** 腿部交替：w.alt · (交替质量 − 1)，≤0。两腿角速度和≈0（完全反相）时为 0 */
  alt: 2.0,
  /** 移动鼓励：w.move · min(1, 髋/膝平均角速度 / moveTarget) —— "骨盆和膝盖要动" */
  move: 1.0,
  /** 前进任务分：w.task · 迈出来的位移 · 时间平均交替质量 */
  task: 1.5,
  /** 旧的"迈步-站稳"循环项总开关（0 = 关掉，只用程序奖励；UI 可调回 1） */
  excl: 2.0,
  cycle: 0.0,
  moveScale: {} as Record<string, number>,   // 逐关节移动倍率（UI 实时改；默认权重在 jointProgram.ts）
  /**
   * ★★ **换脚奖励（必须有）**：每完成一次"左脚→右脚 / 右脚→左脚"的交替接地就给一次。
   * 只要求 ① 左右交替 ② 换脚瞬间在前进（`stepVMin`）。
   * **不要求**位移门槛、**不要求**直线 —— 后两条是可选项（见 `stepMinDx` / `stepMaxDz`），
   * 只影响上面的"大位移奖金"（`step`/`step2`）。
   * 为什么要有：奖励被劫持过一次（ES 找"原地抖腿"刷步数），
   * 但那次的解法应该是"收紧条件"，不是"取消换脚奖励"—— 没有它就没有"迈步"这个梯度。
   */
  switch: 0.3,
  /**
   * ★★★ **迈步后保持稳定的加分**（用户 2026-10-01 定调，循环式奖励）：
   * > "还不如让这玩意只迈两步，但是每迈一步都要稳，需要自行调整平衡"
   * > "需要一个迈步后保持稳定的加分，而且在迈步后要高于迈下一步的收益，然后逐渐减弱，再迈下一步"
   * > "循环为迈步，保持稳定，再迈下一步，再保持稳定的循环"
   *
   * 做法：一次**有效迈步**打开一个**稳定窗口**（`holdMaxSec` 秒，上限），
   *   · 窗口内只要**还在支撑域内**（DCM 未越界）就积分"站稳的秒数"——这就是"自行调整平衡"；
   *   · 每一步的窗口按 `stepDecay^已迈步数` 打折 ⇒ **第一步比第二步值钱，之后逐渐减弱**；
   *   · 窗口用完（或摔倒）就不再给分 ⇒ 想继续拿分**必须再迈一步**，
   *     于是最优策略长成用户描述的循环：**迈步 → 站稳 → 再迈 → 再站稳**。
   *   （曾经用"给分速率指数衰减"，实测不行：迈步后要 1~2 s 才稳得住，
   *     `holdTau=1.1s` 时窗口结束时速率已衰减到 4%，等于白给 ⇒ 改成计秒数。）
   * 于是最优策略自然长成用户描述的循环：**迈步 → 稳住 → 再迈 → 再稳住**。
   */
  hold: 1.2,
  // ★ 显式记录"第一步之前"状态：保持分窗口只在**有效迈步之后**才打开
  //   （用户 2026-10-01："迈第一步之前不要有稳住的加分"）。验收见 tools/probe-gait。
  /**
   * ★★ **抢步罚**（用户 2026-10-01："迈一步立刻迈第二步应该是负分"）。
   * 两次有效迈步之间的间隔 < `stepMinGap`（默认 0.35 s）就按"越快罚得越狠"计：
   *   罚 = `W.rush · (1 − gap/stepMinGap)`。
   * 它和"迈步后保持稳定"的加分是一对：**站稳了再迈才有分，抢步倒扣** ⇒ 策略学到的是节奏。
   */
  rush: 1.5,
  /**
   * ★★ **静止罚**（用户 2026-10-01："这个抢步罚后面会转为静止罚"）。
   * 只有"不罚"是不够的：迈一步 → 站完 2 s 窗口 → 什么都不做，收益并不比
   * "继续迈步"差，所以最优解会退化成"**迈一步然后 freeze**"。
   * ⇒ 只要**不在循环里**（稳定窗口已关、或还没迈出第一步）就一直扣，
   *   而且**越站越贵**：扣分速率在 `stillGrace` 秒后开始，按 `stillRamp` 线性爬升（上限 3×）。
   */
  still: 1.0,
  /**
   * ★★ **同腿连迈罚**（用户："一条腿连着迈两步更是负上加负"）。
   * 摆动腿腾空后**又落到同一条腿**（stance 1→0→1 / 2→0→2）而不是换另一条 = 单腿跳，
   * 这种"假步"既不计入有效迈步，还要额外扣分（`W.sameFoot` / 次）。
   */
  sameFoot: 0.5,
  /** 前进速度积分（塑形项：让早期就有梯度，不必等撞线） */
  velocity: 0.6,
  /**
   * ★ 躯干不正的惩罚：W × ∫(cos(tilt) − 1)dt（≤ 0，不直立就一直扣）。
   * ★★ 权重已从 1.2 **降到 0.5**：它优化的是**代理量** ——
   *   胸腔只占 12.4% 质量、中心离 CoM 0.4635 m，而"人像棍子一样平移倒下"时
   *   胸腔倾角**始终 ≈ 0** ⇒ 这个项对真正的摔倒几乎无感（实测"直立占比 48~97%
   *   却只前进 0.37 m、**仍判摔**"）。真正的平衡判据交给下面的 balance。
   *   不删它是因为"弯腰驼背"确实要以姿态扣分，只是不该由它负责平衡。
   */
  upright: 0.5,
  /** 躯干离地高度偏差（站着才不扣） */
  height: 0.8,
  /** 侧向漂移 ∫|z|dt：任务要求沿 +X 直走 */
  lateral: 1.0,
  /** 关节耗能 */
  energy: 0.02,
  /**
   * ★ 有效迈步奖励，**单位：每米前进**（`w.step · Σ本步前进距离`）。
   *   "大位移才有奖励"；每一次有效迈步都要满足三条门槛（左右交替 / 这一脚直线 / 位移够大）。
   */
  step: 4.0,
  /**
   * ★★ **第 2 步起的超线性加成**：`w.step2 · n(n−1)/2`（n = 换脚次数）。
   *
   * 为什么必须有（用户 2026-10-01："第一步会迈出去，但是第二步不会迈了。
   * 需不需要走直线分数加权或者什么手段教会他走第二步？"）：
   *   `probe-gait`（绕过 ES 的手工相位步态，24 组）实测：**没有任何一组能迈出第二步**，
   *   最好的那组走 1.21 m、存活 3.6 s，但**换脚只有 1 次**。
   *   而原来的奖励结构是 `step 0.4/步` 对 `fall 2.0` ⇒
   *   **"迈一步再倒"是净负分（+0.4−2.0 = −1.6）** ⇒ ES 学到的最优解是"别迈步"。
   *   直线/方向加权救不了这个：它只能改变**已有动作的方向**，
   *   而"落地之后再迈"这个动作在物理层压根没出现。
   *   ⇒ 把"第 2 步、第 3 步…"的价格抬到**超线性**，让"多迈一步"的边际收益超过摔倒代价：
   *     n=1 → +0.4，n=2 → +1.2，n=3 → +2.8，n=4 → +5.2（`step` + `step2` 两项之和）
   */
  step2: 0.8,
  /**
   * ★ 腾空时间惩罚（`∫`双脚离地 dt）。
   * 为什么要：实测**全幅**相位步态 0.27 s 就双脚腾空（把整个人甩起来，腾空占比 10~13%），
   * 而把输出缩到 ×0.05~0.15 才走得远、活得久 ⇒ 摆动权限相对支撑能力过强，
   * 搜索很容易滑到"跳"这个局部解上。给腾空上分可以把搜索推回"走"。
   */
  air: 0.5,
  /** 摔倒一次性扣分 */
  fall: 2.0,
  /**
   * ★ 存活奖励（每秒）。**默认 0 = 关闭**，只有"站桩考核"这类关掉了
   * `distance/velocity/step` 的模式才该打开。
   *
   * ★★ 为什么必须有这么一个项（这条是跑 probe-posture 时踩出来的真坑）：
   *   本适应度里所有姿态项（balance / upright / height / lateral / energy）**都是
   *   随时间累积的负数**，而"摔倒"只是一次性 −2。于是当 locomotion 项被关掉、
   *   没有任何"活得越久拿分越多"的正项时，**早死反而分数更高** ——
   *   ES 会直奔"赶紧倒下"这个解（实测：站桩训练 20 代，最佳个体存活从 0.78 s
   *   一路缩到 0.65 s，却因为累积惩罚更少而分数更高，ξz 峰值也确实"变小"了）。
   *
   *   ★ 行走模式不需要它：`distance` 只有在活着的时候才累积，天然带存活激励
   *     （这也是"摔倒只是一次性 −2"没有毁掉行走训练的原因）。
   *   ★ 也**不能**给行走默认加上它：站着不动 6 s 白拿 6×1.5 = 9 分，
   *     正好抵消 distance 的满分量级 ⇒ 会造出一个"原地不动"的强局部最优
   *     （当年把 upright 从"奖励"改成"惩罚"就是为了掐掉这个最优）。
   */
  survive: 0,
  /**
   * ★★ DCM 越界积分（本轮新增，**这是"站得住"真正的梯度来源**）。
   *
   *   项的形式：W.balance × ∫ (ex² + ez²) dt
   *     其中 ex = max(0, |ξx − cx| / halfX − 1)、ez 同理（无量纲，见 posture.dcmExcess）
   *     ξ = CoM + CoM速度/ω 是**捕获点**，越界之后任何 CoP 都救不回来。
   *
   *   ★ 为什么必须是它、而不是"CoM 投影落在支撑多边形内"：
   *     静力投影判据比真实约束**宽得多**（它是静态近似）。真约束是不稳定倒立摆
   *     ẍ = ω²(x−p)，稳定当且仅当 ξ 在域内。probe-stability 实测：走路量级 0.5 m/s
   *     就已经超过本骨架的可刹上限 ω·p_max = 0.351 m/s ⇒ 静止站立在数学上已不可能，
   *     只有迈步能救。用静力判据会给出"余量 0.11 m，很安全"的错误结论。
   *
   *   ★ 为什么用**归一化**而不是米：站立时 half 只有 0.07 m、迈步时 half 在变，
   *     用米会让"域大的时候小犯规"和"域小的时候不犯规"混在一起不可比。
   *     归一化后 0 = 正好在域边缘、1 = 越出整整一个半宽，跨姿态可比。
   *
   *   ★ 为什么侧向用**被动**半宽（0.070）而不是凸包（0.266）：
   *     两脚等载荷时净 CoP = 两脚 CoP 的平均 ⇒ 侧向可调范围只有"单只脚的宽度"。
   *     拿凸包当域等于给策略 4 倍宽容度，它会以为 ξz = 0.2 很安全（实测静息就是这样翻的）。
   *
   *   ★ 为什么平方：域内给 0 ⇒ 与 upright 一样"站桩不白拿分"，不会造出新的局部最优；
   *     越界越狠扣得越急 ⇒ 梯度指向"别出去"，而不是"出去一点也没事"。
   *
   *   ★ 取值 2.0 的来由：一次典型的摔倒，越界量在 1~3 个半宽之间，积分 ≈ 1~9，
   *     ×2 后是 2~18 分 —— 与 distance（满分 3×3=9）同量级、比 fall（2.0）重，
   *     也就是"慢慢倒下去"和"直接判摔"都会被明显惩罚，但不会把分数压成常数。
   */
  balance: 2.0,
  /**
   * ★★ 抖动惩罚（W.smooth）：∫ Σ_axis (τ_t − τ_{t−1})² （N·m²·s 量纲见下）。
   *
   *   ★ 为什么需要它：`energy = 0.02·∫Σout²` 量的是**出力大小**，量不到**抖动**。
   *     一个每步朝相反方向猛扯、净输出 ≈ 0 的"抽风"关节，Σout² 并不大，
   *     但它把接触抖散了（probe-posture [C3]：抽风个体只活 0.38~0.60 s）。
   *
   *   ★ 为什么用**力矩**差而不是网络输出差：力矩里含 `−kD·ω_rel` 反馈项。
   *     高频换向在力矩上才看得见；网络命令可能是低频的，而关节在硬顶。
   *
   *   ★ 为什么是"平方和"而不是 Σ|Δτ|：和 W.balance 同理 —— 小幅连续修正（真人式）
   *     几乎不罚，大幅高频（抽风）按平方放大。用 Σ|Δτ| 会让"每步轻微调整"也被线性罚。
   *
   *   ★ 量纲/量级（probe-posture [C3]，3.5 s 回合）：
   *     静息（零输出）实测抖动 ≈ 66 N·m/s；抽风个体 ≈ 1.0e5 N·m/s ⇒ 差 3 个数量级。
   *     取 1e-4 量级即可把两者在分数上分开，而不会把正常步态压死（见 C3 的 smooth 列）。
   */
  smooth: 1e-4,
  /** 战斗：命中一次 */
  hit: 4.0,
  /** 战斗：被击中（按出拳次数，不是按周期数） */
  hurt: 0.02,
  /** 战斗：手贴近假人的程度 ∫max(0, 1 − d/1.2)dt —— 塑形项，让"挥空"也有梯度 */
  approach: 0.8,
} as const;

export type FitnessWeights = typeof W;

const ZERO = { x: 0, y: 0, z: 0 };

export class Sim {
  /** ★ 每次 begin() 都会整世界重建（原因见 buildWorld），所以别在外部长期持有 */
  world!: RAPIER.World;
  doll!: Ragdoll;
  readonly cfg: SimConfig;
  readonly shape: BrainShape;
  /** 本次评估实际使用的权重（= W 叠加 cfg.weights） */
  w: FitnessWeights;   // ★ 可运行时调（UI 滑块），见 setWeights
  readonly stages: number;      // 每个控制周期包含几个物理步
  readonly ticksTotal: number;  // 一次评估的控制周期总数
  /** 物理步长（秒）—— driveMotors 的 dt */
  readonly dt: number;

  private readonly sk: Skeleton;

  // ---- 复用缓冲（零分配） ----
  private params: Float32Array;
  private readonly x: Float32Array;
  private readonly hidden: Float32Array;
  private readonly out: Float32Array;
  private readonly motor: Float32Array;
  private readonly jbuf = new Float64Array(3);
  /** ★ 重心 / 支撑域缓冲（posture.ts，零分配） */
  private readonly com = newCom();
  private readonly sup = newSupport();

  // ---- 评估状态 ----
  private subStep = 0;
  private tick = 0;
  private phase = 0;
  private startX = 0;
  private initTorsoY = 0;
  private accUpright = 0;
  private accHeight = 0;
  private accLateral = 0;
  private accEnergy = 0;
  private accVel = 0;
  private accClose = 0;
  /** ★ DCM 越界积分（无量纲，见 W.balance） */
  private accBalance = 0;
  /** ★ 关节程序（相位 → 每个关节的目标角）。null = 不用程序模式 */
  readonly prog: GaitProgram | null;
  /** 逐关节跟踪误差积分（键 = 关节名） */
  private accJt: Record<string, number> = {};
  /** 逐关节角速度积分（rad，键 = 关节名） */
  private accMove: Record<string, number> = {};
  /** 腿部"同相"程度积分：∫((qdot_l+qdot_r)/moveTarget)² dt */
  private accAlt = 0;
  /** ★ 抬腿互斥：两条腿"同时在抬"的时间占比（0 = 一次抬一条，1 = 一直一起抬） */
  private accOverlap = 0;
  /** 每条腿实际"抬起来"的平均高度（0~1，诊断用） */
  private accLift: Record<string, number> = {};
  /** 交替质量的时间积分（0=完全同相，1=完全反相），用来给前进分打折 */
  private accAltQ = 0;
  /** 上一个控制周期的关节角（算角速度用，避免跨 wasm 边界） */
  private prevAng: Record<string, number> = {};
  /** ★ 有效迈步时记下的 x：前进奖励只对"上一次有效迈步之后推进的位移"付费 */
  private stepRefX = 0;
  /** 已付费的前进距离（见 W.distance） */
  private accProgress = 0;
  /** ★ 抖动积分 ∫ Σ(Δτ)²（N·m²·s，见 W.smooth） */
  private accSmooth = 0;
  /** 上一物理步的**实际**关节力矩（= motorImpulse/dt），用于算 Δτ */
  private readonly tauPrev: Float64Array;
  private tauPrimed = false;
  private lastStance: 0 | 1 | 2 = 0;
  /** ★ 有效迈步次数（满足三条门槛；见 SimConfig.stepMinDx） */
  private stepCount = 0;
  /** ★ 有效迈步累计**前进距离**（m）—— 步数奖励按它计价，不按次数 */
  private stepDist = 0;
  /** 上一次有效迈步的画布起点（用于算本步的 Δx/Δz） */
  private stepAnchorX = 0;
  private stepAnchorZ = 0;
  /** 累计净前进（m），用作 stepMinTotal 的门槛 */
  private stepTotalX = 0;
  /** 上一次着地的是哪只脚（1=左 2=右），用来强制左右交替 */
  private stepLastFoot = 0;
  /** ★ 诊断：有效迈步各道门槛分别挡了多少次（探针/调试用，见 `get stepDiag`） */
  readonly stepDiag = { switch: 0, noPrev: 0, noAlt: 0, slow: 0, notStraight: 0, tooSmall: 0, notYet: 0, ok: 0 };
  /** ★ 交替换脚次数（只要求左右交替 + 在前进）—— W.switch 的计价依据 */
  private switchCount = 0;
  /** ★ 当前稳定窗口剩余秒数（迈步时打开，用完关闭）—— 见 W.hold */
  private holdWindow = 0;
  /** ★ 当前窗口的折扣（= stepDecay^已迈步数） */
  private holdFactor = 0;
  /** ★ 累计"迈步后站稳的秒数 × 折扣" */
  private accHold = 0;
  /** ★ 上一次有效迈步的时刻（s），用于抢步判定 */
  private lastStepT = -1;
  /** ★ 抢步罚累计（归一化量，1 = 刚好抢到 0 间隔） */
  private accRush = 0;
  /** ★ 已过秒数（抢步判定用） */
  private elapsed = 0;
  /** ★ 同腿连迈次数 */
  private accSameFoot = 0;
  /** ★ 不在"迈步+站稳"循环里的时长（s）—— 静止罚的计时 */
  private quietT = 0;
  /** ★ 静止罚累计（归一化秒数，速率加权前） */
  private accStill = 0;
  /** ★ 腾空前着地的是哪只脚 / 本轮是否腾空过（同腿连迈判定用） */
  private footBeforeFlight = 0;
  private sawFlight = false;
  /** ★ 诊断：CoM 在支撑域内的累计/计数（hold 奖励的判据） */
  private supInRatio = 0;
  private supTicks = 0;
  private lastInSup = false;
  /** ★ 步数分按"逐渐减弱"加权后的累计（米 × 折扣） */
  private accStepScore = 0;
  /** ★ 腾空时间（双脚都离地），单位 s —— 见 W.air */
  private accAir = 0;

  // ---- 战斗模式 ----
  private puppet?: RAPIER.RigidBody;
  private fist?: RAPIER.RigidBody;
  private fistBaseX = 0;
  private fistLunge = 0.72;
  private fistY = 1.05;
  private handCooldownL = 0;
  private handCooldownR = 0;
  /** 上一控制周期拳头是否压在躯干上 —— 用于把"被击中"按出拳次数计，而不是按周期数 */
  private fistTouching = false;

  // ---- 对外诊断 ----
  finished = true;
  fallen = false;
  fitness = 0;
  hits = 0;
  hurts = 0;
  /** ★ 诊断：DCM 归一化越界量的峰值（1 = 越出整整一个被动半宽） */
  peakDcmX = 0;
  peakDcmZ = 0;
  /** ★★ 诊断：本回合**因何中止**。'' = 跑满时长没摔。
   *
   * 为什么必须有（跑 probe-posture 时踩出来的真需求）：
   *   摔倒判定有三条独立路径（胸塌到 62% / 倾角 > 1.25 rad / 头 < 0.45 m），
   *   而"ξz 峰值只有 1.25（远没越界）却仍然判摔"这种情况**无法从分数和 ξ 看出来**。
   *   没有归因就只能瞎猜是"倒"还是"蹲塌"，而这两者对应的修法完全相反
   *   （倒 ⇒ 补侧向控制；蹲塌 ⇒ 看动作空间/阈值）。
   *   取值 = 三条里**超标最狠**的那一条，比按 || 短路顺序取更利于诊断。
   */
  fallReason: '' | 'height' | 'tilt' | 'head' = '';
  /** ★ 诊断：中止瞬间的姿态（跑满时长 = 结束瞬间），用于区分"倒"与"蹲塌" */
  endTorsoY = 0;
  endTilt = 0;
  endHeadY = 0;
  /** ★ 诊断：ξ 同时落在 x/z 域内的控制周期占比（"站住了"的直接指标） */
  inDomainRatio = 0;
  private inDomainTicks = 0;
  private balanceTicks = 0;

  constructor(sk: Skeleton, shape: BrainShape = BRAIN_SHAPE, cfg: SimConfig = DEFAULT_SIM) {
    this.sk = sk;
    this.cfg = cfg;
    this.shape = shape;
    this.w = { ...W, ...cfg.weights };
    // ★ 关节程序：默认用探针实测最好的那组相位步态（×0.15，1.25 m / 2 次有效迈步）
    this.prog = cfg.program ?? (cfg.mode === 'walk' && cfg.programMode ? phaseProgram() : null);
    if (this.prog) {
      for (const j of this.prog.joints) { this.accJt[j.joint] = 0; this.accMove[j.joint] = 0; this.prevAng[j.joint] = 0; }
      for (const L of this.prog.lifts) this.accLift[L.joint] = 0;   // 不初始化就是 undefined ⇒ += 变 NaN
    }

    this.dt = 1 / cfg.physicsHz;
    this.stages = Math.max(1, Math.round(cfg.physicsHz / cfg.controlHz));
    this.ticksTotal = Math.max(1, Math.round(cfg.duration * cfg.controlHz));

    this.buildWorld();

    this.params = new Float32Array(brainParamCount(shape));
    this.x = new Float32Array(shape.inputs);
    this.hidden = new Float32Array(shape.hidden);
    this.out = new Float32Array(shape.outputs);
    this.motor = new Float32Array(this.doll.jointCount * 3);
    this.tauPrev = new Float64Array(this.doll.jointCount * 3);

    this.initTorsoY = this.doll.torso().translation().y;
  }

  /**
   * ★★ 重建整个物理世界（重力/步长/求解器设置 + 地面 + 12 刚体 + 9 关节 + 战斗道具）。
   *
   * 为什么每个个体每次评估都要重建（这是个**必须**，不是洁癖）：
   *   Rapier 的解算器把上一轮的**累积冲量**留在缓存里做暖启动 —— 关节约束一份、
   *   地面接触一份。只把刚体的位姿/速度 reset 掉清不掉它。
   *   probe-reset / verify-core D 段实测：同一份基因组、同一个 World 连续重放两次，
   *   **从第 1 步就开始分叉**（不是第 2 步之后 ⇒ 不是混沌敏感性），偏差 2.55e-3 m；
   *   而且"删关节再重建"（Ragdoll.purgeJointCache）清不掉那 2.55e-3 ——
   *   说明剩下的是**地面接触**的缓存。⇒ 只能整世界重建。
   *   不修的话，ES 的适应度里混着"上一轮跑到哪"的固定偏置，个体之间不可比。
   *
   * 开销实测：12 刚体 + 14 collider + 9 关节的世界重建 ≈ 0.2 ms，
   *   相对一次评估（4s × 120Hz = 480 步 × ~0.2 ms/步 ≈ 96 ms）不到 0.3%。
   */
  private buildWorld(): void {
    if (this.world) this.world.free();   // 不 free 的话 wasm 侧内存会一代一代累积
    const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    w.timestep = this.dt;
    w.numSolverIterations = this.cfg.solverIterations;
    w.numAdditionalFrictionIterations = Math.max(1, this.cfg.solverIterations >> 1);
    this.world = w;
    this.doll = new Ragdoll(w, this.sk, this.cfg.doll);

    this.puppet = undefined;
    this.fist = undefined;
    if (this.cfg.mode === 'fight') this.createPuppet();
  }

  /**
   * 战斗模式：一个固定假人 + 一根会周期性朝你捅过来的拳头（kinematic，不受物理反作用）。
   *
   * ★★ 假人的距离是**实测**定出来的，不是拍脑袋（tools/probe-fight 的逐帧数据）：
   *    - 手（前臂刚体的几何中心）从静止位置向前挥到底，最远只能到 x ≈ 0.26
   *      （肩的屈伸限位 +80°，肘只能到 +10°，而且前臂 bbox 中心本来就偏外侧 z≈±0.34）。
   *    - 原来假人放在 x=1.0，最近手距 0.79m > 判定阈值 0.68 ⇒ **永远打不中**，
   *      等价于"必须先学会走路再谈打人"，战斗阶段因此完全无法独立学习。
   *    - 现在放 x=0.72：手挥到底时距离 ≈ 0.50m < 0.68 ✅，一站定就能练挥拳。
   *    - 拳头同理：拳根 0.58、推出 0.42 ⇒ 最远 x=0.16，刚好够到躯干胶囊表面
   *      （躯干半径 0.136 + 拳半径 0.09 = 0.226），既真接触又不会穿过身体把人顶飞。
   */
  private createPuppet(): void {
    const x = 0.72;
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0.95, 0);
    this.puppet = this.world.createRigidBody(bodyDesc);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.16, 0.42, 0.12).setFriction(0.8),
      this.puppet,
    );

    this.fistBaseX = x - 0.14;
    this.fistLunge = 0.42;
    this.fistY = 1.05;
    const fistDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(this.fistBaseX, this.fistY, 0);
    this.fist = this.world.createRigidBody(fistDesc);
    this.world.createCollider(RAPIER.ColliderDesc.ball(0.09), this.fist);
  }

  get ticksDone(): number { return this.tick; }
  get progress(): number { return this.tick / this.ticksTotal; }
  /** ★ 净前进距离（跑到此刻为止的位移；"最远距离"已弃用，见 W 的注释） */
  get distance(): number { return this.doll.torso().translation().x - this.startX; }
  /** ★★ 诊断：本回合的**抖动积分** Σ(Δτ)²（量纲 (N·m)²，见 W.smooth / [C3]） */
  get smoothCost(): number { return this.accSmooth; }

  // ------------------------------------------------------------ 生命周期

  /** 装上一份基因组，重置世界，开始一次评估 */
  begin(params: Float32Array): void {
    if (params.length !== this.params.length) {
      throw new Error(`[sim] 基因组长度 ${params.length} ≠ 期望 ${this.params.length}`);
    }
    this.params = params;

    // ★ 先整世界重建（清掉解算器的暖启动缓存，见 buildWorld），
    //   再把刚体摆回初始位姿 —— 顺序反了 startX 就是上一次跑完的位置，
    //   所有距离都会算出垃圾值（这个 bug 会让"前进距离"看起来永远是对的 0）。
    this.buildWorld();
    this.doll.reset(0);
    this.startX = this.doll.torso().translation().x;
    this.initTorsoY = this.doll.torso().translation().y;

    this.subStep = 0;
    this.tick = 0;
    this.phase = 0;
    this.accUpright = 0; this.accHeight = 0; this.accLateral = 0;
    this.accEnergy = 0; this.accVel = 0; this.accClose = 0; this.accBalance = 0;
    this.accAlt = 0; this.accAltQ = 0; this.accOverlap = 0;
    for (const k of Object.keys(this.accLift)) this.accLift[k] = 0;
    for (const k of Object.keys(this.accJt)) { this.accJt[k] = 0; this.accMove[k] = 0; this.prevAng[k] = 0; }
    this.accProgress = 0;
    this.accSmooth = 0;
    // ★ 抖动需要一个"前一帧力矩"；第一步没有前值，置 0 并打标记，
    //   否则第 1 步的 Δτ = τ_0 本身会被当成一次巨大抖动（假罚）。
    this.tauPrev.fill(0);
    this.tauPrimed = false;
    this.lastStance = 0;
    this.stepCount = 0;
    this.switchCount = 0;
    this.holdWindow = 0;
    this.holdFactor = 0;
    this.accHold = 0;
    this.supInRatio = 0;
    this.supTicks = 0;
    this.lastStepT = -1;
    this.accRush = 0;
    this.elapsed = 0;
    this.accSameFoot = 0;
    this.quietT = 0;
    this.accStill = 0;
    this.footBeforeFlight = 0;
    this.sawFlight = false;
    this.accStepScore = 0;
    this.stepDist = 0;
    this.stepTotalX = 0;
    this.stepLastFoot = 0;
    {
      const t0 = this.doll.torso().translation();
      this.stepAnchorX = t0.x;
      this.stepAnchorZ = t0.z;
    }
    this.accAir = 0;
    this.inDomainTicks = 0;
    this.balanceTicks = 0;
    this.peakDcmX = 0;
    this.peakDcmZ = 0;
    this.fallReason = '';
    this.endTorsoY = 0;
    this.endTilt = 0;
    this.endHeadY = 0;
    this.inDomainRatio = 0;
    this.handCooldownL = 0;
    this.handCooldownR = 0;
    this.fistTouching = false;
    this.finished = false;
    this.fallen = false;
    this.fitness = 0;
    this.hits = 0;
    this.hurts = 0;

    if (this.fist) this.fist.setNextKinematicTranslation({ x: this.fistBaseX, y: this.fistY, z: 0 });
  }

  /**
   * 推进最多 budgetSteps 个物理步，返回实际消耗的步数。
   * 评估跑完（或摔倒）即提前返回。
   */
  advance(budgetSteps: number): number {
    if (this.finished) return 0;
    let used = 0;
    while (used < budgetSteps && !this.finished) {
      if (this.subStep === 0) this.controlTick();
      // ★ 关节力矩每物理步施加一次（网络只在控制周期被调用，力矩是连续量）
      this.doll.driveMotors(this.dt);
      this.accumulateSmooth();   // ★ 抖动积分：必须在 driveMotors 之后（读本步力矩）
      this.world.step();
      used++;
      this.subStep++;
      if (this.subStep >= this.stages) {
        this.subStep = 0;
        this.tick++;
        if (this.tick >= this.ticksTotal) { this.finish(false); break; }
      }
      if (this.checkFall()) break;
    }
    return used;
  }

  /**
   * ★ 抖动记账（W.smooth）：`accSmooth += Σ_axis (Δτ)²`，其中 `τ = motorImpulse / dt`。
   *
   * - 逐**物理步**累加（不是逐控制周期）—— "抽风"的定义就是**步间**抖动。
   * - 用**实际施加的力矩**（`motorImpulse`）而不是网络输出 `out`：
   *   力矩里含 `−kD·ω_rel` 反馈项，能抓到"命令平滑但关节在硬顶"的那种抽风。
   * - 第一步跳过：没有前值，Δτ 会把"起步瞬间 0 → 一个正常力矩"记成一次巨大抖动。
   * - 量纲：`∫ Σ(Δτ)²/dt dt = Σ(Δτ)²`，即 (N·m)²（dt 是常数，并入 W.smooth）。
   */
  private accumulateSmooth(): void {
    const imp = this.doll.motorImpulse;
    const tp = this.tauPrev;
    const invDt = 1 / this.dt;
    if (!this.tauPrimed) {
      for (let i = 0; i < imp.length; i++) tp[i] = imp[i] * invDt;
      this.tauPrimed = true;
      return;
    }
    let acc = 0;
    for (let i = 0; i < imp.length; i++) {
      const tau = imp[i] * invDt;
      const d = tau - tp[i];
      acc += d * d;
      tp[i] = tau;
    }
    this.accSmooth += acc;
  }

  /**
   * ★★ 运行时调奖励规则（UI 滑块/开关用，用户 2026-10-01："做成可调的按钮"）：
   *   · `straight=false` ⇒ 取消"这一脚必须直线"（`stepMaxDz` 放到无穷大），
   *     只保留换脚奖励与位移门槛；
   *   · `minDx` ⇒ 改"一次有效迈步所需的净前进"（0 = 不设门槛）。
   *   换脚奖励本身（W.switch）**不受这里影响**，它必须一直在。
   */
  setStepRule(o: { straight?: boolean; minDx?: number }): void {
    if (o.straight !== undefined) {
      // 关掉"直线"时把容差放到 1e9（等于没有这条），开回来时用配置里的默认值
      if (o.straight && this.cfg.stepMaxDz > 1e8) this.cfg.stepMaxDz = DEFAULT_SIM.stepMaxDz;
      else if (!o.straight) this.cfg.stepMaxDz = 1e9;
    }
    if (o.minDx !== undefined) this.cfg.stepMinDx = o.minDx;
  }

  /** ★ 运行时调适应度权重（UI 滑块用）。改完立即对后续 tick 生效。 */
  setWeights(w: Partial<typeof W>): void {
    this.w = { ...this.w, ...w };
  }

  /**
   * ★ 课程：设置"一次有效迈步所需的净前进"。Trainer 每代调用，从 `stepMinDx` 线性升到
   *   `stepMinDxMax`（用户："位移奖励阈值可以逐步增大"）。**只改门槛，不改已发生的记账。**
   */
  setStepMinDx(v: number): void {
    this.cfg.stepMinDx = v;
  }

  /** ★ 诊断：有效迈步的门槛分项计数 + 已计分的有效步数/距离。 */
  get stepStat(): { diag: Record<string, number>; count: number; dist: number;
    holdWindow: number; holdFactor: number; accHold: number; inDomainRatio: number;
    lastInSup: boolean; supInRatio: number; supTicks: number } {
    return {
      diag: { ...this.stepDiag }, count: this.stepCount, dist: this.stepDist,
      holdWindow: this.holdWindow, holdFactor: this.holdFactor, accHold: this.accHold,
      lastInSup: this.lastInSup, supInRatio: this.supInRatio, supTicks: this.supTicks,
      inDomainRatio: this.balanceTicks > 0 ? this.inDomainTicks / this.balanceTicks : 0,
    };
  }

  /** ★ 诊断：当前观测里的时钟两项（clock.sin, clock.cos）与步态相位。 */
  get clock(): { phase: number; sin: number; cos: number } {
    const c2 = Math.PI * 2;
    return { phase: this.phase, sin: this.x[0], cos: this.x[1] };
  }

  /** 一次性跑完（离屏验收 / 无渲染时用） */
  runToEnd(): number {
    while (!this.finished) this.advance(1 << 30);
    return this.fitness;
  }

  // ------------------------------------------------------------ 每控制周期

  private controlTick(): void {
    const doll = this.doll;
    const p = this.params;

    // ---- 步态时钟 ----
    this.phase += this.cfg.gaitHz / this.cfg.controlHz;
    if (this.phase >= 1) this.phase -= Math.floor(this.phase);

    // ---- 填输入（布局见 brain.ts 的 INPUT_LAYOUT，共 22 + 6N 维）----
    const torso = doll.torso();
    const tp = torso.translation();
    const tv = torso.linvel();
    const tw = torso.angvel();
    const tq = torso.rotation();
    const x = this.x;
    const c2 = Math.PI * 2;

    x[0] = Math.sin(this.phase * c2);
    x[1] = Math.cos(this.phase * c2);
    x[2] = tq.x; x[3] = tq.y; x[4] = tq.z; x[5] = tq.w;
    x[6] = tv.x * 0.5; x[7] = tv.y * 0.5; x[8] = tv.z * 0.5;
    x[9] = tw.x * 0.2; x[10] = tw.y * 0.2; x[11] = tw.z * 0.2;
    x[12] = tp.y;
    x[13] = tp.z;

    // ---- ★ 重心块（6 维）：CoM / CoM 速度 / DCM。见 posture.ts ----
    // ★★ 没有这 6 维，策略在**原理上**看不到"我在往哪倒" —— 它只能靠胸腔姿态当代理，
    //    而胸腔只占 12.4% 质量、离 CoM 0.4635 m（实测症状："直立率高却不前进、仍判摔"）。
    const com = readCom(doll, this.com);
    const sup = readSupport(doll, this.sup);
    const om = omegaAt(com.y);
    // DCM ξ = x + ẋ/ω（捕获点 / 发散分量）；归一化到支撑域，0 = 中心、±1 = 域边缘
    const nx = (dcm(com.x, com.vx, om) - sup.cx) / sup.halfX;
    const nz = (dcm(com.z, com.vz, om) - sup.cz) / sup.halfZ;
    x[14] = com.x - sup.cx;          // CoM 相对支撑域中心（m）
    x[15] = com.z - sup.cz;
    x[16] = com.vx * 2;              // CoM 水平速度（×2 ⇒ 0.35 m/s 的抓地上限映射到 ~0.7）
    x[17] = com.vz * 2;
    x[18] = nx > 3 ? 3 : nx < -3 ? -3 : nx;   // DCM 归一化位置（clamp ±3：越界也要有梯度）
    x[19] = nz > 3 ? 3 : nz < -3 ? -3 : nz;

    let k = 20;
    const jb = this.jbuf;
    for (let i = 0; i < doll.jointCount; i++) {
      doll.jointRot(i, jb);
      x[k++] = jb[0]; x[k++] = jb[1]; x[k++] = jb[2];
    }
    for (let i = 0; i < doll.jointCount; i++) {
      doll.jointRelVel(i, jb);
      x[k++] = jb[0] * 0.2; x[k++] = jb[1] * 0.2; x[k++] = jb[2] * 0.2;
    }
    x[k] = doll.soleY('l');
    x[k + 1] = doll.soleY('r');

    // ---- 前向 → 马达 ----
    // ★ 输出语义 = 目标**关节角**（不是角速度），见 ragdoll.setMotorTargets / posRefScale
    brainForward(this.shape, p, x, this.hidden, this.out);
    for (let i = 0; i < this.motor.length; i++) this.motor[i] = this.out[i];
    doll.setMotorTargets(this.motor);

    // ---- 适应度累计 ----
    const dt = 1 / this.cfg.controlHz;
    this.accVel += tv.x * dt;
    this.accUpright += Math.cos(doll.tiltOf(torso)) * dt;
    this.accHeight += Math.abs(tp.y - this.initTorsoY) * dt;
    this.accLateral += Math.abs(tp.z) * dt;

    // ★★ DCM 越界积分（见 W.balance）：域内给 0，越界按"越出几个半宽"的平方扣。
    //    侧向用**被动**半宽（两脚等载时净 CoP 只能动"一只脚的宽度"）——
    //    拿凸包当域会高估 4 倍，策略会把 ξz=0.2 当成安全区。
    const eX = dcmExcess(nx, 0, 1);
    const eZ = dcmExcess(nz, 0, 1);
    // ★★ 只在"该站稳"的窗口里罚（用户 2026-10-01 的循环：迈步 → 站稳 → 再迈步）。
    //   原因：ξ 是**捕获点**，走路时本来就该超前于 CoM（重心先冲出去、脚再接住）。
    //   之前"越界就罚"等于**罚"迈步"本身** —— 实测无头训练里平均适应度 −288、
    //   最好个体也是"动了就挨罚"，ES 完全看不到"走"的梯度（详见 tools/probe-trainwalk）。
    //   现在：窗口开着（该稳）却 ξ 越界 ⇒ 罚；窗口关着（在走）⇒ 只记录不罚。
    if (this.holdWindow > 0) this.accBalance += (eX * eX + eZ * eZ) * dt;
    if (eX === 0 && eZ === 0) this.inDomainTicks++;
    this.balanceTicks++;
    // ★★★★★ 关节程序积分（用户 2026-10-01："精确控制各个关节"）。
    //   读的是观测里已经算好的关节角（x[20+3i+k]），不额外跨 wasm 边界；
    //   角速度用相邻控制周期的差分（rad/s），同样不跨界。
    if (this.prog) {
      const P = this.prog;
      const inv = 1 / Math.max(0.2, P.moveTarget);
      const qd: Record<string, number> = {};
      for (const j of P.joints) {
        const idx = JOINT_ORDER.indexOf(j.joint);
        const a = idx < 0 ? 0 : this.x[20 + 3 * idx + j.axis];
        const rate = (a - this.prevAng[j.joint]) * (1 / dt);
        this.prevAng[j.joint] = a;
        qd[j.joint] = rate;
        // ★ 误差按"该关节本来要摆多大"归一化 ⇒ 每个 jt 项的量纲都是"相对于自己幅度的偏差²"，
        //   不同关节之间才可比，w 才有意义。
        const e = (a - targetAngle(j, this.phase)) / 0.2;   // 0.2 rad ≈ 实测可达摆幅（probe-fit）
        this.accJt[j.joint] += j.w * e * e * dt;
        if (j.move) this.accMove[j.joint] += Math.abs(rate) * dt;
      }
      // ★★ 抬腿互斥（用户："交替抬腿，一次抬一条"）：
      //   lift = clamp((sign·(角度−base))/ref, 0, 1)。同时在抬 ⇒ overlap 上升。
      //   刻意**不锁相位**：实测两膝在角度上并不同相，硬锁相位会因猜错而全盘皆错；
      //   "不能同时抬"才是这条要求的本质。
      for (const L of P.lifts) {
        const idx = JOINT_ORDER.indexOf(L.joint);
        const a = idx < 0 ? 0 : this.x[20 + 3 * idx + 2];
        this.accLift[L.joint] += Math.max(0, Math.min(1, (L.sign * a - L.base) / L.ref)) * dt;
      }
      let mx = 0;
      for (const [l, r] of P.liftPairs) {
        const iL = JOINT_ORDER.indexOf(l), iR = JOINT_ORDER.indexOf(r);
        const sL = P.lifts.find((x) => x.joint === l), sR = P.lifts.find((x) => x.joint === r);
        if (!sL || !sR || iL < 0 || iR < 0) continue;
        const gL = Math.max(0, Math.min(1, (sL.sign * this.x[20 + 3 * iL + 2] - sL.base) / sL.ref));
        const gR = Math.max(0, Math.min(1, (sR.sign * this.x[20 + 3 * iR + 2] - sR.base) / sR.ref));
        mx = Math.max(mx, Math.min(gL, gR));
      }
      this.accOverlap += mx * dt;

      // ★ 腿部交替：两条腿**角速度的和**应该 ≈ 0（同相摆动时和变大）。
      //   归一化到 moveTarget，所以 w.alt 的量纲是"相对目标速度的平方秒"。
      let s2 = 0;
      for (const [l, r] of P.pairs) s2 += (qd[l] + qd[r]) * inv;
      this.accAlt += s2 * s2 * dt;
      this.accAltQ += Math.max(0, Math.min(1, 1 - (s2 * s2) / 4)) * dt;
    }

    // ★★ 前进奖励积分（见 W.distance）：**只对"上一次有效迈步之后推进的位移"付费**。
    //   为什么要：现在位移是最容易拿的大分项，一个"两脚蹭地往前挪、从不迈步"的策略
    //   拿到 1.17 m 却没有一次有效迈步，适应度反而最高（实测第 3 代最优个体就是这样）。
    //   加上"参考点 + 窗口内"两个条件后：迈了步才有钱、站稳时蹭地也没钱。
    if (this.holdWindow > 0) {
      this.accProgress += Math.max(0, this.distance - this.stepRefX) * dt;
    }

    // ★★★ 稳定窗口积分（见 W.hold）：**只有还在支撑域内**才给分（这就是"每迈一步都要稳"），
    //   计的是"站稳的秒数 × 该步折扣"，窗口上限 holdMaxSec ⇒ 想要更多分必须再迈一步。
    //   ★ 判据用 **CoM 在支撑域内**，不是 DCM：DCM = 捕获点，**走路时本来就该超前于 CoM**
    //   （每一步都是"重心冲出 → 落脚点把它接住"）。用 DCM 当"站稳"判据会把所有
    //   正在走的策略判成不稳（实测：位移 1.21m 的步态域内占比只有 41%，稳定窗口 0 分）。
    if (com.y > 0) { this.supTicks++; if (Math.abs(com.x - sup.cx) <= sup.halfX && Math.abs(com.z - sup.cz) <= sup.halfZ) this.supInRatio++; }
    // ★★★ 静止罚（见 W.still）：**不在循环里**就一直扣，越站越贵。
    //   循环内（稳定窗口还开着）不罚；窗口一关（或还没迈出第一步）就开始计时，
    //   过 stillGrace 之后按 stillRamp 线性爬坡，封 3×。
    if (this.holdWindow > 0) {
      this.quietT = 0;
    } else {
      this.quietT += dt;
      const over = this.quietT - this.cfg.stillGrace;
      if (over > 0) {
        const ramp = Math.min(3, over / Math.max(0.05, this.cfg.stillRamp));
        this.accStill += ramp * dt;
      }
    }
    if (this.holdWindow > 0) {
      const inSup = Math.abs(com.x - sup.cx) <= sup.halfX && Math.abs(com.z - sup.cz) <= sup.halfZ;
      this.lastInSup = inSup;
      if (inSup) {
        this.accHold += this.holdWindow > dt ? dt : this.holdWindow;
        this.holdWindow -= dt;
      }
    }
    const anX = nx < 0 ? -nx : nx, anZ = nz < 0 ? -nz : nz;
    if (anX > this.peakDcmX) this.peakDcmX = anX;
    if (anZ > this.peakDcmZ) this.peakDcmZ = anZ;

    let energy = 0;
    for (let i = 0; i < this.out.length; i++) energy += this.out[i] * this.out[i];
    this.accEnergy += energy * dt;

    // 两侧脚掌交替触地 → 记一次"迈步"
    const yl = doll.soleY('l');
    const yr = doll.soleY('r');
    const near = 0.07;
    const stance: 0 | 1 | 2 = yl < near && yl <= yr ? 1 : yr < near ? 2 : 0;
    if (stance !== 0 && stance !== this.lastStance) {
      // ★★★ **有效迈步**判定（用户 2026-10-01 定调，见 SimConfig.stepMinDx）：
      //   ① 换脚瞬间在前进（vx > stepVMin）
      //   ② 左右**交替**（stance 与上次着地脚不同，且上一次确实着过地）
      //   ③ 这一脚是**直线**：本步期间 |Δz| ≤ stepMaxDz
      //   ④ **大位移**：本步净前进 Δx ≥ stepMinDx，且累计 ≥ stepMinTotal
      //   满足则：步数 +1、**按本步前进距离计价**（stepDist += Δx），并重置本步锚点。
      //   任一条不满足：只重置锚点（这一步不算分），左右交替的序列也重新开始。
      this.stepDiag.switch++;
      // ★★ 同腿连迈（假步）：腾空后又落回**同一条腿** ⇒ 计数扣分（不计入有效迈步）
      const st: number = stance;
      if (st !== 0 && st === this.footBeforeFlight && this.sawFlight) {
        this.accSameFoot++;
        this.stepDiag.noAlt++;
      }
      if (st === 0) this.sawFlight = true;
      if (st !== 0) this.footBeforeFlight = st;
      const footChanged = this.lastStance !== 0 && stance !== this.lastStance;
      if (this.lastStance === 0) this.stepDiag.noPrev++;
      else if (!footChanged) this.stepDiag.noAlt++;
      else if (doll.torso().linvel().x <= this.cfg.stepVMin) this.stepDiag.slow++;
      if (footChanged && doll.torso().linvel().x > this.cfg.stepVMin) {
        // ★ 基础"换脚奖励"：只认左右交替 + 在前进，不看位移/直线（那两条是可选项）
        this.switchCount++;
        const tp = doll.torso().translation();
        const dx = tp.x - this.stepAnchorX;
        const dz = tp.z - this.stepAnchorZ;
        this.stepTotalX = Math.max(this.stepTotalX, tp.x);
        const straight = Math.abs(dz) <= this.cfg.stepMaxDz;
        const far = dx >= this.cfg.stepMinDx;
        const past = this.stepTotalX >= this.cfg.stepMinTotal;
        if (!straight) this.stepDiag.notStraight++;
        else if (!far) this.stepDiag.tooSmall++;
        else if (!past) this.stepDiag.notYet++;
        if (straight && far && past) {
          this.stepCount++;
          this.stepDist += dx;
          this.stepDiag.ok++;
          // ★★ 抢步罚：距上一步太近就倒扣（"迈一步立刻迈第二步应该是负分"）
          if (this.lastStepT >= 0) {
            const gap = this.elapsed - this.lastStepT;
            if (gap < this.cfg.stepMinGap) {
              this.accRush += 1 - gap / Math.max(1e-6, this.cfg.stepMinGap);
            }
          }
          this.lastStepT = this.elapsed;
          // ★★ 循环式奖励（用户定调）：这一步的折扣 = stepDecay^步数（越走越弱）
          const decay = Math.pow(this.cfg.stepDecay, this.stepCount);
          this.accStepScore += dx * decay;
          // ★★ 迈步 ⇒ 打开"稳定窗口"：域内站稳就计秒数，窗口上限 holdMaxSec
          this.holdWindow = this.cfg.holdMaxSec;
          this.holdFactor = decay;
          this.quietT = 0;              // ★ 进入循环 ⇒ 静止计时清零
          this.stepRefX = this.distance; // ★ 前进奖励从这里开始重新计（只付"迈出来的"位移）
        }
        // 无论这一步是否计分，锚点都挪到当前 ⇒ 下一步量的是"这一脚"，不会跨步累计
        this.stepAnchorX = tp.x;
        this.stepAnchorZ = tp.z;
        this.stepLastFoot = stance;
      }
      this.lastStance = stance;
    }
    // ★ 腾空记账：双脚都不在支撑 ⇒ 记 dt（见 W.air）
    if (stance === 0) this.accAir += dt;

    if (this.cfg.mode === 'fight') this.fightTick(dt);
  }

  /** 战斗模式的额外逻辑：假人出拳节奏 + 命中/受击判定 */
  private fightTick(dt: number): void {
    const doll = this.doll;
    const fist = this.fist;
    if (!fist || !this.puppet) return;

    // 拳头：每 1.6s 朝角色的方向捅一次（kinematic，位置直接写）
    const t = this.tick / this.cfg.controlHz;
    const period = 1.6;
    const ph = (t % period) / period;
    const pulse = Math.max(0, Math.sin(Math.PI * ph));
    const lunge = pulse * pulse;
    // ★ 战斗用的"身体中心" = 骨盆与胸腔的中点。
    //   ★ 为什么不用 torso()：脊柱分段后 torso() 是**胸腔**（1.43 m），
    //     直接当拳靶会把假人拳头抬高到头上。取中点 ≈ 1.13 m，正好等于
    //     分段之前"整块躯干"的中心高度 —— 战斗几何不用重新调标。
    const rp = doll.root().translation();
    const cp = doll.torso().translation();
    const bodyX = (rp.x + cp.x) / 2;
    const bodyY = Math.max(0.45, (rp.y + cp.y) / 2);
    const bodyZ = (rp.z + cp.z) / 2;
    fist.setNextKinematicTranslation({
      x: this.fistBaseX - lunge * this.fistLunge,
      y: bodyY + 0.05,
      z: 0,
    });

    const fp = fist.translation();
    const dxf = fp.x - bodyX;
    const dyf = fp.y - bodyY;
    const dzf = fp.z - bodyZ;
    // 上升沿计一次：一次出拳压在身上只算 1 次"被击中"（按周期累加会让分数被一次接触吃光）
    const touching = dxf * dxf + dyf * dyf + dzf * dzf < 0.45 * 0.45;
    if (touching && !this.fistTouching) this.hurts++;
    this.fistTouching = touching;

    // 命中：任一手掌贴近假人中心且手在高速运动（有挥击动作才算，不奖励"贴着蹭"）
    const pp = this.puppet.translation();
    this.handCooldownL -= dt;
    this.handCooldownR -= dt;

    // 塑形：最近的那只手离假人中心多近（1.2m 以内开始线性给分）
    let nearest = Infinity;
    const checkHand = (key: string, cd: number): number => {
      const idx = doll.indexByKey.get(key);
      if (idx === undefined) return cd;
      const hb = doll.bodies[idx];
      const hp = hb.translation();
      const dx = hp.x - pp.x;
      const dy = hp.y - pp.y;
      const dz = hp.z - pp.z;
      const far = dx * dx + dy * dy + dz * dz;
      const d = Math.sqrt(far);
      if (d < nearest) nearest = d;
      const v = hb.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (cd <= 0 && far < 0.68 * 0.68 && speed > 1.0) {
        this.hits++;
        return 0.3; // 去抖：0.3s 内同一只手只记一次
      }
      return cd;
    };
    this.handCooldownL = checkHand('hand_l', this.handCooldownL);
    this.handCooldownR = checkHand('hand_r', this.handCooldownR);
    if (Number.isFinite(nearest)) {
      this.accClose += Math.max(0, 1 - nearest / 1.2) * dt;
    }
  }

  /** 摔倒判定：躯干塌下去 / 倾角太大 / 头贴地 → 提前结束 */
  private checkFall(): boolean {
    if (this.finished) return true;
    const torso = this.doll.torso();
    const tp = torso.translation();
    const tilt = this.doll.tiltOf(torso);
    const headY = this.doll.head().translation().y;
    // ★ 写成"超标倍数"而不是三条 || 短路：判据完全等价（r > 1 ⟺ 原条件），
    //   但能顺带说出**是哪一条**、以及超标最狠的是哪一条（见 fallReason）。
    const rH = (this.initTorsoY * this.cfg.fallHeightRatio) / Math.max(1e-6, tp.y);
    const rT = tilt / this.cfg.fallAngle;
    const rD = 0.45 / Math.max(1e-6, headY);
    if (rH > 1 || rT > 1 || rD > 1) {
      this.fallReason = rH >= rT && rH >= rD ? 'height' : rT >= rD ? 'tilt' : 'head';
      this.finish(true);
      return true;
    }
    return false;
  }

  /** ★ 适应度分项（诊断用）。`total` 就是最终适应度；探针用它定位"站桩为什么是负分"。 */
  terms: Record<string, number> = {};

  /**
   * 适应度公式（walk / fight 两套）。抽成独立方法是为了让 `finish()` 和诊断接口
   * 共用**同一份公式** —— 以前诊断要复制一遍公式，改权重就会漏改（踩过）。
   */
  private fitnessTerms(fallen: boolean, elapsed: number): Record<string, number> {
    const w = this.w;
    if (this.cfg.mode === 'walk') {
      if (this.prog) {
        // ★★★ 关节程序模式（用户 2026-10-01）：奖励 = 逐关节"要动" + 逐对"要交替" + 前进。
        //   刻意**不用**不可达的目标角作主项（理由见 jointProgram.GaitProgram 的注释）。
        // ★ 程序模式：逐关节跟踪 + 腿部交替 + 移动鼓励 + 前进（都乘交替质量）
        const P = this.prog;
        const E = Math.max(0.2, elapsed);
        const pt: Record<string, number> = {};
        let jt = 0;
        for (const j of P.joints) {
          pt[`jt.${j.joint}`] = -w.joint * this.accJt[j.joint] / E;
          jt += pt[`jt.${j.joint}`];
        }
        pt.jt = jt;
        // ★ 逐关节"要动"：每个 move 关节单独一项，饱和到 1（w.move/关节数 分摊）
        let mvSum = 0, nMv = 0;
        for (const j of P.joints) {
          if (!j.move) continue;
          const f = Math.min(1, (this.accMove[j.joint] / E) / P.moveTarget);
          pt[`mv.${j.joint}`] = w.move * j.w * (w.moveScale[j.joint] ?? 1) * f;
          mvSum += f; nMv++;
        }
        const moveFrac = nMv > 0 ? mvSum / nMv : 0;
        // ★ 逐对"交替"：两条腿角速度和 ≈ 0 ⇒ 完全反相（正分，0~w.alt）
        const altQ = this.accAltQ / E;
        pt.altQ = altQ;
        // ★★ 交替分**必须乘"在动"**：站着不动时两条腿角速度都是 0，"和≈0"会被判成满分交替
        //   （实测零基因组白拿 alt=1.82 / altQ=0.91）。乘上 moveFrac 之后，
        //   "不动"就既没有移动分、也没有交替分。
        pt.alt = w.alt * altQ * moveFrac;
        // ★ 抬腿互斥分：0 = 一次抬一条，1 = 一直同时抬。
        //   ⚠ 两个必须同时乘的因子（都是被实测坑出来的）：
        //   · moveFrac —— 站着不动时两条腿都在地面，"没有冲突"是假的；
        //   · 抬腿高度 —— 方向选错（把"伸腿"当抬腿）时高度≈0、同时抬占比≈0 ⇒
        //     "从来不抬"反而拿满分（实测 excl=2.00 / 高度 0.00）。
        //     所以要求两条腿的平均抬腿高度达到 liftTarget。
        const ovl = this.accOverlap / E;
        pt.overlap = ovl;
        let hL = 0, hR = 0, np = 0;
        for (const L of P.lifts) { pt[`lift.${L.joint}`] = this.accLift[L.joint] / E; }
        for (const [l, r] of P.liftPairs) {
          hL += pt[`lift.${l}`] ?? 0; hR += pt[`lift.${r}`] ?? 0; np++;
        }
        const hAvg = np > 0 ? (hL + hR) / (2 * np) : 0;
        pt.liftH = hAvg;
        pt.liftGate = Math.min(1, hAvg / P.liftTarget);
        pt.excl = w.excl * (1 - ovl) * moveFrac * pt.liftGate;
        pt.move = w.move * moveFrac;
        pt.task = w.task * this.accProgress * altQ;   // 只有"交替推进"的位移才给分
        pt.program = jt + pt.alt + pt.excl + pt.move + pt.task;
        pt.moveFrac = moveFrac;
        const tt: Record<string, number> = {
          ...pt,
          // ---- 物理基本盘（不是"奖励"，是别摔倒/别歪/别抖）----
          upright: w.upright * (this.accUpright - elapsed),
          height: -w.height * this.accHeight,
          lateral: -w.lateral * this.accLateral,
          energy: -w.energy * this.accEnergy,
          smooth: -w.smooth * this.accSmooth,
          fall: fallen ? -w.fall : 0,
        };
        tt.total = Object.values(tt).reduce((a, b) => a + b, 0);
        return tt;
      }
      const t: Record<string, number> = {
        // ★ accUpright = ∫cos(tilt)dt ≤ elapsed，所以 upright 恒 ≤ 0：不直立就扣分，
        //   "站着不动"恰好得 0，不会白拿分（见 W 的注释）。
        distance: w.cycle * w.distance * this.accProgress,
        // ★★ 走路模式**不用** DCM 越界罚（见 accBalance 处的说明）：它和"保持分"用同一个
        //   判据（CoM/ξ 在支撑域内），一正一负双重惩罚同一个动作。实测：会走的种子
        //   换脚+迈步+重复步+前进一共 +2.7 分，却被 balance −50 埋掉，比"站着不动"还差。
        //   稳定性改由 W.hold（保持分）负责：域内站稳才给分 ⇒ 站不稳就没有保持分。
        balance: 0,   // 仍继续累计 accBalance（供诊断 inDomainRatio 看）
        velocity: w.cycle * w.velocity * this.accVel,
        upright: w.upright * (this.accUpright - elapsed),
        height: -w.height * this.accHeight,
        lateral: -w.lateral * this.accLateral,
        energy: -w.energy * this.accEnergy,
        //   （DCM 越界罚：走路模式已关闭，见上面 balance: 0 的说明；accBalance 仍在累计供诊断）
        // ★★ 抖动**罚**（治"抽风式频繁发力"，见 W.smooth / probe-posture [C3]）
        //   ⚠ 这里以前写成 **加号** ⇒ 疯狂抽风反而加分：实测 25 代训练把总分顶到 800~1400，
        //   而解剖日志里光这一项就是 `smooth=2700`。ES 一直在优化"抖得更狠"。
        //   负号是这行唯一的要点，别改回去。
        smooth: -w.smooth * this.accSmooth,
        survive: w.cycle * w.survive * elapsed,
        // ★ 换脚奖励（**基础项，必须有**）：每交替换一次脚（只要求左右交替 + 在前进）
        switch: w.cycle * w.switch * this.switchCount,
        // ★★ 大位移奖金：按**打折后**的有效迈步距离计价（米 × stepDecay^已迈步数）
        //   "大位移才有奖励" + "在迈步后要高于迈下一步的收益，然后逐渐减弱"
        step: w.cycle * w.step * this.accStepScore,
        // 超线性加成：已完成"步对"数（n=1→0, 2→1, 3→3, 4→6），现在 n 只统计**有效**迈步，
        // 已被"距离计价 + 直线门槛"约束住，抖腿拿不到（实测踩过一次奖励劫持，见 §5.15）。
        step2: w.cycle * w.step2 * ((this.stepCount * (this.stepCount - 1)) / 2),
        // ★★ 静止罚（"抢步罚后面会转为静止罚"）：不在迈步-站稳循环里就一直扣，见 W.still
        still: -w.cycle * w.still * this.accStill,
        // ★★ 抢步罚（"迈一步立刻迈第二步应该是负分"）：见 W.rush
        rush: -w.cycle * w.rush * this.accRush,
        // ★★ 同腿连迈罚（"一条腿连着迈两步更是负上加负"）：见 W.sameFoot
        sameFoot: -w.cycle * w.sameFoot * this.accSameFoot,
        // ★★★ 迈步后保持稳定的加分（循环的第二半）：站稳秒数 × 该步折扣，见 W.hold
        hold: w.cycle * w.hold * this.accHold,
        air: -w.cycle * w.air * this.accAir,
        fall: fallen ? -w.fall : 0,
      };
      t.total = Object.values(t).reduce((a, b) => a + b, 0);
      return t;
    }
    // 战斗：命中为主，但**必须带姿态塑形**（否则全员摔倒时适应度全是负数、梯度恒为零）。
    const t: Record<string, number> = {
      hit: w.hit * this.hits,
      hurt: -w.hurt * this.hurts,
      approach: w.approach * this.accClose,
      upright: w.upright * (this.accUpright - elapsed),
      height: -w.height * this.accHeight,
      balance: -w.balance * this.accBalance,
      smooth: -w.smooth * this.accSmooth,   // ★ 惩罚，负号（见 walk 分支的注释）
      progress: 0.5 * this.progressRaw(),
      fall: fallen ? -w.fall : 0,
    };
    t.total = Object.values(t).reduce((a, b) => a + b, 0);
    return t;
  }

  private finish(fallen: boolean): void {
    this.fallen = fallen;
    const elapsed = this.tick / this.cfg.controlHz;
    const w = this.w;
    this.endTorsoY = this.doll.torso().translation().y;
    this.endTilt = this.doll.tiltOf(this.doll.torso());
    this.endHeadY = this.doll.head().translation().y;
    this.inDomainRatio = this.balanceTicks > 0 ? this.inDomainTicks / this.balanceTicks : 0;
    this.terms = this.fitnessTerms(fallen, elapsed);
    const f = this.terms.total;
    this.fitness = f;
    this.finished = true;
    // 停下马达，避免展示视图里刚体还在挣扎
    for (let i = 0; i < this.motor.length; i++) this.motor[i] = 0;
    this.doll.setMotorTargets(this.motor);
  }

  private progressRaw(): number { return this.tick / this.ticksTotal; }

  /** 重新对齐物理世界（展示视图用：跑完一轮后让角色重新站好） */
  restand(): void {
    this.doll.reset(0);
    this.finished = false;
    this.fallen = false;
    this.subStep = 0;
    this.tick = 0;
    this.phase = 0;
    this.startX = this.doll.torso().translation().x;
  }

  /** 关掉这个 world 时的清理钩子（rapier 没有显式 free，交给 GC） */
  disposeHint(): void {
    for (const b of this.doll.bodies) b.setLinvel(ZERO, false);
  }
}
