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
import type { Skeleton } from './skeleton';

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
  /** 净前进距离（跑到终点时的 x 位移） */
  distance: 3.0,
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
  /** 两侧脚掌交替触地（鼓励"迈步"而不是"蹭"） */
  step: 0.4,
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
  readonly w: FitnessWeights;
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
  /** ★ 抖动积分 ∫ Σ(Δτ)²（N·m²·s，见 W.smooth） */
  private accSmooth = 0;
  /** 上一物理步的**实际**关节力矩（= motorImpulse/dt），用于算 Δτ */
  private readonly tauPrev: Float64Array;
  private tauPrimed = false;
  private lastStance: 0 | 1 | 2 = 0;
  private stepCount = 0;

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
    this.accSmooth = 0;
    // ★ 抖动需要一个"前一帧力矩"；第一步没有前值，置 0 并打标记，
    //   否则第 1 步的 Δτ = τ_0 本身会被当成一次巨大抖动（假罚）。
    this.tauPrev.fill(0);
    this.tauPrimed = false;
    this.lastStance = 0;
    this.stepCount = 0;
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
    this.accBalance += (eX * eX + eZ * eZ) * dt;
    if (eX === 0 && eZ === 0) this.inDomainTicks++;
    this.balanceTicks++;
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
      if (this.lastStance !== 0) this.stepCount++;
      this.lastStance = stance;
    }

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
      const t: Record<string, number> = {
        // ★ accUpright = ∫cos(tilt)dt ≤ elapsed，所以 upright 恒 ≤ 0：不直立就扣分，
        //   "站着不动"恰好得 0，不会白拿分（见 W 的注释）。
        distance: w.distance * Math.max(0, this.distance),
        velocity: w.velocity * this.accVel,
        upright: w.upright * (this.accUpright - elapsed),
        height: -w.height * this.accHeight,
        lateral: -w.lateral * this.accLateral,
        energy: -w.energy * this.accEnergy,
        // ★★ DCM 越界积分：这才是"站得住"真正的梯度来源（见 W.balance）
        balance: -w.balance * this.accBalance,
        // ★ 抖动罚：治"抽风式频繁发力"（见 W.smooth / probe-posture [C3]）
        smooth: w.smooth * this.accSmooth,
        survive: w.survive * elapsed,
        step: w.step * this.stepCount,
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
      smooth: w.smooth * this.accSmooth,
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
