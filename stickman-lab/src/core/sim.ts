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
import {
  AIR_TARGET, JOINT_MOVE_TARGET, MOVE_JOINTS, TARGET_VX, phi,
} from './walkReward';
import { JOINT_ORDER, type Skeleton } from './skeleton';

/** 要"鼓励移动"的关节集合（骨盆=髋、膝盖），见 walkReward.MOVE_JOINTS */
const MOVE_SET = new Set(MOVE_JOINTS);

export type SimMode = 'walk' | 'fight';

export interface SimConfig {
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
  /** ★ 重心转移项的封顶秒数（"会单腿平衡"这件事值多少）；不封顶会被"永远单腿站"刷满 */
  shiftCapSec: number;
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
  physicsHz: 120,
  controlHz: 60,
  duration: 6,
  mode: 'walk',
  gaitHz: 1.15,
  stepVMin: 0.05,
  shiftCapSec: 1.5,
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
  /**
   * 躯干高度低于初始的 (1−ratio) ⇒ 判摔倒（截断）。
   * ★ 从 0.62 收紧到 **0.85**：0.62 太松，**往前塌**不算摔 ——
   *   实测零输出基因组（纯阻尼）会在 0.5 s 内塌 0.41 m、然后一路滑出 **1.25 m**，
   *   而躯干高度还有初始的 70% ⇒ 回合不结束、速度跟踪项被它白拿 0.51 分。
   *   经典配方里 crash ⇒ reset 是"结构上不给退化解留时间"，这里同理。
   */
  fallHeightRatio: 0.85,
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
  // ══════ 走路奖励（walkReward.ts 的 11 项）══════
  private accLift = 0;          // Σ_脚 min(1, 腾空/目标)·dt
  private accSingle = 0;        // 双脚离地（跳/摔）时间积分，×dt（负）
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
  private airL = 0;             // 左脚连续腾空时间
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
  fallReason: '' | 'height' | 'tilt' | 'head' = '';
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

    this.subStep = 0;
    this.tick = 0;
    this.phase = 0;
    this.accUpright = 0; this.accHeight = 0; this.accLateral = 0;
    this.accEnergy = 0; this.accVel = 0; this.accClose = 0; this.accBalance = 0;
    // 走路奖励记账器（walkReward.ts）
    this.accLift = 0; this.accSingle = 0; this.accTicks = 0; this.accMoveSum = 0; this.accAlive = 0;
    this.altCount = 0; this.accShift = 0; this.accSwitchQ = 0; this.doll.resetAlt();
    this.accJointMotion = 0; this.accTau = 0; this.accActRate = 0;
    this.airL = 0; this.airR = 0; this.motorPrev.fill(0);
    this.accVelTrack = 0; this.accYaw = 0; this.accLat = 0; this.accTilt = 0;
    for (const k of MOVE_JOINTS) this.accJtMove[k] = 0;
    this.supInRatio = 0;
    this.supTicks = 0;
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
    if (this.cfg.mode === 'fight') this.accBalance += (eX * eX + eZ * eZ) * dt;
    if (eX === 0 && eZ === 0) this.inDomainTicks++;
    this.balanceTicks++;
    // ══════ ★★ 走路奖励：逐拍积分（唯一一套，定义见 walkReward.ts 的 11 项）══════
    //  ① 抬腿 / 单脚支撑：靠"脚是否接地"（几何判据 posture.footGrounded）。
    //     ★ **交替步态就是从这两项长出来的** —— 不需要相位时钟、不需要换脚检测
    //       （Rudin 2022 原文：奖励与动作空间里"没有任何步态相关元素"）。
    const gL = footGrounded(doll, 'l'), gR = footGrounded(doll, 'r');
    const nGround = (gL ? 1 : 0) + (gR ? 1 : 0);
    // ★ 换支撑脚事件（Ragdoll 内部维护上一拍状态；双脚离地/都着地时也要喂进去）
    const stanceNow: 0 | 1 | 2 = nGround === 0 ? 0 : gL ? 1 : 2;
    const altNow = nGround === 1 && this.doll.altEvent(stanceNow, dt);
    if (altNow) this.altCount++;
    this.airL = gL ? 0 : this.airL + dt;
    this.airR = gR ? 0 : this.airR + dt;
    this.accLift += (Math.min(1, this.airL / AIR_TARGET) + Math.min(1, this.airR / AIR_TARGET)) * dt;
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
    this.accShift += Math.abs(fl2 - fr2) * dt;
    const dom = fl2 > 0.7 ? 1 : fr2 > 0.7 ? 2 : 0;
    if (dom !== 0 && this.doll.altEvent(dom, dt)) {
      this.altCount++;
      // ★★ 换脚**只有在正在推进时才计价**：φ(v*−v_x)。
      //   不加这一层的话实测 6 代就学会"原地金鸡独立式交替"（换脚 14 次/6s = 2.3Hz，
      //   而 velTrack −0.18、位移 −0.38 m）—— 交替本身被当成了终点。
      //   加了之后："迈步"必须同时是"往前走的迈步"，原地抖腿一分不给。
      this.accSwitchQ += phi(TARGET_VX - this.doll.torso().linvel().x);
    }
    this.accSingle += (nGround === 0 ? -0.5 : 0) * dt;   // 双脚离地（跳/摔）仍按时间罚
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
        this.accJtMove[JOINT_ORDER[i2]] += f * dt;
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
    this.accMoveSum += jMove * dt;

    //  ④ 速度跟踪 / 横向 / 翻滚：★ **逐拍积分**（Rudin 表里每一项都带 dt）。
    //     之前写成"finish() 时取末帧读数"⇒ 6 秒的 episode 只算一瞬间，
    //     于是 velTrack 恒为 0、ES 完全看不到"往 +X 走"的梯度（实测 6 代只走 0.65m、velTrack=0）。
    const tvx = tv.x, tvz = tv.z;
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
    if (this.doll.bodyHitGround()) { this.finish(true); return true; }
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
      tt.lift = w.lift * this.accLift * aliveAvg;
      // ★ 换支撑脚拿分（主）+ 双脚离地时间罚（次）。**没有"两脚都着地"的负分**了 ——
      //   那是姿态式判据，在现几何下会把"滑行"也罚掉（而滑行是这个骨架的被动行为）。
      tt.single = w.single * (this.accSwitchQ * aliveAvg + this.accSingle);
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
      tt.alive = aliveAvg;   // 诊断：'站得住'的时间占比
      tt.upright = w.upright * (this.accUpright - elapsed);
      tt.height = -w.height * this.accHeight;
      tt.jointMotion = -w.jointMotion * this.accJointMotion;
      tt.torque = -w.torque * this.accTau;
      tt.actRate = -w.actRate * this.accActRate;
      tt.energy = -w.energy * this.accEnergy;
      tt.survive = w.survive * elapsed;
      tt.fallen = fallen ? 1 : 0;              // 只做标记，不进 total
      // ★★ 只有**非诊断**的项进 total。逐关节明细（mv.*）和 alive/fallen 是给人看的，
      //   一起累加会把"要动"这项的权重变成 4 倍（实测零输出基因组 total 虚高 1.0）。
      tt.total = 0;
      for (const [k, v] of Object.entries(tt)) {
        if (k === 'total' || k === 'fallen' || k === 'alive' || k.startsWith('mv.')) continue;
        tt.total += v;
      }
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
