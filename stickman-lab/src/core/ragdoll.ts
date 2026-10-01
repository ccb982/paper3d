// ============================================================
// ragdoll —— 把骨架装成 Rapier 刚体 + 球关节 +（自实现的）三轴关节马达
// ============================================================
// ★★ 为什么不用 Rapier 自带的关节马达（tools/probe-motor.ts 的实测结论，别改回去）
//
//   实测 1：`configureMotorVelocity(targetVel, 1)` 几乎零出力 —— 火柴人 40 代
//          「最佳前进 0.000 m、全体不摔」，就是这条造成的。
//   实测 2：把 factor 往上扫，gain 1→20 都看不出驱动，gain 30 直接数值爆炸
//          （Δx 上万米后 wasm `unreachable`）。**根本没有可用区间**。
//   实测 3：`ImpulseJoint.handle` 读回是 `0, 5e-324, 1e-323, …` ——
//          整数 1,2,3… 被当成 f64 位模式重新解释了（和本体记录的
//          `createRigidBody` 坏 handle 是同一类绑定 bug）。
//
//   ★ 而且球关节连"名义上的马达"都没有：0.14.0 里 `SphericalImpulseJoint` 是**空类**
//     （dynamics/impulse_joint.d.ts:171 `export declare class SphericalImpulseJoint extends ImpulseJoint {}`），
//     官方在马达/限位那段源码里写着 "Unsupported by this alpha release"。
//     ⇒ 3D 方案下，马达与限位**只能**自实现，没有第二条路。
//
//   → 每物理步对父/子刚体施加一对**等大反向的力矩冲量**（绕同一世界轴）。
//     这本来就是关节马达的物理定义：
//       · 力矩上限取 MuJoCo humanoid.xml 的 actuator gear（髋 200 / 膝 150 /
//         肩 100 / 颈 100 / 肘 40 N·m），是文献里调过的"机器人执行器量级"；
//       · 力矩被 clamp 住 ⇒ 必然有界 ⇒ 不会像 Rapier 马达那样在某个 gain 后爆炸；
//       · 完全不经过关节绑定层，绕开上面那些坑。
//
// ★★ 球关节的锚点约束扛不扛得住施加的力矩？—— 扛得住，但要提高求解器迭代数
//   （tools/probe-ball.ts 实测，别改回去）：
//     锚点漂移 vs 每步三轴力矩冲量（默认 iters，单位 m）：
//       0.01–0.1 → 2.7–4.2 mm ✔   0.5–2 → 32–60 mm △ 偏软   ≥5 → 486 mm+ ✘ 撕裂
//     MuJoCo gear 髋 200 N·m 换算成每步冲量 = 200/120 = 1.67 N·m·s —— 正落在「偏软」区。
//     提高求解器迭代数可以把刚度换回来（同一 5.0 冲量）：
//       iters  4 → 486 mm    8 → 65 mm    16 → 29 mm    32 → 9.5 mm
//     代价（单世界 2000 步）：10.6 / 10.5 / 14.2 / 23.6 µs 每步。
//     ⇒ sim 的 solverIterations 提到 16（默认档），要更硬就 32（+66% 物理开销）。
//   另：纯重力下锚点漂移只有 2.6 mm，且能自由摆出 Z 向位移 ⇒ 3 个转动自由度是真实的。
//
// ★ 自碰撞：**全部关掉**（角色自己的刚体之间永不互撞，只碰地面）。
//   理由是美术包围盒比关节间距宽得多，开自碰撞会持续用巨大的分离力互相顶，
//   是数值发散的温床。代价是左右腿可以互穿 —— 对"纸片人偶"这个视觉风格反而是好事。

import RAPIER from '@dimforge/rapier3d';
import { JOINT_MAX_SPEED, type BodyDef, type JointDef, type Skeleton } from './skeleton';

// ---------------------------------------------------------------- 碰撞分组
// groups = (membership << 16) | filter，双方都要放行才算碰撞。
const MEM_GROUND = 0x0001;
const MEM_SELF = 0x0002;

/** 角色刚体：只碰地面，不碰自己 */
const GROUPS_SELF = ((MEM_SELF << 16) | MEM_GROUND) >>> 0;
/** 地面：碰角色 */
const GROUPS_GROUND = ((MEM_GROUND << 16) | MEM_SELF) >>> 0;

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const ZERO = { x: 0, y: 0, z: 0 };

/**
 * 马达每物理步最多吃掉多少比例的"相对角速度误差"。
 * 显式 P 控制的稳定条件是 α < 2（α=1 一步到位、α>2 振荡发散），取 0.35 留足余量。
 * 这是"限加速度"而不是"限力矩"——后者才是 probe-reset 里那个 284 m/s 爆炸的根因。
 */
const MOTOR_ALPHA = 0.35;

/** 越界回程时用的 α：要大一点才能把甩出去的关节拉回来，但仍须 < 1 */
const MOTOR_ALPHA_RECOVER = 0.7;

/**
 * 软限位的"回程带"（弧度）：越界量达到这个宽度时，目标速度被强制打满回程。
 * 越界越少、回程越柔。★ 上限还会被关节自身量程 clamp（`min(这个值, hi−lo)`），
 * 否则像膝绕 X 那种 ±6° 的窄轴，要越界 17° 才全力回程，等于限位形同虚设。
 */
const LIMIT_SOFT_ZONE = 0.3;

/** 本地三轴（世界初始 = 骨架初始姿态的坐标系） */
const AXIS_X = 0, AXIS_Y = 1, AXIS_Z = 2;

export interface RagdollOptions {
  /** 地面摩擦 */
  groundFriction?: number;
  /** 角色碰撞体摩擦 */
  bodyFriction?: number;
  /** 线性阻尼 */
  linearDamping?: number;
  /** 角阻尼（关节内摩擦之外的整体衰减） */
  angularDamping?: number;
  /**
   * 关节力矩的全局缩放（1 = 完全按 MuJoCo gear）。
   * 想让火柴人"力气更大/更软"时调它，而不是去调每个关节。
   */
  torqueScale?: number;
  /**
   * ★ 被动"姿态张力"增益 k（单位 1/s）：关节的等效目标角速度里叠加 `−k · 关节角`，
   * 把关节往**初始姿态（角 0）**拉。默认 9.0，置 0 可关掉对照。
   *
   * ★ 为什么从 6.0 提到 9.0（tools/probe-ground 的 k 对照，体重 687 N）：
   *   k=6  静息接触力 606 N（88% 体重）  t=2s 躯干 y = 1.107 m  CoM 撑在支撑区内 2.25s/3s
   *   k=9  静息接触力 720 N（105% 体重）  t=2s 躯干 y = 1.120 m  CoM 撑在支撑区内 2.75s/3s
   *   k=12 静息接触力 725 N（106% 体重）  t=2s 躯干 y = 1.122 m  CoM 撑在支撑区内 3.00s/3s
   *   判据是"静止站立时地面接触力应当 ≈ 体重"⇒ k≥9 才真正对账（k=6 只有 0.88 倍）。
   *   再往上（12）静息性能几乎饱和，但张力越大网络越难克服（会压低步幅），故取 9.0。
   *
   * 为什么必须有它（这是"学不出走路"的第三个根因，实测数据在 tools/probe-fight）：
   *   网络输出的目标是**角速度**，不是位置。于是"零输出"= 纯阻尼控制 ——
   *   它能抵抗关节运动，但**不抵抗静态力矩**：重力压着膝盖，只要膝盖不转，
   *   阻尼项就输出 0 力矩，膝盖便一路弯到限位。实测零输出的刚体人偶躯干
   *   从 1.128 m 被慢慢压到 0.693 m（蹲姿），直接踩到摔倒阈值。
   *   后果是 ES 一代里个体几乎全是"摔倒"，适应度梯度全花在"别倒"上，
   *   40 代也走不出一步。
   * 加上它之后零输出 = 站得住 —— 这正是想要的 ES 起点：**先会站，再学走**。
   *
   * ★ 为什么是"改目标速度"而不是"直接加一个弹簧力矩"：
   *   直接加 k·θ 的弹簧力矩有显式积分稳定条件 k < 2·Ieff/dt —— 前臂 I≈0.03、
   *   dt=1/120 ⇒ k < 7.2 N·m/rad，而要让 70 kg 人形站住需要的 k 是几十上百，
   *   必然发散。改成写进目标速度后，它自动走上面那套 `α·|err|·Ieff` 的稳定性上限，
   *   结构性稳定。物理含义上也站得住：这就是 PD 控制的 P 项（角速度目标是 D 项），
   *   对应肌肉的静息张力/韧带刚度。
   */
  restTension?: number;
  /**
   * ★ reset() 时是否"删掉关节再重建"（默认 true）。
   *
   * 为什么：Rapier 的约束解算器会把上一轮的**累积冲量**存在关节里做暖启动，
   * 而 reset() 只清刚体的位姿和速度 —— 解算器内部的缓存还在。
   * probe-reset 实测：同一份基因组在同一 Sim 上连续重放，**从 step1 就分叉**
   * （不是第 2 步之后，所以不是混沌敏感性）；且 reset 后头 6 步的速度和
   * 随重放次数单调变化。⇒ 是残留污染，不是随机性。
   * 后果：ES 的适应度被个体间残留状态污染 + 噪声极大，是"学不出走路"的直接原因之一。
   * 关掉它（false）可以复现那个污染，用于对照实验。
   */
  purgeJointCache?: boolean;
}

const DEFAULTS: Required<RagdollOptions> = {
  groundFriction: 1.0,
  bodyFriction: 0.9,
  linearDamping: 0.0,
  angularDamping: 0.04,
  torqueScale: 1.0,
  restTension: 9.0,
  purgeJointCache: true,
};

// ---------------------------------------------------------------- 四元数工具
// 全部零分配：写入调用方给的缓冲。热路径（每物理步 × 每关节 × 3 轴）不能 new。

/** out = q 旋转 v */
function quatRotate(
  qx: number, qy: number, qz: number, qw: number,
  vx: number, vy: number, vz: number,
  out: Float64Array,
): void {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}

/** out = q⁻¹ 旋转 v（把世界向量搬到 q 的本地坐标系） */
function quatInvRotate(
  qx: number, qy: number, qz: number, qw: number,
  vx: number, vy: number, vz: number,
  out: Float64Array,
): void {
  // q⁻¹ = (−x,−y,−z,w)
  quatRotate(-qx, -qy, -qz, qw, vx, vy, vz, out);
}

/**
 * q_rel = q_a⁻¹ ⊗ q_b（写入 out 的前 4 个分量）。
 * 表示"子坐标系相对父坐标系的姿态"，分量表达在父坐标系里。
 */
function quatRel(
  ax: number, ay: number, az: number, aw: number,
  bx: number, by: number, bz: number, bw: number,
  out: Float64Array,
): void {
  // conj(a) ⊗ b
  const cx = -ax, cy = -ay, cz = -az, cw = aw;
  out[0] = cw * bx + cx * bw + cy * bz - cz * by;
  out[1] = cw * by - cx * bz + cy * bw + cz * bx;
  out[2] = cw * bz + cx * by - cy * bx + cz * bw;
  out[3] = cw * bw - cx * bx - cy * by - cz * bz;
}

/**
 * 四元数 → 旋转向量（exponential map），写入 out 的 3 个分量。
 * |out| ∈ [0, π]，始终取"最短表示"（角度 > π 时翻转轴）。
 * 这就是 3D 关节的"三轴关节角"，见 sim 的输入填装。
 */
function quatToRotVec(
  qx: number, qy: number, qz: number, qw: number,
  out: Float64Array,
): void {
  const w = qw > 1 ? 1 : qw < -1 ? -1 : qw;
  const half = Math.acos(w);        // ∈ [0, π]
  const s = Math.sin(half);
  if (s < 1e-7) {                   // 0° 或 360°：退化，轴无定义
    out[0] = 0; out[1] = 0; out[2] = 0;
    return;
  }
  const ang = 2 * half;             // ∈ [0, 2π]
  // 角度 > π 时换成"绕反向轴转 2π−ang"，保证 |rotvec| ≤ π
  const k = ang > Math.PI ? -(2 * Math.PI - ang) / s : ang / s;
  out[0] = qx * k; out[1] = qy * k; out[2] = qz * k;
}

/**
 * 关节姿态 = 把上面两步串起来。tmp4 是 4 分量暂存（调用方给，避免分配）。
 * ★ 单独抽成函数是为了让 driveMotors 复用「已经取好的四元数」——
 *   热路径上 p.rotation() 每次都跨一次 wasm 边界并 new 一个对象，
 *   原来每关节要取 3 次，白白多两次。
 */
function calcJointRot(
  qpx: number, qpy: number, qpz: number, qpw: number,
  qcx: number, qcy: number, qcz: number, qcw: number,
  tmp4: Float64Array, out: Float64Array,
): void {
  quatRel(qpx, qpy, qpz, qpw, qcx, qcy, qcz, qcw, tmp4);
  quatToRotVec(tmp4[0], tmp4[1], tmp4[2], tmp4[3], out);
}

/** 关节速度 = 世界相对角速度搬到父体本地 */
function calcJointRelVel(
  qpx: number, qpy: number, qpz: number, qpw: number,
  rx: number, ry: number, rz: number,
  out: Float64Array,
): void {
  quatInvRotate(qpx, qpy, qpz, qpw, rx, ry, rz, out);
}

export class Ragdoll {
  readonly sk: Skeleton;
  readonly opt: Required<RagdollOptions>;
  readonly bodies: RAPIER.RigidBody[] = [];
  /** ★ 每次 reset 都会整体重建（见 purgeJointCache），所以别缓存元素引用 */
  readonly joints: RAPIER.ImpulseJoint[] = [];
  /** key → 刚体下标 */
  readonly indexByKey = new Map<string, number>();
  /** 关节 i → [父刚体下标, 子刚体下标] */
  readonly jointBodies: Int32Array;
  /**
   * 关节 i 的等效惯量（单位冲量造成的相对角速度变化 = 1/Ieff），构造时算一次。
   * ★ 3D 版取两个刚体**三个主惯量的最小值**再合成 —— 偏保守。
   *   （绕某轴转的惯量 ≥ 主惯量最小值，用最小值 ⇒ 允许的冲量偏小 ⇒ 不会引入不稳定。）
   */
  readonly jointIeff: Float64Array;
  /** 关节目标角速度（rad/s），长度 = 关节数 × 3，由 setMotorTargets 写入、driveMotors 消费 */
  readonly motorTarget: Float32Array;
  /**
   * ★ 上一次 driveMotors 里**实际施加**到子刚体上的马达冲量（N·m·s），每关节 3 个轴。
   *
   * 存在的意义：Rapier 0.14 的 wasm 绑定里**完全没有关节冲量/反力的读回接口**
   * （rawimpulsejointset_* 只有 jointType / anchor / limits / motor 配置，没有 impulse）。
   * 所以"各个组件受力"只能靠**我们自己记账 + 牛顿定律重建**：
   *   · 马达力矩 —— 这个文件自己施加的，直接记下来（本数组）
   *   · 地面接触力 —— 从接触流形 contactImpulse + normal 读
   *   · 关节反作用力 —— 用"子树动量收支"反推（见 tools/probe-forces.ts C 段）
   * 除以 dt 就是力矩（N·m）。
   */
  readonly motorImpulse: Float64Array;

  private readonly world: RAPIER.World;
  private readonly initX: Float64Array;
  private readonly initY: Float64Array;
  private readonly initZ: Float64Array;

  // ---- 热路径复用缓冲（零分配） ----
  private readonly qRel = new Float64Array(4);
  private readonly rv = new Float64Array(3);
  private readonly relL = new Float64Array(3);
  private readonly axisW = new Float64Array(3);
  /** tiltOf / headingOf 的独立 scratch（别和 rv 共用，否则嵌套调用会串） */
  private readonly dirTmp = new Float64Array(3);
  /** applyTorqueImpulse 的复用向量（wasm 侧只读，复用安全） */
  private readonly iv = { x: 0, y: 0, z: 0 };

  constructor(world: RAPIER.World, sk: Skeleton, opt: RagdollOptions = {}) {
    this.world = world;
    this.sk = sk;
    this.opt = { ...DEFAULTS, ...opt };
    this.motorTarget = new Float32Array(sk.joints.length * 3);
    this.motorImpulse = new Float64Array(sk.joints.length * 3);

    // ---- 地面（3D 之后侧向也要铺开：人形会在 Z 上翻滚） ----
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(60, 0.5, 12)
        .setTranslation(0, -0.5, 0)
        .setFriction(this.opt.groundFriction)
        .setCollisionGroups(GROUPS_GROUND),
      ground,
    );

    // ---- 刚体 ----
    this.initX = new Float64Array(sk.bodies.length);
    this.initY = new Float64Array(sk.bodies.length);
    this.initZ = new Float64Array(sk.bodies.length);
    sk.bodies.forEach((b: BodyDef, i: number) => {
      this.indexByKey.set(b.key, i);
      this.initX[i] = b.cx;
      this.initY[i] = b.cy;
      this.initZ[i] = b.cz;

      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(b.cx, b.cy, b.cz)
          // ★ 3D：六自由度全开，不再锁任何轴（2D 版这里是 (T,T,F)+(F,F,T)）
          .setLinearDamping(this.opt.linearDamping)
          .setAngularDamping(this.opt.angularDamping)
          .setCanSleep(false),
      );
      this.bodies.push(body);

      for (const c of b.colliders) {
        const cd = c.shape === 'capsule'
          ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
          : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
        // ★ ColliderDesc.setTranslation 是 (x,y,z) 三个数，不是 Vector
        cd.setTranslation(0, c.offsetY, 0)
          // ★ 质量必须逐个 collider 给：不给就按默认密度 1.0 凭空加质量。
          //   已用 body.mass() 读回校验过：偏差 < 1e-6 kg（见 probe-motor A 段）。
          .setMassProperties(
            c.mass,
            { x: 0, y: c.comY, z: 0 },
            { x: c.inertiaXY, y: c.inertiaXY, z: c.inertiaZ },
            IDENTITY,
          )
          .setFriction(this.opt.bodyFriction)
          .setRestitution(0.0)
          .setCollisionGroups(GROUPS_SELF);
        this.world.createCollider(cd, body);
      }
    });

    // ---- 关节 ----
    this.jointBodies = new Int32Array(sk.joints.length * 2);
    this.createJoints();

    // ---- ★ 马达的稳定性上限：算每个关节的等效惯量 ----
    // 症状（probe-reset）：随机基因组下峰|线速度| = 284.7 m/s、峰|角速度| = 1244 rad/s、
    // 峰|关节速度| = 1404 rad/s —— 一个 70 kg 人形跑出音速，是**数值爆炸**，不是"动作大"。
    // 根因：只按 τmax 限制力矩，没限制**加速度**。手臂惯量 ≈ 0.03 kg·m²，
    //       力矩 100 N·m 一个 1/120 s 步就打出 Δω = 100·(1/120)/0.03 ≈ 28 rad/s，
    //       而速度误差本身可能只有 1 rad/s ⇒ 显式积分的比例控制必然振荡发散。
    // 修法：把单位冲量造成的相对角速度变化限制在当前误差的一个比例内。
    //       相对角速度 ω_rel = ω_c − ω_p，加一对 ±imp 后
    //         Δω_rel = imp·(1/I_c + 1/I_p) = imp / Ieff，Ieff = 1/(1/Ic + 1/Ip)
    //       显式 P 控制稳定的充要条件是每步吃掉的比例 α < 2，取 0.35 留足余量。
    this.jointIeff = new Float64Array(sk.joints.length);
    const bodyI = new Float64Array(this.bodies.length);
    for (let i = 0; i < this.bodies.length; i++) {
      const I = this.bodies[i].principalInertia();
      bodyI[i] = Math.max(1e-6, Math.min(I.x, I.y, I.z));
    }
    for (let i = 0; i < sk.joints.length; i++) {
      const ip = bodyI[this.jointBodies[i * 2]];
      const ic = bodyI[this.jointBodies[i * 2 + 1]];
      this.jointIeff[i] = 1 / (1 / ip + 1 / ic);
    }
  }

  /**
   * 建/重建所有关节。
   * 球关节只有两个锚点参数，没有轴、没有限位 —— 限位和马达全在 driveMotors 里。
   */
  private createJoints(): void {
    this.joints.length = 0;
    this.sk.joints.forEach((j: JointDef, i: number) => {
      const pi = this.indexByKey.get(j.parentKey);
      const ci = this.indexByKey.get(j.childKey);
      if (pi === undefined || ci === undefined) {
        throw new Error(`[ragdoll] 关节 ${j.name} 的刚体不存在`);
      }
      this.jointBodies[i * 2] = pi;
      this.jointBodies[i * 2 + 1] = ci;

      const jd = RAPIER.JointData.spherical(
        { x: j.parentLocal[0], y: j.parentLocal[1], z: j.parentLocal[2] },
        { x: j.childLocal[0], y: j.childLocal[1], z: j.childLocal[2] },
      );
      this.joints.push(this.world.createImpulseJoint(jd, this.bodies[pi], this.bodies[ci], true));
    });
  }

  get jointCount(): number { return this.joints.length; }

  // ------------------------------------------------------------ 读状态

  /** 把刚体本地向量 v 转到世界，写入 out */
  private toWorld(b: RAPIER.RigidBody, vx: number, vy: number, vz: number, out: Float64Array): void {
    const q = b.rotation();
    quatRotate(q.x, q.y, q.z, q.w, vx, vy, vz, out);
  }

  /** 刚体"上方向"相对世界竖直的夹角（弧度，0 = 完全直立）。摔倒判定/姿态评分用 */
  tiltOf(body: RAPIER.RigidBody): number {
    this.toWorld(body, 0, 1, 0, this.dirTmp);
    const y = this.dirTmp[1] > 1 ? 1 : this.dirTmp[1] < -1 ? -1 : this.dirTmp[1];
    return Math.acos(y);
  }

  /** 刚体"前方向"在世界 XZ 平面里的方位角（弧度；绕 +Y 转，0 = 正对 +X） */
  headingOf(body: RAPIER.RigidBody): number {
    this.toWorld(body, 1, 0, 0, this.dirTmp);
    return Math.atan2(-this.dirTmp[2], this.dirTmp[0]);
  }

  /**
   * 关节 i 的**三轴关节角**（父体本地的旋转向量，弧度）写入 out[0..2]。
   * |out| ≤ π；分量含义 = 绕父体本地 X/Y/Z 各转了多少。
   * ★ 这是 3D 关节的姿态真源：软限位、网络输入、探针全走它。
   */
  jointRot(i: number, out: Float64Array = this.rv): void {
    const p = this.bodies[this.jointBodies[i * 2]];
    const c = this.bodies[this.jointBodies[i * 2 + 1]];
    const qp = p.rotation();
    const qc = c.rotation();
    calcJointRot(qp.x, qp.y, qp.z, qp.w, qc.x, qc.y, qc.z, qc.w, this.qRel, out);
  }

  /** 关节 i 的**三轴相对角速度**（父体本地，rad/s）写入 out[0..2] */
  jointRelVel(i: number, out: Float64Array = this.relL): void {
    const p = this.bodies[this.jointBodies[i * 2]];
    const c = this.bodies[this.jointBodies[i * 2 + 1]];
    const wp = p.angvel();
    const wc = c.angvel();
    const qp = p.rotation();
    calcJointRelVel(qp.x, qp.y, qp.z, qp.w, wc.x - wp.x, wc.y - wp.y, wc.z - wp.z, out);
  }

  /** 兼容标量读数：关节 i 的屈伸角（绕本地 Z 的分量，弧度） */
  jointAngle(i: number): number {
    const buf = this.rvTmp;
    this.jointRot(i, buf);
    return buf[2];
  }

  /** 兼容标量读数：关节 i 绕本地 Z 的相对角速度（rad/s） */
  jointSpeed(i: number): number {
    const buf = this.rvTmp;
    this.jointRelVel(i, buf);
    return buf[2];
  }

  private readonly rvTmp = new Float64Array(3);

  /**
   * 写马达目标：targets 长度 = 关节数 × 3，每个 ∈ [-1,1]，
   * 乘 JOINT_MAX_SPEED 得到该轴的**目标相对角速度**（父体本地）。
   * 只存不施加 —— 真正的力矩在 driveMotors() 里按物理步施加。
   */
  setMotorTargets(targets: Float32Array): void {
    for (let i = 0; i < this.motorTarget.length; i++) {
      const t = targets[i];
      this.motorTarget[i] = (t < -1 ? -1 : t > 1 ? 1 : t) * JOINT_MAX_SPEED;
    }
  }

  /**
   * ★ 自实现的三轴关节马达：每物理步调用一次，dt = 物理步长。
   * 逐轴：期望力矩 = clamp(增益 × (目标角速度 − 当前相对角速度), ±τmax_axis)，
   * 增益取 τmax/JOINT_MAX_SPEED ⇒ 满误差时正好输出 τmax，物理含义清晰。
   * 然后把"本地轴上的力矩冲量"用父体姿态搬到世界，对父/子各施加一对等大反向的冲量。
   *
   * ★★ 两处必须保留的护栏：
   *   1) 稳定性上限 |imp| ≤ α·|err|·Ieff（见构造里 jointIeff 的注释）——
   *      只限力矩不限加速度的话，轻肢体（前臂 I≈0.03）会被打出每步 28 rad/s 的相对转速，
   *      显式积分的比例控制直接发散（probe-reset 的 284 m/s）。
   *   2) 位置感知软限位 —— 替代 Rapier 的硬限位（球关节压根没有）。
   *      越界时把该轴的目标速度强制指向回程，越界越多回程越快，最多打满 JOINT_MAX_SPEED。
   *      这样马达再怎么被网络驱动都不可能把关节推出限位之外，
   *      也就不存在"推出去 → 限位猛烈纠正 → 甩飞"的爆炸路径
   *      （probe-spike：Rapier 硬限位下 neck 被推到 −162°、限位 [−35°,45°]，
   *        纠正时相对角速度顶到 68.9 rad/s → 头甩飞 → 整条链炸）。
   */
  driveMotors(dt: number): void {
    const scale = this.opt.torqueScale;
    const rest = this.opt.restTension;
    const qRel = this.qRel;
    const rv = this.rv;
    const relL = this.relL;
    for (let i = 0; i < this.joints.length; i++) {
      const j = this.sk.joints[i];
      const pi = this.jointBodies[i * 2];
      const ci = this.jointBodies[i * 2 + 1];
      const p = this.bodies[pi];
      const c = this.bodies[ci];

      // ★ 每一步、每个关节只跨 4 次 wasm 边界把状态取齐，再全部在 JS 里算。
      const qp = p.rotation();
      const qc = c.rotation();
      const wp = p.angvel();
      const wc = c.angvel();
      calcJointRot(qp.x, qp.y, qp.z, qp.w, qc.x, qc.y, qc.z, qc.w, qRel, rv);
      calcJointRelVel(qp.x, qp.y, qp.z, qp.w, wc.x - wp.x, wc.y - wp.y, wc.z - wp.z, relL);
      const Ieff = this.jointIeff[i];

      for (let k = 0; k < 3; k++) {
        // 记账：本步该轴实际施加的马达冲量（0 = 该轴没出力，skip 分支不会漏）
        this.motorImpulse[i * 3 + k] = 0;
        const lo = j.minRad[k];
        const hi = j.maxRad[k];
        const a = rv[k];

        let target = this.motorTarget[i * 3 + k];
        let alpha = MOTOR_ALPHA;

        // ---- 软限位（逐轴）：只在**越界之后**才介入 ----
        // ★★ 不要提前量（这里踩过一次大坑，别改回去）：膝的限位是 [−145°, +2°]，
        //    静止姿态 0° 恰好在 +2° 内侧。若按 (hi − zone) 提前 17° 就介入，等于一开局
        //    就判定膝盖越界、全力把它往后掰 —— 实测躯干从 1.128 m 一路塌到 0.698 m，
        //    整个人形自己跪下去，而且"站桩"直接踩到摔倒阈值。提前量对小范围关节是灾难。
        //    越界量与回程速度的关系仍保留 LIMIT_SOFT_ZONE 的斜坡（越界越多回程越快）。
        const ramp = Math.min(LIMIT_SOFT_ZONE, hi - lo);
        if (a > hi) {
          const rec = -JOINT_MAX_SPEED * Math.min(1, (a - hi) / ramp);
          if (target > rec) target = rec;
          alpha = MOTOR_ALPHA_RECOVER;
        } else if (a < lo) {
          const rec = JOINT_MAX_SPEED * Math.min(1, (lo - a) / ramp);
          if (target < rec) target = rec;
          alpha = MOTOR_ALPHA_RECOVER;
        }

        // ★ 被动姿态张力：往初始姿态拉（见 RagdollOptions.restTension 的长注释）。
        //   放在软限位之后叠加，方向永远和"回程"一致（越界时 a 与 -a·k 同向回中）。
        if (rest > 0) target += -a * rest;

        const err = target - relL[k];
        if (err === 0) continue;

        const tauMax = j.maxTorque[k] * scale;
        let tau = err * (tauMax / JOINT_MAX_SPEED);
        if (tau > tauMax) tau = tauMax;
        else if (tau < -tauMax) tau = -tauMax;
        let imp = tau * dt;

        // ★ 稳定性上限：|imp| ≤ α·|err|·Ieff ⇒ 每步最多吃掉 α 比例的相对角速度误差
        const impStable = alpha * Math.abs(err) * Ieff;
        if (imp > impStable) imp = impStable;
        else if (imp < -impStable) imp = -impStable;
        if (imp === 0) continue;

        // 本地轴 k → 世界轴（父体姿态）
        if (k === AXIS_X) quatRotate(qp.x, qp.y, qp.z, qp.w, 1, 0, 0, this.axisW);
        else if (k === AXIS_Y) quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 1, 0, this.axisW);
        else quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 0, 1, this.axisW);

        // ★ 复用同一个向量对象：wasm 侧只是读 x/y/z 三个数再拷进 raw，
        //   每次 new 一个 {x,y,z} 会让这一层每步多出 50+ 次分配。
        const iv = this.iv;
        iv.x = this.axisW[0] * imp;
        iv.y = this.axisW[1] * imp;
        iv.z = this.axisW[2] * imp;
        this.motorImpulse[i * 3 + k] = imp;   // 记账（+ = 推子体绕本轴正转）
        c.applyTorqueImpulse(iv, true);
        iv.x = -iv.x; iv.y = -iv.y; iv.z = -iv.z;
        p.applyTorqueImpulse(iv, true);
      }
    }
  }

  // ------------------------------------------------------------ 便利读数

  torso(): RAPIER.RigidBody { return this.bodies[this.indexByKey.get('torso') ?? 0]; }
  head(): RAPIER.RigidBody { return this.bodies[this.indexByKey.get('head') ?? 0]; }
  shin(side: 'l' | 'r'): RAPIER.RigidBody {
    return this.bodies[this.indexByKey.get(side === 'l' ? 'shin_l' : 'shin_r') ?? 0];
  }
  bodyByKey(key: string): RAPIER.RigidBody {
    return this.bodies[this.indexByKey.get(key) ?? 0];
  }

  /**
   * 脚掌某点的世界坐标写入 out[0..2]。
   * ★ 3D 之后不能再写 `body.y − length/2`：刚体会转，最低点必须按姿态算。
   *   脚掌 collider 的本地最低点 = (0, offsetY − hy, 0)。
   */
  footPoint(side: 'l' | 'r', out: Float64Array): void {
    const key = side === 'l' ? 'shin_l' : 'shin_r';
    const idx = this.indexByKey.get(key) ?? 0;
    const b = this.bodies[idx];
    const sole = this.sk.bodies[idx].colliders.find((c) => c.shape === 'cuboid');
    const ly = sole ? sole.offsetY - sole.hy : -this.sk.bodies[idx].length / 2;
    const t = b.translation();
    this.toWorld(b, 0, ly, 0, out);
    out[0] += t.x; out[1] += t.y; out[2] += t.z;
  }

  private readonly footTmp = new Float64Array(3);

  /** 脚掌最低点的世界 y（接地代理量，比接触查询便宜） */
  soleY(side: 'l' | 'r'): number {
    this.footPoint(side, this.footTmp);
    return this.footTmp[1];
  }

  // ------------------------------------------------------------ 重置

  /**
   * 回到初始位姿，清零速度（每个个体开跑前调用）。
   * ★ 若 purgeJointCache：连关节一起删掉重建 —— 清掉解算器的暖启动冲量缓存。
   *   不这么做的话，同一份基因组在同一个 Sim 上重放会从第 1 步就分叉（见 RagdollOptions）。
   */
  reset(offsetX = 0): void {
    this.motorTarget.fill(0);

    if (this.opt.purgeJointCache) {
      for (const j of this.joints) this.world.removeImpulseJoint(j, true);
    }

    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      b.setTranslation({ x: this.initX[i] + offsetX, y: this.initY[i], z: this.initZ[i] }, true);
      b.setRotation(IDENTITY, true);
      b.setLinvel(ZERO, true);
      b.setAngvel(ZERO, true);
    }

    if (this.opt.purgeJointCache) this.createJoints();
  }
}
