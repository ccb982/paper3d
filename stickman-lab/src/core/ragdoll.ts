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
import { JOINT_MAX_SPEED, restQuatOf, type BodyDef, type JointDef, type Skeleton } from './skeleton';

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
 * ★★ 马达每物理步最多吃掉多少比例的"相对角速度误差"。默认 **1.0**（= 一步收敛）。
 *
 * ★ 这个数原来是 0.35，是**按角速度目标控制器**定的：那时 `err = ω_des − ω_rel`，
 *   轻肢体（前臂 I≈0.03）在 τmax=40 N·m 下一个 1/120 s 步就能被打出 Δω = 28 rad/s，
 *   而误差本身可能只有 1 rad/s ⇒ 显式积分必然振荡发散，所以要压到 1/3 的余量。
 *
 * ★★ 换成位置环之后 0.35 就成了**性能杀手**（probe-posture [B2] 实测）：
 *   护栏给出的有效力矩上限是 τ_eff = α·|err|·Ieff/dt，而 err = kP·Δθ + kD·ω —— 于是
 *
 *       有效关节刚度 = kP · min( τmax/9 , α·Ieff/dt )
 *                      └ 设计值 ┘   └ 护栏值 ┘
 *
 *   髋外展：设计值 13.3，护栏值 0.35×0.083×120 = **3.49** ⇒ 只用了 26% 的力气。
 *   实测"实际力矩 / 想要力矩" = **22%**（全 36 轴求和），零输出下髋/脊柱被重力压开，
 *   83~96° 直接劈叉塌下去 —— 这就是"站不住"的**真根因**（不是控制策略的锅）。
 *
 * ★ 为什么 1.0 是**有依据的**、而不是"把安全阀拧松"：
 *   本护栏的语义是"每步最多把相对角速度误差吃掉多少"。α = 1 恰好是**一步收敛**——
 *   一步之后相对角速度误差归零，且**不过冲**；α < 1 是欠阻尼意义上的保守，
 *   α = 2 才是显式 P 控制的振荡边界。所以 1.0 是"最快且不过冲"的那一档。
 *   ★ 实践上也不会失控：kP 提高后 τ 会先被 **τmax** 夹住（例如膝 Δθ=2.28 rad 时
 *     err=109、护栏允许 5.1 N·m·s，但 τmax 只给 1.25 N·m·s）⇒ 真正生效的是物理力矩上限。
 *   ★ 而且实测峰|线速度|随 α 提高**下降**（3.4 → 0.1 m/s）：关节越硬，人偶越不抖。
 */
const MOTOR_ALPHA = 1.0;

/** 越界回程时用的 α。★ 它必须 ≥ MOTOR_ALPHA，否则"保命回程"反而比正常控制更软 */
const MOTOR_ALPHA_RECOVER = 1.0;

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
   * ★★ 位置环比例增益 kP（单位 1/s）。默认 9.0。
   *
   * 网络输出的是**目标关节角** θ_ref（不是目标角速度了！见 setMotorTargets），
   * 马达把它变成一个**等效目标角速度**：
   *
   *     err = kP·(θ_ref − θ) − kD·ω_rel          // 单位 rad/s
   *     τ   = clamp(err · τmax / JOINT_MAX_SPEED, ±τmax)
   *
   * 为什么必须是位置目标（这一条是本项目"学不出走路"的**头号结构性原因**）：
   *   网络输出的目标是**角速度**时，"零输出"= 纯阻尼控制 —— 它能抵抗关节**运动**，
   *   但**不抵抗静态力矩**：重力压着膝盖，只要膝盖不转，阻尼项就输出 0 力矩，
   *   膝盖便一路弯到限位。实测零输出的刚体人偶躯干从 1.129 m 被慢慢压到 0.693 m（蹲姿），
   *   直接踩到摔倒阈值 ⇒ ES 一代里个体几乎全是"摔倒"，适应度梯度全花在"别倒"上。
   *
   *   ★ 而且**速度目标对静载荷天生不匹配**：`target = 0` 不是"松手"，是"把角速度刹到 0"
   *     （`err = −ω_rel ≠ 0`）⇒ 关节一直在**制动**（实测零出力轴仅 0.00%），
   *     但那是"关节空间的制动"，**不是"重心空间的平衡控制"** —— 把全身刹住 = 让身体僵住，
   *     而僵住的倒立摆一点恢复能力都没有（它不改变 CoP）。见 probe-push。
   *
   * ★ 参数取值：**kP = 48**（原为 9）。零输出时 `err = −kP·θ − kD·ω_rel`，形式与历史
   *   `target = −k·θ; err = target − ω_rel` 逐项一致 ⇒ 仍是严格泛化，只是**刚度换挡了**。
   *   ★★ 为什么从 9 提到 48（probe-posture [B2] 的实测，别再改回去）：
   *     k=9 是按"静息接触力 ≈ 体重"这一条标定的（6→88%，9→105%，12→106% 饱和），
   *     **而那条判据根本管不到"抗屈曲"**。绑定姿态的 CoM 投影本来就在支撑多边形内
   *     （A9 已验证）⇒ 关节足够硬时它是一个静定的刚体站姿，应该**永远站着**；
   *     实测 k=9 只能站 1.28 s（髋被压开 83~96°、直接劈叉塌下去）。
   *     6 s 回合的扫描（α=1.0）：
   *       kP  9 → 1.40 s   ξz峰 1.88   域内 69%
   *       kP 24 → 1.73 s   ξz峰 3.33   域内 70%
   *       kP 48 → **6.00 s 跑满** ξz峰 0.27  域内 93%   ← 取这一档
   *       kP 90 → **6.00 s 跑满** ξz峰 0.20  域内 100%
   *     ⇒ 抗屈曲需要 kP ≥ ~48；再往上收益递减（且会把人偶变成纯位置伺服的木偶，
   *       丢掉"关节柔性"这个对战斗姿态有用的自由度），所以取 48 而不是 90。
   *     ★ 静力接触力不受影响：那条曲线在 k≥12 就饱和在 ~106% 体重。
   */
  kP?: number;
  /**
   * 位置环微分增益 kD（无量纲）。默认 1.0 —— 与历史行为逐项一致。
   * 物理含义：`err = kP·e − kD·ω`，kD 越大越"粘"。
   * ★ 不要设 0：手臂惯量 ≈ 0.03 kg·m²，纯 P 会让轻肢在 τmax 下每步打出几十 rad/s 的
   *   相对转速，显式积分的比例控制直接振荡发散（probe-reset 里那个 284 m/s）。
   *   稳定性真正的护栏是下面 `α·|err|·Ieff` 那条，kD 只是把环路阻尼调舒服。
   */
  kD?: number;
  /**
   * ★★ 逐关节的增益覆盖（默认没有 ⇒ 全部用上面的全局 kP/kD）。
   *
   * 为什么必须有（用户 2026-10-02 要求重调踝）：踝和膝的**负载惯量差一个量级**
   * —— 膝要扛整条腿和大半个躯干（Ieff 大），踝只带一只脚掌（Ieff 小）。
   * 用同一组 kP=48/kD=1 会让踝像一根**极硬的弹簧**：一给角度就抽。
   * 实测（tools/probe-ankle.ts）：踝关掉能站 8 s，一开就 0.5 s 内塌 41 cm。
   */
  jointGain?: Record<string, { kP: number; kD: number }>;
  /**
   * ★ 网络命令的**角度量程比例**（默认 0.9）。
   *
   * `out[k] ∈ [−1, +1]` 线性映射到关节该轴自己的机械量程：
   *
   *     θ_ref = out · (out ≥ 0 ? posRefScale·hi : posRefScale·(−lo))
   *
   * ★ 为什么是**非对称**斜率（正负两侧各按自己的量程走）：
   *   关节量程本来就非对称，典型如膝屈伸 `[−145°, +2°]` —— 膝只能屈不能伸。
   *   对称映射会让 out = 0 对应的 θ_ref ≠ 0，那就**丢掉了"零输出 = 回到绑定姿态"**
   *   这个性质，也就丢掉了与历史行为的可比性。非对称斜率同时保住了两件事：
   *     ① out = 0 ⇒ θ_ref = 0 ⇒ 与旧行为逐项一致；
   *     ② |out| = 1 ⇒ 能顶到量程的 90%（剩下 10% 留给软限位的斜坡）。
   *
   * ★ 权限够不够（解析）：髋 θ_ref 到 −0.9×80° = −1.26 rad、膝到 −2.28 rad 时
   *   `err = kP·|e| ≈ 48×2.28 = 109 rad/s`，远超 JOINT_MAX_SPEED = 9
   *   ⇒ τ 被 clamp 到 τmax ⇒ **满力矩**。旧的"速度目标"模型峰值也是 τmax，
   *   区别是：旧模型必须靠**持续的角速度误差**才能维持这个力矩，站着不动就没了。
   */
  posRefScale?: number;
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
  /**
   * ★★ 稳定性护栏的 α（每步最多吃掉多少比例的相对角速度误差）。默认 1.0。
   *
   * `|imp| ≤ α·|err|·Ieff` 里的 α 直接决定**有效力矩上限**（见 motorDemand 注释）：
   *     τ_max_eff = α · kP · Δθ · Ieff / dt
   * 显式 P 控制的稳定条件是 α < 2，α = 1 表示"一步到位"（无过冲），取 1.0 是**有依据的**取值
   * —— 不是把安全阀拧松。0.35 是当年给"角速度目标控制器"定的，换位置环后它把髋的
   * 力矩压到 26%、把脊柱压到 10%，是"站不住"的真根因。详见 MOTOR_ALPHA 的长注释。
   *
   * ★ 它必须是一个**可探测的旋钮**而不是常量：probe-posture 的 [B2] 用它做扫描，
   *   回答"撑不住是因为没力气，还是因为不敢用力"。
   * ★ 越界回程用 MOTOR_ALPHA_RECOVER（同为 1.0）—— 回程是保命动作，不受这个旋钮影响。
   */
  motorAlpha?: number;
}

const DEFAULTS: Required<RagdollOptions> = {
  groundFriction: 1.0,
  bodyFriction: 0.9,
  linearDamping: 0.0,
  angularDamping: 0.04,
  torqueScale: 1.0,
  kP: 48.0,
  kD: 1.0,
  // 逐关节增益：默认空（全部用上面的全局值）
  jointGain: {} as Record<string, { kP: number; kD: number }>,
  posRefScale: 0.9,
  purgeJointCache: true,
  motorAlpha: MOTOR_ALPHA,
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
/** 四元数乘法 a ⊗ b */
function quatMul(
  ax: number, ay: number, az: number, aw: number,
  bx: number, by: number, bz: number, bw: number,
  out: Float64Array,
): void {
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

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
  /** [左, 右] 鞋底 collider（腾空时间/单脚支撑的真实接触判据） */
  readonly soleCol: [RAPIER.Collider | null, RAPIER.Collider | null] = [null, null];
  /** ★ 每次 reset 都会整体重建（见 purgeJointCache），所以别缓存元素引用 */
  readonly joints: RAPIER.ImpulseJoint[] = [];
  /** key → 刚体下标 */
  readonly indexByKey = new Map<string, number>();
  /**
   * ★ 身体参考点的刚体 key = 脊柱最上一段（胸腔）。K=1 时就是 'torso'。
   * 见 torso() 的注释 —— 分段之后"树根"是骨盆，但状态量要以胸腔为基准。
   */
  readonly torsoKey: string;
  /** 关节 i → [父刚体下标, 子刚体下标] */
  readonly jointBodies: Int32Array;
  /**
   * 关节 i 的等效惯量（单位冲量造成的相对角速度变化 = 1/Ieff），构造时算一次。
   * ★ 3D 版取两个刚体**三个主惯量的最小值**再合成 —— 偏保守。
   *   （绕某轴转的惯量 ≥ 主惯量最小值，用最小值 ⇒ 允许的冲量偏小 ⇒ 不会引入不稳定。）
   */
  readonly jointIeff: Float64Array;
  /**
   * 关节目标**角**命令（无量纲，∈ [−1, 1]，长度 = 关节数 × 3）。
   * ★ 语义已从"目标角速度系数"改成"目标角系数"（见 RagdollOptions.posRefScale）：
   *   由 setMotorTargets 写入，driveMotors 里映射成 θ_ref = cmd × 该侧量程 × posRefScale。
   * 只存不施加 —— 真正的力矩在 driveMotors() 里按物理步施加。
   */
  readonly motorTarget: Float32Array;
  /**
   * 每个可驱动轴的 θ_ref 斜率：cmd > 0 时用 refPos，cmd < 0 时用 refNeg。
   * 两者都取正数 —— 因为 hi 可能很小（膝 +2°）、lo 很负（膝 −145°），
   * 必须各按自己的量程走，才能同时保住 `cmd = 0 ⇒ θ_ref = 0`。见 posRefScale。
   */
  private readonly refPos: Float64Array;
  private readonly refNeg: Float64Array;
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
  /**
   * ★★ 本步**想要**施加的力矩（N·m）—— 即被 `α·|err|·Ieff` 稳定性上限削掉**之前**的值。
   *
   * 为什么必须和 motorImpulse 成对存在（这是"关节明明有力却撑不住"的头号嫌疑的判据）：
   *   本文件的稳定性护栏 `|imp| ≤ α·|err|·Ieff` 是**正比于误差**的 ⇒ 它给出的有效力矩上限是
   *
   *       τ_max_eff = α · kP · Δθ · Ieff / dt
   *
   *   对髋外展轴（Ieff ≈ 0.083）在 α=0.35 时只有 ~31 N·m/rad ⇒ 就算关节差 45°（0.785 rad），
   *   也只出得了 ~25 N·m，而髋的**声明**力矩是 120 N·m（外展）—— **只用了 20%**。
   *   （α 提到 1.0 之后这个比例回到 ~75%，见 MOTOR_ALPHA 的长注释。）
   *   只看 motorImpulse 是看不出这件事的（它已经是被削过的值，看起来"很合理"）；
   *   必须和 motorDemand 相除才能回答"是没力气，还是不敢用力"。
   */
  readonly motorDemand: Float64Array;

  private readonly world: RAPIER.World;
  private readonly initX: Float64Array;
  private readonly initY: Float64Array;
  private readonly initZ: Float64Array;
  /** 各刚体的静姿态四元数（reset 用 + 关节角的参考系） */
  private readonly restQ: { x: number; y: number; z: number; w: number }[];

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

    // ★★ 静默失效护栏：`tools/*.ts` **不参与 tsc**（没有 @types/node，tsconfig 只 include src），
    //   所以探针里写错选项名（比如把 kP 写成已删除的 restTension）**不会有任何编译错误**，
    //   而且 `{...DEFAULTS, ...opt}` 会把那个键原样抄进来、悄悄忽略 —— 探针就会拿着
    //   默认参数跑出"对照组与实验组一模一样"的假结论（这个坑真的踩过）。
    //   ⇒ 构造时点名未知键。
    for (const key of Object.keys(opt)) {
      if (!(key in DEFAULTS)) {
        console.warn(`[ragdoll] ⚠ 未知配置项 "${key}" 被忽略（是不是改名了？见 RagdollOptions）`);
      }
    }

    this.motorTarget = new Float32Array(sk.joints.length * 3);
    this.motorImpulse = new Float64Array(sk.joints.length * 3);
    this.motorDemand = new Float64Array(sk.joints.length * 3);

    // ★ 身体参考点：脊柱最上一段（spineN）；没有分段就是 'torso'
    let topSpine = -1;
    for (const b of sk.bodies) {
      const m = /^spine(\d+)$/.exec(b.key);
      if (m) topSpine = Math.max(topSpine, Number(m[1]));
    }
    this.torsoKey = topSpine > 0 ? `spine${topSpine}` : 'torso';

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
    this.restQ = sk.bodies.map((b) => {
      // 静姿态 = Ry(膝盖以下内收偏航) ⊗ Rx(实测中轴倾角)，与 skeleton.ts 同一公式
      const [x, y, z, w] = restQuatOf(b.restTiltRad, b.restYawRad);
      return { x, y, z, w };
    });
    sk.bodies.forEach((b: BodyDef, i: number) => {
      this.indexByKey.set(b.key, i);
      this.initX[i] = b.cx;
      this.initY[i] = b.cy;
      this.initZ[i] = b.cz;

      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(b.cx, b.cy, b.cz)
          // ★ 静倾角：肢体贴图本身是斜的（上臂 7°、前臂+手 31°、大腿 8°、小腿 9°），
          //   所以刚体初始朝向 = 绕 X 转 restTiltRad，让局部 +Y 沿实测中轴躺平。
          //   这样 reset 后的姿态就是素材画的那张姿势，斜肢体不会被画成正的。
          .setRotation(this.restQ[i])
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
        // ★ offsetZ：脚掌盒要按纹理实测的靴心侧偏摆（否则盒心挂在小腿中轴上，靴子对不上）
        cd.setTranslation(0, c.offsetY, c.offsetZ)
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
        const col = this.world.createCollider(cd, body);
        // ★ 记住鞋底 collider：腾空时间/单脚支撑要用**真实接触**判定
        //   （几何判据有 3cm 死区，实测脚能抬 9cm 却被判成一直着地）。
        if (c.shape === 'cuboid') {
          if (b.key === 'shin_l' || b.key === 'foot_l') this.soleCol[0] = col;
          else if (b.key === 'shin_r' || b.key === 'foot_r') this.soleCol[1] = col;
        }
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

    // ---- ★ 位置命令的 θ_ref 斜率（每轴一份，构造时算一次）----
    this.refPos = new Float64Array(sk.joints.length * 3);
    this.refNeg = new Float64Array(sk.joints.length * 3);
    for (let i = 0; i < sk.joints.length; i++) {
      for (let k = 0; k < 3; k++) {
        const s = this.opt.posRefScale;
        this.refPos[i * 3 + k] = s * Math.max(0, sk.joints[i].maxRad[k]);
        this.refNeg[i * 3 + k] = s * Math.max(0, -sk.joints[i].minRad[k]);
      }
    }
  }

  /**
   * 建/重建所有关节。
   * 球关节只有两个锚点参数，没有轴、没有限位 —— 限位和马达全在 driveMotors 里。
   */
  private createJoints(): void {
    this.joints.length = 0;
    // 预先记下左右髋在 joints 里的下标（hipPoint 每帧都要用，别每帧 findIndex）
    this.hipIdx = [
      this.sk.joints.findIndex((j) => j.name === 'hip_l'),
      this.sk.joints.findIndex((j) => j.name === 'hip_r'),
    ];
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
  /**
   * ★ 脚是否着地（**Rapier 真实接触对**，不是几何判据）。
   *   判据：存在接触流形、且法向的竖直分量 |n·y| > 0.5（只认"从上方压下来"的接触）。
   *   自碰撞是关的（GROUPS_SELF 只和地面碰），所以任何接触对就是对地接触。
   *   为什么不用几何：几何判据（鞋底 4 角最低点 ≤ 3cm）有死区，实测脚抬到 9cm
   *   仍被判成着地 ⇒ `lift` 项恒为 0。
   */
  footGrounded(side: 0 | 1): boolean {
    const col = this.soleCol[side];
    if (!col) return false;
    let hit = false;
    this.world.contactPairsWith(col as RAPIER.Collider, (other: RAPIER.Collider) => {
      this.world.contactPair(col as RAPIER.Collider, other, (mf: RAPIER.TempContactManifold) => {
        if (mf.numContacts() === 0) return;
        const ny = mf.normal().y;
        if (ny > 0.5 || ny < -0.5) hit = true;
      });
    });
    return hit;
  }

  /**
   * ★★ 每只脚的**竖向载荷份额**（`[左, 右]`，和为 1；两只都没受力时给 [0.5, 0.5]）。
   *
   * ★ 为什么用"载荷"而不是"几何接触"来做重心转移/换支撑脚的判据：
   *   ① 几何接触（`contactDist`）要 0.5 cm 以内才算出，抬 1~2 cm 的小步根本测不到；
   *   ② Rapier 窄相还保留**预测性接触**（形状没碰但进了预测距离），实测脚离地 9 cm
   *      仍会报接触（这是踩过的坑，见 footGrounded 的注释）。
   *   而"这只脚承担了 70% 的体重"**才是支撑腿的定义**，也是 Raibert/捕获点那套
   *   真正在控的量（把重心挪到支撑脚上）。
   *
   * 取法与 `tools/probe-coact` 一致：Σ|n_y·冲量| / dt，取绝对值 ⇒ 与法向符号约定无关。
   */
  footLoadFrac(dt: number): [number, number] {
    const one = (side: 0 | 1): number => {
      const col = this.soleCol[side];
      if (!col) return 0;
      let f = 0;
      this.world.contactPairsWith(col as RAPIER.Collider, (other: RAPIER.Collider) => {
        this.world.contactPair(col as RAPIER.Collider, other, (mf: RAPIER.TempContactManifold) => {
          if (mf.numContacts() === 0) return;
          // ★ 不要按法向过滤：自碰撞是关的（GROUPS_SELF 只和地面碰），
          //   鞋底上的接触对**只可能**是地面，加上 |n_y|>0.5 的过滤反而把
          //   全部接触滤掉（实测载荷恒为 0 ⇒ 份额永远是 0.5/0.5）。
          for (let k = 0; k < mf.numContacts(); k++) f += Math.abs(mf.contactImpulse(k)) / dt;
        });
      });
      return f;
    };
    const fl = one(0), fr = one(1);
    const sum = fl + fr;
    return sum > 1e-6 ? [fl / sum, fr / sum] : [0.5, 0.5];
  }

  /**
   * ★★ 交替支撑脚（"一次抬一条"）的**事件**判据，返回 true 表示"这一拍发生了换脚"。
   *
   * ★★ 为什么要做成**事件**而不是"当前是否单脚支撑"（用户 2026-10-01：
   *   "抬一次脚就摔倒了，什么也学不到"）：
   *   实测几何上**长时间单脚支撑是不可能的** —— 两脚在 z=±0.164 m，CoM 在 z≈0.007，
   *   抬掉一只脚后 CoM 离另一只脚 0.171 m，而单脚（含外八 25° 投影）只有 0.139 m
   *   侧向半宽 ⇒ **差 1.23×**。站距收到 0.181 m 才有 1.43×，但那会让脚骨比画出来的靴子
   *   内缩 7 cm（用户早就投诉过"脚部和纹理不太匹配"），而且真正的解法是踝关节内外翻
   *   —— 也就是 `ankleEnabled`（代码就绪、默认关，见架构设计 §12.6）。
   *   但**短暂的交替是可行的**（顶翻的时间常数 ~1/ω ≈ 0.2 s，0.1 s 的抬脚不会倒，
   *   种子步态 1.25 m 就是这么走的）⇒ "一次抬一条"应该按**换支撑脚的事件**计分。
   *
   * @param stanceNow 0=双脚离地 1=左脚支撑 2=右脚支撑
   */
  private lastStance: 0 | 1 | 2 = 0;
  private stanceAge = 0;
  altEvent(stanceNow: 0 | 1 | 2, dt: number): boolean {
    this.stanceAge += dt;
    const prev = this.lastStance;
    this.lastStance = stanceNow;
    // ① 必须"换到另一只脚"（1↔2），且 ② 上一个支撑状态不是双脚离地（否则跳一下也算），
    //   ③ 不应期 0.15 s（否则高频抖动会被数成很多次）
    const switched = (prev === 1 && stanceNow === 2) || (prev === 2 && stanceNow === 1);
    if (switched && this.stanceAge > 0.15) return true;
    if (stanceNow === 0) this.stanceAge = 0;   // 离地时重新计时
    return false;
  }

  resetAlt(): void { this.lastStance = 0; this.stanceAge = 0; }

  /**
   * ★★ 摔倒（crash）判据：**任何非脚部刚体碰到地面**。
   *   这是 Rudin 2022 的原话做法（"contacts with the base are considered crashes
   *   and lead to resets"）。之前只用"躯干高度/倾角"判摔，于是**往前塌**不算摔：
   *   实测零输出基因组 0.5 s 内塌 41 cm、躯干高度还有 70%、倾角几乎不变 ⇒
   *   回合不结束，它一路滑出 0.65~1.25 m 还能拿速度跟踪分。
   */
  bodyHitGround(): boolean {
    for (let i = 0; i < this.bodies.length; i++) {
      const bd = this.sk.bodies[i];
      if (bd.key === 'shin_l' || bd.key === 'shin_r' || bd.key === 'foot_l' || bd.key === 'foot_r') continue;
      const b = this.bodies[i];
      for (let ci = 0; ci < b.numColliders(); ci++) {
        const col = b.collider(ci);
        let hit = false;
        this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
          this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
            if (mf.numContacts() === 0) return;
            const ny = mf.normal().y;
            if (ny > 0.5 || ny < -0.5) hit = true;
          });
        });
        if (hit) return true;
      }
    }
    return false;
  }

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
    const pi = this.jointBodies[i * 2];
    const ci = this.jointBodies[i * 2 + 1];
    const qp = this.bodies[pi].rotation();
    const qc = this.bodies[ci].rotation();
    calcJointRot(qp.x, qp.y, qp.z, qp.w, qc.x, qc.y, qc.z, qc.w, this.qRel, out);
    // ★ 减去静姿态读数（restRad）⇒ 关节零位 = **素材画的那张姿势**。
    //   不减的话每条肢体的静倾角会变成关节角的常量偏置（上臂 5°/前臂 35° ⇒ 肘 ±30°），
    //   左右偏置符号相反而肘/膝限位不对称 ⇒ 马达把一条胳膊往里掰、另一条往外掰
    //   （用户回读："初始状态下两个手臂就一个往外一个往内折了"）。
    const rr = this.sk.joints[i].restRad;
    out[0] -= rr[0]; out[1] -= rr[1]; out[2] -= rr[2];
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
   * 写马达命令：targets 长度 = 关节数 × 3，每个 ∈ [-1,1]，**表示该轴的目标关节角**
   * （占该侧机械量程的比例的 posRefScale 倍，见 RagdollOptions.posRefScale）。
   *
   * ★ 语义已从"目标角速度"改成"目标角" —— 这是本项目的头号结构性修正：
   *   速度目标没有静态刚度（静载荷下必然蠕变），而且不可被网络用来"维持一个姿态"。
   *   见 RagdollOptions.kP 的长注释。
   *
   * 只存不施加 —— 真正的力矩在 driveMotors() 里按物理步施加。
   */
  setMotorTargets(targets: Float32Array): void {
    for (let i = 0; i < this.motorTarget.length; i++) {
      const t = targets[i];
      this.motorTarget[i] = t < -1 ? -1 : t > 1 ? 1 : t;
    }
  }

  /**
   * ★ 自实现的**位置环 PD** 关节马达：每物理步调用一次，dt = 物理步长。
   *
   *     θ_ref  = cmd ×（cmd ≥ 0 ? posRefScale·hi : posRefScale·(−lo)）   // 网络给的目标角
   *     err    = kP·(θ_ref − θ) − kD·ω_rel                              // 等效目标角速度
   *     τ      = clamp(err · τmax / JOINT_MAX_SPEED, ±τmax)
   *
   * 增益取 τmax/JOINT_MAX_SPEED ⇒ **err 跑满 JOINT_MAX_SPEED 时正好输出 τmax**，物理含义清晰。
   * 然后把"本地轴上的力矩冲量"用父体姿态搬到世界，对父/子各施加一对等大反向的冲量。
   *
   * ★★ 为什么是位置环而不是"角速度目标"（这是本项目最重的一处结构性修正）：
   *   速度目标下，`cmd = 0` 的含义是"把角速度刹到 0"（`err = −ω_rel ≠ 0`）⇒ 关节一直在**制动**，
   *   但它**没有静态刚度**：重力压着膝盖，只要膝盖不转，误差就恰好等于 0、力矩也就没了。
   *   ⇒ 静载荷下必然**蠕变**（实测没位置项时躯干 1 s 内从 0.888 掉到 0.149 m）。
   *   位置环天然有静态刚度：θ ≠ θ_ref 就一直有力，这才是"站着不动"能成立的前提。
   *   ★ 且 `θ_ref = 0` 时 `err = −kP·θ − kD·ω_rel`，与历史公式 `target = −k·θ; err = target − ω_rel`
   *     **逐项一致** ⇒ 这是严格泛化，零输出的行为一字没变，但网络拿到了位置通道。
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
   *      ★ 它只在**越界之后**介入，越界时直接接管该轴的目标速度（不再走位置环）
   *        —— 回程是"保命动作"，不该被网络的位置命令拖住。
   */
  driveMotors(dt: number): void {
    const scale = this.opt.torqueScale;
    const kP = this.opt.kP;
    const kD = this.opt.kD;
    const qRel = this.qRel;
    const rv = this.rv;
    const relL = this.relL;
    const jg = this.opt.jointGain ?? {};
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
      // ★ 关节零位 = 静姿态（素材姿势），见 jointRot 的注释
      const rr = j.restRad;
      rv[0] -= rr[0]; rv[1] -= rr[1]; rv[2] -= rr[2];
      calcJointRelVel(qp.x, qp.y, qp.z, qp.w, wc.x - wp.x, wc.y - wp.y, wc.z - wp.z, relL);
      const Ieff = this.jointIeff[i];

      for (let k = 0; k < 3; k++) {
        // 记账：本步该轴实际施加 / 想要施加的马达冲量（0 = 该轴没出力，skip 分支不会漏）
        this.motorImpulse[i * 3 + k] = 0;
        this.motorDemand[i * 3 + k] = 0;
        const lo = j.minRad[k];
        const hi = j.maxRad[k];
        const a = rv[k];
        const idx = i * 3 + k;

        let alpha = this.opt.motorAlpha;
        let err: number;

        // ---- 软限位（逐轴）：只在**越界之后**才介入，直接接管目标速度 ----
        // ★★ 不要提前量（这里踩过一次大坑，别改回去）：膝的限位是 [−145°, +2°]，
        //    静止姿态 0° 恰好在 +2° 内侧。若按 (hi − zone) 提前 17° 就介入，等于一开局
        //    就判定膝盖越界、全力把它往后掰 —— 实测躯干从 1.128 m 一路塌到 0.698 m，
        //    整个人形自己跪下去，而且"站桩"直接踩到摔倒阈值。提前量对小范围关节是灾难。
        //    越界量与回程速度的关系仍保留 LIMIT_SOFT_ZONE 的斜坡（越界越多回程越快）。
        const ramp = Math.min(LIMIT_SOFT_ZONE, hi - lo);
        if (a > hi) {
          err = -JOINT_MAX_SPEED * Math.min(1, (a - hi) / ramp) - relL[k];
          alpha = MOTOR_ALPHA_RECOVER;
        } else if (a < lo) {
          err = JOINT_MAX_SPEED * Math.min(1, (lo - a) / ramp) - relL[k];
          alpha = MOTOR_ALPHA_RECOVER;
        } else {
          // ---- 位置环 PD：θ_ref 由网络命令映射到该侧机械量程 ----
          const cmd = this.motorTarget[idx];
          const thRef = cmd >= 0 ? cmd * this.refPos[idx] : cmd * this.refNeg[idx];
          // ★ 逐关节增益覆盖（踝专用，见 RagdollOptions.jointGain 的注释）
          const ov = jg[j.name];
          err = (ov ? ov.kP : kP) * (thRef - a) - (ov ? ov.kD : kD) * relL[k];
        }

        if (err === 0) continue;

        const tauMax = j.maxTorque[k] * scale;
        let tau = err * (tauMax / JOINT_MAX_SPEED);
        if (tau > tauMax) tau = tauMax;
        else if (tau < -tauMax) tau = -tauMax;
        this.motorDemand[idx] = tau;   // ★ 削之前的"想要值"，供诊断
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
        this.motorImpulse[idx] = imp;   // 记账（+ = 推子体绕本轴正转）
        c.applyTorqueImpulse(iv, true);
        iv.x = -iv.x; iv.y = -iv.y; iv.z = -iv.z;
        p.applyTorqueImpulse(iv, true);
      }
    }
  }

  /** 诊断用：读出某轴当前的 θ_ref（弧度）。探针要核对"命令 → 目标角"的映射是否对 */
  refAngleOf(joint: number, axis: number): number {
    const idx = joint * 3 + axis;
    const cmd = this.motorTarget[idx];
    return cmd >= 0 ? cmd * this.refPos[idx] : cmd * this.refNeg[idx];
  }

  // ------------------------------------------------------------ 便利读数

  /**
   * ★ 身体参考点 = **上躯干（胸腔）**，不是树根。
   *
   * 为什么：脊柱分段后（见 SkeletonConfig.spineSegments）树根变成了骨盆，
   * 而"站得直不直 / 现在多高 / 朝哪转"这些量真正的载体是**上躯干**：
   *   · 平衡反馈用的角速度：胸的角速度才是"我在倒"的信号（骨盆更迟钝）
   *   · 直立惩罚 ∫(cos tilt − 1)：必须量胸的倾角，否则弯腰驼背不扣分
   *   · 摔倒判定的高度：骨盆会深蹲（0.83 → 0.5 是正常下蹲），胸塌到地面才是摔
   * 分段前（K=1）它本身就是 'torso'，行为与历史完全一致。
   */
  torso(): RAPIER.RigidBody { return this.bodies[this.indexByKey.get(this.torsoKey) ?? 0]; }
  /** 树根 = 骨盆（脊柱最下一段，key 恒为 'torso'）。行走位移的基准点 */
  root(): RAPIER.RigidBody { return this.bodies[this.indexByKey.get('torso') ?? 0]; }
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
    // ★★ 踝开启时脚掌是**独立刚体**（`foot_l`/`foot_r`），必须量它，不能量小腿。
    //   之前这里无条件用 `shin_l/shin_r` 的 cuboid 当"鞋底"，于是踝一开：
    //   ① `soleY()` 量到的是**被缩短的小腿**底部（实测离地 +0.0536 m，纯属量错）；
    //   ② 观测里的脚 x/z、离地高度门、步长计算**全部在读小腿** ⇒ 奖励也跟着错。
    const footKey = side === 'l' ? 'foot_l' : 'foot_r';
    const useFoot = this.indexByKey.has(footKey);
    const key = useFoot ? footKey : (side === 'l' ? 'shin_l' : 'shin_r');
    const idx = this.indexByKey.get(key) ?? 0;
    const b = this.bodies[idx];
    const sole = this.sk.bodies[idx].colliders.find((c) => c.shape === 'cuboid');
    const ly = sole ? sole.offsetY - sole.hy : -this.sk.bodies[idx].length / 2;
    const t = b.translation();
    this.toWorld(b, 0, ly, 0, out);
    out[0] += t.x; out[1] += t.y; out[2] += t.z;
  }

  /**
   * ★ 髋关节锚点的世界位置（IK 的固定端）。
   *   为什么必须有：teacher 的动作是二连杆 IK，函数的自变量就是"髋→脚"这个向量
   *   （dx, dy, d）。网络之前**看不见自己的腿长** ⇒ 得用 tanh 去硬拟合 acos/atan2，
   *   行为克隆的 MSE 卡在 0.17 上下、克隆出来的网络不会走（实测位移 −0.832 m、0 步）。
   *   把 dx/dy/d 直接喂进去之后，IK 退化成"d 的一维平滑函数"，浅层网就能拟合。
   */
  hipPoint(side: 'l' | 'r', out: Float64Array): void {
    const i = this.hipIdx[side === 'l' ? 0 : 1];
    const j = this.sk.joints[i]!;
    const b = this.bodies[this.indexByKey.get(j.parentKey) ?? 0];
    const t = b.translation();
    this.toWorld(b, j.parentLocal[0], j.parentLocal[1], j.parentLocal[2], out);
    out[0] += t.x; out[1] += t.y; out[2] += t.z;
  }

  private hipIdx: [number, number] = [-1, -1];
  private readonly footTmp = new Float64Array(3);

  /** 脚掌最低点的世界 y（接地代理量，比接触查询便宜） */
  soleY(side: 'l' | 'r'): number {
    this.footPoint(side, this.footTmp);
    return this.footTmp[1];
  }

  /**
   * ★ 脚掌最低点的世界 **x / z**（观测用）。
   *   为什么必须有：策略要"把支撑脚撑在某个世界位置上"，就必须**看得见脚在哪**。
   *   之前观测里只有脚底**高度**和捕获点 ξ，没有脚的 x/z ⇒ 线性策略没法表达
   *   "脚往捕获点落"这条 Raibert 规则，只能两条腿一起蹦（实测脚最高 0.10 m、
   *   换脚数 0 —— 那是**跳**不是**步**）。加上 x/z 之后，落脚规则可以写成线性的：
   *   `hip = k·(ξ_x − sole_x)`。
   */
  soleXZ(side: 'l' | 'r', out: Float64Array = this.footTmp): number {
    this.footPoint(side, out);
    return out[1];
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
      // ★ 复位到**静倾角**姿态，不是单位四元数 —— 否则斜肢体每 reset 都被掰直。
      b.setRotation(this.restQ[i], true);
      b.setLinvel(ZERO, true);
      b.setAngvel(ZERO, true);
    }

    if (this.opt.purgeJointCache) this.createJoints();
  }
}
