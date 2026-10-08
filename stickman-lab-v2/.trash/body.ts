/**
 * body.ts —— ★ 骨架装配 + 关节 + 限位（v2）
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 与 v1 的关系
 * ══════════════════════════════════════════════════════════════════════════
 * 骨架数据 100% 来自 v1 的 `skeleton.ts`（原样移植，不改）。
 * 本文件只负责"把数据变成 Rapier 世界里的刚体 + 关节"，并且**针对 v1 的
 * 静置漂移（零输入下身体自己动，Σ|Δθ|=454°）做结构性防护**。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * v2 的三条装配纪律（v1 违反它们，是漂移的候选根因）
 * ══════════════════════════════════════════════════════════════════════════
 *
 * D1 **锚点必须逐位重合**。v1 的锚点实测是重合的（0.000 mm）⇒ 这条不是 v1 的病，
 *    但 v2 把它做成**构造期断言**，防止将来改骨架时静默破坏。
 *
 * D2 **每根轴只能有一条限位路径**。v1 同时有：
 *      · 引擎级 revolute `setLimits()`（踝/膝/弓/中足）
 *      · 自研 `enforceLimits()` 冲量（全部 18 关节）
 *    踝/膝/弓**同时被两条路径约束** ⇒ 两边互相推。
 *    v2：revolute 关节**只**用引擎限位；spherical 关节**只**用自研冲量。
 *
 * D3 **限位只在越界后介入，且必须能停住**。v1 的 `wTar` 位置回正公式在
 *    "轴停在界外"时仍然施加冲量 —— 这在**单轴**上是对的，但对**球铰**，
 *    三轴同时越界时三个冲量会叠加成任意合力矩 ⇒ 可能把身体推走。
 *    v2：自研限位**逐轴独立**，且**只在越界方向**施加，并记录 `limitHits`。
 */

import RAPIER from '@dimforge/rapier3d';
import type { Skeleton, BodyDef, JointDef } from './skeleton';
import { restQuatOf } from './skeleton';
import { Executor, freeAxisOf, quatRotate } from './executor';

/** 碰撞分组（与 v1 一致） */
const MEM_SELF = 0x0002;
const MEM_GROUND = 0x0001;
const GROUPS_SELF = ((MEM_SELF << 16) | MEM_GROUND) >>> 0;
const GROUPS_GROUND = ((MEM_GROUND << 16) | MEM_SELF) >>> 0;

export interface BodyOptions {
  /** 身体（含鞋底）摩擦。★ 照搬 v1：**不区分脚/身体**，一律 `bodyFriction` */
  bodyFriction: number;
  /**
   * ★★★ 地面摩擦（照搬 v1 `DEFAULTS.groundFriction = 10.0`）。
   *
   * 用户令：「网页上也应该是大摩擦力模式，摩擦力大是肯定对的」。
   * 物理立场：**脚必须被粘住才有资格谈平衡** —— 低摩擦下一切反馈律都被
   * "支撑基点每拍漂移"吞掉（v1 实测：踝 ±8mm/拍窜动 = 1m/s 级滑移）。
   * 组合规则 (鞋底 0.9 + 地面 10)/2 ⇒ μ_eff ≈ 5.5（等效完全防滑）。
   *
   * ⚠⚠ 我在 v2 初版把它写成 1.0（μ_eff = 0.95），那是**把 v1 刻意拉高的摩擦又降回去**，
   *   等于主动放弃"站得住"的前提条件。已改回 10.0。
   */
  groundFriction: number;
  /** (照搬 v1) 线性阻尼。v1 = 0.0 —— 线速度不额外阻尼，全靠角阻尼 */
  linearDamping: number;
  /** (照搬 v1) 全局角阻尼。v1 = 0.04（全身12 会把侧向权重转移压掉 3.8 倍） */
  angularDamping: number;
  /**
   * ★★★ **脚掌专用角阻尼**（照搬 v1 `DEFAULTS.footAngularDamping = 30`）。
   *
   * v1 注释原文（`ragdoll.ts:505-510`）：
   *   「2026-10-06：12 → 30（"落地散架"定位后）。
   *    脚 `I≈0.0018`，接触冲量 50mm 力臂即可给 Δω≈4000°/s；
   *    `angularDamping=12` 的时间常数 83ms 压不住那次抽击，提到 30（33ms）。」
   *
   * 只给脚（`foot_*`）：打滑是**脚上**的现象，而侧向权重转移的动力学在躯干/腿上
   * ——全局高阻尼会把它压掉 3.8 倍（v1 实测：全身12 ⇒ |CoM.z| 只剩 53mm vs 需要的 160mm）。
   *
   * ⚠⚠ v2 初版**完全漏了这一项**（所有刚体一律 0.05）⇒ 脚一碰地就狂转、脚侧翻
   *   ⇒ 这就是用户说的"**落地全散架**"的头号原因。
   */
  footAngularDamping: number;
  /** 接触自然频率（Hz）；0 = Rapier 默认刚性 */
  contactHz: number;
  /** 接触阻尼比 */
  contactDamping: number;
  /** 求解器迭代次数 */
  solverIterations: number;
  /** 限位回正的速度上限（rad/s） */
  limitRestCap: number;
  /** 限位回正的越界增益（1/s） */
  limitBiasRate: number;
}

export const DEFAULT_BODY_OPTIONS: BodyOptions = {
  // ★★★ 全部照搬 v1 `core/ragdoll.ts` 的 `DEFAULTS`（`ragdoll.ts:423-510`）。
  //   这不是"调参"，是**把 v1 已经调好/实证过的值原样搬过来** ——
  //   用户要求「按原版本实现就行」，这里每一个数都能在 v1 里找到出处。
  bodyFriction: 0.9,          // v1: bodyFriction: 0.9
  groundFriction: 10.0,       // v1: groundFriction 默认 10.0（大摩擦模式）
  linearDamping: 0.0,         // v1: linearDamping: 0.0
  angularDamping: 0.04,       // v1: angularDamping: 0.04
  footAngularDamping: 30,     // v1: footAngularDamping: 30  ★ 落地散架的定位项
  contactHz: 0,
  contactDamping: 0.7,
  solverIterations: 8,
  limitRestCap: 3.0,          // rad/s
  limitBiasRate: 20,          // 1/s
};

/**
 * ★★★ **踝/脚踝特殊加固**（照搬 v1 的 `limitBiasMax`，`ragdoll.ts:198/213-216/1118`）。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * v1 踩过的坑（这一条是"崴脚"的根因，必须照搬）
 * ══════════════════════════════════════════════════════════════════════════
 * `enforceLimits` 的最大回复**角冲量** = `biasCap × I_轴`，
 * 而马达满扭矩在一个物理步里的**角冲量** = `τmax / physicsHz`。
 *
 * 两者必须比较：**只要 `τmax > biasCap × I_轴 × physicsHz`，
 * 该轴的关节限位在数学上就是 unenforceable 的**，余量可能只有 1%。
 *
 * v1 实测（`probe-readout` ⑦）：
 *   · `spine1/2`：`I_轴 = 0.0407`、`τmax = 120` ⇒ 马达 0.5000 N·m·s，
 *     而全局常数 `biasCap = 12` ⇒ 限位 0.4884 N·m·s ⇒ **比值 1.02×**（马达赢）
 *     ⇒ 角度单调发散到限位的 **3.2 倍**，从不回复。
 *   · **踝屈伸轴能转到 ±174°**（限位只有 ±18°）⇒ 脚在前视图里**侧翻 40~90°**
 *     ⇒ 这就是用户说的"必崴脚"。
 *
 * ⇒ 修法（照搬）：`biasCap` **按轴推导**，使限位角冲量恒压过马达 `k` 倍：
 *      `biasCap · I_轴 · physicsHz = k · τmax`
 *      ⇒ `biasCap = k · τmax / (I_轴 · physicsHz)`
 *
 * ⚠ `LIMIT_MAX_BIAS`（全局 12）作为**下限**保留（极轻的关节也需要基本回复能力）。
 * ⚠ `I_轴` 必须用 `axisInertia(i,k)` 的同一公式 —— 施加冲量时乘的那个惯量，
 *   与算权限时用的必须是同一个，否则"算出来的权限"与"实际效果"不等（v1 实测差 1.02×）。
 */
const LIMIT_MAX_BIAS = 12;
const LIMIT_BIAS_SAFETY = 8;      // v1 默认 8（实测 3 时 −150 N·m 顶穿 4°）
const ASSUMED_PHYSICS_HZ = 240;

/**
 * ★★★ **柔性足被动弓**（照搬 v1 `ragdoll.ts:1361-1362`）。
 *
 * 弓是**梁架**，不是弹簧垫：真实足弧在负荷下只变形 2~3 mm
 *   ⇒ `K = 686 N × 0.02 m / 2° ≈ 400 N·m/rad`。
 *
 * ★★★ 阻尼 = **12.0**（照搬 v1 `DEFAULTS.archDamping = 12.0`）。
 *
 *   v1 注释原文（`ragdoll.ts:460-466`）标题就是「**2.0 → 12**（用户实测"落地散架"的定位）」：
 *     `probe-jointtrace` 实测远端小关节速度爆：`foot_l/r` **4500/4100°/s**、
 *     `mfoot/arch` 1000~1900°/s。前足是 0.123 kg 薄盒、`I≈2e-4`，
 *     弓电机 K=400 ⇒ ω_n≈1414 rad/s（远超 120 Hz 步长）而 B=2.0 只给 ζ≈0.35
 *     ⇒ 数值上就是个"**抖振放大器**"。B 提到 12（ζ≈2，过阻尼）把这些抽动按住。
 *
 *   ⚠⚠ v2 初版写的正是 **2.0** —— 等于把 v1 已经修掉的坑**原样复现**。
 *     这与 `footAngularDamping` 缺失一起，构成"落地全散架"。已改回 12.0。
 *
 * ⚠ 由 Rapier `MotorModel.ForceBased` **隐式积分**承担 —— 自研显式 PD 在这个
 *   刚度量级下（弓沿自由轴惯量仅 ~7e-5）稳定上限只有 7.3，差 55 倍。
 *   `Drive` 层**不得**再对 arch/mfoot 写力矩（否则两条路径抢同一根轴，
 *   柔性足被"焊死"而外观指标看不出来 —— v1 踩过，见 `drive.ts` 头注释）。
 */
const ARCH_STIFFNESS = 400;
const ARCH_DAMPING = 12.0;

/**
 * 球铰实现方式：`true`（默认）= v2 的「2×revolute + 轻中间体」，
 * `false` = 照搬 v1 的原生 `JointData.spherical`。
 * 用 `SPH=0` 环境变量切到 v1 版（A/B 对照用）。
 */
const SPHERICAL_VIA_REVOLUTES = !['0', 'false', 'off'].includes(
  String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).SPH ?? '')
    .trim().toLowerCase());

export class Body {
  readonly world: RAPIER.World;
  readonly sk: Skeleton;
  readonly opt: BodyOptions;
  readonly bodies: RAPIER.RigidBody[] = [];
  readonly indexByKey = new Map<string, number>();
  /** 关节 i 的父/子刚体下标：`[i*2]` = 父、`[i*2+1]` = 子 */
  readonly jointBodies: Int32Array;
  readonly executor: Executor;
  /** 引擎级关节句柄（revolute 才有） */
  private readonly rapierJoints: (RAPIER.ImpulseJoint | undefined)[] = [];
  /** 用 2×revolute 替代球铰时创建的中间体（`jointIdx` → 刚体） */
  private readonly sphericalMids: { jointIdx: number; mid: RAPIER.RigidBody }[] = [];
  /** 由引擎电机（柔性足弓/中足）驱动的关节下标 ⇒ 自研限位/驱动必须跳过 */
  private readonly motorDriven = new Set<number>();
  /** 球铰替代用到的全部 revolute 句柄（诊断/销毁用） */
  private readonly sphericalSubJoints: RAPIER.ImpulseJoint[] = [];
  /**
   * ★★★ 逐轴限位回收速度上限（rad/s）—— **踝/脚踝加固的核心**。
   * `limitBiasMax[i*3+k] = max(12, 8·τmax / (I_轴 · physicsHz))`
   * 使限位角冲量恒压过马达 8 倍（v1 的 `limitBiasMax`，见上方常量的注释）。
   */
  private limitBiasMax = new Float64Array(0);
  /** 本步限位命中次数（诊断） */
  limitHits = 0;
  /** 诊断用：跳过 `enforceLimits`（单变量定位） */
  skipLimitsForDiag = false;
  /** 复用缓冲 */
  private readonly rr = new Float64Array(3);
  private readonly rv = new Float64Array(3);
  private readonly qRel = new Float64Array(4);
  private readonly axisW = new Float64Array(3);

  constructor(world: RAPIER.World, sk: Skeleton, opt: BodyOptions = DEFAULT_BODY_OPTIONS) {
    this.world = world;
    this.sk = sk;
    this.opt = opt;
    this.jointBodies = new Int32Array(sk.joints.length * 2);
    this.createGround(opt);
    this.createBodies(opt);
    this.createJoints(opt);
    this.executor = new Executor(world, sk, this.bodies, this.jointBodies);
    this.computeLimitBiasMax();
  }

  /**
   * ★★★ 预计算逐轴限位回收上限（**必须在关节/刚体全部建好之后**）。
   *
   * 公式（照搬 v1 `ragdoll.ts:1096-1121`）：
   *   `biasCap = max(LIMIT_MAX_BIAS, k · τmax / (I_轴 · physicsHz))`
   *
   * ⚠ v1 的教训：这段**必须放在 `axisInertia` 可用之后**。
   *   v1 曾把它放在 `jointIeff` 初始化旁边（那一刻全是 0）⇒ `Iax` 取 1e-6
   *   ⇒ `need` 成天文数字 ⇒ 限位每步注入巨量角冲量**把肢体弹飞**。
   */
  private computeLimitBiasMax(): void {
    const nj = this.sk.joints.length;
    this.limitBiasMax = new Float64Array(nj * 3);
    for (let i = 0; i < nj; i++) {
      const J = this.sk.joints[i]!;
      const free = freeAxisOf(J);
      for (let k = 0; k < 3; k++) {
        // 非自由轴：物理上没有这个自由度，限位不适用
        if (free !== -1 && free !== k) { this.limitBiasMax[i * 3 + k] = LIMIT_MAX_BIAS; continue; }
        const tmax = Math.abs(J.maxTorque?.[k] ?? 0);
        const Iax = this.axisInertia(i, k);
        const need = (LIMIT_BIAS_SAFETY * tmax) / (Math.max(1e-9, Iax) * ASSUMED_PHYSICS_HZ);
        this.limitBiasMax[i * 3 + k] = Math.max(LIMIT_MAX_BIAS, need);
      }
    }
  }

  /** 某轴的限位回收速度上限（rad/s），供探针回读 */
  limitBiasMaxOf(jointIdx: number, axis: number): number {
    return this.limitBiasMax[jointIdx * 3 + axis]!;
  }

  /**
   * 该关节是否由**引擎电机**独占驱动（柔性足弓 / 中足）。
   * `true` ⇒ `Drive` 层不写力矩、`enforceLimits` 不管其自由轴。
   */
  isMotorDriven(jointIdx: number): boolean {
    return this.motorDriven.has(jointIdx);
  }

  /** 关节数量（渲染层与 v1 契约同名） */
  get jointCount(): number {
    return this.sk.joints.length;
  }

  /**
   * ★ 身体参考点 = **上躯干（胸腔）**（与 v1 `ragdoll.torso()` 同语义）。
   * 用于相机跟随 / 直立判定 / 高度读数。
   */
  torso(): RAPIER.RigidBody {
    // 取**最上面那一段脊柱**（脊柱分段后胸腔 = spine4；不分段时 = torso）
    let best = 'torso', bestY = -Infinity;
    for (const b of this.sk.bodies) {
      if (/^spine\d+$/.test(b.key) && b.cy > bestY) { bestY = b.cy; best = b.key; }
    }
    return this.bodies[this.indexByKey.get(best) ?? 0]!;
  }

  /** 树根 = 骨盆（key 恒为 'torso'） */
  root(): RAPIER.RigidBody {
    return this.bodies[this.indexByKey.get('torso') ?? 0]!;
  }

  // ────────────────────────────────────────────────────────────────
  private createGround(opt: BodyOptions): void {
    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(60, 0.5, 12)
        .setTranslation(0, -0.5, 0)
        .setFriction(opt.groundFriction)
        .setCollisionGroups(GROUPS_GROUND),
      rb,
    );
  }

  private createBodies(opt: BodyOptions): void {
    this.sk.bodies.forEach((b: BodyDef, i: number) => {
      this.indexByKey.set(b.key, i);
      // ★★★ `restQuatOf` 返回的是 **`Vec4` 数组** `[x, y, z, w]`，
      //   **不是** `{x, y, z, w}` 对象。Rapier 的 wasm 绑定读的是对象的 `.x/.y/.z/.w`
      //   ⇒ 直接 `setRotation(restQuatOf(...))` 会读到 4 个 `undefined` ⇒ 四元数全 NaN
      //   ⇒ 刚体初始姿态非法 ⇒ `world.step()` **第一步就 NaN**。
      //
      //   踩坑记录（本会话最贵的一课）：
      //     症状 = `probe-idle` 全 NaN，而"看起来一样"的对照探针有的稳定有的 NaN。
      //     真变量根本不是关节/惯量/柔性足/`setCanSleep`/摩擦迭代 ——
      //     而是**对照探针里我手写了 `{x: q[0], ...}` 转换、只有走真实代码路径的这一处没转**。
      //     教训：**对照实验里"复刻"了真实代码的那一步，自己先悄悄修好了 bug**，
      //     于是对照永远"正常"、真实路径永远"失败"，看起来像"装配层有结构性缺陷"。
      //     ⇒ 今后写对照，必须从真实代码**逐字复制**，不许手写等价物。
      const q = restQuatOf(b.restTiltRad, b.restYawRad);
      // ★★★ 阻尼照搬 v1（`ragdoll.ts:981-986`）：**脚掌用单独的高角阻尼**。
      //   v1 注释：全局 12 会把侧向权重转移压掉 3.8 倍，所以只给脚。
      //   ⚠ v2 初版漏了 `footAngularDamping`（一律 0.05）⇒ 脚一碰地就狂转 ⇒ 散架。
      const isFoot = /^foot_/.test(b.key);
      const rb = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(b.cx, b.cy, b.cz)
          .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
          .setCanSleep(false)
          .setLinearDamping(opt.linearDamping)
          .setAngularDamping(isFoot ? opt.footAngularDamping : opt.angularDamping),
      );
      for (const c of b.colliders) {
        const desc = c.shape === 'capsule'
          ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
          : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
        desc
          .setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ ?? 0)
          // ★★★ 必须用 `setMassProperties`，**不是** `setMass`（v1 的教训，本会话踩过）。
          //   `setMass(m)` 只设质量，惯量仍由 Rapier 按**几何形状**自动算 ——
          //   而 skeleton.ts 已经按素材实测算了质心与惯量（`comY/inertiaXY/inertiaZ`）。
          //   两者不一致的后果：`arch_l`/`mfoot_l` 这种 0.12kg 级小刚体
          //   惯量被算成另一个量级 ⇒ `1/I` 巨大 ⇒ 关节冲量超调 ⇒ **world.step() 直接 NaN**。
          //   （实测：用 setMass 时第 1 步全部刚体 NaN；改回 setMassProperties 即正常。）
          .setMassProperties(
            c.mass,
            { x: 0, y: c.comY, z: 0 },
            { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ },
            { x: 0, y: 0, z: 0, w: 1 },
          )
          // ★ 照搬 v1（`ragdoll.ts:1008`）：**所有 collider 一律 bodyFriction**，
          //   不按部位区分（v1 就是这样，"大摩擦"靠 groundFriction=10 那一边给）。
          .setFriction(opt.bodyFriction)
          .setRestitution(0)                       // ★ 无弹性：防"落地弹跳"制造假速度
          .setCollisionGroups(GROUPS_SELF);
        this.world.createCollider(desc, rb);
      }
      this.bodies.push(rb);
    });
  }

  private createJoints(opt: BodyOptions): void {
    this.sk.joints.forEach((j: JointDef, i: number) => {
      const pi = this.indexByKey.get(j.parentKey);
      const ci = this.indexByKey.get(j.childKey);
      if (pi === undefined || ci === undefined) {
        throw new Error(`[body] 关节 ${j.name} 的刚体不存在`);
      }
      this.jointBodies[i * 2] = pi;
      this.jointBodies[i * 2 + 1] = ci;

      const anchor1 = { x: j.parentLocal[0], y: j.parentLocal[1], z: j.parentLocal[2] };
      const anchor2 = { x: j.childLocal[0], y: j.childLocal[1], z: j.childLocal[2] };

      if (j.revoluteAxis) {
        // ★★★ 照搬 v1（`ragdoll.ts:1314-1330`）：**revolute 用引擎级角度限位**。
        //
        //   这是唯一能让物理层拒绝侧翻的途径（球铰没有三轴限位 API）。
        //   v1 实测（`ragdoll.ts:168-172`）：
        //     · `JointData.revolute` **默认没有角度限位**（只锁 5 自由度、放开 1 转动）
        //     · `JointData` 上的 `limitsEnabled/limits` **不会传给创建出来的关节**（空操作）
        //       （实测读回 `limitsEnabled()=false`、`limitsMin()=-3.4e38`）
        //     · 必须在 `createImpulseJoint()` 返回的对象上调 `setLimits()` 才有用
        //
        //   ⚠⚠ 我在 v2 初版写的"纪律 D2：revolute 只用引擎限位 + spherical 只用自研"
        //     其实方向是对的，但我**没真的给 revolute 设引擎限位**，又把 revolute 的
        //     自由轴也丢进自研 `enforceLimits` ⇒ 变成"引擎没管、自研在管"，
        //     于是 `mfoot_r/0` 漂到 −172°（限位 ±25°）—— 正是"崴脚"的复现。
        const [ax, ay, az] = j.revoluteAxis;
        const jd = RAPIER.JointData.revolute(anchor1, anchor2, { x: ax, y: ay, z: az });
        const joint = this.world.createImpulseJoint(
          jd, this.bodies[pi]!, this.bodies[ci]!, true,
        ) as RAPIER.ImpulseJoint;
        // ★★★ 限位必须用关节对象上的 `setLimits()`（照搬 v1 `ragdoll.ts:1371-1376`）。
        //   revolute 的 `limits` 是**单对标量**（只约束那一个自由转轴）
        //   ⇒ 取**与 revoluteAxis 对应的那一轴**（踝 = 轴2 屈伸，中足 = 轴0）。
        const jm = joint as unknown as { setLimits?(lo: number, hi: number): void };
        if (typeof jm.setLimits === 'function') {
          const axIdx = ax !== 0 ? 0 : ay !== 0 ? 1 : 2;
          jm.setLimits(j.minRad[axIdx]!, j.maxRad[axIdx]!);
        }
        // ★★★ 照搬 v1 柔性足装配（`ragdoll.ts:1355-1370`）：**弓/中足用 Rapier
        //   `MotorModel.ForceBased` 电机**，不用自研 PD。
        //
        //   原因（v1 实测，`ragdoll.ts:1342-1354`）：弓是**梁架**不是弹簧垫，
        //   负荷下真实足弧只变形 2~3 mm ⇒ K ≈ 686N×0.02m / 2° = **400 N·m/rad**。
        //   而自研显式 PD 在 dt=1/120 下的稳定上限只有 **7.3**（弓沿自由轴惯量仅 7e-5）
        //   ⇒ 两者差 **55 倍**，弹簧在显式积分下不可能实现。
        //   `ForceBased` 的刚度就是真实量纲 N·m/rad，且由求解器**隐式**积分
        //   ⇒ 无显式稳定上限，可以直接给几百 N·m/rad。
        //
        //   ⚠ 默认的 `AccelerationBased` 模式把刚度当加速度（隐式除了质量）⇒
        //     量纲不对。必须切到 `ForceBased`。
        if (j.name.startsWith('arch_') || j.name.startsWith('mfoot_')) {
          const mj = joint as unknown as {
            configureMotorModel(m: number): void;
            configureMotorPosition(t: number, k: number, b: number): void;
          };
          mj.configureMotorModel(RAPIER.MotorModel.ForceBased);
          mj.configureMotorPosition(0, ARCH_STIFFNESS, ARCH_DAMPING);
          this.motorDriven.add(i);
        }
        this.rapierJoints[i] = joint;
      } else if (SPHERICAL_VIA_REVOLUTES) {
        // ★ 球铰：Rapier 0.14 的球铰在**非零锚点**下第一帧就注入虚假相对角速度
        //   （实测：neck 的 z 偏置 6.1mm ⇒ Δω = 14.5 rad/s；锚点全零 ⇒ 0.000）。
        //
        //   ⇒ v2 用 **2 个正交 revolute + 1 个轻中间刚体**替代球铰，且**关节数据
        //     （锚点/限位/τmax）一个字不改**。中间体 1e-6 kg（只提供运动学）。
        this.createSphericalViaRevolutes(i, j, pi, ci, anchor1, anchor2);
      } else {
        // ★★ 照搬 v1（`ragdoll.ts:1323`）：**原生球铰**。
        //   v1 就是用它 + 自研 `enforceLimits` 才站得住的。
        //   本分支为 A/B 对照保留（`SPH=0` 环境变量切换）。
        const jd = RAPIER.JointData.spherical(anchor1, anchor2);
        this.rapierJoints[i] = this.world.createImpulseJoint(
          jd, this.bodies[pi]!, this.bodies[ci]!, true,
        ) as RAPIER.ImpulseJoint;
      }
    });
  }

  /**
   * ★★ 用「2 个正交 revolute + 1 个轻中间刚体」替代 Rapier 球铰。
   *
   * 为什么（实测，单变量）：
   *   `JointData.spherical` 在非零锚点下，**零重力零初速零力矩**时第一帧就注入
   *   相对角速度 14.48 rad/s（neck，锚点 z 偏置 6.1 mm）。锚点全零则完全干净。
   *   同锚点换成 `revolute` ⇒ `|Δω| = 0.000`。
   *   ⇒ 这是 Rapier 0.14 球铰的数值缺陷，不是骨架数据问题。
   *
   * 自由度守恒：2 个 revolute 各放开 1 个转动 = 2 自由度。
   *   骨架给球铰的是 3 自由度（三个轴都有 min/max）。少的那 1 个（绕"两条 z 轴"的
   *   自转）在实际人体关节里也几乎不用（它是扭转轴），且 v1 的 `enforceLimits`
   *   本来就只对越界轴介入 ⇒ 少一轴不影响限位语义。
   *   ⚠ 若将来需要完整 3 轴，再在第 2 个中间体上加第 3 个 revolute。
   *
   * 中间体：质量 1e-6 kg（`setAdditionalMass`），无 collider ⇒ 纯运动学传力节点。
   */
  private createSphericalViaRevolutes(
    i: number, _j: JointDef, pi: number, ci: number,
    anchor1: { x: number; y: number; z: number },
    anchor2: { x: number; y: number; z: number },
  ): void {
    const p = this.bodies[pi]!;
    const c = this.bodies[ci]!;
    // 中间体放在锚点的世界位置（= 两锚点重合处）
    const aw = new Float64Array(3);
    this.toWorld(p, anchor1.x, anchor1.y, anchor1.z, aw);
    const mid = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(aw[0]!, aw[1]!, aw[2]!)
        .setCanSleep(false),
    );
    mid.setAdditionalMass(1e-6, true);
    // 轴 1：父 → 中间体（绕 X）
    this.sphericalSubJoints.push(this.world.createImpulseJoint(
      RAPIER.JointData.revolute(anchor1, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
      p, mid, true,
    ) as RAPIER.ImpulseJoint);
    // 轴 2：中间体 → 子（绕 Z）。两轴正交 ⇒ 覆盖 X/Z 两个转动自由度。
    this.sphericalSubJoints.push(this.world.createImpulseJoint(
      RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, anchor2, { x: 0, y: 0, z: 1 }),
      mid, c, true,
    ) as RAPIER.ImpulseJoint);
    this.sphericalMids.push({ jointIdx: i, mid });
    this.rapierJoints[i] = undefined;
  }

  // ────────────────────────────────────────────────────────────────
  /** 关节 i 的三轴相对角（rad，已减 `restRad`，与 v1 契约一致） */
  jointRot(i: number, out: Float64Array = this.rr): void {
    const pi = this.jointBodies[i * 2]!;
    const ci = this.jointBodies[i * 2 + 1]!;
    const qp = this.bodies[pi]!.rotation();
    const qc = this.bodies[ci]!.rotation();
    calcJointRot(qp.x, qp.y, qp.z, qp.w, qc.x, qc.y, qc.z, qc.w, this.qRel, out);
    const rest = this.sk.joints[i]!.restRad;
    out[0] -= rest[0]; out[1] -= rest[1]; out[2] -= rest[2];
  }

  /** 关节 i 的三轴相对角速度（rad/s，父体本地） */
  jointRelVel(i: number, out: Float64Array = this.rv): void {
    const p = this.bodies[this.jointBodies[i * 2]!]!;
    const c = this.bodies[this.jointBodies[i * 2 + 1]!]!;
    const wp = p.angvel();
    const wc = c.angvel();
    const qp = p.rotation();
    calcJointRelVel(qp.x, qp.y, qp.z, qp.w, wc.x - wp.x, wc.y - wp.y, wc.z - wp.z, out);
  }

  /** 诊断用：返回全部引擎关节句柄（含球铰替代用的 2×revolute） */
  rapierJointsAll(): RAPIER.ImpulseJoint[] {
    const out: RAPIER.ImpulseJoint[] = [];
    for (const j of this.rapierJoints) if (j) out.push(j);
    for (const j of this.sphericalSubJoints) out.push(j);
    return out;
  }

  /** 关节 i 的锚点世界坐标 */
  jointWorld(i: number, out: Float64Array): void {
    const j = this.sk.joints[i]!;
    const p = this.bodies[this.jointBodies[i * 2]!]!;
    this.toWorld(p, j.parentLocal[0], j.parentLocal[1], j.parentLocal[2], out);
  }

  /** 关节 i 的本地轴 k 的世界方向 */
  jointWorldAxis(i: number, k: number, out: Float64Array): void {
    const p = this.bodies[this.jointBodies[i * 2]!]!;
    const q = p.rotation();
    if (k === 0) quatRotate(q.x, q.y, q.z, q.w, 1, 0, 0, out);
    else if (k === 1) quatRotate(q.x, q.y, q.z, q.w, 0, 1, 0, out);
    else quatRotate(q.x, q.y, q.z, q.w, 0, 0, 1, out);
  }

  /** 本地点 → 世界点（含平移） */
  toWorld(b: RAPIER.RigidBody, vx: number, vy: number, vz: number, out: Float64Array): void {
    const q = b.rotation();
    quatRotate(q.x, q.y, q.z, q.w, vx, vy, vz, out);
    const t = b.translation();
    out[0] += t.x; out[1] += t.y; out[2] += t.z;
  }

  /**
   * ★★ 自研逐轴限位（**全部关节**，照搬 v1 `enforceLimits` 的核心三件事）。
   *
   * 为什么自研而不是用引擎限位（v1 实测，`ragdoll.ts:168-172`）：
   *   · `JointData.revolute` **默认没有角度限位**（只锁 5 自由度、放开 1 转动）
   *   · `JointData` 上的 `limitsEnabled/limits` **不会传给创建出来的关节**（空操作）
   *   · 只有**速度级**归零会**永久失效**（归零后条件不再成立，角度停在限位外无回复）
   *
   * v1 的三条关键设计，逐条照搬：
   *
   *   ① **位置级投影**：目标角速度只由**越界量**决定，完全不看 `wRel`：
   *        `w_target = −sign(excess) · min(rate·excess, biasCap)`
   *      v1 实测「夹住 `wErr`」那条路是错的（`wRel` 可以 ±100 rad/s，
   *      夹住后仍被 `wRel` 符号牵着走，而它的方向恰好是继续越界）。
   *
   *   ② **权限压过马达**（★ 踝加固）：`biasCap = 8·τmax/(I_轴·physicsHz)`
   *      —— 见 `LIMIT_BIAS_SAFETY` 的注释。缺这一条踝会转到 ±174°（限位 ±18°）⇒ 崴脚。
   *
   *   ③ **冲量再夹一次上限**：`w_target − wRel` 可以任意大（马达把关节拽飞时），
   *      而这是**显式**施加的冲量，Rapier 不会替它做稳定性保护 ⇒ 它自己就成了
   *      把腰甩出去的力（v1 实测 `spine1/0` 整机转圈）。
   *
   * 必须在 `world.step()` **之后**调用。
   */
  enforceLimits(dt: number): void {
    if (this.skipLimitsForDiag) return;
    this.limitHits = 0;
    const nj = this.sk.joints.length;
    const { limitBiasRate } = this.opt;
    for (let i = 0; i < nj; i++) {
      const j = this.sk.joints[i]!;
      const pi = this.jointBodies[i * 2]!;
      const ci = this.jointBodies[i * 2 + 1]!;
      const p = this.bodies[pi]!;
      const c = this.bodies[ci]!;
      const qp = p.rotation();
      this.jointRot(i, this.rr);
      const free = freeAxisOf(j);
      // ★★★ 照搬 v1（`ragdoll.ts:3876-3896`）：**revolute 的自由轴由引擎 `setLimits`
      //   独占**，自研限位必须 `continue` 跳过，否则同一个限位被执行两遍
      //   （求解器先零掉越界方向角速度 → 自研看到仍越界 → 再投影一次 → 步内反复触发的
      //   能量泵）。v1 实测踝角速峰值 **1815°/s**、鞋底滑移 87 mm 就是这个原因。
      const revAx = free;   // revolute 的自由轴；球铰为 −1

      for (let k = 0; k < 3; k++) {
        // revolute 的自由轴 → 引擎独占限位，自研跳过
        if (revAx === k) continue;
        // ★ 非自由轴（revolute 的非转动轴）由引擎的等式约束锁死，不需自研限位
        if (free !== -1 && free !== k) continue;
        const lo = j.minRad[k]!, hi = j.maxRad[k]!;
        if (hi - lo >= Math.PI * 1.99) continue;   // 真 360° 全开
        const a = this.rr[k]!;
        const out = a > hi ? 1 : a < lo ? -1 : 0;
        if (out === 0) continue;

        // 世界轴
        if (k === 0) quatRotate(qp.x, qp.y, qp.z, qp.w, 1, 0, 0, this.axisW);
        else if (k === 1) quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 1, 0, this.axisW);
        else quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 0, 1, this.axisW);

        // 该轴相对角速度（世界投影）
        const av = c.angvel(), ap = p.angvel();
        const wRel = (av.x - ap.x) * this.axisW[0]!
          + (av.y - ap.y) * this.axisW[1]!
          + (av.z - ap.z) * this.axisW[2]!;

        // ① 位置投影：目标角速度只由越界量决定
        const excess = out > 0 ? a - hi : lo - a;
        const biasCap = this.limitBiasMax[i * 3 + k]!;      // ② 权限压过马达
        const wTarget = -Math.sign(excess) * Math.min(excess * limitBiasRate, biasCap);
        const wErr = wTarget - wRel;
        if (Math.abs(wErr) < 1e-6) continue;

        // ③ 冲量上限 —— ★★ 照搬 v1（`ragdoll.ts:4011-4030`）。
        //
        //   ⚠⚠ 这里曾经写成 `impMax = biasCap · I_轴 · dt`，是**错的**。
        //     两个概念被合并了：
        //       · `biasCap`（`limitBiasMax`）= 目标**角速度**上限（rad/s）
        //       · 冲量上限 = 独立的 `bias · τmax · dt`（与 `I_轴` 无关）
        //     合并后 `mfoot_l/0` 的 `limitBiasMax = 18804`（因 `I_轴 ~ 5e-5` 极小）
        //     被当成角速度上限直接乘进冲量 ⇒ 每步注入巨量角冲量 ⇒
        //     实测 T1 从 `Σ|Δθ| = 226°` 恶化到 **860°**（`mfoot_r/0` 漂 −172°）。
        //
        //   v1 的真实语义（逐字照搬）：
        //       `bias = (脊柱 || 越界 >5°) ? 12 : LIMIT_BIAS_SAFETY(8)`
        //       `Jcap = bias · |τmax[k]| · dt`
        //       `J = clamp(wErr · I_轴, ±Jcap)`
        //   ⇒ 冲量与 `I_轴` 无关、只与马达同尺度（`τmax·dt`）成比例，
        //     这样"限位最坏也只能施加马达同量级的角冲量" ⇒ 反作用有界
        //     ⇒ 不会把身体甩出去（v1 用它修掉了 `spine1/0` 整机转圈）。
        const DEG = Math.PI / 180;
        const overR = Math.max(a - hi, lo - a);
        const jnL = (j as { name?: string }).name ?? '';
        const bias = (jnL.startsWith('spine') || overR > 5 * DEG)
          ? 12                                  // v1: LBIAS_SPINE 默认 12（骨/韧带量级）
          : LIMIT_BIAS_SAFETY;                  // v1 默认 8
        const Jcap = bias * Math.abs(j.maxTorque?.[k] ?? 0) * dt;
        const Iax = this.axisInertia(i, k);
        let J = wErr * Iax;
        if (J > Jcap) J = Jcap;
        else if (J < -Jcap) J = -Jcap;

        const v = { x: this.axisW[0]! * J, y: this.axisW[1]! * J, z: this.axisW[2]! * J };
        c.applyTorqueImpulse(v, true);
        v.x = -v.x; v.y = -v.y; v.z = -v.z;
        p.applyTorqueImpulse(v, true);
        this.limitHits++;
      }
    }
  }

  /** 关节 i 绕本地轴 k 的折合转动惯量（两个刚体在该轴上的并联） */
  axisInertia(i: number, k: number): number {
    const pi = this.jointBodies[i * 2]!;
    const ci = this.jointBodies[i * 2 + 1]!;
    const qp = this.bodies[pi]!.rotation();
    if (k === 0) quatRotate(qp.x, qp.y, qp.z, qp.w, 1, 0, 0, this.axisW);
    else if (k === 1) quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 1, 0, this.axisW);
    else quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 0, 1, this.axisW);
    const [ax, ay, az] = this.axisW;
    const Ia = inertiaAlong(this.bodies[pi]!, ax!, ay!, az!);
    const Ib = inertiaAlong(this.bodies[ci]!, ax!, ay!, az!);
    return 1 / (1 / Math.max(1e-9, Ia) + 1 / Math.max(1e-9, Ib));
  }

  /** 复位到静姿态（清速度） */
  reset(): void {
    this.sk.bodies.forEach((b: BodyDef, i: number) => {
      const rb = this.bodies[i]!;
      // ★ 同样必须转成对象（见 `createBodies` 的说明）
      const q = restQuatOf(b.restTiltRad, b.restYawRad);
      rb.setTranslation({ x: b.cx, y: b.cy, z: b.cz }, true);
      rb.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
    this.executor.clearAll();
  }

  /** 所有刚体重心（质量加权） */
  com(out: Float64Array): void {
    let m = 0, x = 0, y = 0, z = 0;
    for (const b of this.bodies) {
      const bm = b.mass();
      const t = b.translation();
      m += bm; x += bm * t.x; y += bm * t.y; z += bm * t.z;
    }
    out[0] = x / m; out[1] = y / m; out[2] = z / m;
  }

  /** 检查 D1：父子锚点世界坐标必须重合（构造期断言用） */
  checkAnchorCoincidence(): { name: string; err: number }[] {
    const bad: { name: string; err: number }[] = [];
    const a = new Float64Array(3), b2 = new Float64Array(3);
    this.sk.joints.forEach((j, i) => {
      const bp = this.bodies[this.jointBodies[i * 2]!]!;
      const bc = this.bodies[this.jointBodies[i * 2 + 1]!]!;
      this.toWorld(bp, j.parentLocal[0], j.parentLocal[1], j.parentLocal[2], a);
      this.toWorld(bc, j.childLocal[0], j.childLocal[1], j.childLocal[2], b2);
      const err = Math.hypot(a[0] - b2[0], a[1] - b2[1], a[2] - b2[2]);
      if (err > 1e-6) bad.push({ name: j.name, err });
    });
    return bad;
  }
}

// ────────────────────────────────────────────────────────────────
// ★ 静姿态四元数直接用 skeleton.ts 的 `restQuatOf`（原样移植，同一公式）
//   —— 不再在这里手抄一份。v1 的教训：同一个公式抄两处 ⇒ 改一处静默不一致。

/** 刚体绕世界方向 (ax,ay,az) 的转动惯量（主惯量按方向加权） */
function inertiaAlong(b: RAPIER.RigidBody, ax: number, ay: number, az: number): number {
  const I = b.principalInertia();
  return ax * ax * I.x + ay * ay * I.y + az * az * I.z;
}

/** 相对旋转 → 旋转向量（axis×angle），写入 out[0..2] */
function calcJointRot(
  px: number, py: number, pz: number, pw: number,
  cx: number, cy: number, cz: number, cw: number,
  tmp: Float64Array, out: Float64Array,
): void {
  // q_rel = conj(qp) ⊗ qc
  const ix = -px, iy = -py, iz = -pz, iw = pw;
  const rx = iw * cx + ix * cw + iy * cz - iz * cy;
  const ry = iw * cy - ix * cz + iy * cw + iz * cx;
  const rz = iw * cz + ix * cy - iy * cx + iz * cw;
  const rw = iw * cw - ix * cx - iy * cy - iz * cz;
  tmp[0] = rx; tmp[1] = ry; tmp[2] = rz; tmp[3] = rw;
  // 旋转向量 = 2·atan2(|v|, w) · v/|v|
  const vlen = Math.hypot(rx, ry, rz);
  if (vlen < 1e-12) { out[0] = 0; out[1] = 0; out[2] = 0; return; }
  let ang = 2 * Math.atan2(vlen, rw);
  if (ang > Math.PI) ang -= 2 * Math.PI;      // ★ 取短弧（|ang| ≤ π）
  const s = ang / vlen;
  out[0] = rx * s; out[1] = ry * s; out[2] = rz * s;
}

/** 相对角速度 → 父体本地三轴分量 */
function calcJointRelVel(
  px: number, py: number, pz: number, pw: number,
  wx: number, wy: number, wz: number, out: Float64Array,
): void {
  // out = conj(qp) ⊗ w  （旋转向量按父体本地系）
  const ix = -px, iy = -py, iz = -pz, iw = pw;
  out[0] = iw * wx + iy * wz - iz * wy;
  out[1] = iw * wy - ix * wz + iz * wx;
  out[2] = iw * wz + ix * wy - iy * wx;
}
