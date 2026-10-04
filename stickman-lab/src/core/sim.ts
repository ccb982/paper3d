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
  dcm, dcmExcess, footGrounded, newCom, newSupport, omegaAt, readCom, readSupport,
} from './posture';
import { PelvisFirstTracker, scoreLeg, STANCE_FRAC } from './gaitRef';
import { StepSettleTracker, marginOfStability, mosBand, MIN_SWING, SETTLE_WIN, MIN_CLEARANCE, cadenceScore, TARGET_CYCLE } from './stability';
import { BalanceJudge, wholeBodyAngularMomentum, HEAD_MIN, HEAD_MAX } from './balanceJudge';
import { GaitPhaseMachine } from './gaitPhase';
import { ModuleSet } from './modules';
/** ★ 连续稳住多久才允许发下一条令（s）—— "没稳住就不许迈下一步" */
const SETTLE_HOLD = 0.45;
import { GaitCommander, orderLeg } from './commander';
import {
  AIR_TARGET, JOINT_MOVE_TARGET, MOVE_JOINTS, TARGET_VX, phi,
} from './walkReward';
import { JOINT_ORDER, type Skeleton } from './skeleton';

/** 要"鼓励移动"的关节集合（骨盆=髋、膝盖），见 walkReward.MOVE_JOINTS */
const MOVE_SET = new Set(MOVE_JOINTS);

/**
 * ★★★ 走路模式**参与适应度求和**的项（白名单）。
 *
 * 为什么必须是白名单而不是黑名单：黑名单只能挡住"已知是诊断"的字段，
 * 而 2026-10-01~02 两天陆续加了三十多个诊断字段（cadence / cycleFlick / imbMean /
 * mosMin / wbamNorm / validRatio / footDist / meanStepLen …），它们**全部被当成得分
 * 加进了 total** —— 实测镇定器 total 24.88、零输出 33.11，而站立类门禁
 * （posture/gait/verify）要求"零输出总分很低"，因此一直红着。
 * 白名单的代价是：新增**得分项**时必须往这里加一条；忘了的后果是"该项权重为 0"，
 * 这个失败模式（不生效）比"虚高"安全得多。
 */
const WALK_REWARD_KEYS: readonly string[] = [
  // 前进 / 姿态
  'velTrack', 'yawTrack', 'lateral', 'tiltRate', 'upright', 'height',
  // 迈步本体
  'lift', 'single', 'shift', 'refHip', 'refKnee', 'pelvisFirst',
  // ★ 诊断：盆骨优先**分腿**（左/右/短板腿）—— 不进 total，只为"说清是哪条腿"
  'pelvisFirstL', 'pelvisFirstR', 'pelvisWorst',
  // 迈步 → 调整 的顺序结构
  'settle', 'stepPace', 'moS', 'imbalance', 'stepLen', 'placement', 'cycle', 'stillSwing',
  // 关节运动与代价
  'jointMove', 'jointMotion', 'torque', 'actRate', 'energy', 'survive',
];

export type SimMode = 'walk' | 'fight' | 'stand';

/**
 * ★★ **站立模式专用权重**（2026-10-02）。
 *   目标：**单腿站立存活 ≥ 3 s**（用户："先优化算法，保证单腿能坚持 3s 以上，
 *   然后再写迈腿算法"）。
 *
 *   设计原则（每条都对应一次实测）：
 *   · `single` 是**主项** —— 这个模式的存在理由就是"金鸡独立"。
 *     第一版把它当软加分（walk 权重 2.5，但 `quiet` 同时在白拿）⇒
 *     12 代收敛到"两脚着地 359/360 帧"的退化解。
 *   · `quiet` **归零** —— "少动"就是"不动"的直接成因，去掉它退化解才不划算。
 *   · `alive` 足够大 ⇒ "倒"与"不动"变成**真取舍**：只有抬腿才能拿 single，
 *     但抬腿更容易倒 ⇒ 优化器必须真的去学"怎么单腿站住"，而不是原地罚分。
 *   · `lateral` 给足权重 —— 单腿时额状面支撑面只剩一只脚（Liu 2012），
 *     侧向漂移是主要的倒法。
 */
export const STAND_W = {
  alive: 1.0,      // 存活（s）
  single: 3.0,     // ★主项：恰好一脚着地的时间积分
  upright: 0.8,    // 躯干直立
  height: 1.2,     // 高度不塌
  lateral: 6.0,    // 侧向不漂（单腿时权重调高）
  tiltRate: 0.05,
} as const;


export interface SimConfig {
  /**
   * ★★ **谁在驱动关节**（2026-10-03）。
   *
   *   · `'brain'`（默认）：`controlTick` 调 `brainForward` 并写马达目标（ES 训练路径）
   *   · `'controller'`：**不写**马达目标 —— 由外部的 `Controller` 负责
   *     （`controller.step()` 返回仲裁结果，调用方自己 `setMotorTargets`）
   *
   *   ★ 为什么必须显式开关：`controlTick` 原本无条件 `setMotorTargets(this.motor)`，
   *     会把 `Controller` 刚写进去的目标**覆盖成零基因组的输出** ⇒
   *     控制器退化成开环，而所有指标看起来"正常"（增益扫描 16 行逐位相同）。
   *     这类"被静默覆盖"只有靠显式的所有权声明才能避免。
   */
  driver: 'brain' | 'controller';
  /** 物理步频，越大越稳越贵（120 是刚体-马达链的稳妥档） */
  physicsHz: number;
  /**
   * ★ 死亡后继续推进多少秒的物理（瘫软演出，见 advance）。
   *   这段时间**不再参与评估**（fitness/terms 在 finish() 时已定），纯演出。
   */
  deathFlySeconds?: number;
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
  /** ★ 重心转移项的封顶秒数（"会单腿平衡"这件事值多少）；不封顶会被"永远单腿站"刷满 */
  shiftCapSec: number;
  /** ★ 摆动窗口的占空比（每条腿在一个周期里"抬腿"的时间占比），两腿错开 */
  swingDuty: number;
  /**
   * ★★ 观测消融开关（**只给 tools/probe-closed 用**，正常训练一律 false/不设）。
   *   用来回答"训练出来的到底是闭环反馈还是一段回放"：把观测的某一部分置零，
   *   看轨迹是否变化。变了 = 那一部分真的被用了。
   */
  obsMask?: { clock?: boolean; quat?: boolean; vel?: boolean; joint?: boolean };
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
  /**
   * ★★ **接触柔度**（重构方案 §14.5 F1）—— 足底/地面的法向柔顺性。
   *
   *   Rapier 0.14 **原生支持**：`world.integrationParameters.contact_natural_frequency`
   *   与 `contact_damping_ratio`。这是把"刚性足"变成"柔性足"的最低成本手段：
   *   压力分布从"几何决定"变成"法向柔度加权决定" ⇒ **CoP 变成连续可控量**。
   *
   *   `contactHz = 0` ⇒ 完全刚性（Rapier 默认行为，≈ 无限刚度）。
   *   文献锚点：Loram & Lakie 2002 —— 人类踝的被动刚度是 `mgh` 的 **91%**，
   *   且位于踝的**远端**（足 + 跟腱串联）；Sasagawa 2009 —— **80% mgh 时直立姿态是鞍点**。
   *   ⇒ 目标是把被动刚度抬到 77~109% mgh 那个量级（Lakie 2018：被动背屈 18.7°
   *     可把刚度从 50% 抬到 77% mgh）。
   */
  contactHz: number;
  /** 接触阻尼比（0 = 无阻尼，容易振荡；1 = 临界阻尼）。默认 1 */
  contactDamping: number;
  /** 摔倒判定：躯干高度低于初始的该比例 */
  fallHeightRatio: number;
  /** 摔倒判定：躯干"上方向"偏离世界竖直超过该值（弧度） */
  fallAngle: number;
  /** ★ 头高阈值（m）—— 摔倒判据之一（2026-10-02 由 0.45 放宽到 0.28） */
  headMinHeight: number;
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
  driver: 'brain',
  physicsHz: 120,
  deathFlySeconds: 1.6,
  controlHz: 60,
  duration: 6,
  mode: 'walk',
  gaitHz: 1.15,
  stepVMin: 0.05,
  shiftCapSec: 1.5,
  swingDuty: 0.45,
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
  contactHz: 0,            // ★ 默认关 ⇒ 行为与重构前逐位一致（改它必须重跑全部门禁）
  contactDamping: 1,
  /**
   * 躯干高度低于初始的 (1−ratio) ⇒ 判摔倒（截断）。
   * ★ 从 0.62 收紧到 **0.85**：0.62 太松，**往前塌**不算摔 ——
   *   实测零输出基因组（纯阻尼）会在 0.5 s 内塌 0.41 m、然后一路滑出 **1.25 m**，
   *   而躯干高度还有初始的 70% ⇒ 回合不结束、速度跟踪项被它白拿 0.51 分。
   *   经典配方里 crash ⇒ reset 是"结构上不给退化解留时间"，这里同理。
   */
  // ★ 2026-10-02 放宽（用户："摔倒被判定太严了"、"修，不用限制躯干高度了"）。
  //   回读证据（probe-arch「摔倒瞬间」）：
  //     当前阈值下 存活 3.33s，触发瞬间 rH=1.007 / rT=0.415 / rD=0.232，
  //     **碰地刚体=（无）** ⇒ crash 判据（bodyHitGround）根本没有误伤，
  //     真正的杀手是**躯干高度**：躯干 1.064m vs 阈值 0.75×1.429=1.072m，差 8mm 就摔。
  //     而那姿态是"弯腰低头"（倾角仅 34.5°，远未到 83° 阈值），走路时本来就会这样。
  //   ⇒ 按用户要求**取消躯干高度作为摔倒判据**（设 0 = 关闭），
  //     只保留【倾角】与【刚体碰地】两条 —— 后者已验证不会误伤。
  fallHeightRatio: 0,      // ★ 0 = 不再用躯干高度判摔
  fallAngle: 1.45,         // 倾角阈值 83°
  /** ★ 头高阈值（m）：由 0.45 → 0.28（实测 rD 只到 0.23，从未触发） */
  headMinHeight: 0.28,
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
  // ══════ 走路：walkReward.ts 的 11 项（顺序同那张表）══════
  /** 线速度跟踪 φ(v*−v_x)，v*=0.5 m/s —— 唯一说"往哪儿走"的一项 */
  velTrack: 1.0,
  /**
   * 角速度跟踪 φ(ω*−ω_y)。★ **默认 0**：φ(0)=1 意味着"完全不自转"是满分，而站桩恰好满分
   *   ⇒ 白拿一份分（实测零输出 +0.5）。自转由 tiltRate 罚（已把 ω_y 纳入）。
   */
  yawTrack: 0.0,
  /** 侧向漂移 −v_z² */
  lateral: 4.0,
  /** 翻滚/俯仰角速度罚 */
  tiltRate: 0.05,
  /** 抬腿：Σ_脚 min(1, 腾空/0.5s)·dt —— 交替步态的发动机之一 */
  lift: 1.0,
  /** 单脚支撑（"一次抬一条"）：恰好一脚着地 +1 / 两脚都飞 −0.5 / 都着地 0 */
  single: 2.5,
  /** ★ 重心转移：∫|载荷左−载荷右|dt（0=双脚均分，1=全压一只脚）。迈步真正的第一步。 */
  shift: 2.0,
  /**
   * 逐关节"要动"（骨盆/膝盖），每关节另有 moveScale 倍率。
   * ★ 权重必须**小于 velTrack 的潜在收益**（φ(1)−φ(0.5) = 0.63）：否则策略会去"原地抖"
   *   而不是走 —— 实测 jointMove=1.0 时最好个体 5 代只走 0.03 m，训练全部靠抖腿拿分。
   */
  refHip: 1.5,
  refKnee: 1.5,
  pelvisFirst: 2.0,
  settle: 3.0,
  stepPace: 1.5,
  moS: 0.5,
  imbalance: 2.0,
  /**
   * ★★ 步幅分：**只对"结算过的步"付费**（稳住了、间隔够），目标是 **2~3 个脚长**
   *   （Usherwood 2023 碰撞力学：S = 2 或 3 个脚长；原文明确"短于 2 或长于 3 个脚长
   *   的步态显得别扭、也很少观察到"）。
   *   ★ 这就是"先稳定步幅"的落点：抽搐式的高速蹭脚拿不到任何步长分，
   *   速度再快也换不来钱。
   */
  stepLen: 3.0,
  /**
   * ★ 落点分：摆动脚落点相对**捕获点 ξ** 的误差（Hof 的 XCoM/MoS 体系；综述见
   *   *Control of human gait stability through foot placement*：人主要靠**摆动相的
   *   髋外展肌**调节落点 —— 与"盆骨优先"是同一件事）。
   */
  placement: 1.0,
  /**
   * ★★★ 顺序结构项：完成一个"迈步 → 调整身体"循环才给分（`gaitPhase.ts`）。
   *   用户 2026-10-02："走路大致是迈步，调整身体，再迈步"、
   *   "迈步间隔太小，无法调整自身平衡"。以前所有走路项都是**独立**时间积分，
   *   任何"一直在动"的动作都能同时满足（实测脚高主频 3.9 Hz 的抖动就能刷 ≈3.5 分）；
   *   改成顺序后，**没走完循环一分不给** —— 这是关住抽搐的结构性办法。
   */
  cycle: 3.0,
  /**
   * ★★★ "脚往前迈的时候身体别动，脚落地后身体再动"（用户 2026-10-02 的原话）。
   *   诊断：脚在空中的那一段（单支撑）**支撑面只剩一只脚**，此时身体任何横向平移或
   *   转动都会立刻吃掉本来就只有 1.23 倍余量的稳定裕度（实测抬脚后 CoM 离支撑脚
   *   0.171 m，而单脚侧向半宽只有 0.139 m）。
   *   ⇒ 摆动相**冻结**身体（横向 CoM 速度 + 全身角速度），落地之后才允许动。
   *   与文献一致：Perry 八相分期里双支撑（0~10%、50~60%）才是"调整身体"的时间窗
   *   （见 gaitPhase.ts 的三相状态机）。
   */
  stillSwing: 2.0,
  minCycle: 0.9,
  jointMove: 0.3,
  /** 逐关节倍率（UI 滑块） */
  moveScale: {} as Record<string, number>,
  /**
   * 弯腰驼背罚 ∫(cos tilt − 1)dt。★ 从 0.5 抬到 2.0：这个 rig 被动站不住，
   *   "塌着往前滑"也能拿速度跟踪分（实测零输出基因组滑 0.65 m 拿 velTrack +0.63），
   *   倾角罚必须压过 locomotion 收益，"塌"才不是可行解。
   */
  upright: 2.0,
  /** 高度偏差罚 */
  height: 0.8,
  survive: 0.0,
  /** 关节角速度平方罚 */
  jointMotion: 0.001,
  /** 力矩平方罚 */
  torque: 0.00002,
  /** 电机指令变化率罚（替代旧的 accSmooth；旧版符号写反过一次，"疯狂抽风"反而加分） */
  actRate: 0.25,
  energy: 0.02,
  // ══════ 以下只被 fight 分支用 ══════
  hit: 3.0,
  hurt: 1.0,
  approach: 0.8,
  balance: 2.0,
  fall: 2.0,
} as const;

/** 站立模式：**两脚都着地**的每秒罚分。双脚站立必须是"贵"的，
 *  否则退化解（两脚着地 + 不动）永远最优（实测 12 代每一位不变）。 */
export const STAND_BOTH_FEET = 1.5;

/** 奖励权重表 = `W` 的数值类型（UI 滑块/配置用 `Partial<FitnessWeights>` 覆盖） */
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
  /** ★ 公开给 teacher 的**真实支撑域**（每控制周期由 readSupport 更新）。
   *   平衡门的 MoS 必须用这个 —— 此前 teacher 自己用常数 STANCE_X_HALF 估算，
   *   得出的是假 MoS（实测 −200mm），门因此永闭。 */
  readonly sup = newSupport();

  // ---- 评估状态 ----
  private subStep = 0;
  /** 死亡后还要推进多少物理步（瘫软演出，见 advance） */
  private deathLeft = 0;
  private tick = 0;
  private phase = 0;
  private startX = 0;
  private initTorsoY = 0;
  private accUpright = 0;
  private accHeight = 0;
  private accLateral = 0;
  private accEnergy = 0;
  // ══════ 走路奖励（walkReward.ts 的 11 项）══════
  private accLift = 0;          // Σ_脚 min(1, 腾空/目标)·dt
  private accSingle = 0;        // 单脚支撑时间积分（×dt）
  private gN0 = 0; private gN1 = 0; private gN2 = 0;   // 接地脚数的帧数分布（诊断）
  private accRefHip = 0; private accRefKnee = 0;   // 参考分的时间积分（身体级：两条腿合起来的形状分）
  /** ★★ 盆骨优先**分腿**积分：左腿的髋先动只进 accPelvisL，右腿只进 accPelvisR。
   *  以前是一个 accPelvis 把两腿平均 ⇒ 调试根本说不清"是左腿没过还是右腿没过"。 */
  private accPelvisL = 0; private accPelvisR = 0;
  private pfL = new PelvisFirstTracker(); private pfR = new PelvisFirstTracker();
  private ssL = new StepSettleTracker(); private ssR = new StepSettleTracker();
  private accSettle = 0; private accPace = 0; private accMoS = 0; private accPlace = 0;
  private mosMinSeen = Infinity; private mosSum = 0; private mosN = 0;
  private settleDebug = '';
  private bal = new BalanceJudge();
  private lbuf = new Float64Array(3);
  private footFar = 0;                // ★ 脚的最远前伸（"以脚为准"的距离基准）
  private footDist = 0;                // ★ 有效脚距离（只在头没塌时累加）
  private torsoDist = 0;
  private footVel = 0;                // 脚的速度（m/s）
  private lastFootX = 0;
  private footStart = 0;
  private imbAcc = 0; private validTicks = 0; private stepCycleT = 0;

  /** 诊断：迈步-稳住状态机的末态（为什么没结算） */
  get settleState(): string { return this.settleDebug; }
  private altCount = 0;
  private accSwitchQ = 0;         // Σ 换脚事件时的 φ(v*−v_x)（推进中的换脚才计价）
  private accShift = 0;          // ∫|载荷左−载荷右|dt（重心转移，0..1/秒）          // ★ 换支撑脚次数（"一次抬一条"的事件计数）
  private accTicks = 0;         // 累计控制秒数（给"平均"类分项做分母）
  private accAlive = 0;         // ∫"站得住"因子 dt（门控抬腿/单脚支撑/要动三项）
  private accJtMove: Record<string, number> = {};   // 逐关节"要动"
  private accMoveSum = 0;
  private accJointMotion = 0;   // ∫Σ|q̇|²
  private accTau = 0;           // ∫Στ²
  private accActRate = 0;       // ∫Σ|Δq*|²
  private lastLoadFrac: [number, number] = [0.5, 0.5];   // 上一拍每脚载荷份额（观测用）
  private footTmpL = new Float64Array(3);
  private footTmpR = new Float64Array(3);
  private hipTmp = new Float64Array(3);
  private airL = 0;             // 左脚连续腾空时间
  private airPeakL = 0; private airPeakR = 0;   // 本次腾空的最大脚底高度（离地高度判据）
  private cycTimes: number[] = [];             // 换支撑脚的时刻（节律门用）
  // ── 顺序步态状态机（迈步 → 调整 → 迈步）+ 它需要的逐拍量 ──
  gp = new GaitPhaseMachine();   // ★ teacher 也要读当前相（否则脊椎模块的开关是假的）
  /**
   * ★★★ 发令者（用户 2026-10-02："主动发令控制一个模块，其余模块进行调整和平衡的稳定；
   *   发令顺序是腿、腰、腿；但只发令，别精确控制腿部落点"）。
   *   它只说**哪条腿 / 什么时候到腰 / 该走了没有**，绝不给位置目标。
   *   顺序固定：左腿 → 腰 → 右腿 → 腰 → …；`jitter` 提供反应随机性。
   */
  readonly cmd = new GaitCommander();
  /** 伺服层反馈：上一个动作稳住/落地了才发下一条令（由稳定跟踪器更新） */
  private servoReady = true;
  /** ★ 连续稳住多久才允许发下一条令（s）——"没稳住就不许迈下一步" */
  private settleHold = 0;
  get servoReadyDbg(): boolean { return this.servoReady; }
  /** 发令总数（调试） */
  get cmdOrders(): number { return this.cmd.nOrders; }
  /** 调试：发令时间线 */
  get cmdTimeline(): string { return this.cmd.timeline(); }
  get cmdLabel(): string { return this.cmd.label; }
  /**
   * ★★★ 算法模块开关（用户 2026-10-02："左腿就是左腿，右腿就是右腿，脊椎就是脊椎；
   *   需要代码操控什么时候什么模块起作用，什么不起作用"）。
   *   所有奖励项的"何时生效"门控**统一**走这里，不再各写各的 `if (nGround === 1)`。
   *   调试看 `mod.report(gp.now, nGround)`。
   */
  readonly mod = new ModuleSet();
  private accStill = 0;                        // ★ 摆动相里身体的运动量（要被罚）
  private stillStep = 0; private stillAdjust = 0;   // 诊断：摆动段 vs 调整段的身体运动量
  /** ★ 调试用的当前状态："该迈哪条腿 + 身体该不该动" */
  gpLabel = 'both 过渡（双脚着地）';
  gpSwing: 'l' | 'r' | null = null;
  gpBodyFree = false;
  /** 状态机转移轨迹（含"哪个状态没通过"） */
  get stateTrace() { return this.gp.trace; }
  private accCycle = 0; private gpPaidThisStep = false;
  private cycleN = 0; private cycleFlick = 0; private cycleAdj = 0; private cyclePhase = 'both';
  private lastMosX = 0; private lastSupEdgeX = 0; private lastRefHip = 0; private lastRefKnee = 0;
  private flickerCount = 0;                     // 被判定为接触抖动（离地不够）的次数（诊断）
  private lastAltT = 0;
  private airR = 0;
  private motorPrev: Float32Array;   // 上一拍的马达目标（action rate）
  private accVelTrack = 0;   // ∫(φ(v*−vx) − φ(v*))dt  （扣基线，站桩 = 0）
  private accYaw = 0;        // ∫φ(−ω_y)dt
  private accLat = 0;        // ∫v_z² dt
  private accTilt = 0;       // ∫|ω|² dt
  private accVel = 0;
  private accClose = 0;
  /** ★ DCM 越界积分（无量纲，见 W.balance） */
  private accBalance = 0;


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
  fallReason: '' | 'height' | 'tilt' | 'head' | 'crash' = '';
  /** ★ 摔倒瞬间的判据快照（用户 2026-10-02：看到底是什么触发摔倒） */
  fallDiag: { rH: number; rT: number; rD: number; torsoY: number; headY: number; tiltDeg: number; hit: string } = { rH: 0, rT: 0, rD: 0, torsoY: 0, headY: 0, tiltDeg: 0, hit: '' };
  /** ★ 诊断：中止瞬间的姿态（跑满时长 = 结束瞬间），用于区分"倒"与"蹲塌" */
  endTorsoY = 0;
  endTilt = 0;
  endHeadY = 0;
  /** ★ 诊断：ξ 同时落在 x/z 域内的控制周期占比（"站住了"的直接指标） */
  inDomainRatio = 0;
  /** 支撑域内占比（诊断：域内 CoM 占比，DCM 判据已从走路奖励里去掉） */
  private supInRatio = 0;
  private supTicks = 0;
  private inDomainTicks = 0;
  private balanceTicks = 0;

  constructor(sk: Skeleton, shape: BrainShape = BRAIN_SHAPE, cfg: SimConfig = DEFAULT_SIM) {
    // ★★★ **形状硬断言**（2026-10-03）：网络的输入/输出维数必须与骨架关节数一致。
    //
    //   为什么必须硬抛：`BRAIN_SHAPE = shapeForJoints(9)`，而本 rig 是 **12 关节**。
    //   任何 `new Sim(sk)` / `new Sim(sk, undefined, cfg)` 都会拿到 9 关节的脑子：
    //     · `params` 长度按 9 关节算（3803 而不是 4676）
    //     · `controlTick` 往 90 维的 `x` 里写 108 维 ⇒ **超出的 18 维被静默丢弃**
    //     · `setMotorTargets` 只下到第 9 个关节 ⇒ 后面的膝/踝/腰**完全没有指令**
    //   全程**不报错**，只是行为诡异地退化（实测：10 个物理步内 com 全变 NaN）。
    //   ⇒ 这里直接抛，别让它安静地跑出假数据。
    const n = sk.joints.length;
    const expIn = 36 + 6 * n, expOut = 3 * n;
    if (shape.inputs !== expIn || shape.outputs !== expOut) {
      throw new Error(
        `[sim] 网络形状与骨架不符：shape ${shape.inputs}→${shape.outputs}，`
        + `但骨架 ${n} 关节要求 ${expIn}→${expOut}。`
        + '请传 shapeForJoints(sk.joints.length)（BRAIN_SHAPE 是 9 关节的默认值，不能用于本 rig）。',
      );
    }
    this.sk = sk;
    this.cfg = cfg;
    this.shape = shape;
    this.w = { ...W, ...cfg.weights };

    this.dt = 1 / cfg.physicsHz;
    this.stages = Math.max(1, Math.round(cfg.physicsHz / cfg.controlHz));
    this.ticksTotal = Math.max(1, Math.round(cfg.duration * cfg.controlHz));

    this.buildWorld();

    this.params = new Float32Array(brainParamCount(shape));
    this.x = new Float32Array(shape.inputs);
    this.hidden = new Float32Array(shape.hidden);
    this.out = new Float32Array(shape.outputs);
    this.motor = new Float32Array(this.doll.jointCount * 3);
    this.motorPrev = new Float32Array(this.doll.jointCount * 3);
    for (const k of MOVE_JOINTS) this.accJtMove[k] = 0;

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
    // ★★ F1：接触柔度。contactHz=0 ⇒ 不设置（Rapier 默认刚性 ⇒ 与旧行为逐位一致）
    if (this.cfg.contactHz > 0) {
      const ip = w.integrationParameters;
      ip.contact_natural_frequency = this.cfg.contactHz;
      const dr = (ip as unknown as { contact_damping_ratio?: number });
      if ('contact_damping_ratio' in dr) dr.contact_damping_ratio = this.cfg.contactDamping;
    }
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
  /**
   * ★ 只读访问器：**给探针/门禁用**（它们需要 `new Float32Array(sim.params.length)`
   *   来填一个零基因组）。
   *
   *   ⚠ 之前探针直接读 `sim.params`（private）—— 10 处类型错误，
   *     而 `tools/` 长期不做类型检查，所以没人发现"探针在戳私有成员"。
   *     与其放宽 TS 的 private，不如给一个**文档化的只读口**：
   *     探针本来只需要"参数个数"，不需要那个数组本身。
   */
  get paramCount(): number { return this.params.length; }
  /** 只读：当前基因组的参数（探针诊断用；改动它会污染模拟，故不给 setter） */
  get paramView(): Readonly<Float32Array> { return this.params; }
  get progress(): number { return this.tick / this.ticksTotal; }
  /** ★ 净前进距离（跑到此刻为止的位移；"最远距离"已弃用，见 W 的注释） */
  /**
   * ★★ 距离改为**以脚为准**（用户 2026-10-02："移动距离应该以脚的移动为准"）。
   * 原来用的是躯干 x —— 于是"整个人往前扑倒"会被算成"走了很远"，
   * 策略只要向前扑就能拿满速度分（实测零输出基线都能量到 0.65 m）。
   * 真正的判据是"支撑面（脚）在前进"：Hof 的说法是，走路是**支撑面前进**，
   * 不是质心前进；质心冲出支撑面而脚没跟上，那就是**摔**。
   * ★ 而且只在**头没塌**（`valid`）时累加：身体已经塌下去时往前扑**一分不给**。
   */
  get distance(): number { return this.footDist; }
  /** 诊断：躯干位移（用来对比"脚走了多少 vs 人扑了多远"） */
  get torsoDistance(): number { return this.torsoDist; }
  /** 诊断：脚的速度（m/s） */
  get footSpeed(): number { return this.footVel; }
  /** 诊断：头的世界高度 */
  private headTopY(): number {
    let y = -1e9;
    for (const b of this.doll.bodies) { const t = b.translation(); if (t.y > y) y = t.y; }
    // 加上该刚体自身半高（用脚掌实测口径近似：这里只关心相对变化，取最高点 + 该体半高）
    return y + 0.10;
  }
  /** 两只脚的最远前伸（x） */
  private footMaxX(): number {
    return Math.max(this.footTmpL[0]!, this.footTmpR[0]!);
  }
  /** 诊断：本回合的电机指令变化率积分（替代旧的抖动积分 Σ(Δτ)²，见 W.actRate） */
  get actionRateCost(): number { return this.accActRate; }

  // ------------------------------------------------------------ 生命周期

  /** ★ UI 滑块：运行时改权重（只接受新配方那 11 项的键） */
  setWeights(w: Partial<typeof W>): void {
    this.w = { ...this.w, ...w };
  }

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
    // ★ 平衡判据的参考头高：用初始站姿的头顶高度（"头必须在该在的高度"）
    this.bal.setRefHead(this.headTopY());
    // ⚠ 必须**先刷新**脚的临时向量再读 footMaxX：footTmpL/R 是逐帧复用的缓冲，
    //   不刷新的话这里读到的是**上一个个体**残留的脚位置 ⇒ 起点不同 ⇒
    //   "复用 Sim ≡ 新建 Sim"门禁失败（实测 3/4 个不同，最大差 9.6e-2）。
    this.doll.soleXZ('l', this.footTmpL);
    this.doll.soleXZ('r', this.footTmpR);
    this.lastFootX = this.footMaxX();
    this.footFar = this.lastFootX;
    this.footStart = this.lastFootX;

    this.subStep = 0;
    this.tick = 0;
    this.phase = 0;
    this.accUpright = 0; this.accHeight = 0; this.accLateral = 0;
    this.accEnergy = 0; this.accVel = 0; this.accClose = 0; this.accBalance = 0;
    // 走路奖励记账器（walkReward.ts）
    this.gN0 = 0; this.gN1 = 0; this.gN2 = 0;
    this.accRefHip = 0; this.accRefKnee = 0; this.accPelvisL = 0; this.accPelvisR = 0;
    this.pfL.reset(); this.pfR.reset();
    this.ssL.reset(); this.ssR.reset();
    this.accSettle = 0; this.accPace = 0; this.accMoS = 0; this.accPlace = 0;
    this.bal.reset();
    this.footFar = 0; this.footDist = 0; this.torsoDist = 0; this.footVel = 0;
    this.lastFootX = 0; this.imbAcc = 0; this.validTicks = 0; this.stepCycleT = 0; this.mosMinSeen = Infinity; this.mosSum = 0; this.mosN = 0;
    this.accLift = 0; this.accSingle = 0; this.accTicks = 0; this.accMoveSum = 0; this.accAlive = 0;
    this.altCount = 0; this.accShift = 0; this.accSwitchQ = 0; this.doll.resetAlt();
    this.accJointMotion = 0; this.accTau = 0; this.accActRate = 0;
    this.airL = 0; this.airR = 0; this.motorPrev.fill(0);
    this.airPeakL = 0; this.airPeakR = 0; this.cycTimes = []; this.lastAltT = 0;
    // ⚠ 观测里的每脚载荷份额也必须重置：漏掉它时，**复用的 Sim** 会把上一代的
    //   载荷带进下一个个体的第一帧，而新建的 Sim 从默认值开始 ⇒
    //   "存档→续训"在第 4 代开始与"一路训到底"分叉（实测 1.490 vs 1.508）。
    //   这条由 verify-core 的"复用 Sim ≡ 新建 Sim"门禁永久盯着。
    this.lastLoadFrac = [0.5, 0.5];
    this.gp.reset(); this.accCycle = 0; this.gpPaidThisStep = false;
    this.accStill = 0; this.stillStep = 0; this.stillAdjust = 0;
    this.mod.reset();          // ★ 每回合恢复全部模块到默认（代码可中途关）
    this.cycleN = 0; this.cycleFlick = 0; this.cycleAdj = 0; this.cyclePhase = 'both';
    this.lastMosX = 0; this.lastSupEdgeX = 0; this.lastRefHip = 0; this.lastRefKnee = 0;
    this.accVelTrack = 0; this.accYaw = 0; this.accLat = 0; this.accTilt = 0;
    for (const k of MOVE_JOINTS) this.accJtMove[k] = 0;
    this.supInRatio = 0;
    this.supTicks = 0;
    this.inDomainTicks = 0;
    this.balanceTicks = 0;
    this.peakDcmX = 0;
    this.peakDcmZ = 0;

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
  /**
   * ★ 死亡后继续推进物理（`deathSteps` 步），让瘫软的角色被带着飞出去
   *   （用户 2026-10-04：「当角色死亡的时候我觉得可以恢复这个状态让他飞出去」）。
   *
   *   之前 `finish()` 之后 `advance()` 直接 return，所以尸体站着不动、像卡住。
   *   现在：死亡 ⇒ 只结束**评估**（fitness/terms 已定、不再变），物理照跑，
   *   马达已瘫软（`setLimp`），于是重力 + 接触 + 残余动量接管，角色被甩出去。
   *   跑完 `deathSteps` 后彻底停止。
   */
  advance(budgetSteps: number): number {
    if (this.finished) {
      if (this.deathLeft <= 0) return 0;
      const used0 = this.deathLeft;
      let n = 0;
      while (n < budgetSteps && this.deathLeft > 0) {
        this.doll.driveMotors(this.dt);
        this.world.step();
        this.doll.enforceLimits();
        this.doll.primeVelocities();   // ★ 同上：死亡演出也要维持力链
        if (this.doll.supportPointOn) this.doll.applySupportPoint(this.dt);
        this.deathLeft--; n++;
      }
      return Math.min(used0, n);
    }
    let used = 0;
    while (used < budgetSteps && !this.finished) {
      if (this.subStep === 0) this.controlTick();
      // ★ 关节力矩每物理步施加一次（网络只在控制周期被调用，力矩是连续量）
      this.doll.driveMotors(this.dt);
      this.world.step();
      // ★ 逐轴关节限位约束**必须在步后**施加（2026-10-02）。
      //   Rapier 0.14 球铰不支持逐轴限位（见 ragdoll.enforceLimits 注释），
      //   我们在冲量层自己做。若放在 driveMotors（= world.step 之前），
      //   求解器在步内产生的接触响应看不见 ⇒ 踝实测跑到 +96.5°（限位 +18°）。
      this.doll.enforceLimits();
      // ★★ 采一帧速度，供 `Ragdoll.jointForce` 做**窗口差分**（2026-10-04 补）。
      //
      //   为什么必须在这里：`jointForce` 算的是「子树净力 = m·(a_com − g)」，
      //   其中 a_com 要用**N 步之前**的速度做差分（VEL_WIN=5 步 ≈ 42ms，
      //   单步差分会把落地冲击读成 109 kN）。写环的**唯一**入口是
      //   `primeVelocities()`，而它此前**从不被调用** ⇒ `velFrames` 永远
      //   < VEL_WIN ⇒ `velOld()` 一直返回 null ⇒ `jointForce` **整条力链
      //   全部返回 0**（连子树质量都是 0）。
      //
      //   ⇒ `controller.ts:178` 写进 `rigState.forceBuf` 的一直是全零，
      //   HUD 的自下而上力链一直在显示**假数据**（"没力"而不是"接口坏了"）。
      //
      //   位置 = `world.step()` 之后（契约如此，且要看到接触响应后的速度）。
      this.doll.primeVelocities();
      // ★ 虚拟支撑点：让踝获得 CoP 权限（踝策略=CoP策略，文献里的主力通道）。
      //   此前踝指令对动力学零效力，根因是刚性平底盒把压力中心锁死。
      if (this.doll.supportPointOn) this.doll.applySupportPoint(this.dt);
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
   * ★★ 运行时调奖励规则（UI 滑块/开关用，用户 2026-10-01："做成可调的按钮"）：
   *   · `straight=false` ⇒ 取消"这一脚必须直线"（`stepMaxDz` 放到无穷大），
   *     只保留换脚奖励与位移门槛；
   *   · `minDx` ⇒ 改"一次有效迈步所需的净前进"（0 = 不设门槛）。
   *   换脚奖励本身（W.switch）**不受这里影响**，它必须一直在。
   */
  /**
   * ★ 诊断（走路奖励）：腾空/单脚支撑/逐关节移动 —— 经典配方里"交替步态从哪来"的全部证据。
   *   `singleRatio` = 恰好一脚着地的时间占比（"一次抬一条"的直接度量）。
   */
  /** ★ 调试：接触/腾空的原始计数（一脚着地=0、双脚=1、离地=2 的帧数），用来定位"为什么换脚数是 0" */
  get rawGround(): { n0: number; n1: number; n2: number; accSingle: number; accLift: number; switchQ: number; alive: number } {
    return { n0: this.gN0, n1: this.gN1, n2: this.gN2, accSingle: this.accSingle, accLift: this.accLift, switchQ: this.accSwitchQ, alive: this.accTicks > 0 ? this.accAlive / this.accTicks : 0 };
  }

  get walkStat(): {
    airL: number; airR: number; singleRatio: number; moveFrac: number;
    jtMove: Record<string, number>; supInRatio: number; inDomainRatio: number;
  } {
    const E = Math.max(0.2, this.accTicks);
    const jt: Record<string, number> = {};
    for (const k of MOVE_JOINTS) jt[k] = (this.accJtMove[k] ?? 0) / E;
    return {
      airL: this.airL, airR: this.airR,
      singleRatio: this.accSingle / E,
      moveFrac: this.accMoveSum / E / MOVE_JOINTS.length,
      jtMove: jt,
      supInRatio: this.supTicks > 0 ? this.supInRatio / this.supTicks : 0,
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

  /**
   * 最近一帧的观测向量（`x`）。给行为克隆/探针用：teacher 采数据时要记下
   * "这一刻看到了什么"，才能训出 `观测 → 目标` 的映射。
   */
  observation(): Float32Array {
    return this.x;
  }

  private controlTick(): void {
    const doll = this.doll;
    const p = this.params;

    // ---- 步态时钟 ----
    this.phase += this.cfg.gaitHz / this.cfg.controlHz;
    if (this.phase >= 1) this.phase -= Math.floor(this.phase);

    // ---- 填输入（布局见 brain.ts 的 INPUT_LAYOUT，共 36 + 6N 维）----
    const torso = doll.torso();
    const tp = torso.translation();
    const tv = torso.linvel();
    const tw = torso.angvel();
    const tq = torso.rotation();
    const x = this.x;
    const c2 = Math.PI * 2;

    x[0] = Math.sin(this.phase * c2);
    x[1] = Math.cos(this.phase * c2);
    // ★ 观测消融（探针用，见 SimConfig.obsMask）
    if (this.cfg.obsMask?.clock) { x[0] = 0; x[1] = 0; }
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
    // ★ 关节反馈消融（探针用）
    const noJoint = this.cfg.obsMask?.joint === true;
    const noQuat = this.cfg.obsMask?.quat === true;
    const noVel = this.cfg.obsMask?.vel === true;
    for (let i = 0; i < doll.jointCount; i++) {
      doll.jointRot(i, jb);
      if (noJoint) { x[k] = 0; x[k + 1] = 0; x[k + 2] = 0; k += 3; } else { x[k++] = jb[0]; x[k++] = jb[1]; x[k++] = jb[2]; }
    }
    for (let i = 0; i < doll.jointCount; i++) {
      doll.jointRelVel(i, jb);
      if (noJoint) { x[k] = 0; x[k + 1] = 0; x[k + 2] = 0; k += 3; } else { x[k++] = jb[0] * 0.2; x[k++] = jb[1] * 0.2; x[k++] = jb[2] * 0.2; }
    }
    if (noQuat) { for (let q = 2; q <= 5; q++) x[q] = 0; }
    if (noVel) { for (let q = 6; q <= 11; q++) x[q] = 0; }
    x[k] = doll.soleY('l');
    x[k + 1] = doll.soleY('r');
    // ★★ 新增：每只脚的**载荷份额**（controlTick 里已经算过，这里白拿）。
    //   为什么必须给网络：真正行走时"哪条腿在摆"是由**载荷**决定的（被压住的是支撑腿，
    //   卸载的才能摆）。固定的反相正弦做不到 —— 两条腿对称摆 ⇒ 支撑腿也在摆，
    //   永远没有稳定支撑相。实测没有这一路时线性基因组只能踩 2 步且一路倒退
    //   （tools/probe-capgen）。有了它，摆腿可以写成线性的：
    //   hip = A·(载荷左 − 载荷右) —— 载荷大的伸（支撑）、小的屈（摆动），
    //   差值的正反馈自然形成交替。
    // ★ 量化到 1%：求解器冲量在不同 Sim 实例之间不是逐位可复现的
    //   （实测存档往返的适应度会在第 6 位数字上分叉），观测里放未量化的求解量
    //   会让"同一份基因组重放得分一致"这条门禁失效。1% 的精度对策略完全够用。
    const lf = this.lastLoadFrac;
    x[k + 2] = Math.round(lf[0] * 100) / 100;
    x[k + 3] = Math.round(lf[1] * 100) / 100;
    // ★★★ 每条腿的**摆动窗口**（0~1 的平滑脉冲，两腿反相、带占空比）。
    //   为什么必须有：行走里"该抬哪条腿"是一个**不连续**的决策，而网络输入是线性的
    //   组合 —— 固定反相正弦只能让两条腿**对称**摆（实测：支撑腿也在摆，永远没有支撑相，
    //   基因组版只能踩 2 步还倒退）。把"摆动窗口"直接喂进去，抬腿就变成
    //   `hip = −A·swingL` 这样**一行线性**就能写出来的事。
    //   窗口内是 sin(π·s)（两端为 0 ⇒ 支撑相真的是 0），占空比 cfg.swingDuty。
    {
      const duty = Math.max(0.15, Math.min(0.85, this.cfg.swingDuty));
      const ph = this.phase >= 1 ? this.phase - 1 : this.phase;
      const w1 = (q: number): number => {
        if (ph >= q || ph < q - 1 + duty) return 0;           // 不在窗口里
        const s = (ph - (q - 1 + duty) + 1) / duty;            // 窗口内归一化进度 0..1
        return Math.sin(Math.PI * Math.max(0, Math.min(1, s)));
      };
      x[k + 4] = w1(0);                                        // 左腿窗口
      x[k + 5] = w1(duty);                                     // 右腿窗口（错开一个占空比）
    }
    // ★★★ 脚掌的**世界 x / z**（每只脚 2 个，共 4 维）。
    //   缺了它，策略看不见自己的脚落在哪 ⇒ 无法"把支撑脚撑住"也无法"把摆动脚落到捕获点"，
    //   线性策略只能两条腿对称运动（实测：脚抬到 0.10 m 但换脚数 0，是跳不是步）。
    doll.soleXZ('l', this.footTmpL); doll.soleXZ('r', this.footTmpR);
    // ★★ 用**相对 CoM**的量，不是世界绝对坐标、也不是相对支撑域中心：
    //   · 绝对 x 会随行走漂到几十米，线性权重没法用；
    //   · 相对支撑域中心更糟 —— sup.cx 就是两脚中点，于是这一项恒等于 ±半步宽，
    //     脚的位置信息被**完全抵消**（我踩过这个坑）。
    //   Raibert 落脚要的就是"脚相对身体在哪"，所以基准取 CoM：x[16] 里还有 CoM 速度，
    //   目标位置 ẋ/ω 同样是线性的 ⇒ 整条落脚规则可以写成一层线性权重。
    // ★ 量化到 1 mm：亚毫米的落脚位置对策略没有意义，但**求解器状态**有 ——
    //   两个 Sim 实例的接触求解顺序会因内存布局不同而差最后几位，策略一旦直接读
    //   脚的位置，1e-16 的差异会被放大（实测存档往返适应度 1.833 vs 1.505）。
    //   量化把这种噪声挡在策略外面。仍然不保证逐位一致，见 probe-persist 的说明。
    const q1 = (v: number): number => Math.round(v * 1000) / 1000;
    x[k + 6] = q1(this.footTmpL[0] - com.x);
    x[k + 7] = q1(this.footTmpR[0] - com.x);
    x[k + 8] = q1(this.footTmpL[2] - com.z);
    x[k + 9] = q1(this.footTmpR[2] - com.z);
    // ★★★ 每条腿的**髋→脚向量** (dx, dy, d)，各 3 维、共 6 维。
    //   为什么非有不可：teacher 的动作就是二连杆 IK（acos/atan2），自变量正是这个向量。
    //   网络之前看不见自己的腿长，只能用 tanh 硬拟合那套三角函数 —— 行为克隆 MSE 卡在
    //   0.17、克隆网络实测 −0.832 m / 0 步。喂进去之后 IK 退化成"d 的一维平滑函数"。
    for (let s2 = 0; s2 < 2; s2++) {
      const side = s2 === 0 ? 'l' : 'r';
      const fp = s2 === 0 ? this.footTmpL : this.footTmpR;
      doll.hipPoint(side, this.hipTmp);
      const dx = q1(fp[0]! - this.hipTmp[0]!);
      const dy = q1(fp[1]! - this.hipTmp[1]!);
      x[k + 10 + s2 * 3] = dx;
      x[k + 11 + s2 * 3] = dy;
      x[k + 12 + s2 * 3] = q1(Math.hypot(dx, dy));
    }

    // ---- 前向 → 马达 ----
    // ★ 输出语义 = 目标**关节角**（不是角速度），见 ragdoll.setMotorTargets / posRefScale
    //   ⚠ `driver === 'controller'` 时**跳过**：马达目标由 `Controller` 拥有。
    //     这里若继续写，就会把控制器的输出覆盖掉（历史事故：控制器全程开环，
    //     表现为"增益扫描所有行结果一样"）。
    if (this.cfg.driver === 'controller') return;
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
    if (this.cfg.mode === 'fight') this.accBalance += (eX * eX + eZ * eZ) * dt;
    if (eX === 0 && eZ === 0) this.inDomainTicks++;
    this.balanceTicks++;
    // ══════ ★★ 走路奖励：逐拍积分（唯一一套，定义见 walkReward.ts 的 11 项）══════
    //  ① 抬腿 / 单脚支撑：靠"脚是否接地"（几何判据 posture.footGrounded）。
    //     ★ **交替步态就是从这两项长出来的** —— 不需要相位时钟、不需要换脚检测
    //       （Rudin 2022 原文：奖励与动作空间里"没有任何步态相关元素"）。
    const gL = footGrounded(doll, 'l'), gR = footGrounded(doll, 'r');
    const nGround = (gL ? 1 : 0) + (gR ? 1 : 0);
    if (nGround === 0) this.gN0++; else if (nGround === 1) this.gN1++; else this.gN2++;
    // ★ 换支撑脚事件（Ragdoll 内部维护上一拍状态；双脚离地/都着地时也要喂进去）
    const stanceNow: 0 | 1 | 2 = nGround === 0 ? 0 : gL ? 1 : 2;
    const altNow = nGround === 1 && this.doll.altEvent(stanceNow, dt);
    if (altNow) this.altCount++;
    // ★★★ **收敛点的唯一推进处**：把离地净空峰值交给统一判定，并在固定时间线上
    //   推进它一次（与 `altEvent` 同一处、同一拍）。
    //   ⚠⚠ 必须在这里推进、而不是在被读取的地方 —— 见 `Ragdoll.advanceStance`
    //     的病历：读时推进会让"读诊断"产生副作用，奖励求值顺序一变状态就分叉
    //     （实测 `probe-fitness` 首次不一致从第 21 代提前到第 13 代）。
    //   净空峰值用 `max(L,R)`：任一脚离地才算单支撑，不预设是哪只。
    this.doll.stanceClearancePeak = Math.max(this.airPeakL, this.airPeakR);
    this.doll.advanceStance(dt);
    this.airL = gL ? 0 : this.airL + dt;
    this.airR = gR ? 0 : this.airR + dt;
    // ★ 记录本次腾空的**最大脚底高度**（离地高度判据用，见 MIN_CLEARANCE）
    if (gL) this.airPeakL = 0; else this.airPeakL = Math.max(this.airPeakL, this.doll.soleY('l'));
    if (gR) this.airPeakR = 0; else this.airPeakR = Math.max(this.airPeakR, this.doll.soleY('r'));
    // ★★★ 腾空分只在"**恰好一脚离地**"时给满：双脚同时离地（蹦跳）只给一半。
    //   原来两条腿的腾空时间是各自独立累加的 ⇒ 蹦一下拿双份分。
    //   实测训练 4 代的收敛方向：抬腿项一路涨到 2.81，而换脚数一直是 0 ——
    //   策略学会了"两只脚一起跳"，因为那比"一次抬一条"更容易从站桩状态达到。
    //   交替行走要的是"一次抬一条"，奖励里必须写死这件事。
    // ★★ 离地**高度**门槛：一步必须真的抬起来 ≥ MIN_CLEARANCE 才算数。
    //   没有它，`single`(2.5)+`lift`(1.0) 只看"有没有一脚离地"，
    //   高频小幅抖动就能全额刷 ≈3.5 分 ⇒ 这就是"高频抽搐"的奖励根源。
    const air = Math.min(1, this.airL / AIR_TARGET) + Math.min(1, this.airR / AIR_TARGET);
    const clL = this.airPeakL >= MIN_CLEARANCE, clR = this.airPeakR >= MIN_CLEARANCE;
    const cl = (nGround === 1) ? (gL ? clR : clL) : (nGround === 0 ? (clL && clR) : false);
    this.accLift += air * (nGround === 1 ? 1 : nGround === 0 ? 0.5 : 0) * (cl ? 1 : 0.15) * dt;
    // ★★ "站得住"门控因子：只有**身体还在控制中**（躯干没歪、没塌下去），
    //   抬腿/单脚支撑/要动这三项才算数。
    //   为什么要：不加的话**摔倒过程本身会拿高分** —— 零输出基因组（纯阻尼、站桩）
    //   塌下去时关节乱动，jointMove 拿到 0.575（实测），"往地上倒"变成得分项。
    //   ★ 只用**高度**判据（塌下去 = 真摔），**不用倾角**：走路本来就会前倾/body 会上下起伏，
    //     加倾角会把真正在走的步态也筛掉（实测 1.25 m 的种子步态 alive 只有 0.247，
    //     它的抬腿/单脚支撑分被门控吃掉 3/4）。倾角由 upright 项单独罚。
    //   高度比 <0.6（塌下去）⇒ 0；≥0.8（站直）⇒ 1。**必须先夹到 0..1 再除**，
    //   否则上限会变成 1/0.2 = 5（实测 aliveAvg 打出 1.69，就是这么来的）。
    const hRatio = tp.y / Math.max(0.2, this.initTorsoY);
    const alive = Math.max(0, Math.min(1, (hRatio - 0.6) / 0.2));   // 0.6→0, 0.8→1
    this.accAlive += alive * dt;
    // ★ 双足补充项（Rudin 换到 Cassie 双足时必须加的那一项）：**恰好一脚着地 +1**；
    //   **两脚都离地 −0.5**（跳/摔）；**两脚都着地 −0.15**（站桩/蹭地滑行）。
    //   ⚠ 最后那个负分是实测逼出来的：我把 lift 写成饱和形式 min(1, air/T)（不会因"两脚一起飞"
    //   而刷分）之后，"从不抬脚"就变成了 0 分 ⇒ ES 找到"两脚不离地滑行 0.63 m"，
    //   lift=0、single=0、velTrack 还有分（实测 6 代都是这个解）。
    //   "一次抬一条"的反面就是"两脚都在地上"，必须给它负分。
    // ★★★ 重心转移 + 换支撑脚（用户 2026-10-01："抬一次脚就摔了，什么也学不到"）。
    //   实测根因：抬脚后 CoM 离支撑脚 0.171 m，而单脚侧向半宽只有 0.139 m ⇒ **差 1.23×**，
    //   所以"抬脚"在现几何下几乎不会出现（种子步态的鞋底离地峰值只出现在倒塌过程中，
    //   站立期间两脚始终贴地）⇒ 直接教抬腿 = 教一个学不到的动作。
    //   但**髋外展限位 ±45°、骨盆横向可移 ~0.15 m**，够把重心挪到支撑脚上 ——
    //   这才是迈步真正的第一步（Raibert 落脚点 / 捕获点那套在控的量）。奖励分两层：
    //     ① `shift`    = ∫|载荷左−载荷右|dt   （连续 0..1：把体重挪到一只脚上就有分）
    //     ② `altCount` = 换支撑脚次数（载荷 >70% 从一只脚换到另一只脚，0.15 s 不应期）
    //   判据用**接触力分配**而不是几何接触：抬 1~2 cm 的小步几何测不到，而且 Rapier
    //   窄相会保留**预测性接触**（脚离地 9 cm 仍报接触，踩过）。
    const [fl2, fr2] = this.doll.footLoadFrac(dt);
    this.lastLoadFrac = [fl2, fr2];
    if (this.mod.active('loadShift', this.gp.now, nGround, null)) this.accShift += Math.abs(fl2 - fr2) * dt;
    const dom = fl2 > 0.7 ? 1 : fr2 > 0.7 ? 2 : 0;
    // ★ 必须"真的单脚着地"才算换支撑脚：载荷份额 >70% **且** 该脚接触地面、另一脚离地。
    //   只看载荷会被前后晃动钻空子 —— 实测**站桩不动的镇定器**能拿到 13 次"换脚"
    //   （前后倾让载荷在两脚间来回跨 70% 阈值），于是它成了最优解而完全没在走。
    const domGround = dom === 1 ? gL : dom === 2 ? gR : false;
    const otherGround = dom === 1 ? gR : dom === 2 ? gL : true;
    if (dom !== 0 && domGround && !otherGround && this.doll.altEvent(dom, dt)) {
      // ★★★ 换支撑脚也必须"**真的抬起来了**"（离地峰值 ≥ MIN_CLEARANCE）。
      //   实测（probe-gaitcycle ⑤）：脚高信号主频 **3.90 Hz**、离地峰值中位 **0 mm**、
      //   88% 的"离地"不到 3 cm ⇒ 之前的"单支撑/换脚"大多是**接触抖动**（contact flicker），
      //   脚还踩在地上。`footGrounded`（contactDist ≤ 2 mm）在这种抖动里会闪，
      //   于是 altCount / altGate 全被假的"迈步"点亮 —— 这就是"高频抽搐"的物理来源。
      const airPeak = dom === 1 ? this.airPeakR : this.airPeakL;   // 离地那只脚
      if (airPeak < MIN_CLEARANCE) { this.flickerCount++; } else {
      this.altCount++;
      // ★ 记录换支撑脚时刻，供**节律门**用（高频抽搐在这一步就会被量出来）
      const tNow = this.tick / this.cfg.controlHz;
      if (this.lastAltT > 0) this.cycTimes.push(tNow - this.lastAltT);
      this.lastAltT = tNow;
      // ★★ 换脚**只有在正在推进时才计价**：φ(v*−v_x)。
      //   不加这一层的话实测 6 代就学会"原地金鸡独立式交替"（换脚 14 次/6s = 2.3Hz，
      //   而 velTrack −0.18、位移 −0.38 m）—— 交替本身被当成了终点。
      //   加了之后："迈步"必须同时是"往前走的迈步"，原地抖腿一分不给。
      this.accSwitchQ += phi(TARGET_VX - this.footVel);
      }
    }
    // ★★★ 这里原来漏了**正项**：只累加了"双脚离地"的罚，从来没记过"恰好一脚着地"的时间。
    //   后果很致命：Rudin 那套配方里最核心的"单腿支撑"项永远拿不到正分
    //   （实测 teacher 走完 4 次真实换脚，单腿支撑占比仍是 0.000），
    //   于是"抬一条腿"在奖励里**一分为二** ⇒ ES 当然去学"两脚都踩着不动"。
    //   这才是"训练一直偏好站着不动"的根因（不是权重配得不好）。
    //   判据用**几何接触**（不是载荷）：这一步只要求"确实一脚离地"，能挣到分就行，
    //   质量更高的部分由上面的 `shift`（载荷转移）和 `accSwitchQ`（换支撑脚）负责。
    //   ⚠ 正分（确实一脚离地）走模块表；**负分（两脚都离地=跳）永远生效** ——
    //   "禁止跳"是物理安全约束，不是步态时序约束，不能被相位门控关掉。
    if (this.mod.active('singleSupport', this.gp.now, nGround, null))
      // ★★ 收敛点：`单支撑` 正分读**统一判定** `doll.stanceSingleNow`（纯读取）。
      //   不用裸接触数 `nGround === 1` —— 本文件上方的实测注释写着
      //   「88% 的"离地"不到 3 cm ⇒ 之前的单支撑/换脚大多是接触抖动」。
      //   ⚠ `nGround` 保留给"**有几只脚在接触**"这个**事实性**用途
      //     （`gN0/gN1/gN2` 记账、`altEvent` 换脚事件、`nGround===0` 禁跳罚分）——
      //     那是接触数，不是"是否真单支撑"的判断，两者不该混用。
      this.accSingle += (this.doll.stanceSingleNow ? 1 : 0) * (cl ? 1 : 0.1) * dt;
    if (nGround === 0) this.accSingle += -0.5 * (cl ? 1 : 0.1) * dt;
    // ★★★ 站立模式：**两脚都着地必须罚**（2026-10-02）。
    //   原来的实现里 `nGround===2` 既不奖也不罚 ⇒ **双脚站立是免费的**
    //   ⇒ 12 代实测每一代都是 `2脚=359 / accSingle=-0.001`，
    //     连把 `single` 权重提到 3.0、把 `quiet` 归零、甚至把
    //     `singleSupport` 模块的相位放开为三相，数字都**一位不变**
    //     —— 因为惩罚压根不存在，退化解永远是最优解。
    //   注意：`walkReward.ts` 的注释写着"两脚都着地 −0.15 是实测逼出来的"，
    //   但那段逻辑**从来没写进 sim.ts**，注释与实现不符（踩过一次的坑）。
    if (this.cfg.mode === 'stand' && nGround === 2) {
      this.accSingle += -STAND_BOTH_FEET * (cl ? 1 : 0.1) * dt;
    }

    // ══════ ★★ 文献步态参考分 + 盆骨优先（用户 2026-10-02）══════════════
    //  只在**真单支撑帧**给分：站着不动 / 两脚都在地上 ⇒ 一分不给。
    //  （这一条门控是关键的：之前"要动"项没门控时，站着扭关节反而是全局最优。）
      {
        const clr = Math.max(this.airPeakL, this.airPeakR);
        const mosHere = this.lastMosX;
        const xiH = this.lastSupEdgeX - mosHere;
        const footHere = gL ? this.footTmpR[0]! : this.footTmpL[0]!;
        const eH = Math.abs(footHere - xiH);
        const placeHere = eH <= 0.05 ? 1 : Math.max(0, 1 - (eH - 0.05) / 0.25);
        const shpHere = (this.lastRefHip + this.lastRefKnee) * 0.5;
        const pelHere = (this.pfL.score() + this.pfR.score()) * 0.5;
        // ★ 该迈哪条腿 = **发令**说的（不再是"载荷较轻的那条"自己猜）
        const swingLeg: 'l' | 'r' = orderLeg(this.cmd.now) ?? (gL ? 'r' : 'l');
        this.gp.step(nGround, clr, mosHere, shpHere, placeHere, pelHere, dt, swingLeg);
        this.gpLabel = this.gp.label;
        this.gpSwing = this.gp.swingLeg;
        this.gpBodyFree = this.gp.bodyFree;
        // ══════ ★★★ 发令者推进（离散顺序：腿 → 腰 → 腿）══════════════
        //   `ready` = **伺服层的反馈**："上一个动作已经稳住/落地了"。
        //   发令者等这个才走 ⇒ 分层控制闭环：发令 → 伺服执行 → 报 ready → 下一条令。
        //   `jitter` = 反应随机性（想换成学习策略时注入 brain 驱动的 rand）。
        this.cmd.step(dt, this.servoReady);
        // ★★ "脚往前迈的时候身体别动"：**门控统一走模块表**（摆动相 + 单支撑 + 未被代码关闭）
        const stillOn = this.mod.active('stillSwing', this.gp.now, nGround, null);
        const wb = Math.hypot(this.lbuf[0]!, this.lbuf[1]!, this.lbuf[2]!);
        const bodyMove = Math.abs(this.com.vz) + Math.abs(this.com.vx) * 0.3 + wb * 0.08;
        if (nGround === 1) {
          if (stillOn) { this.accStill += bodyMove * dt; this.stillStep += bodyMove * dt; }
          else if (this.gp.bodyFree) this.stillAdjust += bodyMove * dt;
        }
        const cyc = this.gp.tally;
        if (cyc.lastCredit > 0 && !this.gpPaidThisStep) {
          this.accCycle += cyc.lastCredit;
          this.gpPaidThisStep = true;
        }
        if (!this.gp.inAdjust) this.gpPaidThisStep = false;
        this.cycleN = cyc.nAdjustOk; this.cycleFlick = cyc.flickers;
        this.cycleAdj = cyc.meanAdjustSec; this.cyclePhase = this.gp.now;
    }
    // ── 盆骨优先：门控走模块表（逐腿：左腿只算左腿、右腿只算右腿）──
    if (this.mod.active('pelvisFirst', this.gp.now, nGround, 'l') || this.mod.active('pelvisFirst', this.gp.now, nGround, 'r')) {
    if (nGround === 1) {
      // 相位：摆动腿在 [STANCE_FRAC, 1)，支撑腿在 [0, STANCE_FRAC)。
      // 用 Sim 的步态时钟推进，两腿天然相差半周期 ⇒ 这就是"交替"的实现。
      const ph = this.phase >= 1 ? this.phase - 1 : this.phase;
      const swingIsL = gL;                       // 右脚离地 ⇒ 左腿是支撑腿
      const tSw = swingIsL ? ph + STANCE_FRAC : ph;
      const rd = (name: string): number => {
        const i = JOINT_ORDER.indexOf(name);
        if (i < 0) return 0;
        return doll.jointAngle(i) + (this.sk.joints[i]?.restRad[2] ?? 0);
      };
      const hipSw = rd(swingIsL ? 'hip_l' : 'hip_r'), kneeSw = rd(swingIsL ? 'knee_l' : 'knee_r');
      const hipSt = rd(swingIsL ? 'hip_r' : 'hip_l'), kneeSt = rd(swingIsL ? 'knee_r' : 'knee_l');
      const a = scoreLeg(tSw, hipSw, kneeSw);
      const b = scoreLeg((tSw + 0.5) % 1, hipSt, kneeSt);
      this.accRefHip += (a.hip + b.hip) * 0.5 * dt;
      this.accRefKnee += (a.knee + b.knee) * 0.5 * dt;
    }
    // ── 盆骨优先：髋先动、膝滞后；且髋在触地前就在动（文献 −100 ms 预激活）──
    {
      const dt2 = dt;
      const vel = (name: string): number => {
        const i = JOINT_ORDER.indexOf(name);
        if (i < 0) return 0;
        doll.jointRelVel(i, this.jbuf);
        return this.jbuf[2]!;
      };
      // 用**摆动相的相位**给每条腿自己的步态时钟（两腿差半周期）
      const ph2 = this.phase >= 1 ? this.phase - 1 : this.phase;
      this.pfL.step(vel('hip_l'), vel('knee_l'), gL, dt2);
      this.pfR.step(vel('hip_r'), vel('knee_r'), gR, dt2);
      // 只在"确实在交替"时计分（单支撑），并且要求髋领先才是正分
      // ★ 逐腿计分：左腿只算左腿的盆骨优先，右腿只算右腿的（模块表按 part 过滤）
      if (this.mod.active('pelvisFirst', this.gp.now, nGround, 'l'))
        this.accPelvisL += this.pfL.score() * dt;
      if (this.mod.active('pelvisFirst', this.gp.now, nGround, 'r'))
        this.accPelvisR += this.pfR.score() * dt;
      // ══════ ★★★ 顺序结构：迈步 → 调整身体 → 再迈步 ══════
      //   以前所有走路项都是**独立**的时间积分 ⇒ 任何"一直在动"的动作都能同时满足它们
      //   （实测脚高主频 3.9 Hz 的抖动就能刷 ≈3.5 分）。
      //   现在由 GaitPhaseMachine 强制顺序：
      //     相 1 迈步：单支撑且离地 ≥3cm 且持续 ≥STEP_MIN(0.28s)
      //     相 2 调整：**必须单支撑待够 ADJUST_MIN(0.70s)**，期间累计 MoS/落点/形状/盆骨分
      //     相 3 过渡：双脚着地
      //   ⇒ **没走完"迈步→调整"这个循环，一分不给**。这是关住抽搐的结构性办法。
      }
    }
    // ══════ ★ 平衡判据 + 脚距离（用户 2026-10-02）════════════════════════
    //  ① 全身体角动量 WBAM（文献：Herr 2008，L(t)≈0）⇒ 不平衡扣分的依据
    //  ② 头高比 = 有效性闸门：头塌了 ⇒ 距离/迈步分一律作废（"快倒下的距离不算"）
    //  ③ 距离以**脚**的前伸为准，且只在 valid 时累加
    {
      doll.soleXZ('l', this.footTmpL); doll.soleXZ('r', this.footTmpR);
      const comB = readCom(doll, this.com);
      wholeBodyAngularMomentum(doll, comB, this.lbuf);
      const headY = this.headTopY();
      const brot = torso.rotation();
      const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (brot.w * brot.x + brot.y * brot.z))));
      // 有效性还要看 MoS（Hof 2005）：XCoM 出支撑面 = 正在倒 ⇒ 距离分作废
      const supB = readSupport(doll, this.sup);
      const mosB = marginOfStability(
        comB.x, comB.vx, omegaAt(comB.y), supB.cx + supB.halfX, comB.z, comB.vz, supB.cz + supB.halfZ,
      );
      const b = this.bal.step(this.lbuf, headY, dt, pitch, mosB.x);
      // 脚的前伸：`footFar` = 单调最大值（诊断用）；`footDist` = **净位移**（真正的"移动距离"）
      const fx = this.footMaxX();
      if (fx > this.footFar) this.footFar = fx;
      // ★ 速度用**净变化**（可正可负），原来用 `max(0, …)` 等于把后退也当成前进
      this.footVel += ((fx - this.lastFootX) / Math.max(1e-6, dt) - this.footVel) * 0.3;
      this.lastFootX = fx;
      this.torsoDist = doll.torso().translation().x - this.startX;
      if (b.valid) {
        // ★★ 距离 = **脚的净位移**，不是"最远够到哪儿"。
        //   原来用单调最大值 `footFar - footStart`：一旦往前够出一次就永远不回来，
        //   于是"扑出去 0.6 m 再倒回来"仍然记 0.6 m ⇒ 距离严重虚高（用户 2026-10-02 报告）。
        this.footDist = fx - this.footStart;
        this.validTicks += dt;
        this.stepCycleT += dt;
      } else {
        this.imbAcc += 0.5 * dt;      // 头塌了也算"不平衡"的一部分
      }
      void HEAD_MIN; void HEAD_MAX;
    }
    // ── 迈步 → 稳住（MoS 课程）──────────────────────────────────────────
    //  MoS = BoS边缘 − XCoM（Hof 2005）。只在**单支撑**时有支撑域可言，
    //  但"稳住"这件事恰恰发生在触地之后，所以两腿都要跟踪。
    {
      const com2 = readCom(doll, this.com);
      const sup2 = readSupport(doll, this.sup);
      const om2 = omegaAt(com2.y);
      const mos = marginOfStability(
        com2.x, com2.vx, om2, sup2.cx + sup2.halfX, com2.z, com2.vz, sup2.cz + sup2.halfZ,
      );
      if (nGround >= 1) {
        this.mosMinSeen = Math.min(this.mosMinSeen, mos.x);
        this.mosSum += mos.x; this.mosN++;
      }
      // 步长要用**脚的世界 x**（与"距离以脚为准"同一口径）
      const fXl = this.footTmpL[0]!, fXr = this.footTmpR[0]!;
const gL2 = this.ssL.step(gL, mos.x, dt, fXl);
      const gR2 = this.ssR.step(gR, mos.x, dt, fXr);
      if (this.mod.active('balance', this.gp.now, nGround, null))
        this.accMoS += mosBand(mos.x) * (nGround === 1 ? 1 : 0) * dt;
      // ══════ ★★★ 伺服层 → 发令者的反馈闭环 ══════
      //   "上一个动作已经稳住/落地了吗？" ⇒ 这一个布尔量决定发令者敢不敢发下一条令。
      //   判据：双脚都在地上（落地了）或 MoS 有正余量（站得住）⇒ ready。
      //   这就是分层控制的握手：发令者**不猜**，它**问**伺服层。
//   ⚠ 必须**跨帧锁存**（上一帧 ready 就一直 ready），不能每帧重判：
    //     否则"迈右腿"那条令恰好落在 MoS<0 的那一帧被拒，就再也不会发了。
    //
    // ★★★ 用户 2026-10-02："我想增大迈步，稳定身体的间隔，再优化稳定身体的算法。
    //   现在没稳定身体就迈下一步，自然会倒。"
    //   ⇒ `servoReady` 判据收紧：**必须连续稳住 `SETTLE_HOLD` 秒**才放行下一条令。
    //   旧判据 `nGround>=2 || mos.x>0.02` 是**瞬时**的 —— 双脚刚着地就放行，
    //   等于"没稳定就迈下一步"，这正是摔倒的直接原因。
    const stableNow = nGround >= 2 && mos.x > 0.02;
    if (stableNow) this.settleHold += dt;
    else this.settleHold = 0;
    this.servoReady = this.settleHold >= SETTLE_HOLD;
      // ★ 落点分：摆动脚落点相对**捕获点 ξ** 的误差（Hof 的 XCoM/MoS 体系）。
      //   ξ = com.x + vx/ω（mos.x = supEdge − ξ ⇒ 可直接反解），半宽取 0.14 m。
      //   只在**摆动相**计分（落地那一刻最有意义），容差 0.05 m（比"落点该在哪"的
      //   生理精度宽松一档：我们只有位置型 PD 电机，不是人）。
      if (nGround === 1) {
        const xi = sup2.cx + sup2.halfX - mos.x;
        const footX = gL ? this.footTmpR[0]! : this.footTmpL[0]!;
        const err = Math.abs(footX - xi);
        this.accPlace += (err <= 0.05 ? 1 : Math.max(0, 1 - (err - 0.05) / 0.25)) * dt;
      }
      // 摆动太短的罚（负分）
      if (gL2 < 0 || gR2 < 0) this.accPace += Math.min(gL2, gR2) * dt;
    }
    this.accTicks += dt;

    //  ② 逐关节"要动"：骨盆(髋)和膝盖必须持续动，站桩得 0。
    //     腾空时间只管"脚离地了"，管不了骨盆摆没摆，所以这项必须留。
    //  ③ 平滑/省力：关节角速度平方、马达力矩平方、电机指令变化率。
    let jSpd = 0, jMove = 0;
    for (let i2 = 0; i2 < doll.jointCount; i2++) {
      doll.jointRelVel(i2, this.jbuf);
      const w0 = this.jbuf[0], w1 = this.jbuf[1], w2 = this.jbuf[2];
      jSpd += w0 * w0 + w1 * w1 + w2 * w2;
      if (MOVE_SET.has(JOINT_ORDER[i2])) {
        const sp = Math.sqrt(jSpd === 0 ? w0 * w0 : w0 * w0 + w1 * w1 + w2 * w2);
        const f = Math.min(1, sp / JOINT_MOVE_TARGET);
        // ★★ 只在"**真的在迈步**"（至少一脚离地）时才给"要动"分。
        //   否则"两脚踩死在地上疯狂扭关节"是绝对最优解：实测最优个体 jointMove=2.81，
        //   而同一时刻 lift/single/altCount 全是 0.00（走路项最多只能给 ~0.3 分）。
        //   这就是"训练永远停在站着不动"的直接原因，比权重配比更根本。
        //   ⚠ 要门控的是**逐关节累加器 accJtMove**（tt.jointMove 由它算出），
        //   不是 accMoveSum（那个只喂 moveFrac 诊断）—— 我第一次改错了地方，白跑一轮。
        //   ⚠ 判据必须是 **nGround === 1**（恰好一脚着地），不能是 `nGround <= 1`：
        //   后者让"**两只脚同时腾空**"（蹦）也能拿满，而蹦的时候 accSingle 正在被罚
        //   （实测第 4 代就出现过 jointMove=2.45 却 altCount=0 的蹦跳解）。
        if (nGround === 1) this.accJtMove[JOINT_ORDER[i2]] += f * dt;
        jMove += f;
      }
    }
    let act2 = 0, tau2 = 0;
    for (let i2 = 0; i2 < this.motor.length; i2++) {
      const dq = this.motor[i2] - this.motorPrev[i2];
      act2 += dq * dq;
      this.motorPrev[i2] = this.motor[i2];
      const tq = this.doll.motorImpulse[i2] / this.dt;
      tau2 += tq * tq;
    }
    this.accJointMotion += jSpd * dt;
    this.accActRate += act2 * dt;
    this.accTau += tau2 * dt;
    // ★★ "要动"这一项**只在真的在迈步时才给**（至少一脚离地）。
    //   原来是无条件累加，而它比所有走路项加起来都大（实测最优个体 jointMove=2.81，
    //   而当时的 lift/single/shift 全是 0.00）⇒ ES 学会的"最优解"就是
    //   **站在原地疯狂扭关节**：4.06 分里大头是它，而走路项最多只能给 ~0.3 分。
    //   这就是"训练一直偏好站着不动"的直接原因（比权重配比更根本）。
    this.accMoveSum += (nGround === 1 ? jMove : 0) * dt;

    //  ④ 速度跟踪 / 横向 / 翻滚：★ **逐拍积分**（Rudin 表里每一项都带 dt）。
    //     之前写成"finish() 时取末帧读数"⇒ 6 秒的 episode 只算一瞬间，
    //     于是 velTrack 恒为 0、ES 完全看不到"往 +X 走"的梯度（实测 6 代只走 0.65m、velTrack=0）。
    // ★ 速度跟踪改用**脚的前伸速度**（用户："移动距离应该以脚的移动为准"）。
    //   原来用躯干速度 ⇒ 整个人往前扑就能拿满分（实测零输出基线躯干位移 0.65 m）。
    // ⚠⚠ 这里原来写成 `const tvx = -this.footVel` ⇒ `phi(TARGET_VX - tvx)` 变成
    //   `phi(TARGET_VX + footVel)` ⇒ **脚动得越快分越高、而且没有上限**。
    //   这一个符号错误同时毁掉了速度跟踪项、并直接喂了"高频抽搐"（快速蹭脚得分最高）。
    const tvx = this.footVel, tvz = tv.z;
    const ang = torso.angvel();
    this.accVelTrack += (phi(TARGET_VX - tvx) - phi(TARGET_VX)) * dt;   // 扣掉站桩基线
    this.accYaw += phi(-ang.y) * dt;
    this.accLat += tvz * tvz * dt;
    this.accTilt += (ang.x * ang.x + ang.y * ang.y + ang.z * ang.z) * dt;

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
    // ★★ crash：任何非脚部刚体碰到地面 ⇒ 截断（Rudin 2022 的原做法）。
    //   只看躯干高度/倾角抓不住"往前塌"（实测：塌 41cm 而躯干仍有 70% 高、倾角几乎不变，
    //   于是一路滑 0.65~1.25 m 还能拿速度跟踪分）。
    if (this.doll.bodyHitGround()) {
      // ★ crash 触发也记录是谁碰的地（用户 2026-10-02）
      //   ⚠ 必须同时设 `fallReason`：漏设会让探针把"四肢碰地摔倒"读成 `fallReason === ''`
      //   而误报成"跑满"（已踩过：零输出明明 5.53s 倒了，却打印"跑满"）。
      this.fallReason = 'crash';
      this.fallDiag = { rH: +((this.initTorsoY * this.cfg.fallHeightRatio) / Math.max(1e-6, tp.y)).toFixed(3), rT: +NaN.toFixed(3), rD: +NaN.toFixed(3), torsoY: +tp.y.toFixed(3), headY: +headY.toFixed(3), tiltDeg: 0, hit: this.doll.lastHitKey };
      this.finish(true); return true;
    }
    // ★ `fallHeightRatio = 0` ⇒ 关闭躯干高度判据（用户 2026-10-02："不用限制躯干高度了"）
    const useH = this.cfg.fallHeightRatio > 0;
    const rH = useH ? (this.initTorsoY * this.cfg.fallHeightRatio) / Math.max(1e-6, tp.y) : 0;
    const rT = tilt / this.cfg.fallAngle;
    const rD = this.cfg.headMinHeight / Math.max(1e-6, headY);
    if ((useH && rH > 1) || rT > 1 || rD > 1) {
      this.fallReason = rT > 1 ? 'tilt' : 'head';
      // ★ 记录触发瞬间的三个比值与 crash 来源（用户 2026-10-02："看看到底什么原因触发摔倒"）
      this.fallDiag = {
        rH: +rH.toFixed(3), rT: +rT.toFixed(3), rD: +rD.toFixed(3),
        torsoY: +tp.y.toFixed(3), headY: +headY.toFixed(3),
        tiltDeg: +(tilt * 180 / Math.PI).toFixed(1), hit: this.doll.lastHitKey,
      };
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
if (this.cfg.mode === 'stand') {
      // ══════ ★★★ **站立模式：目标 = 单腿站立存活 ≥ 3 s**（用户 2026-10-02）
      //
      //   "先优化算法，保证单腿能坚持 3s 以上，然后再写迈腿算法"
      //
      //   ── 第一版的实测退化解（12 代）──────────────────────────────
      //     `存活 100%（alive=1.000，5.79 s）`，但接地帧是
      //       0脚=1  1脚=0  **2脚=359**
      //     ⇒ 它找到了"**两脚着地、纹丝不动**"这个退化解：
      //       不倒 ⇒ 拿满存活分；不动 ⇒ 不吃任何惩罚；`accSingle=-0.001` 几乎不罚。
      //     原因：`quiet`（少动）在各项里最容易被白拿，而 `single` 只是软加分。
      //
      //   ── 修法：把"单腿"从软奖励改成**硬门控** ────────────────────
      //     ① `single` 提到**主项**（它是这个模式的存在理由）
      //     ② `quiet` 归零 —— 它就是"不动"的直接成因，必须去掉
      //     ③ `alive` 权重足以压住其他项 ⇒ 宁可不动也不倒时，会去尝试抬腿
      //        （因为只有抬腿才能拿 single），于是"倒"与"不动"的取舍变成真取舍
      //     ④ 惩罚项（upright/height/lateral）保留，把"歪着单脚站"也堵掉
      const sw = STAND_W;
      const ts: Record<string, number> = {};
      ts.alive = sw.alive * elapsed;                      // ① 不倒
      ts.single = sw.single * this.accSingle;              // ② ★主项：恰好一脚着地
      ts.upright = sw.upright * (this.accUpright - elapsed);
      ts.height = -sw.height * this.accHeight;
      ts.lateral = -sw.lateral * this.accLateral;
      ts.tiltRate = -sw.tiltRate * this.accMoveSum;
      // 明确置 0 的项（保留通道，以后调迈步时再放开）
      ts.quiet = 0; ts.velTrack = 0; ts.lift = 0; ts.jointMove = 0;
      ts.jointMotion = 0; ts.actRate = 0; ts.torque = 0; ts.yawTrack = 0;
      ts.total = Object.values(ts).reduce((a, b) => a + b, 0);
      return ts;
    }

    if (this.cfg.mode === 'walk') {
      // ══════ ★★ 走路：walkReward.ts 的 11 项，一项一行 ══════
      //  ★ 跌倒**不给负分**，直接截断（finish(true) 提前结束）。
      //    旧版 fall = −2 和单步收益同量级 ⇒ "迈一步再倒"是净负分，
      //    ES 的最优解变成"别迈步"（实测过）。经典配方也是 crash ⇒ reset 而非负奖励。
      const tt: Record<string, number> = {};
      // ★★ "站得住"门控：塌着往前滑同样在"走"（实测零输出基因组滑 0.65 m 拿 velTrack +0.63），
      //   所以速度跟踪 / 抬腿 / 单脚支撑 / 要动 这四项统统乘它。
      const aliveAvg = this.accAlive / Math.max(0.2, this.accTicks);
      // ★★ 减去"站桩基线"：φ(v*) 是站着不动就能拿到的底分（实测 0.368），
      //   原样积分会让"什么都不做"得正分（零输出基因组 +0.87，门禁直接抓到）。
      //   经典配方里没这一步是因为它默认策略被**命令**去走；我们要把"不动"钉在 0 分。
      // ★★ 前进分要"迈过步"才给（stepGate = min(1, 换脚数/2)）。
      //   实测这个骨架**零输出也会自己往前滑 0.65 m**（脚掌外八 25° + 纯阻尼 ⇒ 被动自走），
      //   不设门槛的话"什么都不做"能拿满速度跟踪（实测 +0.63，总分最高）。
      //   冷启动由 `shift` 项负责（它不依赖前进），迈出两步之后前进分才解锁。
      tt.velTrack = w.velTrack * this.accVelTrack * aliveAvg
        * Math.min(1, this.altCount / 2);
      // ★ yawTrack 默认权重 0：φ(0)=1 意味着"完全不自转"是**满��**，而站桩恰好满���
      //   ⇒ 又一份白拿的分。自转改由 tiltRate 罚（把 ω_y 也纳入）。
      tt.yawTrack = w.yawTrack * this.accYaw;
      tt.lateral = -w.lateral * this.accLat;
      tt.tiltRate = -w.tiltRate * this.accTilt;
      // ★★★ **节律门**：按实测步间隔给 0..1 分，挂在**所有走路项**上。
      //   没有它：一个 3 Hz、每次抬 3 cm 的抖动仍能刷满 single/lift/moS/placement。
      //   有了它：乱颤的实测间隔远离 TARGET_CYCLE=1.0 s ⇒ 这一项直接压到 ~0。
      //   （离地高度门负责"幅度"，节律门负责"频率"，两个一起才关得住抽搐。）
      let cad = 1;
      if (this.cycTimes.length >= 2) {
        const sc = [...this.cycTimes].sort((a, b) => a - b);
        cad = cadenceScore(sc[Math.floor(sc.length / 2)]!, TARGET_CYCLE);
      }
      const altGate = Math.min(1, this.altCount / 2);
      const gate = altGate * cad;
      const cap = (v: number, m: number): number => (v > m ? m : v);
      tt.cadence = cad;
      // ★★★ 顺序分：一个完整的"迈步→调整"循环结束时一次性记账
      //   （`settle` 等旧项保留，但它们都被 gate 管着）
      tt.cycle = cap(w.cycle * this.accCycle * aliveAvg, 6);
      // ★ 摆动相身体冻结的罚分（落地后的调整相不算）
      tt.stillSwing = -w.stillSwing * this.accStill * aliveAvg;
      tt.stillStep = this.stillStep;      // 诊断
      tt.stillAdjust = this.stillAdjust;  // 诊断
      tt.cycleCount = this.cycleN;         // 诊断：完成了多少个循环
      tt.cycleFlick = this.cycleFlick;     // 诊断：抖动次数
      tt.cycleAdjust = this.cycleAdj;      // 诊断：平均调整时长（s）
      tt.cyclePhase = this.gp.now === 'adjust' ? 2 : this.gp.now === 'step' ? 1 : 0;
      tt.medianCycle = this.cycTimes.length >= 2
        ? [...this.cycTimes].sort((a, b) => a - b)[Math.floor(this.cycTimes.length / 2)]! : 0;
      // ★ `lift` / `single` 也乘节律门：这两个是抽搐最容易刷到的项
      //   （accLift 内部已有"离地高度"门，这里再加"频率"门）
      tt.lift = w.lift * this.accLift * aliveAvg * cad;
      tt.single = w.single * (this.accSwitchQ * aliveAvg + this.accSingle * cad);
      // ★ 换支撑脚拿分（主）+ 双脚离地时间罚（次）。**没有"两脚都着地"的负分**了 ——
      //   那是姿态式判据，在现几何下会把"滑行"也罚掉（而滑行是这个骨架的被动行为）。
      tt.altCount = this.altCount;   // 诊断：换支撑脚次数
      // ★ 重心转移：**封顶**的"能力门槛"，不是无限得分项。
      //   实测：不封顶的话，策略只要**永远把体重压在一只脚上**就能拿满（6s × 2.0 ≈ 20 分，
      //   而换脚数还是 0）—— 奖励被"金鸡独立"刷满，学不到走路。
      //   所以只付"会单腿平衡"这件事本身（cap 1.5 s），**多出来的收益必须靠换脚拿**。
      tt.shift = w.shift * Math.min(this.accShift, this.cfg.shiftCapSec) * aliveAvg;
      tt.shiftRaw = this.accShift;   // 诊断：实际单腿时间
      let jm = 0, nJm = 0;
      for (const k of MOVE_JOINTS) {
        const v = this.accJtMove[k] ?? 0;
        tt[`mv.${k}`] = w.jointMove * ((w.moveScale as Record<string, number>)[k] ?? 1) * v * aliveAvg;
        jm += v; nJm++;
      }
      tt.jointMove = nJm > 0 ? w.jointMove * (jm / nJm) * aliveAvg : 0;
      // ★★ 文献步态参考分（gaitRef.ts）+ 盆骨优先
      tt.refHip = w.refHip * this.accRefHip * aliveAvg * Math.min(1, this.altCount / 2);
      tt.refKnee = w.refKnee * this.accRefKnee * aliveAvg * Math.min(1, this.altCount / 2);
      // ★ 分腿：左腿与右腿**分别**看"髋有没有领先膝"，任何一条腿不达标都会被单独体现
      const pelL = this.accPelvisL, pelR = this.accPelvisR;
      const pelMean = (pelL + pelR) * 0.5;
      const pelWorst = Math.min(pelL, pelR);          // 短板腿（诊断）
      tt.pelvisFirst = w.pelvisFirst * pelMean * aliveAvg * Math.min(1, this.altCount / 2);
      tt.pelvisFirstL = pelL * aliveAvg;
      tt.pelvisFirstR = pelR * aliveAvg;
      tt.pelvisWorst = pelWorst * aliveAvg;            // ★ 调试：左腿右腿里更差的那个
      tt.hipLeadSec = (this.pfL.meanLead + this.pfR.meanLead) / 2;   // 诊断：膝滞后髋多少秒（>0 才正确）
      tt.preActive = (this.pfL.preActiveRatio + this.pfR.preActiveRatio) / 2;   // 诊断：触地前髋预激活程度
      // ★★ 按**结算过的步数**计价，不是时间积分：
      //   时间积分会被"一直站着 MoS 很好"刷分（实测镇定器一度拿到 26 分），
      //   而且步数越多按时间平均分越高 ⇒ 反而鼓励快抖。
      //   按"结算步"计价天然限速：摆动 < MIN_SWING 的步**根本不计数**。
      // ★ 用**累计结算分**（含渐进塑形）而不是"结算步数"：
      //   步数是二值的、砍掉了梯度；累计分能把"摆动 0.1 s → 0.36 分"这种中间态传给 ES。
      const nTooFast = this.ssL.fastCount + this.ssR.fastCount;
      // ⚠ 计数类惩罚**必须封顶**：实测零输出触发 18 次"太快"，−1.5×18 = **−27 分**，
      //   直接淹没其余所有项（而它只是"迈得太快"这一个维度）。
      //   封顶口径：每 1.5 秒最多算 1 次 ⇒ 6 秒回合最多 4 次。
      const paceCap = 1 + Math.floor(this.accTicks / 1.5);
      // ★★★ 三个防"白拿分"的闸门，一次说清（都是本轮实测逼出来的）：
      //  ① altGate：没有真正的换支撑脚（载荷 >70% 从一只脚换到另一只脚）之前不给分。
      //     这把尺子在 velTrack 上已被验证（零输出的 velTrack = 0.000）。
      //  ② cap：这些项都是"时间积分 × 权重"，6 秒能堆到几十上分
      //     （refHip 1.5 + refKnee 1.5 + pelvisFirst 2.0 + settle 3.0 + moS 0.5 = 8.5/s）。
      //     不封顶的话"零输出滑 0.65 m"能拿 26~33 分，把代价项（力矩/能量/不平衡）
      //     全部淹没 —— 站立类门禁（posture/gait/verify）就是这么被顶穿的。
      //  ③ 封顶后新增的走路加分有确定上界（约 13.5 分），与代价项同量级。
      const altGate2 = altGate;
      void altGate2;
      tt.settle = cap(w.settle * (this.ssL.creditSum + this.ssR.creditSum) * aliveAvg * gate, 4);
      tt.stepPace = -w.stepPace * Math.min(nTooFast, paceCap) * aliveAvg;
      tt.moS = cap(w.moS * this.accMoS * aliveAvg * altGate, 1.5);
      // ★★ 步幅分：只对"结算过的步"付费，目标是 2~3 个脚长（Usherwood 2023）。
      //   ★ 这是"先稳定步幅"的落点：抽搐式的高速蹭脚**拿不到任何步长分**。
      const lenSum = this.ssL.lenCredit + this.ssR.lenCredit;
      tt.stepLen = cap(w.stepLen * lenSum * aliveAvg * altGate, 4);
      tt.meanStepLen = (this.ssL.meanStepLen + this.ssR.meanStepLen) / 2;   // 诊断
      tt.settledCount = this.ssL.settledCount + this.ssR.settledCount;      // 诊断
      // ★ 落点分：摆动脚落点 vs 捕获点 ξ（髋外展肌在摆动相调节落点）
      tt.placement = cap(w.placement * this.accPlace * aliveAvg * altGate, 2);
      // ★ 不平衡扣分：WBAM 偏离 + 头塌帧
      const bstat = this.bal.stats;
      const imbMean = bstat.ticks > 0 ? bstat.accImb / bstat.ticks : 0;
      const badHeadFrac = bstat.ticks > 0 ? bstat.badHead / bstat.ticks : 0;
      tt.imbalance = -w.imbalance * (imbMean + badHeadFrac) * aliveAvg;
      tt.imbMean = imbMean; tt.imbBadFrac = badHeadFrac; tt.imbAlive = aliveAvg; tt.imbW = w.imbalance;
      tt.wbamMax = bstat.wbamMax;                       // 诊断
      tt.wbamNorm = this.bal.norms.wbam;                // 诊断：标定尺度
      tt.headRatioMin = bstat.headMin;                  // 诊断：最低头高比
      tt.validRatio = this.accTicks > 0 ? this.validTicks / this.accTicks : 0;  // 诊断：有效帧占比
      tt.footDist = this.footDist;                      // 诊断：以脚为准的距离
      tt.torsoDist = this.torsoDist;                    // 诊断：躯干位移（扑出去的距离）
      // "扑出去的距离"：躯干走了但脚没走的那部分（米）—— 比"比值"更好读
      tt.flopRatio = Math.max(0, this.torsoDist - this.footDist);
      tt.settledSteps = this.ssL.settleRatio + this.ssR.settleRatio;      // 诊断：结算过的步数
      tt.tooFastSteps = this.ssL.fastCount + this.ssR.fastCount;           // 诊断：摆动太短的次数
      tt.flightSteps = this.ssL.flightCount + this.ssR.flightCount;        // 诊断：被识别成"一步"的次数
      tt.mosMin = this.mosMinSeen === Infinity ? 0 : this.mosMinSeen;     // 诊断：全程最小 MoS
      tt.mosMean = this.mosN > 0 ? this.mosSum / this.mosN : 0;            // 诊断：平均 MoS
      tt.unstableSteps = this.ssL.unstable + this.ssR.unstable;           // 诊断：MoS<0 的步数
      tt.recoveredSteps = this.ssL.recoveredCount + this.ssR.recoveredCount;  // 诊断：恢复成功的步数
      this.settleDebug = `L[${this.ssL.debug()}] R[${this.ssR.debug()}]`;
      void MIN_SWING; void SETTLE_WIN;
      tt.alive = aliveAvg;   // 诊断：'站得住'的时间占比
      tt.upright = w.upright * (this.accUpright - elapsed);
      tt.height = -w.height * this.accHeight;
      tt.jointMotion = -w.jointMotion * this.accJointMotion;
      tt.torque = -w.torque * this.accTau;
      tt.actRate = -w.actRate * this.accActRate;
      tt.energy = -w.energy * this.accEnergy;
      tt.survive = w.survive * elapsed;
      tt.fallen = fallen ? 1 : 0;              // 只做标记，不进 total
      // ★★★ 只有**白名单**里的项进 total（2026-10-02 修）。
      //   原来是**黑名单**（只排除 total/fallen/alive/mv.*），于是这两天加的三十多个
      //   **诊断字段**（cadence / imbMean / mosMin / wbamNorm / validRatio / footDist …）
      //   全被当成得分加了进去 —— 实测镇定器 total 24.88、零输出 33.11，
      //   而站立类门禁（posture/gait/verify）要求"零输出总分很低"，所以一直红着。
      //   改成白名单后，新增诊断字段再也不可能影响适应度。
      let sum = 0;
      for (const k of WALK_REWARD_KEYS) sum += tt[k] ?? 0;
      tt.total = sum;
      return tt;
    }
    // 战斗：命中为主，但**必须带姿态塑形**（否则全员摔倒时适应度全是负数、梯度恒为零）。
    const t: Record<string, number> = {
      hit: w.hit * this.hits,
      hurt: -w.hurt * this.hurts,
      approach: w.approach * this.accClose,
      upright: w.upright * (this.accUpright - elapsed),
      height: -w.height * this.accHeight,
      balance: -w.balance * this.accBalance,
      smooth: -w.actRate * this.accActRate,   // ★ 惩罚，负号（电机指令变化率）
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
    // ★★ 死亡时**瘫软**，让角色被残余动量+重力带着飞出去
    //   （用户 2026-10-04：「当角色死亡的时候我觉得可以恢复这个状态让他飞出去」）。
    //   原来只把 motorTarget 归零，但 kP=48 的位置伺服仍在把四肢拉回姿态
    //   ⇒ 尸体站在原地挣扎，像卡住了。
    if (fallen) {
      this.doll.setLimp(true);
      this.deathLeft = Math.round((this.cfg.deathFlySeconds ?? 1.6) * this.cfg.physicsHz);
    } else {
      // 跑满时长（非摔倒）：仍然停下马达，避免展示视图里刚体继续挣扎
      for (let i = 0; i < this.motor.length; i++) this.motor[i] = 0;
      this.doll.setMotorTargets(this.motor);
    }
  }

  private progressRaw(): number { return this.tick / this.ticksTotal; }

  /** 重新对齐物理世界（展示视图用：跑完一轮后让角色重新站好） */
  restand(): void {
    this.doll.reset(0);
    this.doll.setLimp(false);   // ★ 解除瘫软（死亡演出后要能重新站起来）
    this.deathLeft = 0;
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
