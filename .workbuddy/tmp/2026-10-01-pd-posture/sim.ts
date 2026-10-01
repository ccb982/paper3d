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
import { Ragdoll } from './ragdoll';
import { BRAIN_SHAPE, brainParamCount, brainForward, type BrainShape } from './brain';
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
 */
export const W = {
  /** 净前进距离（跑到终点时的 x 位移） */
  distance: 3.0,
  /** 前进速度积分（塑形项：让早期就有梯度，不必等撞线） */
  velocity: 0.6,
  /** 躯干不正的惩罚：W × ∫(cos(tilt) − 1)dt（≤ 0，不直立就一直扣） */
  upright: 1.2,
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
  /** 战斗：命中一次 */
  hit: 4.0,
  /** 战斗：被击中（按出拳次数，不是按周期数） */
  hurt: 0.02,
  /** 战斗：手贴近假人的程度 ∫max(0, 1 − d/1.2)dt —— 塑形项，让"挥空"也有梯度 */
  approach: 0.8,
} as const;

const ZERO = { x: 0, y: 0, z: 0 };

export class Sim {
  /** ★ 每次 begin() 都会整世界重建（原因见 buildWorld），所以别在外部长期持有 */
  world!: RAPIER.World;
  doll!: Ragdoll;
  readonly cfg: SimConfig;
  readonly shape: BrainShape;
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

  constructor(sk: Skeleton, shape: BrainShape = BRAIN_SHAPE, cfg: SimConfig = DEFAULT_SIM) {
    this.sk = sk;
    this.cfg = cfg;
    this.shape = shape;

    this.dt = 1 / cfg.physicsHz;
    this.stages = Math.max(1, Math.round(cfg.physicsHz / cfg.controlHz));
    this.ticksTotal = Math.max(1, Math.round(cfg.duration * cfg.controlHz));

    this.buildWorld();

    this.params = new Float32Array(brainParamCount(shape));
    this.x = new Float32Array(shape.inputs);
    this.hidden = new Float32Array(shape.hidden);
    this.out = new Float32Array(shape.outputs);
    this.motor = new Float32Array(this.doll.jointCount * 3);

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
    this.doll = new Ragdoll(w, this.sk);

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
    this.accEnergy = 0; this.accVel = 0; this.accClose = 0;
    this.lastStance = 0;
    this.stepCount = 0;
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

    // ---- 填输入（布局见 brain.ts 的 INPUT_LAYOUT，共 70 维）----
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

    let k = 14;
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
    brainForward(this.shape, p, x, this.hidden, this.out);
    for (let i = 0; i < this.motor.length; i++) this.motor[i] = this.out[i];
    doll.setMotorTargets(this.motor);

    // ---- 适应度累计 ----
    const dt = 1 / this.cfg.controlHz;
    this.accVel += tv.x * dt;
    this.accUpright += Math.cos(doll.tiltOf(torso)) * dt;
    this.accHeight += Math.abs(tp.y - this.initTorsoY) * dt;
    this.accLateral += Math.abs(tp.z) * dt;

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
    if (
      tp.y < this.initTorsoY * this.cfg.fallHeightRatio ||
      tilt > this.cfg.fallAngle ||
      headY < 0.45
    ) {
      this.finish(true);
      return true;
    }
    return false;
  }

  private finish(fallen: boolean): void {
    this.fallen = fallen;
    const elapsed = this.tick / this.cfg.controlHz;
    let f: number;
    if (this.cfg.mode === 'walk') {
      f =
        W.distance * Math.max(0, this.distance) +
        W.velocity * this.accVel +
        // ★ accUpright = ∫cos(tilt)dt ≤ elapsed，所以这一项恒 ≤ 0：不直立就扣分，
        //   "站着不动"恰好得 0，不会白拿分（见 W 的注释）。
        W.upright * (this.accUpright - elapsed) -
        W.height * this.accHeight -
        W.lateral * this.accLateral -
        W.energy * this.accEnergy +
        W.step * this.stepCount;
      if (fallen) f -= W.fall;
    } else {
      // 战斗：命中为主，但**必须带姿态塑形**（否则全员摔倒时适应度全是 −2.00，
      // 梯度恒为零、ES 无从下手 —— 2D 版就是这么卡住的）。
      // 存活/直立给出"先站住"的梯度，approach 给出"伸手够到假人"的梯度，
      // 命中才在上面叠一次大奖励。
      f =
        W.hit * this.hits -
        W.hurt * this.hurts +
        W.approach * this.accClose +
        W.upright * (this.accUpright - elapsed) -
        W.height * this.accHeight +
        0.5 * this.progressRaw() -
        (fallen ? W.fall : 0);
    }
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
