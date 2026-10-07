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
import type { FootForce, SolePatch } from './rigState';
import { JOINT_MAX_SPEED, jointIndexByName, restQuatOf, type BodyDef, type JointDef, type Skeleton, type Vec3 } from './skeleton';

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
// ★ 2026-10-06：可从环境变量扫（`MOTOR_ALPHA=0.35 node tools/run.mjs …`）——
//   实测头 7 拍"零命令、零角度、速度却指数涨"（31→276°/s）⇒ 疑离散时间自激，
//   本护栏（"每步最多吃掉 α 比例的相对角速度误差"）就是治它的唯一旋钮。
/**
 * ★★★ **伺服"τ↔误差"换算系数**（= `JOINT_MAX_SPEED × JMS_SCALE`）。
 *
 *   实测（`probe-firstframes`）：`zero`（喂全零目标）与 `nocontrol` 都只有 1°/s，
 *   而正常命令（首拍被软斜坡限到 **0.0044 ≈ 0.6°**）却造出 **τ=11 N·m、Δω=105°/s**，
 *   并随后**恒定加速 ≈2000°/s²**（31→276°/s 七拍）⇒ 伺服刚度（17~36 N·m/度）
 *   相对关节有效惯量与 1/120s 步长**过大**，离散环发散。
 *   本旋钮就是那个刚度：`τ = err·τmax/(JMS·JMS_SCALE)`。
 *   环境变量 `JMS_SCALE` 可扫（默认 1 = 原行为）。
 */
const JMS_SCALE = (() => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.JMS_SCALE);
  return Number.isFinite(v) && v > 0 ? v : 1;
})();

/**
 * ★ 平行轴修正开关（`IEFF_FIX=0/1`）。
 *   1 = 在首拍用运行期句柄把 `jointIeff` 补成**含 `m·d²`** 的真值（见 `refineJointIeff`）；
 *   0 = 保持构造期的旧值（只有绕质心的主惯量）。
 */
/**
 * ★★★★ **基础位置增益 `kP` 实验开关**（2026-10-06）。
 *   实测（`probe-t0`）：前 0.1s **全部 15+ 条通道消融逐位相同**、护栏不夹、
 *   换阻尼符号/换 JMS 都更糟 ⇒ 泵只可能在**始终常开的 PD** 里。
 *   本开关直接扫基础增益（`KP=…`，默认 48 = 原值）。
 */
const KP_OVERRIDE = (() => {
  const e = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.KP);
  return Number.isFinite(e) && String((globalThis as any).process?.env?.KP ?? '') !== '' ? e : NaN;
})();

/** ★ 阻尼护栏量纲修正开关（`DMPFIX=0/1`）。1 = `α·|relL|·Ieff`（正确语义）。 */
const DMPFIX = ['1','true','on'].includes(String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.DMPFIX ?? '').toLowerCase());
/** ★ V4 架构开关：纯力矩关节（K≡0；FF+阻尼+平衡修正） */
const V4_MODULE_MODE = (): boolean => ['1','true','on'].includes(String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.V4MODE ?? '').toLowerCase());

const IEFF_FIX = (() => {
  const e = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.IEFF_FIX ?? '');
  return e === '1';
})();

/** ★ 阻尼项符号实验开关（`KD_SIGN=-1` 翻转，用于验证"负阻尼"假说） */
const KD_SIGN = (() => {
  const e = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.KD_SIGN);
  return Number.isFinite(e) && String((globalThis as any).process?.env?.KD_SIGN ?? '') !== '' ? e : 1;
})();

const MOTOR_ALPHA = (() => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.MOTOR_ALPHA);
  return Number.isFinite(v) && v > 0 ? v : 1.0;
})();

/** 调试用：`mfoot_*` 回到自研 PD（定位“换引擎电机”是否导致站立退化） */
const LEGACY_MFOOT_PD = (globalThis as { __LEGACY_MFOOT_PD?: boolean }).__LEGACY_MFOOT_PD === true;

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

/**
 * ★ 限位**位置级投影**的回收速率（1/s）。20 ⇒ 时间常数 50 ms。
 *
 *   2026-10-04 新增。此前 `enforceLimits()` **只有速度级**：越界就归零 `wRel`，
 *   归零后条件 `out>0 ? wRel>0 : wRel<0` 不再成立 ⇒ **限位永久失效**，
 *   角度停在限位外、没有任何回复力。而 `RAPIER.JointData.revolute`
 *   **默认没有角度限位**（只锁 5 自由度、放开 1 转动）⇒ 本函数是唯一的角度约束。
 *   ⇒ 实测踝屈伸轴（轴2 = 绕 Z = 前视里脚长边的旋转方向）能转到 **±174°**、
 *     越限 20~30% ⇒ 脚在前视图里侧翻 40~90°（用户 2026-10-04 亲手画的框证实），
 *     这也是站不住的根本原因：支撑面朝向失控，平衡系统无从下手。
 */
const LIMIT_BIAS_RATE = 20;
/**
 * 位置级投影的**兜底**最大回收角速度（rad/s）。
 *
 * ★★ 2026-10-06：它不再是**上限**，而是**下限** —— 真正的上限由
 *   `limitBiasMaxFor()` 按「马达权限」**逐轴推导**。
 *
 * 背景（`tools/probe-readout.ts` ⑦ 段实测，不是推断）：
 *   `enforceLimits` 的最大回复**角冲量**是 `LIMIT_MAX_BIAS × Iax`，
 *   而马达满扭矩在一个物理步里的**角冲量**是 `τmax / physicsHz`。
 *   spine1 实测：
 *       限位侧 12 × 0.0414 kg·m² = 0.4969 N·m·s
 *       马达侧 120 / 240        = 0.5000 N·m·s
 *       比值 **1.01×** ⇒ 马达赢，限位拦不住
 *   轨迹实测（每物理步）：t=0.033s 时 `spine1/0` 越过 +15°、`spine1/2` 越过 −25°，
 *   随后单调发散到 +34.9° / −52.9°（**限位量的 2.3~2.9 倍**），再未回复。
 *
 * ⇒ 也就是说：**只要 `τmax > LIMIT_MAX_BIAS × Iax × physicsHz`，
 *   该轴的关节限位在数学上就是 unenforceable 的**，而余量只有 1% ——
 *   换个骨架或改个 τmax 就会静默失效，且所有下游指标（存活/倾角）看起来正常。
 *
 * ⇒ 正确做法：限位权限必须**永远压过**马达权限，按轴推导而不是全局魔数。
 *   见 `limitBiasMaxFor()`。
 */
const LIMIT_MAX_BIAS = 12;

/**
 * ★ 2026-10-06 P0 开关：`axisInertia` 是否含**平行轴项** `m·d²`（默认 1 = 含）。
 *   `AXPAR=0` 回退旧行为（仅用于对照；旧行为实测限位失效，膝被撕到 −187°）。
 */
/** `DEATHEFF=0`：瘫软时不放开限位（默认放开 = 保留"散架/转圈"死亡演出） */
const DEATH_EFF = !['0', 'false', 'off'].includes(String(
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).DEATHEFF ?? '').trim().toLowerCase());

const FOOTDMP_OVERRIDE = Number(
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).FOOTDMP ?? '');
const AX_PAR = ['1', 'true', 'on'].includes(String(
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).AXPAR ?? '').trim().toLowerCase());
/** 限位权限相对马达权限的安全系数。1.0 = 刚好压过；留 3× 余量给接触冲击 */
const LIMIT_BIAS_SAFETY = (() => {
  const v = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).LBIAS ?? '');
  return Number.isFinite(v) && v > 0 ? v : 3;     // `LBIAS` 可扫（默认 3）
})();
/**
 * 构造期假定的物理步长（Hz）。真实值在第一个 `driveMotors` 之后由
 * `limitBiasMaxHz` 校正（见该字段注释）。
 */
const ASSUMED_PHYSICS_HZ = 240;

/**
 * ★ "真单支撑"判据的三个常数（控制与计分**共用**，见 `stanceIsSingleSupport`）。
 *
 * `STANCE_CLEAR_MIN = 0.03`：离地净空门槛。取 `stability.MIN_CLEARANCE` 的同一
 *   个口径 —— `sim.ts` 的注释实测"88% 的离地不到 3 cm ⇒ 多是接触抖动"。
 *   重新定义成局部常量而不是 import，是为了不让物理层依赖计分层。
 * ⚠ 若要改，必须**同时**改 `stability.MIN_CLEARANCE`，否则两处口径又分家。
 */
const STANCE_CLEAR_MIN = 0.03;
/** 进入单支撑所需的连续时长（s）：滤掉一瞬的接触抖动 */
const STANCE_ENTER = 0.05;
/** 退出单支撑所需的连续时长（s）：比进入**慢**，形成滞回防来回跳 */
const STANCE_EXIT = 0.10;

export interface RagdollOptions {
  /** 地面摩擦 */
  groundFriction?: number;
  /**
   * ★ 中足关节（距下关节）的**被动弹簧刚度/阻尼**（N·m/rad、N·m·s/rad）。
   *
   *   柔性足 F1（2026-10-04）：内侧弓是**有限刚度**的 —— 站立承重时压缩、
   *   离载时回弹（arch recoil / windlass；Jeon & Cho 压力垫综述 / Welte 2023
   *   「Mobility of the human foot's medial arch」）。revolute 若完全自由，
   *   前足会被接触力压到限位并打滑 ⇒ 必须给弹簧。
   *
   *   量级参考：踝 `ankleTorque = 120 N·m`、行程 30°（0.52 rad）⇒ 等效刚度量级
   *   ~230 N·m/rad。中足肌肉远小于踝 ⇒ 取 **30 N·m/rad**（约 1/8），
   *   阻尼按临界附近 `2√(k·I)` 的量级 ⇒ **1.5 N·m·s/rad**。
   *   ⚠ 这两个数是**量级选取，不是实测标定**。验收判据是「髋外展力矩扫描下
   *     CoP_z 能迁到 **±13.5mm**」（Lugade & Kaufman 2014：CoP 行程 = 足宽 27%）。
   *     达不到就调 `midfootStiffness`，不要动别的地方。
   */
  midfootStiffness?: number;
  /**
   * ★ 弓关节（`arch_*`）的**被动刚度**（N·m/rad）。
   * ⚠ 中足关节当初被删掉的原因就是**塌陷**，但正确结论是「缺限位 + 缺阻尼」。
   *   限位在骨架侧（`cfg.archLimitDeg`），阻尼在这里。
   *   默认给**适中的刚度 + 明确的阻尼** —— 阻尼不足时弓在受载/离载
   *   会像弹簧一样抽，把侧向 CoP 变成高频噪声。
   */
  archStiffness?: number;
  /** ★ 弓关节的**被动阻尼**（N·m·s/rad）。见 `archStiffness` 的注释。 */
  archDamping?: number;
  midfootDamping?: number;
  /** 角色碰撞体摩擦 */
  bodyFriction?: number;
  /** 线性阻尼 */
  linearDamping?: number;
  /** 角阻尼（关节内摩擦之外的整体衰减） */
  angularDamping?: number;
  /**
   * ★ 脚掌刚体（`foot_*`）**单独**的角阻尼。
   *
   *   为什么要单独一份（2026-10-04 实测）：全局 `angularDamping = 12` 确实把
   *   "脚打滑"压掉了（鞋底滑移 86→7mm、峰值角速 1520→82°/s），**但代价是
   *   侧向权重转移权限被压掉 3.8 倍**：
   *     全局 12                   ⇒ |CoM.z|max =  53mm（站距 326mm，需 ±160mm）
   *     全局 5                    ⇒             137mm
   *     额状全开 + 全局 0.04       ⇒             **202mm**
   *   而"把重心压到一条腿"正是单支撑（进而迈步）的第一道门
   *   （用户 2026-10-04：「刻意让重心转移到左腿上，并且维持平衡，然后才能实现迈腿」）。
   *   ⇒ 阻尼只给**脚**（打滑发生在脚上），躯干/腿保持低阻尼（侧向动力学在那里）。
   */
  footAngularDamping?: number;
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
  /**
   * ★★ **踝接地时的等效惯量放大倍数**（"踝权限 ↔ 稳定性"的唯一旋钮）。
   *
   *   背景：稳定性护栏 `|imp| ≤ α·|err|·Ieff` 里的 Ieff 若只用**自由**脚掌的惯量
   *   （1.5 kg 薄盒 ⇒ ≈0.0047 kg·m²），要放行 τmax=60 N·m 需要 Ieff ≥ 0.0556
   *   ⇒ **踝只能拿到 8.4% 的力矩**（实测 τ_demand 60 / τ_applied 5.02），
   *   而存活/倾角指标全都"正常"。
   *
   *   物理上，**承重的脚被地面反作用约束住**，它在踝处的等效惯量应该是
   *   "脚掌之上整个身体绕踝的惯量"（点质量近似 ≈ 0.5~1 kg·m²），不是脚掌自身的质量。
   *
   *   ⚠ 但不能一���放大：实测 factor 很大时**脚会被踹飞**（接触 Σλ 归零 ⇒ 整条力链断）。
   *   ⇒ 必须扫参，取"权限够但脚不离地"的那一档。
   */
  ankleGroundFactor?: number;
  /**
   * ★ 子侧子树总质量阈值（kg）：**不超过**它的关节才享受 `ankleGroundFactor` 放宽。
   *   默认 2 kg —— 实测踝 1.01 / 中足 0.51 / 膝 4.27 / 髋 11.3 ⇒ 干净地只放开踝与中足。
   *   理由见 `ankleGroundFactor` 那段注释：「着地脚掌的有效惯量由地面决定」
   *   这条物理只对踝/中足成立，对髋/膝（内关节）不成立。
   */
  groundFactorFootKg?: number;
}

/** 鞋底接触法线与该块底面外法线的对齐门槛（|cos| ≥ 0.7 ⇒ 夹角 ≤ ~45°） */
const SOLE_NORMAL_TOL = 0.7;

/**
 * ★ 默认 ragdoll 选项（**导出以便探针扫参**：弓刚度/阻尼是在**构造时**折算进
 *   `jointGain` 的，运行中改 `doll.opt` **不生效** ⇒ 扫描必须在构造前设置）。
 */
export const DEFAULTS: Required<RagdollOptions> = {
  // ★★★★★ 2026-10-06 **默认大摩擦**（用户令：「网页上也应该是大摩擦力模式，
  //   摩擦力大是肯定对的」）。
  //   物理立场：脚必须被粘住才有资格谈平衡——低摩擦下一切反馈律都被
  //   "支撑基点每拍漂移"吞掉（实测：踝 ±8mm/拍窜动 = 1m/s 级滑移）。
  //   组合规则 (鞋底 0.9 + 地面 X)/2 ⇒ X=10 ⇒ μ_eff≈5.5（等效完全防滑）。
  groundFriction: (() => {
    const raw = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).GROUNDFRIC ?? '');
    const v = Number(raw);
    return raw !== '' && Number.isFinite(v) && v >= 0 ? v : 10.0;
  })(),
  // ★ 中足被动弓（**单位 N·m/rad**，折算见构造里那段注释）
  midfootStiffness: 120,
  midfootDamping: 8,
  // ★ 弓关节（`arch_*`）的被动刚度/阻尼。**默认比 midfoot 软得多**：
  //   midfoot 是"中足"（脚掌中部），arch 是**内侧弓** —— 弓必须能被压下、
  //   踩实一部分才有用；压到底就成平板、丧失 CoP 行程（Lugade & Kaufman 2014）。
  //   τmax 只有 30 N·m，K=6 ⇒ 满偏 5 rad；K 再大就压不动了。
  // ★ 实测选定（20 档扫描，K=35~260 × B=2~30）：
  //   K=100 / B=15 ⇒ 弓角摆幅 **4.0°**、CoP 内侧余量 **228mm**（最好）
  //   ⚠ 这两个数只在**护栏改成"只管阻尼项"之后**才有效 —— 修之前
  //   K 从 3 扫到 260 弓角摆幅**恒为 20°**（满限位、结果逐位相同），
  //   因为 `α·|err|·Ieff` 把小惯量的弓的马达限到了 1.3%。
  // ★★ 弓的刚度按**真实足弓**取值，不是按弹簧取值。
  //   足弓是骨骼 + 跖腱膜/弹簧韧带/绞盘机制组成的**刚性桁架**，负荷下只变形 2~3mm：
  //     负荷弓前力矩 ≈ 686N × 0.02m ≈ 13.7 N·m，只变形 2°(0.035rad) ⇒ K ≈ 400 N·m/rad。
  //   阻尼取略超临界（临界 = 2√(K·I) ≈ 2√(400×7e-5) ≈ 0.34）⇒ 快速沉降、不过冲。
  //   ★ 这两个值由 **Rapier 力模式电机**执行（隐式积分），所以不受显式 PD 的
  //     K < 4I/dt² ≈ 7.3 那个上限约束 —— 见 createJoints 里"弓用引擎电机"那段。
  archStiffness: 400,
  // ★★★★★ 2026-10-06 **2.0 → 12**（用户实测"落地散架"的定位）：
  //   `probe-jointtrace` 实测远端小关节速度爆：`foot_l/r` **4500/4100°/s**、
  //   `mfoot/arch` 1000~1900°/s。前足是 0.123 kg 薄盒、`I≈2e-4`，
  //   弓电机 K=400 ⇒ ω_n≈1414 rad/s（远超 120 Hz 步长）而 B=2.0 只给 ζ≈0.35
  //   ⇒ 数值上就是个"抖振放大器"。B 提到 12（ζ≈2，过阻尼）把这些抽动按住。
  //   （瘫软/死亡演出仍可复现"散架"——那是刻意的效果，见 `setLimp`。）
  archDamping: 12.0,
  /**
   * ★ 中足关节（距下关节）的**被动弹簧刚度/阻尼**（N·m/rad、N·m·s/rad）。
   *
   *   柔性足 F1（2026-10-04）：内侧弓是**有限刚度**的，站立时承重会压缩它、
   *   离载时回弹（arch recoil / windlass，Jeon&Cho 综述 / Welte 2023）。
   *   revolute 完全自由会让前足被接触力压到限位、打滑 ⇒ 必须给弹簧。
   *
   *   量级参考：踝的 `ankleTorque = 120 N·m`、行程 30°（0.52 rad）⇒ 等效刚度
   *   量级 ~230 N·m/rad。中足比踝**弱**得多（足内小肌肉），取 **30 N·m/rad**
   *   （约为踝的 1/8），阻尼取临界附近 `2·√(k·I)` 的量级 ⇒ **1.5 N·m·s/rad**。
   *   ⚠ 这两个数是**量级选取**，不是实测标定。验收标准是「髋外展力矩扫描下
   *     CoP_z 能迁到 ±13.5mm」（Lugade&Kaufman 2014 的足宽 27%），
   *     达不到就调 `midfootStiffness`，而不是改别的地方。
   */
  bodyFriction: 0.9,
  linearDamping: 0.0,
  // ★★★ 2026-10-04：0.04 → **12**。这不是调参，是补上一个**缺失的物理机制**。
  //
  //   现象（用户）：「脚打滑，膝盖和盆骨乱飞」。
  //   实测（tools/probe-midfoot.ts K 段，扫角阻尼）：
  //       角阻尼   鞋底滑移   全关节峰值角速   >300°/s 的关节
  //        0.04        86mm         1520°/s     foot_l,foot_r,knee_r
  //        0.5        78mm          789°/s     knee_r,foot_r,foot_l
  //        2         88mm         1244°/s     foot_l,foot_r,knee_r
  //        5        106mm          625°/s     knee_r,foot_r,hip_r
  //       12     **12mm**     **109°/s**     （无）   ← 取这个
  //       30          8mm          316°/s     knee_r
  //
  //   为什么角阻尼是**对症**的而不是掩盖：前足是 0.5 kg 的薄长盒
  //   （绕长轴 I ≈ m(hz²+hy²)/3 ≈ 0.0018 kg·m²），接触冲量在 50 mm 力臂上
  //   给 15 N·m 力矩 ⇒ 1/120 s 内 Δω ≈ 4000°/s —— **这个角速度物理上是真的**，
  //   不是求解器发散。真实的人脚靠**肌腱/足底筋膜/肌肉的黏弹**把它压住，
  //   而这里原本 `0.04` 几乎等于**没有被动阻尼** ⇒ 脚像鞭子一样抽动，
  //   反作用力把膝/盆骨抽飞，同时摩擦力被横向速度带跑 ⇒ 打滑。
  //   阻尼**不注入能量**，所以不像放松护栏/加刚度那样把脚踹飞（实测刚度方案滑移 1113mm）。
  //
  //   ⚠ 代价：Rapier 的 `angularDamping` 是**所有刚体**统一值。12 对躯干偏大
  //   （会显得"肉"）。更细的做法是按部位给（脚/前足高、躯干低），
  //   那需要把 `RagdollOptions` 拆成分组阻尼 —— 留作后续。
  // ★ 2026-10-04：**全身回退到 0.04**，高阻尼只给脚掌。
  //   实测（tools/probe-midfoot.ts E3，站距 326mm ⇒ 单支撑需 |CoM.z| ≈ 160mm）：
  //     全身12 / 脚12 ⇒ |CoM.z| =  53mm   ✗ 侧向权重转移被压掉 3.8 倍
  //     全身 0.04 / 脚12 ⇒ **296mm**  ✓ 鞋底滑移 0mm
  //   「刻意把重心转移到左腿上，然后才能迈步」这条序列的第一道门就是侧向权重转移，
  //   全局高阻尼会直接把它堵死。
  angularDamping: 0.04,
  // ★ 2026-10-06：12 → 30（"落地散架"定位后）。
  //   脚 `I≈0.0018`，接触冲量 50mm 力臂即可给 Δω≈4000°/s；
  //   `angularDamping=12` 的时间常数 83ms 压不住那次抽击，提到 30（33ms）。
  //   ⚠ 上限：再大脚会"发木"（触地感消失）⇒ 30 是实测折中，`FOOTDMP` 可扫。
  footAngularDamping: Number.isFinite(FOOTDMP_OVERRIDE) ? FOOTDMP_OVERRIDE : 30,
  torqueScale: 1.0,
  kP: Number.isFinite(KP_OVERRIDE) ? KP_OVERRIDE : 48.0,   // ★ 可由 `KP=…` 扫（实验）
  kD: 1.0,
  // 逐关节增益：默认空（全部用上面的全局值）
  jointGain: {} as Record<string, { kP: number; kD: number }>,
  posRefScale: 0.9,
  purgeJointCache: true,
  motorAlpha: MOTOR_ALPHA,
  // ★★ 保持 **1 = 不放大**。曾设 20 想修"髋权限被护栏卡在 0.52"，但方向错了：
  //   隔离实测（零电机输出、20 s）：
  //     groundFactor=1  → 站满 20.00 s，躯干 1.427 m，倾 0.55°  ✓
  //     groundFactor=20 →  3.05 s 倒，躯干 0.218 m，倾 83.35°   ✗
  //   原因：`Ieff` 同时是**位置反馈环**稳定性护栏 `|imp| ≤ α·|err|·Ieff` 的分母。
  //     放大 Ieff = 放大位置伺服的权限 = 撑破它的稳定性 ⇒ 泵能量 ⇒ 塌。
  //   而"髋权限不足"其实**不需要**靠放大解决：`τ = JᵀF` 的前馈力矩在
  //   `driveMotors` 里单独记账、**不受这条护栏约束**（见 impStable 处的注释），
  //   额状面平衡要的那几十 N·m 走的就是那条路。
  //   ⇒ 位置反馈环保持原始护栏（站得住），前馈走无护栏通道（力矩够）。
  //   该系数只留给"踝接地时脚掌惯量重标定"用，见 probe-authority。
  //
  // ★★★ 2026-10-04 修：`1` 让这整条机制**恒等于死代码**。
  //   `Math.max(1, Math.min(ankleGroundFactor, sum/free, need/free))` 在系数 = 1 时
  //   永远返回 1 ⇒ 柔性足/踝的接地惯量放大**从未生效**（实测 16 个关节全是 1.00）。
  //   后果：薄盒脚掌 Ieff ≈ 0.0015 kg·m² ⇒ 位置环护栏把踝/中足反馈掐到 **1% 权限**
  //   （实测 motorAuthority = 0.01），踝与中足实际都是**自由铰**。
  //   取 8：让髋/膝拿到它们本来该拿的量级，踝拿到够用的刚度而脚仍不脱离地面。
  //   ⚠ 这个数**只在 VIP 刚度 + 髋被动刚度（文献结构）就位之后**才有意义 ——
  //   在那之前放松护栏只会把脚踹飞（实测 factor 32/64 ⇒ 0.9~1.2 s 倒地）。
  //   扫参见 tools/probe-midfoot.ts D3；改这个数必须重跑它。
  // ⚠ 2026-10-04 二次调整：全局系数**只对踝/中足生效**（见 `groundFactorFootKg`）。
  //   之前它是全局的，一动就把髋/膝的稳定性护栏也放松（实测关踝基线 6.00→1.53 s）。
  //   踝/中足要权限走这里；**不要**再靠调 `driveMotors` 的 kP 去救踝。
  //   ⚠⚠ 2026-10-04 **实测否决**：这个系数不能用来给踝/中足补权限。
  //   `groundFactorFootKg`（只作用于踝/中足）确实让它们拿到了权限，但**代价是打滑**：
  //     gf=1 → 鞋底滑移   87mm、踝角速峰值 1815°/s
  //     gf=8 →           174mm、           2676°/s
  //     gf=72→           507mm、           3199°/s
  //     gf=120→         **1113mm**、       3062°/s
  //   角速上千度/秒（每秒 5~9 转）是**数值爆炸**不是"动作大"，求解器在用它甩脚，
  //   反作用力把膝/盆骨抽飞（用户现象：「脚打滑，膝盖和盆骨乱飞」）。
  //   ⇒ 回到 1。踝/中足的权限问题要用**几何不穿地**来解决，不是靠放松护栏。
  //   扫参见 tools/probe-midfoot.ts J 段（逐关节角速 + 鞋底滑移）。
  ankleGroundFactor: 1,
  groundFactorFootKg: 2,
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

/**
 * 力链窗口差分的帧数（N 步前）。5 步 @120Hz ≈ 42ms，
 * 足以压掉接触尖峰 —— 实测单步差分会把落地冲击读成 **109 kN**（真值是体重的 1/60）。
 */
const VEL_WIN = 5;

export class Ragdoll {
  readonly sk: Skeleton;
  readonly opt: Required<RagdollOptions>;
  readonly bodies: RAPIER.RigidBody[] = [];
  /** [左, 右] 鞋底 collider（腾空时间/单脚支撑的真实接触判据） */
  /**
   * ★ 鞋底 collider **列表**（每只脚可能有多块：脚跟 + 前脚掌）。
   *
   * 此前是单数 `soleCol`。脚掌拆成两块后（`SkeletonConfig.soleSplit`），
   * 单数只能存下**一块** ⇒ CoP / 接地判定 / 载荷分配全都在读**半个脚**
   * （实测拆分后 CoP 基线从 214mm 变成 191mm，而踝角没变）。
   * ⇒ 全部改成遍历列表。`soleCol` 保留为「第一块」以兼容既有调用点。
   */
  readonly soleCols: [RAPIER.Collider[], RAPIER.Collider[]] = [[], []];
  /**
   * ★ 与 `soleCols` / `soleColBody` **一一对应**的「该 collider 在**所属刚体**自己的
   *   `colliders[]` 里的下标」。
   *
   *   为什么必须另存：`soleCols` 的下标是**全脚**顺序（左脚 6 块 = foot 4 + arch 2），
   *   而 collider **定义**要在**所属刚体**的 `colliders[]` 里取。
   *   直接拿 `ci` 去索引 `sk.bodies[bi].colliders[ci]` 对弓那两块一定是 `undefined`。
   */
  readonly soleColLocalIdx: [number[], number[]] = [[], []];
  /**
   * ★ 与 `soleCols` 一一对应的**所属刚体下标**。
   *   为什么必须记：`readCoP` 要按"这块鞋底**自己的底面**"筛接触面（见该函数注释），
   *   而底面外法线取决于刚体姿态 ⇒ 必须知道 collider 挂在哪个刚体上。
   *   （`foot_*` 与 `forefoot_*` 是**两个**刚体，姿态各不相同。）
   */
  private readonly soleColBody: [number[], number[]] = [[], []];
  readonly soleCol: [RAPIER.Collider | null, RAPIER.Collider | null] = [null, null];
  /** `readCoP` 的复用缓冲：[copX, copY, copZ, Σλ] */
  private readonly copTmp = new Float64Array(4);
  /**
   * ★★ **每轴权限**：`driveMotors` 的稳定性护栏放行了百分之多少（0~1）。
   *   1 = 完全放行；<1 = 冲量被 `α·|err|·Ieff` 卡住。
   *   必须可回读：**"马达没力"和"指令太小"在别的指标里看起来一模一样**
   *   （历史事故：踝只能出 3% 的力矩，而存活/倾角指标全都"正常"）。
   */
  readonly motorAuthority: Float32Array;
  /** 接地时 Ieff 的放大倍数（踝专用；离地时用 1） */
  private readonly groundFactor: Float32Array;
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
   * ★ 由 **Rapier 引擎电机**（而非自研 PD）驱动的关节下标。
   *   `driveMotors` 必须跳过它们 —— 否则双驱动，弹性不去动。
   *   历史：中足曾因“PD 拉向 0 且 Rapier 弹簧也拉向 0”而被锻死，
   *   外观指标却全部“正常”。
   */
  private motorDriven = new Set<number>();
  /** ★ 最近一次 `driveMotors` 的物理步长 —— 弓增益的数值稳定上限要用它 */
  private physicsDt = 0;
  /** 弓增益被夹紧的实况（可回读：`requested` vs 实际生效），null = 没夹或没有弓 */
  archMotor: { K: number; B: number; joint: number } | null = null;
  /**
   * ★★★ **逐关节发力门禁** —— 用户 2026-10-06 定调：
   *   「**承重无上限，但是发力有上限**」。
   *
   *   ⇒ 本类（位置伺服 + 最终输出）**不做**额外上限：
   *     位置伺服是**承重**路径（撑住身体、保持姿态），它只能被 `τmax` 限
   *     —— 那也是"能扛住的最大力"，不是"能一直发的力"。
   *   ⇒ 真正的发力门禁在 `RigState.requestTorque`（**主动命令**入口），
   *     见那里的 `tauCap`/`hold` 判据。0 = 不设上限。
   *
   *   ⚠ 我曾在这里加了第二道夹（连位置伺服一起夹到 0.35·τmax）——
   *     那会把**承重**也限住（"撑不住自己"），与用户定调相反，已撤。
   */
  tauCap: Float32Array = new Float32Array(0);   // 保留字段：供探针回读上限表，不再执行
  /**
   * ★★★ **逐轴刚度上限**（N·m/rad；0 = 不设限）—— 见 `driveMotors` 里的长注释。
   *   与 `tauCap`（发力上限）**是两件事**：`tauCap` 限"一次能发多大劲"，
   *   `stiffCap` 限"对一个角度误差反应多硬"。实测脊柱后者超了 7 倍。
   */
  stiffCap: Float32Array = new Float32Array(0);
  /** 被刚度上限夹住的次数（可回读） */
  stiffCapHits = 0;
  /** 各轴**夹之前**的 kP 峰值（诊断：用来反推"本来有多硬"） */
  readonly kpRawPeak = new Float64Array(256);
  /** 安装逐轴刚度上限（长度 = 关节数×3；`Controller` 构造时调一次） */
  setStiffCaps(caps: Float32Array): void { this.stiffCap = caps; }
  /** 被夹住的次数（已停用；保留 0 以兼容回读） */
  capHits = 0;
  /** 安装逐轴发力上限（长度 = 关节数×3；`Controller` 构造时调一次） */
  setTauCaps(caps: Float32Array): void { this.tauCap = caps; }
  /**
   * ★★★ 弓/内侧前足关节的**引擎电机句柄**（侧 → 引擎关节对象）。
   *   它们由 Rapier 力模式电机驱动，不进 `driveMotors` 的自研 PD 阵列
   *   ⇒ `setTorqueTargets` 到不了。这里留一句柄给 `setArchRoll` 写**目标角**。
   */
  private readonly archRollers: { side: 0 | 1; j: unknown }[] = [];
  /**
   * 关节 i 的等效惯量（单位冲量造成的相对角速度变化 = 1/Ieff），构造时算一次。
   * ★ 3D 版取两个刚体**三个主惯量的最小值**再合成 —— 偏保守。
   *   （绕某轴转的惯量 ≥ 主惯量最小值，用最小值 ⇒ 允许的冲量偏小 ⇒ 不会引入不稳定。）
   */
  readonly jointIeff: Float64Array;
  /**
   * ★★ 每轴的限位回复角速度上限（rad/s），由「马达权限 ÷ 该轴惯量」**推导**。
   *
   * 为什么必须有这个数组：关节限位靠**速度偏置**回复，而偏置产生的角冲量是
   * `bias × Iax`；马达满扭矩一个物理步的角冲量是 `τmax/240`。
   * ⇒ 限位要 enforceable，必须 `bias_max × Iax ≥ τmax/240`。
   * 全局常数 `LIMIT_MAX_BIAS = 12` 对 spine1 只差 **1%**（实测，见其注释），
   * 而腰一旦被推出限位，四根轴全部 τmax 对抗限位冲量 ⇒ 力矩全耗在内耗上、
   * 一点都变不成地面上的力（实测：`spine1/2` 冲到限位的 2.9 倍）。
   */
  private readonly limitBiasMax: Float64Array;
  /**
   * `limitBiasMax` 是按**假定的**物理步长算的（构造期拿不到真实值）。
   * `driveMotors` 每物理步都会写 `this.physicsDt`，第一个物理步之后就能校正。
   * ★ 为什么要校正：步长**变大** ⇒ 马达角冲量变小 ⇒ 原来算的权限偏大（安全）；
   *   步长**变小** ⇒ 马达角冲量变大 ⇒ 权限不足（危险）。
   *   而 `SimConfig.physicsHz` 是可配的（默认 240，实测曾为 120）⇒ 必须校正。
   */
  private limitBiasMaxHz = ASSUMED_PHYSICS_HZ;
  /** 瘫软标记：位置环增益置 0（死亡演出，见 setLimp） */
  limp = false;
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
  /** ★ 逐轴限位触发次数（诊断用：>0 说明限位真的在起作用） */
  limitHits = 0;
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
  /** ★ 是否启用**虚拟支撑点**。默认 **关** —— 用户 2026-10-02 反馈"支撑腿打滑的感觉"，
   *   原因是支撑点在脚刚体上直接施加冲量、**绕过接触与摩擦**。
   *   纯物理路径（靠踝力矩把脚撬起来让接触自然算 CoP）才是不打滑的做法。 */
  supportPointOn = false;
  /** 最近一次 driveMotors 的 dt（enforceLimits 的角度投影需要它换算角冲量）。 */
  private lastDt = 1 / 120;
  private readonly axTmp = new Float64Array(3);
  private readonly ptTmp = { x: 0, y: 0, z: 0 };
  private readonly pcTmp = { x: 0, y: 0, z: 0 };
  private readonly ivUp = { x: 0, y: 0, z: 0 };

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
    this.motorAuthority = new Float32Array(sk.joints.length * 3);
    this.groundFactor = new Float32Array(sk.joints.length).fill(1);
    this.footAuthUsed = new Float32Array(sk.joints.length * 3).fill(1);
    this.ankleGroundFactorUsed = new Float32Array(sk.joints.length).fill(1);
    this.torqueCmd = new Float32Array(sk.joints.length * 3);
    this.holdCmd = new Array(sk.joints.length * 3).fill(0);
    this.toneScale = new Array(sk.joints.length * 3).fill(1);
    this.tauApplied = new Float32Array(sk.joints.length * 3);
    this.motorBranch = new Uint8Array(sk.joints.length * 3);
    this.motorThRef = new Float32Array(sk.joints.length * 3);
    this.motorErr = new Float32Array(sk.joints.length * 3);
    this.motorErrP = new Float32Array(sk.joints.length * 3);
    this.motorErrD = new Float32Array(sk.joints.length * 3);
    this.motorTauFF = new Float32Array(sk.joints.length * 3);
    this.eqLPF = new Float64Array(sk.joints.length * 3);
    this.v4ThRef = new Float64Array(sk.joints.length * 3);
    this.v4FF = new Float64Array(sk.joints.length * 3);
    this.v4Locked = new Uint8Array(sk.joints.length * 3);
    this.signState = new Int8Array(sk.joints.length * 3);
    this.signT = new Float64Array(sk.joints.length * 3);
    this.motorInt = new Float64Array(sk.joints.length * 3);
    this.ankleJoint = jointIndexByName(sk, 'foot_l');
    this.ankleJointR = jointIndexByName(sk, 'foot_r');

    // ★★ 被动弓的刚度折算成 `jointGain`（N·m/rad → 1/s 的等效增益）。
    //   自研马达的力矩是 `τ = kP·(θ_ref−θ)·τmax/ωmax − kD·ω_rel·τmax/ωmax`，
    //   令 `θ_ref = 0` 就是**以 0 rad 为原点的弹簧**，其
    //       等效刚度 K = kP·τmax/ωmax        等效阻尼 B = kD·τmax/ωmax
    //   ⇒ 反解 `kP = K·ωmax/τmax`。
    //   这样 `midfootStiffness` 的单位**真的是 N·m/rad**（与文献同量纲），
    //   而不是 Rapier 马达那种无量纲增益 —— 见 createJoints 里被删掉的那段注释。
    const archK = this.opt.archStiffness ?? 6;      // N·m/rad：软到能被压下、硬到不塌
    const archB = this.opt.archDamping ?? 1.2;     // N·m·s/rad：临界阻尼量级
    if (this.opt.midfootStiffness || this.opt.midfootDamping || true) {
      const gain: Record<string, { kP: number; kD: number }> = { ...(this.opt.jointGain ?? {}) };
      for (let i = 0; i < sk.joints.length; i++) {
        const j = sk.joints[i]!;
        // ★ 同时覆盖 `midfoot_*`（旧命名）与 **`arch_*`**（柔性足 F2 的弓关节）。
        if (!j.name.startsWith('midfoot_') && !j.name.startsWith('arch_')) continue;
        // ★ 弓不进自研阵别：它由 **Rapier 力模式电机**驱动（见 createJoints）。
        //   原因：自研是每步**663e式**加冲量，稳定上限 K < 4I/dt² ≈ 7.3 N·m/rad，
        //   而真实足弧要的刚度是 **≈400**（负荷下只变形 2°）。
        //   低足够“有弹性”的柔软弓不是足弓，是弹精。
        if (j.name.startsWith('arch_')) continue;
        if (gain[j.name]) continue;            // 调用方显式给了就不覆盖
        const ax = j.revoluteAxis
          ? (j.revoluteAxis[0] !== 0 ? 0 : j.revoluteAxis[1] !== 0 ? 1 : 2)
          : 0;
        const tmax = Math.max(1e-6, j.maxTorque[ax]!);
        const isArch = j.name.startsWith('arch_');
        gain[j.name] = {
          kP: ((isArch ? archK : (this.opt.midfootStiffness ?? 0)) * JOINT_MAX_SPEED) / tmax,
          kD: ((isArch ? archB : (this.opt.midfootDamping ?? 0)) * JOINT_MAX_SPEED) / tmax,
        };
      }
      this.opt.jointGain = gain;
    }

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
          // ★ 脚掌用单独的高角阻尼：打滑是脚上的现象，而侧向权重转移的
          //   动力学在躯干/腿上，全局高阻尼会把它压掉 3.8 倍。
          .setAngularDamping(/^foot_/.test(b.key)
            ? (this.opt.footAngularDamping ?? this.opt.angularDamping)
            : this.opt.angularDamping)
          .setCanSleep(false),
      );
      this.bodies.push(body);

      for (let ci = 0; ci < b.colliders.length; ci++) {
        const c = b.colliders[ci]!;   // ★ ci = 该 collider 在**本刚体** colliders[] 里的下标
        const cd = c.shape === 'capsule'
          ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius)
          : RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz);
        // ★ ColliderDesc.setTranslation 是 (x,y,z) 三个数，不是 Vector
        // ★ offsetX：脚掌拆成"脚跟 + 前脚掌"两块时用（沿足长方向分离）。
        //   CoP 权限的关键 —— 见 `ColliderDef.offsetX` 的说明。
        // ★ offsetZ：脚掌盒要按纹理实测的靴心侧偏摆（否则盒心挂在小腿中轴上，靴子对不上）
        cd.setTranslation(c.offsetX ?? 0, c.offsetY, c.offsetZ)
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
          // ★ `forefoot_*` 是柔性足 F1 的前足刚体，它的 collider **也是鞋底**
          //   （前脚掌内侧柱/外侧柱）⇒ 必须一起登记，否则 CoP / 载荷只统计后足。
          // ★ `arch_l/arch_r`（柔性足 F2 的**弓刚体**）也要登记：
          //   内侧弓是唯一能**旋前踩实**的部分，它不登记 ⇒ CoP / 逐块载荷
          //   永远看不到它 ⇒ 又会得出"弓不承重"的错误结论（正是本设计要修的）。
          // ★ `mfoot_*`（内侧前足 / 第一跳骨头）也是鞋底，一样要登记。
          if (b.key === 'shin_l' || b.key === 'foot_l' || b.key === 'forefoot_l'
              || b.key === 'arch_l' || b.key === 'mfoot_l') {
            this.soleCols[0].push(col);
            this.soleColBody[0].push(i);      // ★ 记下所属刚体（readCoP筛底面要用）
            this.soleColLocalIdx[0].push(ci);
            this.soleCol[0] ??= col;      // 兼容旧调用点（= 第一块）
          } else if (b.key === 'shin_r' || b.key === 'foot_r' || b.key === 'forefoot_r'
              || b.key === 'arch_r' || b.key === 'mfoot_r') {
            this.soleCols[1].push(col);
            this.soleColBody[1].push(i);
            this.soleColLocalIdx[1].push(ci);
            this.soleCol[1] ??= col;
          }
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
    // ★★★ **每轴有效惯量**：必须用**最大**主惯量，不能用 `min`。
    //
    //   历史事故（同一个坑修过两次，第二次漏在这里）：
    //     `min(I.x,I.y,I.z)` 对**薄盒形脚掌**极小（实测 ≈0.0022 kg·m²），
    //     于是稳定性护栏 `|imp| ≤ α·|err|·Ieff` 把踝的冲量卡到只剩 **3%**
    //     ⇒ 踝实际只能出 ~1 N·m（τmax 是 60）⇒ CoP 权限≈0，
    //       而所有指标看起来都"正常"。
    //     `enforceLimits` 早就发现并修过（见那里的注释），**但 driveMotors 没跟着修**。
    //
    //   护栏的物理目的是"别过冲速度误差"，它应该用**该轴**的惯量；
    //   取最大主惯量是保守的**上界**（护栏更宽松），实测不发散。
    const bodyI = new Float64Array(this.bodies.length);
    for (let i = 0; i < this.bodies.length; i++) {
      const I = this.bodies[i].principalInertia();
      bodyI[i] = Math.max(1e-6, Math.max(I.x, Math.max(I.y, I.z)));
    }
    for (let i = 0; i < sk.joints.length; i++) {
      // ⚠⚠ 2026-10-06 试过在这里加**平行轴项 `m·d²`**（理论上是必要的），
      //   但**构造期**调用 `jointWorld`/`body.worldCom()` 会拿到未就绪的 wasm 句柄
      //   ⇒ `probe:domain` 在 G 段 `World.step` 里 **RuntimeError: unreachable**。
      //   ⇒ 已回退。**若要做，必须挪到构造之后**（见 `axisInertia`，它是运行期调用，
      //     加平行轴项是安全的）。
      const ip = bodyI[this.jointBodies[i * 2]];
      const ic = bodyI[this.jointBodies[i * 2 + 1]];
      this.jointIeff[i] = 1 / (1 / ip + 1 / ic);
    }
    // ★★ 限位回复上限**逐轴推导**（2026-10-06）。必须在 `jointIeff` 填完**之后**。
    //
    //   推导式（冲量相等 ⇒ 限位刚好压过马达）：
    //       bias_max · Iax  ≥  τmax / physicsHz
    //   ⇒ bias_max = LIMIT_BIAS_SAFETY · τmax / (Iax · physicsHz)
    //
    //   用**该轴**的 `τmax`（不是关节的总 τmax），因为 `driveMotors` 也是逐轴限幅的。
    //   `Iax` 用 `jointIeff`（与 `enforceLimits` 里施加冲量时用的是**同一个**惯量 ——
    //   两者必须一致，否则「算出来的权限」和「实际施加的权限」不是一回事，
    //   而这正是本 bug 的形态）。
    // ⚠⚠ 必须放在 `jointIeff` 填完**之后** —— 见下面那句注释。
    //   （原实现放在 `jointIeff = new Float64Array(...)` **旁边**，
    //     那一刻 `jointIeff` 全是 0 ⇒ `Iax` 取 `1e-6` ⇒ `need` 变成天文数字
    //     ⇒ 限位偏置被放到几千 rad/s ⇒ `enforceLimits` 每个子步注入
    //     巨量角冲量把肢体弹飞。2026-10-06 因此把整段移到 `jointIeff` 循环之后。）
    this.limitBiasMax = new Float64Array(sk.joints.length * 3);
    for (let i = 0; i < sk.joints.length; i++) {
      const J = sk.joints[i]!;
      const bp = this.bodies[this.jointBodies[i * 2]];
      const bc = this.bodies[this.jointBodies[i * 2 + 1]];
      const ip = bp.principalInertia(), ic = bc.principalInertia();
      const q = bp.rotation();
      for (let k = 0; k < 3; k++) {
        const tmax = Math.abs(J.maxTorque[k] ?? 0);
        // ★★ 必须用**该轴**的折合惯量（与 `enforceLimits` 施加冲量时同一个），
        //   **不能**用 `jointIeff`：后者是**最大**主惯量的并联，
        //   对细长段（脊柱）可以比该轴真实惯量小 2~4 倍
        //   ⇒ 用它算出的限位权限**名义上够、物理上不够**（实测 `spine1/2` 差 1.02×）。
        //   这里就地复算 `axisInertia` 的公式（不直接调那个 private 方法：
        //   它写 `this.axisW`，构造期调用会引入顺序依赖）。
        const axk = k === 0 ? 1 : 0, ayk = k === 1 ? 1 : 0, azk = k === 2 ? 1 : 0;
        quatRotate(q.x, q.y, q.z, q.w, axk, ayk, azk, this.axisW);
        const a = this.axisW;
        const Ip = a[0] * a[0] * ip.x + a[1] * a[1] * ip.y + a[2] * a[2] * ip.z;
        const Ic = a[0] * a[0] * ic.x + a[1] * a[1] * ic.y + a[2] * a[2] * ic.z;
        const Iax = 1 / (1 / Math.max(1e-9, Ip) + 1 / Math.max(1e-9, Ic));
        // ⚠ `physicsHz` 不在 `RagdollOptions` 里（在 `SimConfig`）。取 240
        //   （`DEFAULT_SIM.physicsHz` 的值），并在 `driveMotors` 里按真实 dt 校正。
        const need = LIMIT_BIAS_SAFETY * tmax / (Math.max(1e-9, Iax) * ASSUMED_PHYSICS_HZ);
        this.limitBiasMax[i * 3 + k] = Math.max(LIMIT_MAX_BIAS, need);
      }
    }

    // ★ 权限诊断：护栏放行了-demanded 的百分之多少（0~1）。<1 就是被护栏卡住。
    //   这个量必须可回读 —— 否则"马达没力"和"指令太小"看起来一模一样。
    this.motorAuthority.fill(1);

    // ─────────────────────────────────────────────────────────────
    // ★★★ **接地时的等效惯量**（第二次修同一个坑，仍然漏在 driveMotors）
    //
    //   护栏 `|imp| ≤ α·|err|·Ieff` 里的 Ieff 若只用**自由**脚掌的主惯量，
    //   一只 1.5 kg 的薄盒脚 Ieff ≈ 0.0047 kg·m²，而"要放行 τmax=60 需 Ieff ≥ 0.0556"
    //   ⇒ **踝只能拿到 8.4% 的力矩**（实测 τ_demand 60 / τ_applied 5.02 N·m）。
    //
    //   物理上这是错的：**承重的脚被地面反作用约束住**，它在踝处的等效惯量
    //   不是脚掌的质量，而是"脚掌之上整个身体绕踝的惯量"（点质量近似
    //   `Σ mᵢ·rᵢ²`，≈ 0.5~1 kg·m²）—— 大得多。
    //   自由脚掌那个值只在**脚离地**时才该用（那时确实可以瞬间加速）。
    //
    //   ⇒ 预计算 `groundFactor[i] = Ieff_接地 / Ieff_自由`，接地时乘上去。
    //   这不是"把护栏调松"，是**把护栏用在对的地方**。
    // ─────────────────────────────────────────────────────────────
    this.groundFactor.fill(1);
    this.ankleGroundFactorUsed.fill(1);
    {
      // ── 推广到**所有子侧子树含脚**的关节（踝、髋、膝）────────────
      //   病根：`Ieff = 1/(1/I_父 + 1/I_子)` 是**两个自由体**的折合惯量。
      //   但单腿站立时**大腿/小腿被地面约束住**，它在髋/膝处的等效惯量
      //   应该是"脚以上整个身体绕该关节"的惯量（点质量近似 Σmᵢrᵢ²），大得多。
      //   不做这一步：护栏把髋卡在 **51%**（实测 τ 105/200 N·m、权限 0.52），
      //   而单腿要撑 58.7 kg ⇒ **发力不够 ⇒ 髋屈 −21.6°、膝反折 ⇒ 整体塌下去**
      //   （实测 `hit=torso`、tilt=0°、躯干 y 1.427→0.346）。
      // ⚠ 关踝时 `foot_l/r` **不是独立刚体**（焊在小腿上），所以只查 foot_* 会永远
      //   判成 false，髋/膝拿不到任何 groundFactor（实测 groundF=1.00、权威卡 51%）。
      //   ⇒ 接地判定按"这条链的**末端刚体**"：开踝是 foot_*，关踝是 shin_*。
      // ★★ 柔性足 F1（2026-10-04 修）：**必须含 `forefoot_*`**。
      //   中足关节的子体是 `forefoot_*`，而 `forefoot_*` 是叶子（无下级关节）
      //   ⇒ 不显式播种的话 `walk('forefoot_l')` 恒 false ⇒ 中足永远拿不到放大。
      const footKeys = ['foot_l', 'foot_r', 'forefoot_l', 'forefoot_r', 'shin_l', 'shin_r'];
      const hasFootBelow = new Map<string, boolean>();
      const walk = (k: string): boolean => {
        const hit = hasFootBelow.get(k);
        if (hit !== undefined) return hit;
        let r = false;
        for (const jj of sk.joints) {
          if (jj.parentKey === k) { if (walk(jj.childKey)) { r = true; break; } }
        }
        hasFootBelow.set(k, r);
        return r;
      };
      for (const k of footKeys) hasFootBelow.set(k, true);
      // 末端刚体自身也当作"含接地端"，以便 shin→(无踝)→world 的情况
      for (let bi = 0; bi < sk.bodies.length; bi++) {
        const k = sk.bodies[bi]!.key;
        if (!footKeys.includes(k)) continue;
        hasFootBelow.set(k, true);
      }
      for (let i = 0; i < sk.joints.length; i++) {
        const jn = sk.joints[i]!;
        // ⚠ 必须调 `walk()`，不能用 `hasFootBelow.get()`：
        //   种子只填了末端刚体（shin_*），中间的 thigh_* 从没被 walk 过，
        //   `.get()` 返回 undefined ⇒ 被判成"不含脚" ⇒ **只有膝拿到 groundFactor，
        //   髋永远是 1.00**（实测 hip groundF=1.00、knee=1.56）。
        if (!walk(jn.childKey)) continue;
        const aj = this.bodies[this.jointBodies[i * 2 + 1]]!;    // 子体侧锚点
        const ap = aj.translation();
        // 子侧子树（含脚）的 body 下标集合
        const inSub = new Set<number>();
        for (let bi = 0; bi < sk.bodies.length; bi++) {
          if (sk.bodies[bi]!.key === jn.childKey) inSub.add(bi);
        }
        let frontier = [jn.childKey];
        while (frontier.length) {
          const k = frontier.pop()!;
          for (let bi = 0; bi < sk.bodies.length; bi++) {
            const bd = sk.bodies[bi]!;
            if (inSub.has(bi)) continue;
            if (sk.joints.some((jj) => jj.parentKey === k && jj.childKey === bd.key)) {
              inSub.add(bi);
              frontier.push(bd.key);
            }
          }
        }
        // 父侧（脚以上）所有刚体绕该关节的 Σ mᵢ·rᵢ²
        let sum = 0;
        for (let bi = 0; bi < sk.bodies.length; bi++) {
          if (inSub.has(bi)) continue;
          const t = this.bodies[bi]!.translation();
          const dx = t.x - ap.x, dy = t.y - ap.y, dz = t.z - ap.z;
          sum += sk.bodies[bi]!.mass * (dx * dx + dy * dy + dz * dz);
        }
        const free = this.jointIeff[i]!;
        const need = Math.max(...jn.maxTorque) * (1 / 120) / JOINT_MAX_SPEED;

        // ★★★ 2026-10-04：**只给"子侧就是一只着地脚掌"的关节**放宽护栏（踝、中足）。
        //
        //   为什么必须限定在这两个关节上（实测）：
        //     全局放宽会把**髋/膝也一起放松**（它们的 `need/free` 本来就 >1：
        //     髋 3.4、膝 1.6）⇒ 实测关踝基线从 6.00 s 掉到 1.53 s。
        //     而"着地脚掌的有效惯量由地面决定、不是子树质量决定"这条物理理由
        //     **对髋/膝不成立** —— 它们是两块都在动的身体段之间的内关节，
        //     不存在地面约束。所以护栏在髋/膝上是**必要的稳定性保护**，不能动。
        //
        //   判据：子侧子树总质量 ≤ `groundFactorFootKg`（默认 2 kg）。
        //     实测各关节子侧子树质量：踝 1.01 kg / 中足 0.51 kg
        //                          膝 4.27 kg / 髋 11.3 kg ⇒ 2 kg 干净地分开。
        let subMass = 0;
        for (const bi of inSub) subMass += this.sk.bodies[bi]!.mass;
        const footAnchored = subMass <= this.opt.groundFactorFootKg;

        this.groundFactor[i] = footAnchored
          ? Math.max(1, Math.min(this.opt.ankleGroundFactor,
            sum / Math.max(1e-9, free), need / Math.max(1e-9, free)))
          : 1;
        this.ankleGroundFactorUsed[i] = this.groundFactor[i]!;
      }
    }
    if (false) {
      const ank = jointIndexByName(sk, 'foot_l');
      const ankR = jointIndexByName(sk, 'foot_r');
      for (const jn of [ank, ankR]) {
        if (jn < 0) continue;
        const footBody = jn === ank ? 0 : 1;
        void footBody;
        const aj = this.bodies[this.jointBodies[jn * 2 + 1]]!;   // 子体 = 脚
        const ap = aj.translation();
        // 点质量近似：踝以上所有刚体绕踝的 Σ mᵢ·rᵢ²（排除脚自身）
        let sum = 0;
        for (const b of this.bodies) {
          if (b === aj) continue;
          const t = b.translation();
          const dx = t.x - ap.x, dy = t.y - ap.y, dz = t.z - ap.z;
          sum += b.mass() * (dx * dx + dy * dy + dz * dz);
        }
        void ap;
        const free = this.jointIeff[jn]!;
        // 限制放大倍数：护栏还必须留一点（不然真会发散），但要够放行 τmax
        // 要放行 τmax 所需的 Ieff 下限：τmax·dt/(JOINT_MAX_SPEED·α)，α=1
        const tauMax = sk.joints[jn]!.maxTorque[AXIS_Z] ?? 45;
        const want = tauMax * (1 / 120) / JOINT_MAX_SPEED;
        // ★ 放大倍数是"踝权限 ↔ 稳定性"的唯一旋钮，必须可调、可扫：
        //   太大 ⇒ 脚被踹飞（实测 Σλ 归零）；太小 ⇒ 权限上不来（实测 8.4%）。
        const need = want / Math.max(1e-9, free);
        const f = Math.max(1, Math.min(this.opt.ankleGroundFactor, sum / Math.max(1e-9, free), need));
        this.groundFactor[jn] = f;
        this.ankleGroundFactorUsed[jn] = f;
      }
    }

    // ---- ★ 位置命令的 θ_ref 斜率（每轴一份，构造时算一次）----
    this.refPos = new Float64Array(sk.joints.length * 3);
    this.refNeg = new Float64Array(sk.joints.length * 3);
    for (let i = 0; i < sk.joints.length; i++) {
      for (let k = 0; k < 3; k++) {
        const s = this.opt.posRefScale;
        // ★★ 双向都用该轴的**最大行程**做归一化斜率（2026-10-02 修）。
        //   旧写法按各自一侧的限位取斜率，在**不对称限位**上会把那一侧掐死：
        //     knee 限位 [-145°, +2°] ⇒ refPos = s·2°，一个 cmd=0.5 只产生 s·1°
        //     ⇒ 实测膝单轴只动 1.6°/5.1°、肘 4.4°，而髋（[-80°,+60°] 较对称）动 50~72°。
        //   这就是"看起来只有髋像有关节"的来源：**不是物理推不动，是映射把幅度压没了**。
        const span = Math.max(Math.abs(sk.joints[i].minRad[k]), Math.abs(sk.joints[i].maxRad[k]));
        this.refPos[i * 3 + k] = s * span;
        this.refNeg[i * 3 + k] = s * span;
      }
    }
  }

  /**
   * 建/重建所有关节。
   * 球关节只有两个锚点参数，没有轴、没有限位 —— 限位和马达全在 driveMotors 里。
   */
  private createJoints(): void {
    // ★ `reset()` 在 `purgeJointCache` 时会**删掉全部关节再重建**（清暖启动冲量缓存）
    //   ⇒ 这里必须**先清空**，否则 `archRollers` 里会留下陈旧句柄、
    //   对它调 `configureMotorPosition` 会让 Rapier wasm **panic**（实测 unreachable）。
    this.archRollers.length = 0;
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

      const anch1 = { x: j.parentLocal[0], y: j.parentLocal[1], z: j.parentLocal[2] };
      const anch2 = { x: j.childLocal[0], y: j.childLocal[1], z: j.childLocal[2] };
      let jd: RAPIER.JointData;
      if (j.revoluteAxis) {
        // ★★ 踝：真正的 **revolute 铰链**，带**引擎级**角度限位（2026-10-04）。
        //   这是唯一能让物理层拒绝侧翻的途径 —— 球铰没有三轴限位 API。
        const ax = j.revoluteAxis;
        jd = RAPIER.JointData.revolute(anch1, anch2, { x: ax[0], y: ax[1], z: ax[2] });
        jd.limitsEnabled = true;
        // revolute 的 `limits` 是**单对标量**（只约束那一个自由转轴）⇒ 用轴2（屈伸）
        jd.limits = [j.minRad[2], j.maxRad[2]];
      } else {
        jd = RAPIER.JointData.spherical(anch1, anch2);
        // ⚠ 球铰**不设** limits：Rapier 0.14 的 `limitsMin()/limitsMax()` 是单对标量
        //   （给 revolute/prismatic 设计），给球铰写 limits 是**实测无效**的
        //   （2026-10-02：打开前后所有回读逐位相同）。
        //   ⇒ 球铰的角度约束只能靠 `enforceLimits()` 的手写冲量
        //     （2026-10-04 补了**位置级投影**，此前只有速度级、越界即永久失效）。
      }
      const joint = this.world.createImpulseJoint(jd, this.bodies[pi], this.bodies[ci], true) as RAPIER.ImpulseJoint;
      // ★★★ 限位**必须用关节对象上的 `setLimits()`**，不能只写 `jd.limitsEnabled`（2026-10-04 实测）。
      //
      //   实测证据：踝已经建成 `RevoluteImpulseJoint`，但引擎读回
      //     `limitsEnabled() = false`、`limitsMin() = -3.4e38`、`limitsMax() = +3.4e38`
      //   ⇒ **`JointData` 上的 `limitsEnabled/limits` 不会传给创建出来的关节**（空操作）。
      //   这也解释了旧注释「Rapier 0.14 不吃这个格式」的**真正原因** —— 不是格式错，
      //   是**设置点错了**：得在 `createImpulseJoint()` 返回的对象上调 `setLimits()`。
      //
      //   ⚠ 球铰（`GenericImpulseJoint`）**没有任何 limits 方法**
      //     （实测其原型上只有 anchor/body/configureMotor/raw 那些）⇒ 球铰确实无法有
      //     引擎级角度限位，其余关节只能靠 `enforceLimits()` 的手写冲量。
      // ★★★ 灵性足 F2：**弓用 Rapier 力模式电机，不用自研 PD**。
      //
      //   弓是**剔性梁架**，不是弹粽（真实足弧在负荷下只变形 2~3mm）：
      //     · 刚度要求：负荷弓前力矩 ≈ 686N×0.02m ≈ 13.7 N·m，
      //       只让它变 2°(0.035rad) ⇒ **K ≈ 400 N·m/rad**。
      //     而自研显式 PD 在 dt=1/120s 下的稳定上限只有 **7.3**（归因是弓沿自由轴惯量只有 7e-5 kg·m²）。
      //   ⇓ 两者差 **55 倍**，弹精在显式集成下不可能实现。
      //
      //   `MotorModel.ForceBased` 的刚度/阻尼就是真实量纲 N·m/rad，且由求解器**隐式**积分
      //   ⇒ 无显式稳定上限，可以直接给几百 N·m/rad。
      //   ⚠ 旧注释说“Rapier 的 stiffness 根本不是 N·m/rad” —— 那是因为用了**默认的
      //     AccelerationBased**模式（把刚度当加速度，隐式除了质量）。
      //     切到 `ForceBased` 后量纲就对了。
      if ((j.name.startsWith('arch_') || (j.name.startsWith('mfoot_') && !LEGACY_MFOOT_PD)) && j.revoluteAxis) {
        const mj = joint as unknown as {
          configureMotorModel(m: number): void;
          configureMotorPosition(t: number, k: number, b: number): void;
        };
        mj.configureMotorModel(RAPIER.MotorModel.ForceBased);
        const K = this.opt.archStiffness ?? 400;      // N·m/rad
        const B = this.opt.archDamping ?? 2.0;        // N·m·s/rad
        mj.configureMotorPosition(0, K, B);
        // ★ `mfoot_*`（内侧前足）也用同一刚度：链上两个关节都是内侧柱的承力环节，
        //   用两种驱动方式会让链路一半可控一半不可控。
        this.motorDriven.add(i);
        this.archMotor = { K, B, joint: i };
        // ★ 记下引擎关节句柄 ⇒ `setArchRoll` 能写它的**目标角**（见该方法注释）
        this.archRollers.push({ side: j.name.endsWith('_l') ? 0 : 1, j: joint });
      }
      if (j.revoluteAxis && typeof (joint as { setLimits?: unknown }).setLimits === 'function') {
        // revolute 的限位取**与 revoluteAxis 对应的那一轴**（踝 = 轴2，中足 = 轴0）
        const ax = j.revoluteAxis[0] !== 0 ? 0 : j.revoluteAxis[1] !== 0 ? 1 : 2;
        (joint as unknown as { setLimits(a: number, b: number): void })
          .setLimits(j.minRad[ax], j.maxRad[ax]);
      }
      // ★★ 柔性足 F1：中足关节的**被动弓**改由自研马达实现（2026-10-04 修）。
      //
      //   原来这里挂的是 Rapier 的 `configureMotorPosition(0, midfootStiffness,
      //   midfootDamping)`。**双驱动是错的**，实测（tools/probe-midfoot.ts B/C 段）：
      //     · `driveMotors()` 遍历**全部**关节做位置环 PD，没有被动关节排除名单
      //       ⇒ 中足的 `motorTarget = 0` ⇒ 自研 PD 以 kP=48、τmax=60 N·m 把它拉向 0；
      //     · 同时 Rapier 那条弹簧也在往 0 拉。
      //   两个不同量纲的"刚度"（一个是 N·m/rad 的位置环，一个是 Rapier 马达的无量纲
      //   增益）叠在一起，柔性足等于被**焊死**，而所有外观指标都看起来正常。
      //   实测把 Rapier 弹簧关掉（`midfootStiffness: 0`）中足仍停在 14°，而
      //   `joints[MID].maxTorque[0] = 60` 与 30 N·m/rad 的标称值都对不上 ——
      //   证明 Rapier 的 `stiffness` 根本不是 N·m/rad。
      //
      //   ⇒ **统一到自研马达**（项目原则：马达与限位全部自实现，理由见文件头）。
      //     弓的刚度由 `midfootStiffness`（N·m/rad）显式给出，语义唯一、可扫参、可回读。
      //     位置伺服已经天然是弹簧：`τ = −kP·θ·τmax/ωmax − kD·θ̇·τmax/ωmax`
      //     ⇒ 等效刚度 = `kP·τmax/ωmax` = 48×60/9 ≈ **320 N·m/rad**，
      //     等效阻尼 = `kD·τmax/ωmax` = 1×60/9 ≈ 6.7 N·m·s/rad。
      //     要改弓的软硬就调 `midfootStiffness`（→ `jointGain`），不要动别的地方。
      this.joints.push(joint);
    });
  }

  /**
   * ★★★ **接触参数（研究用）** —— 读 Rapier 的 `integrationParameters`。
   *
   *   为什么需要它（2026-10-06，用户「先把这个链路打通」）：
   *   `probe-footpush` 实测**脚在共面接触块之间逐拍翻号**（内 509 N <-> 外 305 N），
   *   ⇒ 单脚 CoP 每 1/60 s 跳 ~180 mm ⇒ 对 CoM 的力矩 ±300 N·m 白噪声
   *   ⇒ 「脚发力带动全身倾斜」在**信息论上**就不可能。
   *
   *   机理假设：**共面刚性接触的载荷分配是静不定的** —— 由 LCP 求解器挑一个解，
   *   微小的数值差就翻面；若接触变软（`contact_natural_frequency` 降低），
   *   分配改由**穿透深度**（连续量）决定 ⇒ 应当稳定。
   */
  contactTuning(): { freq: number; erp: number; iters: number; small: boolean } {
    const ip = this.world.integrationParameters as unknown as Record<string, unknown>;
    const num = (k: string): number => (typeof ip[k] === 'number' ? (ip[k] as number) : Number.NaN);
    return {
      freq: num('contact_natural_frequency'),
      erp: num('contact_erp'),
      iters: num('numSolverIterations'),
      small: (this.smallSteps ?? false),
    };
  }

  /** 小步长 PGS 求解器开关（Rapier：堆叠接触更准，专治静不定分配） */
  private smallSteps = false;

  /** ★ 诊断：在原型链上找某个属性的**类型**（区分数据字段 / getter / 方法） */
  contactPropType(k: string): string {
    const ip = this.world.integrationParameters as unknown as Record<string, unknown>;
    return typeof ip[k];
  }

  /** 写接触参数（`undefined` = 不动那一项）。返回写入后的实况。 */
  setContactTuning(o: {
    freq?: number; erp?: number; iters?: number; small?: boolean; linearErr?: number;
  }): { freq: number; erp: number; iters: number; small: boolean } {
    const ip = this.world.integrationParameters as unknown as Record<string, unknown>;
    // ★★ 键名必须是 Rapier 的 **snake_case**（`probe-rocking` 枚举原型得到；
    //   写成 camelCase 会**静默无效** —— 实测 4 个 freq 配置逐位相同就是这么来的）。
    if (o.freq !== undefined) ip['contact_natural_frequency'] = o.freq;
    if (o.erp !== undefined) ip['contact_erp'] = o.erp;
    if (o.iters !== undefined) ip['numSolverIterations'] = o.iters;
    if (o.linearErr !== undefined) ip['normalizedAllowedLinearError'] = o.linearErr;
    if (o.small !== undefined) {
      this.smallSteps = o.small;
      const m = this.world.integrationParameters as unknown as Record<string, () => void>;
      if (o.small && typeof m['switchToSmallStepsPgsSolver'] === 'function') m['switchToSmallStepsPgsSolver']();
      else if (!o.small && typeof m['switchToStandardPgsSolver'] === 'function') m['switchToStandardPgsSolver']();
    }
    return this.contactTuning();
  }

  get jointCount(): number { return this.joints.length; }

  // ------------------------------------------------------------ 读状态

  /** 把刚体本地向量 v 转到世界，写入 out */
  /**
   * 关节 `i` 的第 `axis` 轴在世界系下的**单位方向**（写 out[0..2]）。
   *
   * 全链 QP 需要它把"关节力矩"翻译成"对地面的水平力"（附录 B.2 的等式 ①）：
   * `τ` 沿这个方向，力臂由 `jointWorld` 给。
   * ⚠ `toWorld` 是 private 且签名是**私有用法**（直接给三元组），
   *   这里包一层给外部用，避免 QP 去访问私有实现。
   */
  bodyWorldAxis(i: number, axis: 0 | 1 | 2, out: Float64Array = this.axisWorldTmp): Float64Array {
    const j = this.jointBodies[i * 2]!;                 // 父刚体
    const b = this.bodies[j]!;
    if (axis === 0) this.toWorld(b, 1, 0, 0, out);
    else if (axis === 1) this.toWorld(b, 0, 1, 0, out);
    else this.toWorld(b, 0, 0, 1, out);
    return out;
  }

  private readonly axisWorldTmp = new Float64Array(3);
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
  /**
   * ★★★ **真·压力中心（CoP）** —— 直接由接触冲量加权算出（重构方案 §14.5 F1/F2 的验收量）。
   *
   *     CoP = Σ(P_i · λ_i) / Σλ_i        λ_i = 该接触点的法向冲量
   *
   * 为什么要直接读，而不是像以前那样从 ΔCoM 反推：
   *   反推量的是"身体怎么动了"，混着惯量与耦合；直接读压力分布才是**足底发力**本身。
   *   并且它是判定"接触柔度有没有用"的唯一干净指标：
   *     刚性足 ⇒ CoP 被钉在接触面形心附近，踝怎么转都几乎不动；
   *     柔性足 ⇒ CoP 随踝力矩**连续移动**，且可能超过 `τ/(mg)` 的刚性上限。
   *
   * ★★★ 2026-10-04 修：**接触面筛选**从"世界竖直"改成"**该鞋底块自己的底面**"。
   *
   *   原来只判 `|n·y| ≥ 0.5`。但鞋底是**扁盒**，倾倒时它的**侧面**也会贴到地面，
   *   而侧面的法线在侧向 ⇒ `|n·y|` 可能仍然不小 ⇒ 侧面的接触点被算进 CoP。
   *   后果（实测）：`CoP_z` 读出 **391 mm**，而整只脚宽只有 **204 mm** ——
   *   物理上不可能，正是"侧面被当成底面"的证据。这类读数会让人误判
   *   "柔性足权限巨大"，其实测的是倾倒瞬态。
   *   ⇒ 第一版改成"法线与该块底面外法线对齐（|n·bottom| ≥ 0.7）"，**实测仍不够**：
   *     强制跖屈到 29° 时读出 CoP_z 相对脚掌 **70.1mm**，而所有鞋底块的
   *     z 跨度只有 ±50mm ⇒ 还是有侧面接触被算进来（29° 倾角下侧面法线
   *     与底面法线夹角仍可能 < 45°）。
   *   ⇒ 改成**直接验证接触点落在这块底面的矩形范围内**：把接触点变换到
   *     该刚体局部系，要求 `|x| ≤ hx+ε` 且 `|z| ≤ hz+ε`（y 不判，因为
   *     接触点就在面上）。这与"底面"是几何等价定义，没有夹角可漏。
   *
   * @param side 0=左 1=右
   * @param out  写入 [copX, copY, copZ, Σλ]（世界系；无接触时 Σλ=0）
   */
  readCoP(side: 0 | 1, out: Float64Array): void {
    out[0] = out[1] = out[2] = out[3] = 0;
    // ★ 遍历**全部**鞋底 collider（脚跟 + 前脚掌 / 内侧弓 / 跖骨 / 趾）。
    let sx = 0, sy = 0, sz = 0, sl = 0;
    const cols = this.soleCols[side];
    const bb = this.soleBB; this.footSoleBounds(side, bb);
    const EPS = 2e-3;
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci] as RAPIER.Collider;
      const bi = this.soleColBody[side]![ci];
      if (bi === undefined) continue;
      this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
        this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
          // ① 法线与该块底面外法线对齐
          this.soleNormalAligned(bi, mf.normal());
          if (this.soleAl < SOLE_NORMAL_TOL) return;
          const n = mf.numSolverContacts();
          for (let i = 0; i < n; i++) {
            const l = Math.abs(mf.contactImpulse(i));
            if (!(l > 0)) continue;
            const p = mf.solverContactPoint(i);
            // ② 落在该脚世界系鞋底包围盒内
            if (p.x < bb[0]! - EPS || p.x > bb[1]! + EPS
              || p.z < bb[2]! - EPS || p.z > bb[3]! + EPS) continue;
            sx += p.x * l; sy += p.y * l; sz += p.z * l; sl += l;
          }
        });
      });
    }
    if (sl > 0) { out[0] = sx / sl; out[1] = sy / sl; out[2] = sz / sl; }
    out[3] = sl;
  }

  /**
   * ★★ **鞋底逐柱法向载荷**：内侧柱 / 外侧柱各承担多少（N·s/拍，除 120 即 N）。
   *
   * 柔性足 F1 真正提供的机制**不是**"CoP 能跑多远"，而是
   * 「**载荷能在内/外侧柱之间连续转移**」（文献：内侧弓/外侧柱是两条独立载荷路径；
   *  Jeon & Cho 压力垫综述 / Welte 2023 内侧弓）。
   * 骨架注释里记的失败模式正是这个：
   *     「内侧柱 Σ 162.8N / 外侧柱 Σ 14.2N（比值 **14:1**），CoP_z 只动 **0.9mm**」
   *   —— 只切 collider 不给中足自由度时，两柱载荷严重失衡，CoP 动不了。
   *
   * ⇒ 这个比值就是判据本身：比值从 14:1 收敛到 ~1:1 ⇒ 前足真的在"分配载荷"。
   *   柱归属用**接触点在所属刚体局部系里的 z 符号**（+Z 为内侧，见 `offColIn`）。
   *
   * @param out 写入 [内侧柱Σλ, 外侧柱Σλ]（单位 N·s，按 120Hz 换算成 N 要 ×120）
   */
  soleColumnLoad(side: 0 | 1, out: Float64Array): void {
    const tmp = this.footTmp;
    const cols = this.soleCols[side];
    const bb = this.soleBB; this.footSoleBounds(side, bb);
    const bbMidZ = (bb[2]! + bb[3]!) / 2;
    for (let i = 0; i < out.length; i++) out[i] = 0;
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci] as RAPIER.Collider;
      const bi = this.soleColBody[side]![ci];
      if (bi === undefined) continue;
      const body = this.bodies[bi]!;
      const q = body.rotation();
      // ★ 用**刚体内下标**取定义，不能用全脚下标 `ci`（弓的两块会取到 undefined）。
      const cd = this.sk.bodies[bi]!.colliders[this.soleColLocalIdx[side][ci] ?? ci];
      // ⚠ `continue` 不是 `return`：一个索引取不到定义不应该把**后面所有块**一起中断。
      if (!cd) continue;
      const cdOx = cd.offsetX ?? 0;
      this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
        this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
          const n = mf.numSolverContacts();
          for (let i = 0; i < n; i++) {
            const l = Math.abs(mf.contactImpulse(i));
            if (!(l > 0)) continue;
            const p = mf.solverContactPoint(i);
            // ★ 同理：用接触法向判断、不用 XZ 包围盒（见 `soleBlockLoad` 里的同样注释）。
            if (Math.abs(mf.normal().y) < 0.5) continue;
            if (p.z >= bbMidZ) out[0] += l; else out[1] += l;
          }
        });
      });
    }
  }

  /**
   * ★★ **摩擦占用**：鞋底切向冲量合计 / 法向冲量合计。
   *
   * 判读（这是"打滑"和"只是重心在动"的唯一分界）：
   *   `|Σf_t| / (μ·Σf_n) ≈ 1` ⇒ 摩擦**饱和**，脚正在被拖着走（真打滑）
   *   远小于 1            ⇒ 摩擦没用满，位移来自别的原因
   *                            （通常是**绕棱转动** rocking：刚体中心几乎不动，
   *                              但接触点在扫——`soleCoPLocal` 能看出来）
   *
   * @param out 写入 [Σ|f_t|, Σf_n]（单位 N·s，按 120Hz 换算成 N 要 ×120）
   */
  soleFrictionUse(side: 0 | 1, out: Float64Array): void {
    let ft = 0, fn = 0;
    const cols = this.soleCols[side];
    const bb = this.soleBB; this.footSoleBounds(side, bb);
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci] as RAPIER.Collider;
      const bi = this.soleColBody[side]![ci];
      if (bi === undefined) continue;
      const cd = this.sk.bodies[bi]!.colliders[ci];
      if (!cd) continue;
      const q = this.bodies[bi]!.rotation();
      const cdOx = cd.offsetX ?? 0;
      const EPS = 2e-3;
      this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
        this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
          const n = mf.numSolverContacts();
          for (let i = 0; i < n; i++) {
            const p = mf.solverContactPoint(i);
            if (p.x < bb[0]! - EPS || p.x > bb[1]! + EPS || p.z < bb[2]! - EPS || p.z > bb[3]! + EPS) continue;
            // ⚠ `contactTangentImpulseX/Y` 在某些接触上返回 **NaN**
            //   （实测：站立期恒 NaN ⇒ 摩擦占用指标一直是坏的，"占用 0%"是假象）
            const tx = mf.contactTangentImpulseX(i), ty = mf.contactTangentImpulseY(i);
            if (Number.isFinite(tx) || Number.isFinite(ty)) {
              ft += Math.hypot(tx || 0, ty || 0);
            }
            fn += Math.abs(mf.contactImpulse(i));
          }
        });
      });
    }
    out[0] = ft; out[1] = fn;
  }

  /**
   * ★★ 鞋底 **CoP 的世界坐标**（写入 out[0..2]）+ Σλ（out[3]）。
   *
   * ⚠ 2026-10-04：函数名还叫 `soleCoPLocal`，但**已改成返回世界坐标**。
   *   原本想返回"脚刚体局部系"，实测不可靠 —— 脚掌有外八偏航 ~25°，
   *   而刚体局部系算出来不可信（见 `soleNormalAligned` 上面的踩坑说明）。
   *   需要"沿足长/内外"的语义时，用**块的 `_label` + `footSoleBounds`** 表达，
   *   不要依赖这个局部系。名字保留是为了少动调用点。
   *
   * 为什么要有局部系版本：`soleXZ` / `footSoleBounds` 给的是世界量，而脚有
   * **外八偏航（~25°）**，世界 x/z 和"脚的前后/内外"不是一回事。
   * 局部系里 `x` = 沿足长（−跟 … +趾）、`z` = 内(+)/外(−)，语义直接可比。
   * 用它区分两种"位移"：
   *   · 局部 CoP 基本不动、刚体原点却在走 ⇒ **摩擦打滑**（压力点被拖着走）
   *   · 局部 CoP 在鞋底上扫、刚体原点不动   ⇒ **绕棱 rocking**（不是打滑）
   */
  soleCoPLocal(side: 0 | 1, out: Float64Array): void {
    out[0] = out[1] = out[2] = out[3] = 0;
    let sx = 0, sy = 0, sz = 0, sl = 0;
    // 以该侧**第一个**鞋底 collider 所属刚体的局部系为参照（同属一只脚）
    const bi0 = this.soleColBody[side]![0];
    if (bi0 === undefined) return;
    const q0 = this.bodies[bi0]!.rotation();
    const cols = this.soleCols[side];
    const bb = this.soleBB; this.footSoleBounds(side, bb);
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci] as RAPIER.Collider;
      const bi = this.soleColBody[side]![ci];
      if (bi === undefined) continue;
      const cd = this.sk.bodies[bi]!.colliders[ci];
      if (!cd) continue;
      const q = this.bodies[bi]!.rotation();
      const cdOx = cd.offsetX ?? 0;
      const EPS = 2e-3;
      this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
        this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
          this.soleNormalAligned(bi, mf.normal());
          if (this.soleAl < SOLE_NORMAL_TOL) return;
          const n = mf.numSolverContacts();
          for (let i = 0; i < n; i++) {
            const l = Math.abs(mf.contactImpulse(i));
            if (!(l > 0)) continue;
            const p = mf.solverContactPoint(i);
            if (p.x < bb[0]! - EPS || p.x > bb[1]! + EPS || p.z < bb[2]! - EPS || p.z > bb[3]! + EPS) continue;
            sx += p.x * l; sy += p.y * l; sz += p.z * l; sl += l;
          }
        });
      });
    }
    if (sl > 0) { out[0] = sx / sl; out[1] = sy / sl; out[2] = sz / sl; }
    out[3] = sl;
  }

  /** 某刚体的世界原点（诊断"刚体平移 vs 绕棱转动"用；不存在返回 false） */
  bodyOrigin(key: string, out: Float64Array): boolean {
    const i = this.indexByKey.get(key);
    if (i === undefined) return false;
    const t = this.bodies[i]!.translation();
    out[0] = t.x; out[1] = t.y; out[2] = t.z;
    return true;
  }

  /**
   * ★ 诊断：数接触点。out = [manifold 总接触数, 通过底面过滤的接触数, Σf_n]
   *   用来区分"接触本来就少"和"被我的底面过滤丢掉了"。
   */
  soleContactAudit(side: 0 | 1, out: Float64Array): void {
    out[0] = 0; out[1] = 0; out[2] = 0;
    const cols = this.soleCols[side];
    const bb = this.soleBB; this.footSoleBounds(side, bb);
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci] as RAPIER.Collider;
      const bi = this.soleColBody[side]![ci];
      if (bi === undefined) continue;
      const cd = this.sk.bodies[bi]!.colliders[ci];
      if (!cd) continue;
      const q = this.bodies[bi]!.rotation();
      const cdOx = cd.offsetX ?? 0;
      const EPS = 2e-3;
      this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
        this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
          const n = mf.numSolverContacts();
          for (let i = 0; i < n; i++) {
            out[0]++;
            const p = mf.solverContactPoint(i);
            if (p.x < bb[0]! - EPS || p.x > bb[1]! + EPS || p.z < bb[2]! - EPS || p.z > bb[3]! + EPS) continue;
            out[1]++;
            out[2] += Math.abs(mf.contactImpulse(i));
          }
        });
      });
    }
  }

  /**
   * ★★ 鞋底接触的**权威判据**（frame-independent，两个条件都要满足）：
   *   ① 接触法线与该鞋底块所在刚体的**底面外法线**对齐：`|n·axisW| ≥ soleNormalTol`
   *   ② 接触点落在该脚的**世界系鞋底包围盒**内（`footSoleBounds`，已实测正确）
   *
   * ★★ 为什么**不能**用局部系判"接触点是否在底面矩形内"（2026-10-04 实测踩坑）：
   *   我先写了局部系版本（`|local.x − offsetX| ≤ hx` 且 `|local.z − offsetZ| ≤ hz`），
   *   看着最精确，结果 **16 个接触点只放过 2 个**、Σf_n 只有静止值的 11%。
   *   逐点 dump 显示局部 z 读出 **−29 ~ −128 mm**（应 ±50 mm）。
   *   根因：脚掌有**外八偏航 `restYaw ≈ 25°`**，而 `restTiltRad = 0`（脚保持水平）
   *   ⇒ **y 分量对不对完全检验不出旋转对不对**（偏航绕 Y、不动 y）。
   *   我当时就是被"y = −68.6mm 正好等于鞋底平面"骗过去的 —— y 对 ≠ 局部系对。
   *   ⇒ 改用①+②：都与局部系无关，也不需要反旋转。
   */
  /** ① 法线是否与该块底面外法线对齐 */
  private soleNormalAligned(bi: number, n: { x: number; y: number; z: number }): void {
    const q = this.bodies[bi]!.rotation();
    quatRotate(q.x, q.y, q.z, q.w, 0, -1, 0, this.soleAxisW);
    this.soleAl = Math.abs(n.x * this.soleAxisW[0] + n.y * this.soleAxisW[1] + n.z * this.soleAxisW[2]);
  }
  private readonly soleAxisW = new Float64Array(3);
  private soleAl = 0;
  /** 各鞋底读回函数共用的"世界系鞋底包围盒"缓冲 */
  private readonly soleBB = new Float64Array(4);

  /**
   * 世界点 → 刚体局部系。**必须先减掉刚体平移**再反旋转。
   *
   * ★★ 2026-10-04 修一个我自己写错的 bug：此前各处都写成
   *   `quatRotate(-q…, p.x, p.y, p.z, out)` —— 漏了 `− translation`。
   *   后果实测（tools/probe-midfoot.ts L 段）：脚掌本体在 z = 0.164 m、
   *   局部 z 只该在 ±50 mm 内，却读出 **56~281 mm** ⇒ 底面过滤把
   *   **16 个接触点里的 15 个**误判为"不在底面"⇒ CoP 只剩 1 个接触点、
   *   Σ|λ| 只有体重的 4%（静止应 5.72 N·s）、压力点被钉死在足跟角上。
   *   ⇒ 凡是"压力点钉住不动""载荷只有几个百分点"这类异常，先查这个。
   */
  toLocal(bodyIdx: number, wx: number, wy: number, wz: number, out: Float64Array): void {
    const b = this.bodies[bodyIdx]!;
    const t = b.translation();
    const q = b.rotation();
    quatRotate(-q.x, -q.y, -q.z, -q.w, wx - t.x, wy - t.y, wz - t.z, out);
  }

  /**
   * ★ 诊断：把某侧鞋底**所有**接触点的局部坐标与所属块的范围全部列出。
   *   实测发现底面过滤把 16 个接触点里的 15 个丢掉了（只剩 1 个），
   *   所以必须看原始数据才能定位是"过滤写错了"还是"接触点坐标不对"。
   * @param cb 每行一个：`块名 x z |lx-cd.offsetX| hx |lz-cd.offsetZ| hz 判定`
   */
  soleContactDump(side: 0 | 1, cb: (line: string) => void): void {
    const cols = this.soleCols[side];
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci] as RAPIER.Collider;
      const bi = this.soleColBody[side]![ci];
      if (bi === undefined) continue;
      const cd = this.sk.bodies[bi]!.colliders[ci];
      if (!cd) continue;
      const lb = ((cd as unknown as { _label?: string })._label) ?? `#${ci}`;
      const q = this.bodies[bi]!.rotation();
      const tr = this.bodies[bi]!.translation();
      const cdOx = cd.offsetX ?? 0;
      this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
        this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
          const n = mf.numSolverContacts();
          for (let i = 0; i < n; i++) {
            const p = mf.solverContactPoint(i);
            this.toLocal(bi, p.x, p.y, p.z, this.footTmp);
            const t = this.footTmp;
            const dx = Math.abs(t[0]! - cdOx), dz = Math.abs(t[2]! - cd.offsetZ);
            const ok = dx <= cd.hx + 2e-3 && dz <= cd.hz + 2e-3;
            cb(`     ${lb.padEnd(12)} 本体(${tr.x.toFixed(3)},${tr.y.toFixed(3)},${tr.z.toFixed(3)})`
              + ` 局部(${(t[0]! * 1000).toFixed(0)},${(t[1]! * 1000).toFixed(0)},${(t[2]! * 1000).toFixed(0)})mm`
              + `  Δx${(dx * 1000).toFixed(0)}/${(cd.hx * 1000).toFixed(0)}`
              + ` Δz${(dz * 1000).toFixed(0)}/${(cd.hz * 1000).toFixed(0)}  ${ok ? '✓' : '✗'}`);
          }
        });
      });
    }
  }

  /** 该侧鞋底的有效摩擦系数（Rapier 默认 Average 合成规则） */
  soleFriction(side: 0 | 1): number {
    const bi = this.soleColBody[side]![0];
    const col = bi !== undefined ? this.soleCols[side][0] : undefined;
    if (!col) return 0;
    return ((col as unknown as { friction(): number }).friction()
      + this.opt.groundFriction) / 2;
  }

  /**
   * ★★ **逐块鞋底法向载荷**（`out[i]` = 第 i 块鞋底 collider 的 Σ|λ|）。
   *
   * 真实人脚形状的鞋底是 6 块（`skeleton.buildSoleBlocks`）：
   *   足跟 / 外侧柱 / 内侧弓·后 / 内侧弓·前 / 跖骨头 / 趾
   *   其中**内侧弓两块天生离地 `archRise = 22 mm`**（`buildSoleBlocks` 的注释与依据：
   *   Jeon & Cho 压力垫综述 / Welte 2023 —— 内侧弓是独立载荷路径，把重量传到足的外侧缘）。
   *
   * ⇒ 这 6 个数直接回答"侧向载荷到底走哪条路"：
   *     重心压到支撑腿内侧 ⇒ 内侧弓应该**接近 0**（它离地），
   *     外侧柱 / 跖骨头承重 ⇒ **侧向 CoP 权限就是这么来的**（不需要中足关节）。
   *   块的名字在 `skeleton` 里以 `_label` 挂在 collider 上（运行时可读，仅供诊断/UI）。
   *
   * @param out 长度 ≥ 该侧鞋底 collider 数的 `Float64Array`（复用缓冲，零分配）
   */
  soleBlockLoad(side: 0 | 1, out: Float64Array): void {
    const cols = this.soleCols[side];
    for (let i = 0; i < out.length; i++) out[i] = 0;
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci] as RAPIER.Collider;
      // ★★ 三个索引误区，全部会静默读出错值（“弓承重 0%”就是这么来的）：
      //   1. collider 定义要取所属**刚体自己**的下标 `soleColLocalIdx[side][ci]`，
      //      不能用全脚下标 `ci`（弓的两块会取到 undefined）。
      //   2. 取不到定义必须 `continue`，不能 `return` —— `return` 会把**后面所有块**一起中断。
      //   3. 不用 **XZ 包围盒**过滤：它会静默丢掉真实载荷（实测并排读数：
      //        直读λ = [0.885, 0.866, **0.357**, 0, **0.016**, 0]
      //        经过包围盒 = [0.885, 0.866, **0.000**, 0, **0.000**, 0]）。
      //      只认「从上方压下来的接触」（|n·y| ≥ 0.5）才是鞋底承重。
      const bi = this.soleColBody[side]![ci];
      if (bi === undefined) continue;
      const cd = this.sk.bodies[bi]!.colliders[this.soleColLocalIdx[side][ci] ?? ci];
      if (!cd) continue;
      this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
        this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
          const n = mf.numSolverContacts();
          for (let i = 0; i < n; i++) {
            const l = Math.abs(mf.contactImpulse(i));
            if (!(l > 0)) continue;
            if (Math.abs(mf.normal().y) < 0.5) continue;
            out[ci] += l;
          }
        });
      });
    }
  }

/** 该侧鞋底 collider 的块名（诊断/UI 用；`skeleton` 挂在 collider 上的 `_label`） */
soleBlockLabels(side: 0 | 1): string[] {
    const out: string[] = [];
    for (let ci = 0; ci < this.soleCols[side].length; ci++) {
      const bi = this.soleColBody[side]![ci];
      // ★ 用**刚体内下标**（同 `soleBlockLoad`），否则弓的两块取不到标签、退化成 `#4`/`#5`。
      const c = bi !== undefined
        ? this.sk.bodies[bi]!.colliders[this.soleColLocalIdx[side][ci] ?? ci]
        : undefined;
      out.push(((c as unknown as { _label?: string } | undefined)?._label) ?? `#${ci}`);
    }
    return out;
  }

  /**
   * ★ 该侧**鞋底在世界系**的轴对齐包围盒 `[minX, maxX, minZ, maxZ]`（m）。
   *
   * 为什么要它：脚掌有**外八偏航**（`restYawRad`，实测约 25°），
   * 于是"刚体局部 x"会经 `sinψ` 混进**世界 z**。拿 CoP 的世界 z 去和
   * "刚体轴"比会得到假误差（实测局部 z=0 的跟块接触点，世界 z 偏 59mm）。
   * ⇒ 任何"CoP 有没有超出鞋底"的判据都必须用**世界系鞋底包围盒**做参照。
   */
  footSoleBounds(side: 0 | 1, out: Float64Array): void {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const t = this.footTmp;
    for (let ci = 0; ci < this.soleCols[side].length; ci++) {
      const bi = this.soleColBody[side]![ci];
      if (bi === undefined) continue;
      const cd = this.sk.bodies[bi]!.colliders[ci];
      if (!cd) continue;
      const body = this.bodies[bi]!;
      const q = body.rotation();
      const tr = body.translation();
      const ox = cd.offsetX ?? 0;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        quatRotate(q.x, q.y, q.z, q.w, ox + sx * cd.hx, cd.offsetY - cd.hy, cd.offsetZ + sz * cd.hz, t);
        const wx = t[0]! + tr.x, wz = t[2]! + tr.z;
        if (wx < x0) x0 = wx; if (wx > x1) x1 = wx;
        if (wz < z0) z0 = wz; if (wz > z1) z1 = wz;
      }
    }
    out[0] = x0; out[1] = x1; out[2] = z0; out[3] = z1;
  }

  /** 只取竖向分量是否受力（比 footGrounded 更严：必须有正冲量） */
  footLoaded(side: 0 | 1): boolean {
    this.readCoP(side, this.copTmp);
    return this.copTmp[3]! > 0;
  }

  private readonly ankleJoint: number;
  private readonly ankleJointR: number;
  private readonly footAuthUsed: Float32Array;
  /** 实际采用的接地惯量放大倍数（诊断：扫参时看它） */
  readonly ankleGroundFactorUsed: Float32Array;
  // ── 直接力矩通道（τ = JᵀF 的产物）─────────────────────────────
  /**
   * ★ 与 `motorTarget`（归一化目标角）**完全分开**的一条通道。
   *   位置环算的是 `τ = kP·(θ_ref−θ)·τmax/ωmax` —— 反馈量；
   *   这里放的是由 `τ = JᵀF` 直接算出的**前馈力矩**，单位 N·m。
   *   两者相加后再按 τmax 饱和。
   */
  private readonly torqueCmd: Float32Array;
  /** 让位掩码（1=balance 让位、2=step 让位、0=正常位置伺服） */
  private readonly holdCmd: number[] = [];
  /**
   * ★★ **载荷依赖的姿势张力**（每轴缩放系数，默认 1）。
   *
   * 位置伺服原来只有固定 `kP=48`：它把每个关节当"刹车"，锁在绑定姿态，
   * **对载荷毫无反应**。后果（逐帧实测，锁定承诺修好之后）：
   *   · `spine1/0` 目标 −2.7°（=腰 8° / 三段均分），**实际被扭到 −35°**
   *     ⇒ 位置伺服被打输，躯干在转移过程中先塌；
   *   · `hip/0` 力矩**全程饱和在 −120 = τmax**，没有任何调节余量。
   *
   * 文献依据（**载荷依赖的姿势张力**）：
   *   · **Horak & Nashner 1986**：CoP 向哪只脚移动，那条腿的肌张力就上升
   *     —— 这是"支撑面约束 /腿部僵化"的经典表述；
   *   · **J Ab 2021 单侧负重步行**（PMC8628027）：承重侧 GMED 激活 **+58%**、
   *     TFL **+65%**，而**非承重侧无变化**（p≥0.790）⇒ 张力是**按腿不对称**调节的，
   *     而且由载荷驱动；
   *   * 姿势张力的经典表述（referent configuration）：肌张力随支撑负荷连续变化。
   *
   * 机制：位置环增益按该关节所属腿的**载荷份额**放大
   *   `kP_eff = kP · toneScale`，`kD_eff = kD · toneScale`。
   * 由 balance 每拍写（它掌握 `loadFrac` 与锁定腿），这里只负责施加。
   */
  readonly toneScale: number[] = [];   // ★ 2026-10-06 供 probe-waist 回读（只读）
  /** 本拍生效的姿势张力（balance 每拍写；未写则保持上一拍 ⇒ 必须有复位） */
  setToneScale(joint: number, axis: number, scale: number): void {
    const i = joint * 3 + axis;
    if (i >= 0 && i < this.toneScale.length) this.toneScale[i] = scale > 0 ? scale : 0.01;
  }
  /** 复位到 1（每拍开头调；漏调会把上一拍的增益带进这一拍） */
  resetToneScale(): void {
    for (let i = 0; i < this.toneScale.length; i++) this.toneScale[i] = 1;
  }
  /** `jacobianTorque` 的临时向量（避免每关节分配） */
  private readonly jw = new Float64Array(3);
  private readonly ja = new Float64Array(3);
  /** 本拍由 `jacobianTorque` 写入的、供诊断/回读的力矩（N·m） */
  readonly tauApplied: Float32Array;
  /**
   * ★★★ **逐轴"走了哪条分支"**（用户 2026-10-06：「逐帧回读关节发力情况」）。
   *   0=未算（被 motorDriven 跳过/limp）｜1=正常 PD｜2=让位（只阻尼）｜3=越上限｜4=越下限
   *   （5=越界回程）。为什么必须记账：实测开局"命令≈0、角度≈0、角速度却恒定加速
   *   （≈2000°/s²）"⇒ 只有**限位分支**能在无命令时注入速度，但它此前完全不可见。
   */
  readonly motorBranch: Uint8Array;
  /** ★ 本步该轴的**参考角**（`thRef`，rad；能让"目标 vs 实际"同帧对照） */
  readonly motorThRef: Float32Array;
  /** ★ 本步该轴的**误差项**（`err`，rad/s 量纲；限位分支会≥0 一大截） */
  readonly motorErr: Float32Array;
  /**
   * ★★★ **τ 分量分解**（用户「逐帧回读关节发力情况」的落地）。
   *   为什么必须拆：实测开局第 0 拍，`hip_l` 在 **命令≈0** 的情况下拿到 **29~34°/s**，
   *   而它**不随伺服增益变**（`JMS_SCALE` 1→6 只降 15%）⇒ 用整轴 `tauApplied` 看不出
   *   是**哪个分量**给的。三者单位都是 rad/s（乘 `tauMax/(JMS·JMS_SCALE)` 才是 N·m）。
   */
  readonly motorErrP: Float32Array;   // 弹簧（位置）分量 `kp·ts·(thRef−a)`
  readonly motorErrD: Float32Array;   // 阻尼（速度）分量 `−kd·ts·relL`
  /** ★ V4-1 平衡点跟随：逐轴 LPF(实际角) 状态 */
  eqLPF = new Float64Array(0);
  /** ★★★★★ 2026-10-06 **V4 校准（V4CAL）状态**：
   *   起立期照常（V3）；t=TCAL 时一次性快照——
   *     `v4ThRef[idx] = thRef`（平衡点锁定到当时实况姿态 = 物理找出的对齐基线）
   *     `v4FF[idx] = kpUse·ts·(thRef−a)`（当时的 P 出力 = 静姿支撑 τ，转成 FF）
   *   之后：`dRefUse = v4ThRef − a`（围绕锁定姿态的**小弹簧**）+ `err += v4FF`。
   *   ⇒ 支撑由 FF 承担 ⇒ K 可降（`V4KP`）⇒ 环路增益低 ⇒ chatter 源消失。 */
  v4ThRef = new Float64Array(0);
  v4FF = new Float64Array(0);
  private v4CalDone = false;
  private v4Locked = new Uint8Array(0);
  /** ★★★★★ GRAVTAU：每个关节轴的重力矩 FF（几何法，见 computeGravityTau） */
  private gravSub: number[][] | null = null;   // 关节 → 子树刚体索引列表
  private gravFFCache = new Float64Array(0);
  private gravRoot: number[] = [];             // 各刚体的父关节（构建子树用）
  /** 极性保驰：每轴当前符号与上次翻号时刻 */
  private signState = new Int8Array(0);
  private signT = new Float64Array(0);
  private clock = 0;
  /** ★★★★★ 2026-10-06 **V4 第一块砖：积分项状态**（重力支撑的载体）
   *   经典 PI 控制：P-only 有稳态误差（= 我们实测的"静姿 sag 2~5°"），
   *   I 项累积出**稳态负载力矩**（≈ 重力矩），从而 P 可以降到生理值。
   *   与 P-only+K48 的区别：K48 是"把 sag 放大 48 倍成支撑"（放大误差换力），
   *   I 是"把误差**积掉**成支撑"（不放大误差）。 */
  motorInt = new Float64Array(0);
  readonly motorTauFF: Float32Array;  // 力矩通道（τ=JᵀF / 踝 VIP / 髋外展…）

  /**
   * 该关节的**子侧是否有脚承重** ⇒ 是则用被地面约束放大的等效惯量。
   * 只需查踝（唯一直接连脚的身体），向上传递由调用方按关节链判断。
   */
  private footLoadedFlag(joint: number): boolean {
    void joint;
    this.readCoP(0, this.copTmp);
    const gl = this.copTmp[3]! > 0;
    this.readCoP(1, this.copTmp);
    const gr = this.copTmp[3]! > 0;
    this.footLoadedCache = { l: gl, r: gr };
    return gl || gr;
  }
  /** 两侧脚的承重缓存（由 `footLoadedFlag` 刷新） */
  private footLoadedCache = { l: false, r: false };

  footGrounded(side: 0 | 1): boolean {
    // ★ 遍历**全部**鞋底 collider。任一块有接触就算着地。
    //   单数版只读一块 ⇒ 前脚掌离地、脚跟仍着地时会被误判成"整只脚离地"
    //   （那会让腾空时间与单脚支撑判定提前触发）。
    let hit = false;
    for (const col of this.soleCols[side]) {
      this.world.contactPairsWith(col as RAPIER.Collider, (other: RAPIER.Collider) => {
        this.world.contactPair(col as RAPIER.Collider, other, (mf: RAPIER.TempContactManifold) => {
          if (mf.numContacts() === 0) return;
          const ny = mf.normal().y;
          if (ny > 0.5 || ny < -0.5) hit = true;
        });
      });
      if (hit) return true;
    }
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
    // ★★★ 2026-10-06 修（`probe:sagchain` 顺带查出）：**`dt = 0` 会让本函数恒返回 NaN**。
    //
    //   机理：下面算的是 `f += |impulse| / dt`。调用方 `posture.ts:209` 传的是
    //   `doll.footLoadFrac(0)`（把一个**布尔式的 0** 当 dt 传进来了），于是
    //     · 有接触 ⇒ `fl = fr = Infinity` ⇒ `sum = Infinity` ⇒ `fl/sum = NaN`
    //     · `posture.ts` 拿到 `NaN` ⇒ `Number.isFinite(sum)` 为假
    //       ⇒ 走**未加权平均**的兜底分支
    //   ⇒ 那段"按载荷加权"的修复（`posture.ts:191-207` 注释，明确写着这是
    //     「单腿交接永远不启动」的结构性原因）被这一行调用**整体废掉**。
    //
    //   修法：`dt` 非正时**退回本机自己的物理步长**（`driveMotors` 每拍更新），
    //   再兜底 1/120。⇒ 调用方再传 0 也不会坏（旧调用点保持兼容）。
    const dStep = dt > 1e-9 ? dt : (this.physicsDt > 1e-9 ? this.physicsDt : 1 / 120);
    // ★★★ 2026-10-06 修（实测 `tools/dbg-grip`）：原来读 `this.soleCol[side]`
    //   —— **单个** collider，而每只脚有 **7 个**鞋底 collider
    //   （`soleCols[0].length = 7`：foot 4 + arch 2 + mfoot 1）。
    //   `soleCol` 是 `ragdoll.ts:882` 的 `??= col`，即**只拿到第一块**。
    //   ⇒ 法向力漏掉 **6/7** ⇒ `sum` 常为 0 ⇒ 走 `sum > 1e-6` 的兜底
    //      ⇒ 返回 `[0.5, 0.5]`。
    //
    //   ★ 后果链（这就是「为什么右腿是承重腿」的机制）：
    //       `footLoadFrac` 恒 0.5/0.5 → `controller.ts:97` 的 `loadFrac` 恒 0.5/0.5
    //       → `supportLeg()` 里 `loadDominant()` 的迟滞**永远不换边**（差值恒 0）
    //       → 支撑腿永远停在初值 `'l'`
    //       而 `readCoP` 实测右脚承重 357.7 N、左脚 0
    //       ⇒ **物理承重腿 = 右，系统判定 = 左** ⇒ 右腿该支撑时被当摆动腿抬起来。
    //
    //   ⇒ 与 `readCoP`（ragdoll.ts:1313 已正确遍历 `soleCols`）对齐。
    const sumOne = (side: 0 | 1): number => {
      const cols = this.soleCols[side];
      let f = 0;
      for (let ci = 0; ci < cols.length; ci++) {
        const col = cols[ci] as RAPIER.Collider;
        this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
          this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
            if (mf.numContacts() === 0) return;
            // ★ 不要按法向过滤：自碰撞是关的（GROUPS_SELF 只和地面碰），
            //   鞋底上的接触对**只可能**是地面，加上 |n_y|>0.5 的过滤反而把
            //   全部接触滤掉（实测载荷恒为 0 ⇒ 份额永远是 0.5/0.5）。
            for (let k = 0; k < mf.numContacts(); k++) f += Math.abs(mf.contactImpulse(k)) / dStep;
          });
        });
      }
      return f;
    };
    const fl = sumOne(0), fr = sumOne(1);
    const sum = fl + fr;
    return sum > 1e-6 ? [fl / sum, fr / sum] : [0.5, 0.5];
  }

  /**
   * ★★★ 力链 L0/L1：**逐块法向力 + 该脚 CoP**（`架构_v2_三模块协作.md` §20.2）。
   *
   *   与 `readCoP` **同一套取法**，保证不会出现"两个 CoP"：
   *     · `numSolverContacts()` 只含**真正的求解接触**，预测性接触不算 ——
   *       这正是旧代码「有接触但冲量为 0」的来源（旧代码用 `numContacts()`）；
   *     · `solverContactPoint()` 给**世界坐标**，不再用局部坐标 + 锚点近似；
   *     · 法线对齐 + 鞋底包围盒过滤，与 `readCoP` 一致。
   *
   *   ★ `copValid=false` 时**所有数值返回 0**，绝不返回 `[0.5, 0.5]` 之类的兜底：
   *     "有接触、没载荷"这种自相矛盾的状态必须**显式暴露**，
   *     否则上层会把假值当真实载荷去控（旧 `footLoadFrac` 的坑）。
   */
  soleForceProfile(side: 0 | 1, dt: number): FootForce {
    const cols = this.soleCols[side];
    const bb = this.soleBB; this.footSoleBounds(side, bb);
    const bbMidZ = (bb[2]! + bb[3]!) / 2;   // ★ 与 `soleColumnLoad` 同一分组界线
    const EPS = 2e-3;
    const patches: SolePatch[] = [];
    let fz = 0, sx = 0, sz = 0, contactN = 0;
    let colIn = 0, colOut = 0;      // 内 / 外侧柱法向合力（N）
    let ft = 0;                     // 切向幅值合计（N）
    let tangentValid = false;
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci] as RAPIER.Collider;
      const bi = this.soleColBody[side]![ci];
      if (bi === undefined) continue;
      let bfz = 0, bsum = 0, bpx = 0, bpz = 0, bt = 0;
      this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
        this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
          this.soleNormalAligned(bi, mf.normal());
          if (this.soleAl < SOLE_NORMAL_TOL) return;
          const n = mf.numSolverContacts();
          for (let i = 0; i < n; i++) {
            const l = Math.abs(mf.contactImpulse(i));
            if (!(l > 0)) continue;
            const p = mf.solverContactPoint(i);
            if (p.x < bb[0]! - EPS || p.x > bb[1]! + EPS
              || p.z < bb[2]! - EPS || p.z > bb[3]! + EPS) continue;
            const f = l / dt;
            bfz += f; bsum += l; bpx += p.x * l; bpz += p.z * l;
            // ★ 内外侧柱：与 `soleColumnLoad` 同一规则（z ≥ 中位 = 内侧）
            if (p.z >= bbMidZ) colIn += f; else colOut += f;
            // ★ 切向幅值：`contactTangentImpulseX/Y` 在部分接触上返回 NaN
            //   （`soleFrictionUse` 已记录该问题）⇒ 只有有限值才算有效
            const tx = mf.contactTangentImpulseX(i), ty = mf.contactTangentImpulseY(i);
            if (Number.isFinite(tx) || Number.isFinite(ty)) {
              tangentValid = true;
              const tm = Math.hypot(tx || 0, ty || 0) / dt;
              bt += tm; ft += tm;
            }
          }
        });
      });
      if (bfz > 1e-6) {
        contactN++;
        fz += bfz; sx += bpx; sz += bpz;
        patches.push({ block: ci, ny: bfz, t: bt, cx: bpx / bsum, cz: bpz / bsum });
      }
    }
    const valid = contactN > 0 && fz > 15;   // 15 N ≈ 体重的 2%，低于此 CoP 噪声被放大
    if (!valid) {
      return { contactN, fz: 0, fx: 0, fzTan: 0, copX: 0, copZ: 0, copValid: false, patches,
        colIn: 0, colOut: 0, ftMag: 0, slipV: Number.NaN,
        frictionUse: Number.NaN, tangentValid };
    }
    // ★ 滑移速度：脚体在世界系的速度（地面静止 ⇒ 接触点的相对速度 = 脚的速度）。
    //   取脚体速度的水平分量（x/z），供摩擦/滑移判读。
    let slipV = Number.NaN;
    {
      // 脚体 = `shin_*`（脚掌是它的一部分；鞋底列挂在 shin 的 collider 上）
      const b = this.shin(side === 0 ? 'l' : 'r');
      const lv = b.linvel();
      slipV = Math.hypot(lv.x, lv.z);
    }
    return { contactN, fz, fx: 0, fzTan: 0, copX: sx / (fz * dt), copZ: sz / (fz * dt), copValid: true, patches,
      colIn, colOut, ftMag: tangentValid ? ft : 0, slipV,
      // 摩擦占用：Σ|f_t| / (μ·Σf_n)。μ 用鞋底-地面系数（`GROUPS` 里设的 `bodyFriction`）。
      frictionUse: tangentValid ? ft / Math.max(1e-6, 0.8 * fz) : Number.NaN,
      tangentValid };
  }


  /**
   * ★★ 支撑脚的**法向力 / 切向力 / 摩擦利用率**（诊断"体重有没有真的压上去、脚有没有打滑"）。
   *   用户 2026-10-02："我认为需要保证脚底真能抓地或者身体的体重真的压在脚上了"。
   *   返回 `[法向力N, 切向力N, μ·法向力N]`：
   *     · 法向力 ≈ 0 ⇒ 体重**没压在脚上**（脚在飘）
   *     · 切向力 ≥ μ·法向力 ⇒ 已在**打滑**边界
   *   Rapier 的 `TempContactManifold` 只暴露法向冲量，切向冲量要靠切点速度估计，
   *   这里用"接触点相对切向速度 × 法向冲量"做一阶估计。
   */
footGrip(side: 0 | 1, dt: number): [number, number, number] {
    // ★★★ 2026-10-06 修：与 `footLoadFrac` 同一个 bug —— 原来读单数 `soleCol[side]`
    //   （只拿到 7 块鞋底里的**第一块**）⇒ 法向力恒 0 ⇒ 实测「体���完全没压在脚上」
    //   一直误报为「没压上」，而 `readCoP` 同时在说有 357.7 N。
    //   `footGrip` 是**对外的诊断接口**（UI 的「脚有没有抓地」面板读它），
    //   读错会让「体重没压上」和「接触力为零」这两件事无法区分。
    const cols = this.soleCols[side];
    let fn = 0;
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci] as RAPIER.Collider;
      this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
        this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
          if (mf.numContacts() === 0) return;
          for (let k = 0; k < mf.numContacts(); k++) fn += Math.abs(mf.contactImpulse(k)) / dt;
        });
      });
    }
    // 切向：接触点滑移速度 × 法向力（一阶近似，够判断"是否在打滑"）
    const body = this.bodies[this.indexByKey.get(side === 0 ? "foot_l" : "foot_r") ?? 0];
    const v = body.linvel();
    const slip = Math.hypot(v.x, v.z);
    return [fn, fn * slip, fn * slip * 0.35];
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

  /**
   * ★★★ **"真单支撑"的唯一判定**（收敛点：控制与计分共用）
   *
   * 用户 2026-10-04：「控制和计分的状态机可以分开，但是还得做到收敛。」
   *
   * 问题：`sim.ts` 用裸接触数 `nGround === 1` 判单支撑，而它**自己的注释**
   * 就承认这是噪声源：脚高信号 3.90 Hz、离地峰值中位 0 mm、**88% 的"离地"
   * 不到 3 cm** ⇒ 大多是接触抖动。`gaitState` 那边则用 `X1`（前腿接地 **且**
   * 载荷达标）判 —— 两者对"现在是单支撑吗"给出不同答案。
   *
   * 收敛办法：**只保留一个带滞回 + 净空门限的判定**，两条路径都读它。
   * 判据（三条全满足才算单支撑）：
   *   ① 接触数恰为 1（真的只有一只脚有接触对）
   *   ② 离地那只脚的**净空峰值** ≥ `STANCE_CLEAR_MIN`（滤掉接触抖动）
   *   ③ 滞回：进入要连续 `STANCE_ENTER` 秒、退出要连续 `STANCE_EXIT` 秒
   *
   * ⚠⚠⚠ **有状态 ⇒ 必须只在固定时间线上推进一次，绝不能在被读取的地方推进。**
   *   我第一版把它写成 `stanceIsSingleSupport(...)`（读时推进），直接放进奖励表达式：
   *   `accSingle += (doll.stanceIsSingleSupport(...) ? 1 : 0) * ...`
   *   ⇒ **"读诊断"产生了副作用**，于是奖励求值的调用顺序/次数一变，滤波器状态就分叉。
   *   实测代价：`probe-fitness` 的「首次不一致」从**第 21 代**提前到**第 13 代**
   *   （不一致本身是既有 bug，但我把它**放大**了）。
   *   ⇒ 现在拆成两个职责明确的接口：
   *      · `advanceStance(clearancePeak, dt)` —— **唯一推进点**，与 `altEvent` 同一处；
   *      · `stanceSingleNow` —— **纯读取**，任何调用顺序都安全。
   */
  private stanceSingle = false;
  private stanceEnterT = 0;
  private stanceExitT = 0;
  /** 离地脚的**净空峰值**。`sim.ts` 的 `airPeakL/R` 是同一件事的私账；
   *  这里给出公共读数，好让"真单支撑"的判据在两条路径上用**同一个数**。 */
  stanceClearancePeak = 0;

  /** ★ 唯一推进点：每个控制拍调一次（与 `altEvent` 同一处）。 */
  advanceStance(dt: number): void {
    const gL = this.footGrounded(0);
    const gR = this.footGrounded(1);
    const nGround = (gL ? 1 : 0) + (gR ? 1 : 0);
    // 离地那只脚的当前净空。⚠ 用 `soleY`（脚掌最低点世界 y）—— 这是 rig 里
    //   **唯一**的净空真源（`sim.ts` 的 `airPeakL/R` 也是从它累积的）。
    const clr = gL ? Math.max(0, this.soleY('r')) : gR ? Math.max(0, this.soleY('l')) : 0;
    const raw = nGround === 1 && Math.max(this.stanceClearancePeak, clr) >= STANCE_CLEAR_MIN;
    if (raw) {
      this.stanceExitT = 0;
      this.stanceEnterT += dt;
      if (this.stanceEnterT >= STANCE_ENTER) this.stanceSingle = true;
    } else {
      this.stanceEnterT = 0;
      this.stanceExitT += dt;
      if (this.stanceExitT >= STANCE_EXIT) this.stanceSingle = false;
    }
  }

  /** ★ 纯读取：现在是否"真单支撑"。**任何调用顺序都安全**（不推进状态）。 */
  get stanceSingleNow(): boolean { return this.stanceSingle; }

  /** 收敛判据的原始输入（裸接触数），仅供诊断对照 */
  get stanceRawSingle(): boolean {
    return ((this.footGrounded(0) ? 1 : 0) + (this.footGrounded(1) ? 1 : 0)) === 1;
  }

  resetAlt(): void {
    this.lastStance = 0; this.stanceAge = 0;
    this.stanceSingle = false; this.stanceEnterT = 0; this.stanceExitT = 0;
    this.stanceClearancePeak = 0;
  }

  /**
   * ★★ 摔倒（crash）判据：**任何非脚部刚体碰到地面**。
   *   这是 Rudin 2022 的原话做法（"contacts with the base are considered crashes
   *   and lead to resets"）。之前只用"躯干高度/倾角"判摔，于是**往前塌**不算摔：
   *   实测零输出基因组 0.5 s 内塌 41 cm、躯干高度还有 70%、倾角几乎不变 ⇒
   *   回合不结束，它一路滑出 0.65~1.25 m 还能拿速度跟踪分。
   */
  /**
    * ★★ 最近一次 `bodyHitGround()` 命中的**刚体名**（空 = 没命中）。
    *   用于调试："摔倒到底是哪个部位碰地触发的" —— 手/肘在正常低姿态下就接近地面，
    *   如果它们也算 crash，就会误伤，把本可以继续的重心转移判成摔倒。
    */
  lastHitKey = '';

  /**
   * ★★ **所有与地面有竖直接触的刚体名**（诊断用）。
   *
   * 为什么要它：`bodyHitGround()` 只报**非脚部**刚体（`NOT_CRASH` 过滤掉了腿和脚），
   * 所以"身体到底被什么撑住"这个问题它答不了。
   * 而这个问题很关键：实测出现「躯干竖直速度 ≈0（没自由落体）但两脚 Σ|λ| 只有
   * 体重的 4%」—— 说明支撑力来自**脚之外**的碰撞体。
   *
   * 判据与 `bodyHitGround` 同源（真实接触对 + |n·y| ≥ 0.5），但**不过滤**脚部。
   */
  groundTouching(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]!;
      let hit = false;
      for (let ci = 0; ci < b.numColliders() && !hit; ci++) {
        const col = b.collider(ci);
        this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
          this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
            if (mf.numSolverContacts() === 0 && mf.numContacts() === 0) return;
            const ny = mf.normal().y;
            if (Math.abs(ny) > 0.5) hit = true;
          });
        });
      }
      if (hit) out.push(this.sk.bodies[i]!.key);
    }
    return out;
  }

  /**
   * 该刚体所有碰撞体的最低点世界 y（m）；没碰撞体返回 +Infinity
   *
   * ⚠ 2026-10-04：这个函数以前是**死的** —— 它调 `collider.aabb?.()`，
   *   而 Rapier 0.14 的 `Collider` **没有 `aabb()` 方法**（AABB 在 `World` 上），
   *   所以可选链永远取 undefined ⇒ 恒返回 `+Infinity`。
   *   静默失效比报错更坏：任何依赖它的判据都会得到"永不触地"的结论。
   *   改为**真去查接触**（与 `groundTouching` 同一套判据），并保留几何回退。
   */
  lowestY(i: number): number {
    const b = this.bodies[i]!;
    let lo = Infinity;
    for (let ci = 0; ci < b.numColliders(); ci++) {
      const col = b.collider(ci);
      let hit = false;
      this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
        this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
          if (mf.numSolverContacts() === 0 && mf.numContacts() === 0) return;
          if (Math.abs(mf.normal().y) > 0.5) hit = true;
        });
      });
      if (hit) lo = Math.min(lo, 0);
    }
    return lo;
  }

  /**
    * ★★ 不算 crash 的刚体（2026-10-02，用户："摔倒被判定太严了"）。
    *   实测证据：关掉躯干高度判据后，crash 抓到的是 **hand_l** ——躯干蹲到 0.796m、
    *   头 0.925m、倾角 0°，这是"弯腰用手撑一下"的正常姿态，不是摔倒。
    *   ⇒ 手/前臂不参与 crash 判据；躯干、头、大腿、小腿仍参与（那才是真摔）。
    */
  // ★ `forefoot_l/r` 是柔性足 F1（2026-10-04）新增的**前足刚体** ——
  //   它和 `foot_l/r` 一样是脚的一部分，碰地是**正常的支撑**而不是摔倒。
  //   漏登记的后果实测：站立在**第 0 帧**就 `fallReason='crash'`（前足一着地即判摔倒），
  //   中足关节角恒 0°、四块鞋底受力合计只有 64N（体重 687N）—— 整条腿在第一帧就被截断。
  /**
   * ★★ 判为"支撑/肢体"而**不算 crash** 的刚体 —— 改成**前缀模式**而不是硬编码名单。
   *
   *   为什么必须模式化：这是**第三次**被"改名漏掉"咬到了。名单里原本只有
   *   `forefoot_*`（柔性足 F1 的前足命名），F2 把中足改名成 `arch_*` 之后
   *   名单没跟着改 ⇒ **弓合法着地做旋前时 `bodyHitGround()` 立刻返回 true**、
   *   `lastHitKey='arch_l'` ⇒ 回合被判 `fallReason='crash'`。
   *   也就是说：**柔性足做得越对，越容易被判摔倒**（用户实测「摔倒会误判」）。
   *
   *   前缀覆盖：小腿/脚掌/前足/**弓** 四类足部构件 + 上肢。
   */
  private static notCrashKey(key: string): boolean {
    return /^(shin|foot|forefoot|arch|midfoot|toe|mfoot)_[lr]$/.test(key)
      || /^(arm|hand|forearm)_[lr]$/.test(key);
  }

  /**
   * ★★ **头是否碰到地面** —— 跌倒的唯一判据（用户 2026-10-05：「头碰地为跌倒，只留这一个判据得了」）。
   *
   *   为什么必须是"头"而不是任何别的部位：
   *     · 弓/内侧前足/足趾**合法承重时就要接地** ⇒ 用它们当判据等于"脚一干活就死"
   *       （`notCrashKey` 漏 `mfoot` 时就是这么炸的：回合 t=0 结束）。
   *     · 躯干高度、倾角在**恢复过程中**必然穿越，早判等于把"正在纠正"当"已经倒了"。
   *     · 而站着、走路、单腿站、弓承重、足趾抓地时，**头不可能碰地** ⇒ 零误伤。
   *
   * 判据与 `bodyHitGround()` 同源（真实接触对 + |n·y| ≥ 0.5），只作用在**头**这���刚体上。
   */
  headHitGround(): boolean {
    const b = this.bodies[this.indexByKey.get('head')!];
    if (!b) return false;
    for (let ci = 0; ci < b.numColliders(); ci++) {
      const col = b.collider(ci);
      let hit = false;
      this.world.contactPairsWith(col, (other: RAPIER.Collider) => {
        this.world.contactPair(col, other, (mf: RAPIER.TempContactManifold) => {
          if (mf.numContacts() === 0) return;
          if (Math.abs(mf.normal().y) > 0.5) hit = true;
        });
      });
      if (hit) return true;
    }
    return false;
  }

  bodyHitGround(): boolean {
    this.lastHitKey = '';
    for (let i = 0; i < this.bodies.length; i++) {
      const bd = this.sk.bodies[i];
      if (Ragdoll.notCrashKey(bd.key)) continue;
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
        if (hit) { this.lastHitKey = bd.key; return true; }
      }
    }
    return false;
  }

  /**
   * ★★ 刚体"上"轴在**世界系**的单位向量（⇒ 倾角**大小** + **倾斜方位**）。
   *   用户 2026-10-06：「状态机还得捕捉各个身体的**运动趋势**」。
   *
   *   ⚠ 为什么不能只用 `tiltOf`：它只给合成大小，**分不出前倾还是侧倒**
   *     （`rigState.ts:630` 记着这个教训："我曾因此把「腰向前折」误判成侧倒"）。
   *   这里把向量写出来 ⇒ `azim = atan2(z, x)` 直接可读（0=朝前，90=朝左）。
   */
  leanVector(body: RAPIER.RigidBody, out: Float64Array): void {
    this.toWorld(body, 0, 1, 0, out);
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
  /**
   * ★ 关节绕**指定自由轴**的转动惯量（kg·m²）—— 数值稳定性上限要用它。
   *
   * ⚠⚠ **不要**用 `this.jointIeff` 代替：那个是**过冲护栏**用的，取的是
   *   **最大**主惯量（故意宽松，理由见构造函数里那段"同一个坑修过两次"）。
   *   而显式积分的稳定性取决于**绕该轴真实转动惯量**，对薄弓体绕长轴旋转
   *   来说那是**最小**主惯量（≈1e-4，比 max 小两个数量级）。
   *   用 max 去算上限 ⇒ 会把 K/B 的合法上限高估两个数量级 ⇒ 弓必然高频抖动。
   *
   * @param axis 主轴单位向量（柔性足就是 `[1,0,0]`）
   */
  jointAxisInertia(i: number, axis: Vec3): number {
    // 弓的自由轴是**主轴**之一（[1,0,0]），所以沿该轴的惯量就是对应的主惯量；
    // 写成加权通式是为了将来自由轴不是主轴时也不至于静默算错。
    const ic = this.bodies[this.jointBodies[i * 2 + 1]]!.principalInertia();
    const [ax, ay, az] = axis;
    return Math.max(1e-9, ax * ax * ic.x + ay * ay * ic.y + az * az * ic.z);
  }

  jointAngle(i: number): number {
    const buf = this.rvTmp;
    this.jointRot(i, buf);
    return buf[2];
  }

  /**
   * ★ 关节锚点的**世界坐标**（父刚体变换 × parentLocal）。
   *   teacher 的 IK 需要真实髋位置 —— 之前用 `com.y − HIP_DY` 推算，
   *   虚拟髋(0.744m) 和真实髋刚体(0.849m) 差了 10cm ⇒ IK 按错的骨盆高度算腿姿，
   *   踝前摆时必然扫地（用户："盆骨抬得不够高，导致踝部向前会触地"）。
   */
  /** ★ v4 基础设施：关节轴 k 的**世界方向**（父体姿态旋转；与 enforceLimits 同约定） */
  jointWorldAxis(i: number, k: number, out: Float64Array): boolean {
    const j = this.sk.joints[i];
    if (!j) return false;
    const p = this.bodies[this.jointBodies[i * 2]!];
    if (!p) return false;
    const r = p.rotation();
    let ax = 0, ay = 0, az = 0;
    if (k === 0) ax = 1; else if (k === 1) ay = 1; else az = 1;
    quatRotate(r.x, r.y, r.z, r.w, ax, ay, az, out);
    return true;
  }

  jointWorld(i: number, out: Float64Array): void {
    const j = this.sk.joints[i];
    if (!j) { out[0] = out[1] = out[2] = 0; return; }
    const p = this.bodies[this.jointBodies[i * 2]!];
    const t = p.translation(), r = p.rotation();
    const lx = j.parentLocal[0], ly = j.parentLocal[1], lz = j.parentLocal[2];
    // q * v * q^-1
    const ix = r.w * lx + r.y * lz - r.z * ly;
    const iy = r.w * ly + r.z * lx - r.x * lz;
    const iz = r.w * lz + r.x * ly - r.y * lx;
    const iw = -r.x * lx - r.y * ly - r.z * lz;
    out[0] = t.x + ix * r.w + iw * -r.x + iy * -r.z - iz * -r.y;
    out[1] = t.y + iy * r.w + iw * -r.y + iz * -r.x - ix * -r.z;
    out[2] = t.z + iz * r.w + iw * -r.z + ix * -r.y - iy * -r.x;
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
  /**
   * ★ 直接力矩通道（N·m，逐轴）。与 `setMotorTargets` 的角度通道**并联相加**。
   *   这不是"把护栏调松"：位置环的 `err` 稳定性护栏对**反馈**成立
   *   （|imp| ≤ α·|err|·Ieff），而这里是 `τ = JᵀF` 算出的**定量前馈**，
   *   本来就知道该多大，不该再被位置误差的护栏砍。
   */
  /**
   * ★ 让位掩码（逐轴，1=balance / 2=step）：该轴的位置伺服**只做阻尼**（P 项置零）。
   *   见 `RigState.requestHold` 的注释：定量支撑交给 `τ = JᵀF`，
   *   位置环只留 `−kD·ω_rel` 提供关节阻尼，两者职责不重叠、不会互相顶。
   */
  setHoldMask(mask: readonly number[]): void {
    const n = Math.min(this.holdCmd.length, mask.length);
    for (let i = 0; i < n; i++) this.holdCmd[i] = mask[i]!;
  }

  /**
   * ★★ **关节传递力（力链）** —— 这才是"从脚往上"的力。
   *
   *   物理：对某关节的**子侧子树**做牛顿第二定律
   *       F_constraint = m·(a_com − g)
   *   `a_com` 用**窗口差分**（跨 `VEL_WIN` 个物理步的**平均加速度**）。
   *
   *   ★★ 为什么必须是窗口而不是单步差分：
   *     单步 `Δv/dt` 会把**接触冲击**算进去 —— 实测开踝时脚掌落地那一步
   *     读到 **109 kN** 的"传递力"（真实值是体重的 1/60）。
   *     窗口平均等价于低通，代价是丢掉 30ms 内的真峰值（对力链可接受）。
   *
   *   ★ 为什么不用马达力矩倒推：马达力矩是**控制器要的**，约束力是
   *     **动力学结果**（含接触、摩擦、惯量耦合）—— 只有后者是"传上来的力"。
   *
   *   ★ 轴约定：x=矢状(前) y=竖直 z=额状(左)。
   *   输出到 `out`（长度 ≥ 5·nJoints），每关节 {fx,fy,fz,|F|,subtreeMass}。
   *   **这是自下而上的读数**：foot 的子树 = 脚掌；knee 的子树 = 小腿+脚；
   *   hip 的子树 = 大腿+小腿+脚 ⇒ 数值应当**自下而上递增**。
   */
  jointForce(out: Float64Array, dt: number): void {
    const g = 9.81;
    const win = Math.max(1, Math.min(this.velRing.length / Math.max(1, this.bodies.length), VEL_WIN));
    const dtW = dt * win;
    for (let i = 0; i < this.sk.joints.length; i++) {
      const o = i * 5;
      if (o + 4 >= out.length) break;
      const idx = this.subtreeOf(i);
      let mt = 0, ax = 0, ay = 0, az = 0, usable = false;
      for (let k = 0; k < idx.length; k++) {
        const bi = idx[k]!;
        const b = this.bodies[bi];
        if (!b) continue;
        const m = b.mass(), v = b.linvel();
        // 环上**最老**的那一帧（= N 步之前）
        const pv = this.velOld(bi);
        if (!pv) continue;
        usable = true;
        mt += m;
        ax += m * (v.x - pv.x) / dtW;
        ay += m * (v.y - pv.y) / dtW;
        az += m * (v.z - pv.z) / dtW;
      }
      if (!usable || mt <= 0 || dtW <= 0) {
        out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; out[o + 4] = 0;
        continue;
      }
      const fx = ax, fy = ay + mt * g, fz = az;   // +mg：扣除重力后= 地面/上级传来的净力
      out[o] = fx; out[o + 1] = fy; out[o + 2] = fz;
      out[o + 3] = Math.hypot(fx, fy, fz);
      out[o + 4] = mt;
    }
  }

  /** 速度环：每步写一帧，供窗口差分取"N 步前"的值 */
  private velRing: Float64Array = new Float64Array(0);
  private velRingPos = 0;
  private velFrames = 0;
  /** N 步之前的速度（环未满时返回 null ⇒ 不输出，避免"看起来正常的 0"） */
  private velOld(bi: number): { x: number; y: number; z: number } | null {
    const n = this.bodies.length;
    if (n === 0 || this.velFrames < VEL_WIN) return null;
    // ★ 环满后 `velRingPos` 指向**下一个要写**的槽 ⇒ 最老的一帧就在 `velRingPos` 本身。
    //   （原写成 `(velRingPos+1)%VEL_WIN` 是 off-by-one，会取到"刚写的那帧"
    //     ⇒ 窗口差分退化成单步差分、且在某些下标上读到未初始化值 ⇒ fz 出现 NaN。）
    const b = this.velRingPos * n + bi;
    if (b + 2 >= this.velRing.length) return null;
    return { x: this.velRing[b]!, y: this.velRing[b + 1]!, z: this.velRing[b + 2]! };
  }

  /** 子树刚体下标（绑定姿态下不变 ⇒ 缓存）。`out` 复用写入避免每帧分配 */
  private subtreeCache: Map<number, number[]> | null = null;
  private subtreeOf(i: number): number[] {
    if (!this.subtreeCache) {
      this.subtreeCache = new Map();
      const kidsOf = (key: string): string[] => {
        const r: string[] = [];
        for (const j of this.sk.joints) if (j.parentKey === key) r.push(j.childKey);
        return r;
      };
      for (let i = 0; i < this.sk.joints.length; i++) {
        const keys: string[] = []; const st = [this.sk.joints[i]!.childKey];
        while (st.length) {
          const c = st.pop()!;
          if (keys.includes(c)) continue;
          keys.push(c); st.push(...kidsOf(c));
        }
        this.subtreeCache.set(i, keys
          .map((k) => this.indexByKey.get(k))
          .filter((x): x is number => x !== undefined));
      }
    }
    return this.subtreeCache.get(i) ?? [];
  }

  /**
   * ★ 在 `advance()` **之后**采一帧速度，供 `jointForce` 做**窗口差分**。
   *   环未满 `VEL_WIN` 帧时 `jointForce` 不输出（而不是输出 0 —— 后者会
   *   让力链看起来"正常"但全是零，是个静默失效）。
   */
  primeVelocities(): void {
    const n = this.bodies.length;
    if (this.velRing.length !== VEL_WIN * n) this.velRing = new Float64Array(VEL_WIN * n);
    const base = this.velRingPos * n;
    for (let i = 0; i < n; i++) {
      const v = this.bodies[i]!.linvel();
      this.velRing[base + i] = v.x;
      this.velRing[base + i + 1] = v.y;
      this.velRing[base + i + 2] = v.z;
    }
    this.velRingPos = (this.velRingPos + 1) % VEL_WIN;
    if (this.velFrames < VEL_WIN) this.velFrames++;
  }
  /** 力链是否已就绪（环已满）—— UI 显示用，避免展示未初始化的 0 */
  forceChainReady(): boolean { return this.velFrames >= VEL_WIN; }

  setTorqueTargets(taus: Float32Array): void {
    const n = Math.min(this.torqueCmd.length, taus.length);
    for (let i = 0; i < n; i++) this.torqueCmd[i] = taus[i]!;
  }

  /**
   * ★★★ **足部侧向发力通道**（2026-10-06，用户：「我的柔性足是支持脚的侧向发力的」）。
   *
   *   柔性足的侧向机构 = `arch_*` / `mfoot_*` 绕**足长轴**（axis 0）的旋前/旋后。
   *   物理含义：roll 越大 ⇒ 内侧柱压得越实 ⇒ 压力中心（CoP）往内侧走（外侧同理）。
   *   这就是"脚自己发侧向力"的机制 —— 不靠踝（踝 revolute 只有屈伸轴，额状轴被引擎锁死）。
   *
   *   ⚠ 为什么必须走这条通道、而不是 `setTorqueTargets`：
   *     这两个关节由 **Rapier 力模式引擎电机**（隐式积分，K=400 N·m/rad）驱动，
   *     已登记进 `motorDriven` ⇒ `driveMotors` **跳过**它们
   *     （显式 PD 在 dt=1/120 对弓的稳定上限只有 7.3 N·m/rad，差 55 倍，见 createJoints 注释）。
   *     ⇒ 自研力矩通道到不了它们；只能写引擎电机的**目标角**。
   *
   *   @param side 0 = 左 (`*_l`)、1 = 右 (`*_r`)
   *   @param rad  目标角（rad）。正 = **旋前**（内侧弓下沉）；限位见 `cfg.archLimitDeg`
   *   @returns 实际写入的关节数（0 = 该侧没有弓关节 ⇒ 调用方可据此报"通道不存在"）
   */
  setArchRoll(side: 0 | 1, rad: number): number {
    const k = this.opt.archStiffness ?? 400;
    const b = this.opt.archDamping ?? 2.0;
    let n = 0;
    for (const a of this.archRollers) {
      if (a.side !== side) continue;
      (a.j as { configureMotorPosition(t: number, k: number, b: number): void })
        .configureMotorPosition(rad, k, b);
      n++;
    }
    return n;
  }

  /** 弓/内侧前足关节（引擎电机驱动）的**当前目标角**回读（rad）。−1 侧无弓 ⇒ NaN */
  archRollTarget(side: 0 | 1): number {
    for (const a of this.archRollers) {
      if (a.side !== side) continue;
      const t = (a.j as { motorPositionTarget?: () => number }).motorPositionTarget?.();
      return typeof t === 'number' ? t : Number.NaN;
    }
    return Number.NaN;
  }

  /**
   * ══════════════════════════════════════════════════════════════
   * ★★ `τ = Jᵀ F` —— 把一个**世界系力** F 作用在点 p 上，投影成各关节力矩。
   *
   * ⚠⚠ **轴约定：`fx` = 矢状(前)、`fy` = 竖直、`fz` = 额状(侧)**。
   *   （依据：`rs.grf.y = 686.7 × 载荷` 是竖直分量。）额状面平衡的水平力
   *   必须传 `fz`；传成 `fx` 会变成前后推，横向完全失控。
   *
   *   文献依据（这才是平衡的标准律，不是"关节角 P 控制"）：
   *     · Yin & Zhou 2004 / Horak 2006 / Reitsma 2013 / van Mierlo 2022/2024
   *       —— 上层只决定**需要的地面反力矢量 F**（由倒立摆 / Capture Point / Houska
   *          balance point 反解），关节力矩由**虚功**唯一确定：`τ = Jᵀ F`。
   *     · 好处：各关节按**力臂几何自动分配**，没有可调的符号旋钮。
   *       （旧实现"关节角 = P·ΔCoM.z"的符号与增益完全由被控对象决定，
   *         护栏一改就翻面 —— 实测半权限 sign=−1 收敛、满权限 sign=+1 才收敛。）
   *
   *   公式：对切点 i（父侧 = 被 F 作用的那一侧），
   *       τ_i = û_i · [ (a_i − p) × F ]
   *   其中 û_i 是关节轴的世界方向、a_i 是关节世界锚点。
   *   只沿 `chain` 上给的关节分配（一般是支撑腿 + 脊柱链）。
   *
   *   @param chain 允许参与分配的关节下标（其余轴写 0）
   * @param copMoment 额外的支撑面力矩（N·m，绕世界 Z/绕踝），用于设定 CoP
   */
  jacobianTorque(
    fx: number, fy: number, fz: number,
    px: number, py: number, pz: number,
    chain: readonly number[], out: Float32Array,
  ): void {
    out.fill(0);
    const ax = this.jw;
    for (const i of chain) {
      const j = this.sk.joints[i];
      if (!j) continue;
      const pi = this.jointBodies[i * 2];
      const p = this.bodies[pi]!;
      const q = p.rotation();
      // 锚点用**当前**位姿算（不是 rest 的 wx/wy/wz）：关节会动，锚点跟着动
      const pt = p.translation();
      const pl = j.parentLocal;
      quatRotate(q.x, q.y, q.z, q.w, pl[0], pl[1], pl[2], this.ja);
      const axw = pt.x + this.ja[0]!, ayw = pt.y + this.ja[1]!, azw = pt.z + this.ja[2]!;
      const rx = axw - px, ry = ayw - py, rz = azw - pz;
      // (r × F)
      const cx = ry * fz - rz * fy;
      const cy = rz * fx - rx * fz;
      const cz = rx * fy - ry * fx;
      for (let k = 0; k < 3; k++) {
        const lx = k === AXIS_X ? 1 : 0, ly = k === AXIS_Y ? 1 : 0, lz = k === AXIS_Z ? 1 : 0;
        quatRotate(q.x, q.y, q.z, q.w, lx, ly, lz, ax);
        const idx = i * 3 + k;
        out[idx] = ax[0]! * cx + ax[1]! * cy + ax[2]! * cz;
        // 按该轴 τmax 夹紧（虚功解可能超过硬件能力，必须可见地饱和）
        const tmax = j.maxTorque[k]!;
        if (out[idx]! > tmax) out[idx] = tmax;
        else if (out[idx]! < -tmax) out[idx] = -tmax;
      }
    }
  }

  /**
   * ★★ **瘫软（死亡演出用）**：把位置环增益降到 0，只留重力/接触/残余动量。
   *
   *   动机（用户 2026-10-04：「当角色死亡的时候我觉得可以恢复这个状态让他飞出去」）：
   *   原来 `Sim.finish()` 只是把 `motorTarget` 归零，但 `kP=48` 的位置伺服
   *   仍然在用力矩把四肢**拉回绑定姿态** ⇒ 尸体站在原地挣扎，像"卡住"了。
   *   瘫软之后关节不再出力，角色会被残余动量和重力带走 ⇒ 自然地被甩出去。
   *
   *   注意：这只改马达，**不碰 `enforceLimits`**（关节限位必须留着，
   *   否则关节会无限转圈）。
   */
  /**
   * ★★★★★ 2026-10-06 **瘫软 = 死亡演出**（用户：「有个很神奇的散架效果…
   *   这个可以**敌人死后复现**这个效果」「腰部向下弯曲然后转一个圈，
   *   也是**可以保留并复刻**的效果」）。
   *
   *   实测两个"魔法效果"的**机制是同一根因**：
   *     · **散架**：远端小关节速度爆（`foot_l/r` **4500/4100 °/s**、
   *       `mfoot/arch` 1000~1900 °/s）——接触冲量打在轻体（脚 `I≈0.0018`）上的单步抽击；
   *     · **弯腰 + 转圈**：ball 关节**非主轴限位失效**——
   *       `spine1/0` 折到 **179.8°**（限位 ±15°）、`spine1/1` −104.8°（扭转）、
   *       `knee_r/0` 122.8°（偏航）⇒ 躯干从骨盆折过去 + 下半身绕长轴自由转。
   *
   *   ⇒ 结论：**这些效果就是"限位失效"本身**。正常游玩要修限位；
   *     死亡演出要**故意关掉限位**（`skipLimits`）⇒ 效果**可复刻、可开关**。
   *   `DEATHEFF=0` 可关（瘫软时也保留限位）。
   */
  setLimp(on: boolean): void {
    this.limp = on;
    if (DEATH_EFF) this.skipLimits = on;      // ★ 死亡演出：放开限位 ⇒ 散架/转圈可复刻
  }

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
    // ★★ 首拍懒算：把平行轴项补进 `jointIeff`（构造期句柄不可用，见 `refineJointIeff`）
    if (IEFF_FIX) this.refineJointIeff();
    {
      // V4 校准用的内部时钟（driveMotors 的 dt 累加）
      const dtc = this.lastDt;
      if (Number.isFinite(dtc) && dtc > 0 && dtc < 0.1) this.clock += dtc;
    }
    this.physicsDt = dt;
    // ★ 校正限位权限用的步长（2026-10-06）。构造期只能假定 `ASSUMED_PHYSICS_HZ`，
    //   而 `SimConfig.physicsHz` 可配（实测曾用 120）⇒ 步长变小会让马达角冲量变大、
    //   原来算的限位权限变不足。⇒ 第一次拿到真值时按比例**收紧**。
    //   只在变化超过 5% 时重算，避免每个物理步都遍历 54 轴。
    {
      const hz = dt > 1e-9 ? 1 / dt : ASSUMED_PHYSICS_HZ;
      if (Math.abs(hz - this.limitBiasMaxHz) / this.limitBiasMaxHz > 0.05) {
        const k = hz / this.limitBiasMaxHz;
        for (let i = 0; i < this.limitBiasMax.length; i++) {
          this.limitBiasMax[i] = Math.max(LIMIT_MAX_BIAS, this.limitBiasMax[i]! * k);
        }
        this.limitBiasMaxHz = hz;
      }
    }
    const scale = this.opt.torqueScale;
    this.lastDt = dt;   // 供 enforceLimits 的角度投影用
    // ★ 瘫软（死亡演出）：位置环增益置 0 ⇒ 马达不再把四肢拉回姿态，
    //   关节交给重力/接触/残余动量，角色会被带着飞出去。见 setLimp。
    //   `enforceLimits` 不受影响（关节限位必须留着）。
    const limp = this.limp;
    const kPEnvRaw = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).KP ?? '');
    const kPEnv = Number(kPEnvRaw);
    const kP = limp ? 0 : (kPEnvRaw !== '' && Number.isFinite(kPEnv) && kPEnv >= 0 ? kPEnv : this.opt.kP);
    // ★ KD 可扫（伺服 D 项；chatter 的 ω 会把它放大成 ±τmax）
    const kDEnvRaw = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).KD ?? '');
    const kDEnv = Number(kDEnvRaw);
    const kD = limp ? 0 : (kDEnvRaw !== '' && Number.isFinite(kDEnv) && kDEnv >= 0 ? kDEnv : this.opt.kD);
    const qRel = this.qRel;
    const rv = this.rv;
    const relL = this.relL;
    const jg = this.opt.jointGain ?? {};
    for (let i = 0; i < this.joints.length; i++) {
      // ★★ 跳过**引擎电机**驱动的关节（当前只有弓）。双驱动 = 一个关节被两个
      //   不同量纲的刚度同时拉向 0 ⇒ 柔性足被"焊死"，而外观指标全部看起来正常
      //   （中足已经栽过这个坑，见 createJoints 里那段注释）。
      if (this.motorDriven.has(i)) continue;
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
      // ★ 子侧有脚承重时，用被地面约束放大的等效惯量（见构造里 groundFactor 的注释）
      const gf = (this.footLoadedFlag(i) && this.groundFactor[i]! > 1) ? this.groundFactor[i]! : 1;
      const Ieff = this.jointIeff[i]! * gf;

      for (let k = 0; k < 3; k++) {
        // 记账：本步该轴实际施加 / 想要施加的马达冲量（0 = 该轴没出力，skip 分支不会漏）
        this.motorImpulse[i * 3 + k] = 0;
        this.motorDemand[i * 3 + k] = 0;
        this.motorBranch[i * 3 + k] = 0;
        this.motorThRef[i * 3 + k] = 0;
        this.motorErr[i * 3 + k] = 0;
        this.motorErrP[i * 3 + k] = 0;
        this.motorErrD[i * 3 + k] = 0;
        this.motorTauFF[i * 3 + k] = 0;
        const lo = j.minRad[k];
        const hi = j.maxRad[k];
        const a = rv[k];
        const idx = i * 3 + k;

        let alpha = this.opt.motorAlpha;
        let err = 0;
        const kDd = limp ? 0 : kD;

        // ---- 软限位（逐轴）：只在**越界之后**才介入，直接接管目标速度 ----
        // ★★ 不要提前量（这里踩过一次大坑，别改回去）：膝的限位是 [−145°, +2°]，
        //    静止姿态 0° 恰好在 +2° 内侧。若按 (hi − zone) 提前 17° 就介入，等于一开局
        //    就判定膝盖越界、全力把它往后掰 —— 实测躯干从 1.128 m 一路塌到 0.698 m，
        //    整个人形自己跪下去，而且"站桩"直接踩到摔倒阈值。提前量对小范围关节是灾难。
        //    越界量与回程速度的关系仍保留 LIMIT_SOFT_ZONE 的斜坡（越界越多回程越快）。
        // 下面 `impSpring`/`impDamp` 要用这两个量，而它们只在 else 分支里赋值
        let thRef = 0, kPSpring = 0, kDdEff = kDd, ts = 1;
        const ramp = Math.min(LIMIT_SOFT_ZONE, hi - lo);
        if (a > hi) {
          err = -JOINT_MAX_SPEED * Math.min(1, (a - hi) / ramp) - relL[k];
          alpha = MOTOR_ALPHA_RECOVER;
          this.motorBranch[idx] = 3;
        } else if (a < lo) {
          err = JOINT_MAX_SPEED * Math.min(1, (lo - a) / ramp) - relL[k];
          alpha = MOTOR_ALPHA_RECOVER;
          this.motorBranch[idx] = 4;
        } else if (V4_MODULE_MODE()) {
          // ═══════════════════════════════════════════════════════════════
          // ★★★★★ 2026-10-06 **V4 架构：纯力矩关节**
          //
          //   用户定调：「我想让你重新写 v4 架构而不是调参，旧架构也要丢弃。
          //   脚不知为何一直在抖，然后向前，导致重心改变然后倒了，可能是力矩
          //   还是太大导致的抖」。
          //
          //   诊断（本会话全部实测的收束）：位置伺服范式（K=48 弹簧 + 目标钉死）
          //   有两个无法调和的产物：①支撑必须靠"静姿 sag × K"（K 降就塌）；
          //   ②K 放大一切高频扰动 = **抖**。抖动破坏摩擦 → 脚滑前移 → 倒。
          //
          //   V4 换范式：**关节只输出力矩，不跟踪位置**：
          //     τ_joint = τ_grav（几何精确 FF，姿态自适应）
          //             + τ_damp（阻尼，物理化）
          //             + τ_bal（平衡修正，后续接入）
          //   P 项永久为 0。支撑由"骨骼几何 + 精确 FF"承担——
          //   对齐站姿的静力矩天然是 5~20 N·m（人类区间），**没有东西放大扰动**。
          // ═══════════════════════════════════════════════════════════════
          // 脚部（踝）关节需要**实实在在的阻尼**（用户设计坚持）：
          //   人体踝是黏弹性结构（跟腱+足底），无阻尼只会振铃。
          //   V4FKD 放大脚部关节的阻尼增益（默认 4×；kDd 基准=1.0）。
          const fkd = (() => {
            const raw = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V4FKD ?? '');
            return Number.isFinite(raw) && raw > 0 ? raw : 4;
          })();
          // ★ 2026-10-06：腿链整体（hip/knee/foot）——垂直压缩模态的阻尼在**膝**，
          //   只放大踝打不到它（实测：踝 errD 3× 但真倒不动）。V4LEGDK 可扫。
          const isLeg = /^(hip|knee|foot)_/.test(j.name);
          const legDk = (() => {
            const raw = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V4LEGDK ?? '');
            return Number.isFinite(raw) && raw > 0 ? raw : fkd;
          })();
          let kdUse2 = isLeg ? kDd * legDk : kDd;
          // ★★★★★ 2026-10-06 **扭转（yaw）阻尼**：两脚前后劈叉 = 身体在转（yaw）。
          //   髋的轴1（TWIST，绕竖直）此前在 V4 下几乎无阻尼 ⇒ 扭转自由度漂移
          //   ⇒ 支撑脚被"转"到 CoM 后方 ⇒ ξ 永远出界 ⇒ 一切反馈被吞。
          //   `V4TWISTD`（默认 20×）：髋轴1显式阻尼。
          {
            const raw = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V4TWISTD ?? '');
            const twd = Number.isFinite(raw) && raw > 0 ? raw : 20;
            if (/^hip_/.test(j.name) && k === 1) kdUse2 = kDd * twd;
          }
          err = -kdUse2 * relL[k];
          this.motorErrP[idx] = 0;
          this.motorErrD[idx] = err;
          this.motorBranch[idx] = 5;
        } else if (this.holdCmd[idx]) {
          // ★★ 让位模式：位置伺服**只做阻尼**，P 项置零。
          //   定量支撑由 `τ = JᵀF` 力矩通道提供（见 setHoldMask / requestHold）。
          //   两者职责不重叠 ⇒ 不会再在同一轴上互相顶。
          err = -kDd * relL[k];
          this.motorErrD[idx] = err;
          this.motorBranch[idx] = 2;
        } else {
          this.motorBranch[idx] = 1;
          const cmd = this.motorTarget[idx];
          thRef = cmd >= 0 ? cmd * this.refPos[idx] : cmd * this.refNeg[idx];
          // ★ 逐关节增益覆盖（踝/弓专用，见 RagdollOptions.jointGain 的注释）
          const ov = jg[j.name];
          // ★ 载荷依赖的姿势张力：P/D 同时按 `toneScale` 缩放。
          //   只放大 P 会让系统变"硬但嗡"(过阻尼不足)；D 同比例放大才保持阻尼比。
          ts = this.toneScale[idx] || 1;
          let kpUse = ov ? ov.kP : kP;
          let kdUse = ov ? ov.kD : kDd;
          const kpRaw = kpUse, kdRaw = kdUse;
          // ★★★ **逐轴刚度上限**（2026-10-06；用户 + 文献）
          //
          //   用户：「巨量的发力 0.5s 就能直接让身体姿态崩溃」。
          //   实测（`probe:pelvis`）：`spine1/2` 只有 **3°** 误差就顶到 τmax=120，
          //   即有效刚度 `K ≈ 120/0.052 ≈ 2300 N·m/rad`，而**文献的躯干临界刚度是
          //   175 N·m/rad**（Morasso 2022），模型取 2× 临界 = **350**
          //   （Goodworth & Peterka 2014 的"主动上身反馈刚度"实测 121~352）。
          //   ⇒ 我们硬了 ~7 倍。而 Reeves 2006 实测：**主动绷紧躯干反而恶化平衡**
          //     （CoP 速度↑, p<0.001），被动加硬不恶化 —— 所以这是**真的过刚**。
          //
          //   换算：`K = kP·ts·τmax/ωmax` ⇒ 夹 `kP` 到 `Kmax·ωmax/τmax`。
          //   ⚠ 只夹 **P（刚度）**，不动 D（阻尼）——阻尼是抑制数值振荡的，不是"发力"。
          const scMax = this.stiffCap[idx] ?? 0;
          if (scMax > 0) {
            const tmaxAxis = (j.maxTorque[k] ?? 0) * this.opt.torqueScale;
            if (tmaxAxis > 1e-6) {
              const kpCap = (scMax * JOINT_MAX_SPEED) / tmaxAxis;
              if (kpUse > kpCap) {
                if (kpUse > (this.kpRawPeak[idx] ?? 0)) this.kpRawPeak[idx] = kpUse;
                const r = kpCap / kpUse;
                kpUse = kpCap;
                // ★★ **阻尼必须按同一比例一起夹**（2026-10-06 实测）：
                //   只夹 P 时脊柱仍会顶到 τmax —— 因为 `kD` 默认与 `kP` 同量级
                //   （48），`D = kD·τmax/ωmax = 48×120/9 = 640 N·m·s/rad`，
                //   而文献的躯干临界阻尼 `2ζ√(K·I) ≈ 65`（K=350, I≈3）⇒ **过阻尼 10 倍**。
                //   过阻尼的关节本质是个**刹车**：姿态误差很小也要顶满力矩才能动。
                //   按同比例缩 ⇒ 阻尼比 ζ 不变、绝对刚度/阻尼一起降。
                //   ⚠⚠ **但让位的轴（`holdCmd` = 位置伺服只剩阻尼）绝不能夹阻尼**：
                //     那是该轴**唯一**的稳定手段。实测：`hip/2` 被块④c 让位后又夹了
                //     阻尼 ⇒ 髋阻尼掉 3 倍 ⇒ 「迈步系统停手」从 **12.00s → 1.14s**。
                //   ⇒ 让位轴只夹 P（其实 P 已被置零、等于不夹），阻尼原样保留。
                if (!this.holdCmd[idx]) kdUse = Math.min(kdUse, kdRaw * r);
                this.stiffCapHits++;
              }
            }
          }
          kPSpring = kpUse;
          // ★★★★★ 2026-10-06 **阻尼项符号**（实测：`probe-t0` 逐轴 τ·ω 账）
          //   实测（`hip_l` 三轴**全 `bind`**、角度仅 0.1~0.6°，却 ω=±17~41°/s、
          //   τ=±1~69 N·m，且 **τ·ω > 0 = 在往系统里泵能量**）：
          //     轴2  -0.2° / τ −35 / ω −30°/s   ⇒ **τ 与 ω 同号**
          //   阻尼项 `−kd·ω` 应**反抗**速度，实测却同号 ⇒ `relL[k]` 与
          //   `d(rv[k])/dt` **反号**（`quatRel` 与 `quatInvRotate` 的约定不一致）
          //   ⇒ 阻尼变成**负阻尼（正反馈）** ⇒ 逐拍泵能量（KE 0.024→1.13 J / 0.12s，
          //     执行器正功率 5.7→420 W）⇒ 关节高频抖振 ⇒ 踝的阻尼响应它 ⇒
          //     CoP 被推到脚尖 ⇒ 0.2s 起被推着后倒。
          //   `KD_SIGN=-1` 是**实验开关**（默认保持原样，先验证再决定）。
          // ★★★★★ 2026-10-06 **平衡点带限（EQP）** —— Hogan/Bizzi/Mussa-Ivaldi/Flash 1987
          //   「the net mechanical **impedance** ... even posture requires coordination」；
          //   人的静姿态里 Δθ（平衡点−实角）极小（目标**跟着身体**走）⇒ τ 小。
          //   我们：目标钉死 ⇒ Δθ 可到 1+ rad ⇒ kP=48 顶满 ⇒ τ ±200。
          //   `EQP=1`：把 `(thRef−θ)` 夹到 ±`EQP_BAND`（rad）——
          //   等效"平衡点跟踪实际±带" ⇒ τ ≤ K·band（**力矩天然有界**）。
          // ══════════════════════════════════════════════════════════
          // ★★★★★ 2026-10-06 **V4-1：平衡点跟随层（EQF）** —— §8.9
          //   文献：Hogan/Bizzi/Mussa-Ivaldi/Flash 1987（阻抗控制）；
          //         Feldman 平衡点：**平衡点跟随实际**（低频）⇒ Δθ 天然小。
          //   形态：`eq_eff = LPF(实际, EQF_TAU) + 显式意图(thRef)`
          //     ⇒ 伺服只对**快偏差**出力（`−(a−LPF(a))` = 高通）+ 意图；
          //   取代"目标钉死 ⇒ Δθ 到 1+ rad ⇒ kP=48 顶满"。
          //   `EQF=1` 开；`EQF_TAU`（s，默认 0.4）。
          const eqfRaw = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).EQF ?? '');
          let thRefEq = thRef;
          if (eqfRaw === '1' || eqfRaw === 'on' || eqfRaw === 'true') {
            const tauRaw = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).EQF_TAU ?? '');
            const tauEq = Number.isFinite(tauRaw) && tauRaw > 0 ? tauRaw : 0.4;
            const dtEq = this.lastDt > 1e-6 ? this.lastDt : 1 / 240;
            const kEq = Math.min(1, dtEq / tauEq);
            this.eqLPF[idx] = (this.eqLPF[idx] ?? 0) + (a - (this.eqLPF[idx] ?? 0)) * kEq;
            thRefEq = this.eqLPF[idx]! + thRef;
          }
          const eqpRaw = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).EQP ?? '');
          const dRefRaw = thRefEq - a;
          let dRefUse = dRefRaw;
          if (eqpRaw === '1' || eqpRaw === 'on' || eqpRaw === 'true') {
            const bandRaw = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).EQP_BAND ?? '');
            const bandDeg = Number.isFinite(bandRaw) && bandRaw > 0 ? bandRaw : 15;
            const band = (bandDeg * Math.PI) / 180;
            dRefUse = dRefRaw > band ? band : dRefRaw < -band ? -band : dRefRaw;
          }
          // ★★★★★ 2026-10-06 **`ZEROPASS=1`：目标为 0 的轴 = 无人写 ⇒ 卸掉弹簧**
          //   （泵能量的轴正是这些"目标=0=静姿态"的 bind 轴：K=48 的弹簧把
          //    全身硬拉到静姿态。卸簧后它们只剩阻尼 = 被动关节。）
          //   诊断开关（默认关）；与 `holdCmd`（让位）语义一致，只是触发条件不同。
          // ★★★★★ 2026-10-06 **V4CAL：校准式前馈换档**
          {
            const calRaw = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V4CAL;
            if (calRaw !== undefined && calRaw !== '') {
              const tcal = Number(calRaw);
              if (Number.isFinite(tcal) && tcal > 0) {
                if (!this.v4CalDone && this.clock >= tcal) {
                  this.v4CalDone = true;
                  for (let q = 0; q < this.v4FF.length; q++) {
                    this.v4FF[q] = 0;
                    this.v4ThRef[q] = 0;
                  }
                }
                if (this.v4CalDone) {
                  // 快照当拍：把 P 出力存成 FF、锁定平衡点
                  if (this.v4ThRef[idx] === 0 && this.v4FF[idx] === 0 && this.motorThRef[idx] === undefined) { /* noop */ }
                  // 首次进入该轴：未锁则锁
                  if (this.v4Locked[idx] !== 1) {
                    this.v4ThRef[idx] = thRef;
                    this.v4FF[idx] = kpUse * ts * dRefUse;
                    this.v4Locked[idx] = 1;
                  }
                  const kpV4 = (() => {
                    const r = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V4KP ?? '');
                    return Number.isFinite(r) && r > 0 ? r : 15;
                  })();
                  dRefUse = this.v4ThRef[idx]! - a;
                  kpUse = kpV4;
                  err = kpUse * ts * dRefUse + this.v4FF[idx]! - kdUse * ts * relL[k] * KD_SIGN;
                  this.motorErrP[idx] = kpUse * ts * dRefUse;
                  this.motorErrD[idx] = -kdUse * ts * relL[k];
                  kPSpring = kpUse;
                  // 继续走下面的应用流程（跳过 KI/ZEROPASS 分支）
                  this.motorInt[idx] = 0;
                }
              }
            }
          }
          if (!(this.v4CalDone)) err = kpUse * ts * dRefUse - kdUse * ts * relL[k] * KD_SIGN;

          // ★★★★★ 2026-10-06 **V4：积分项（KI）——稳态支撑的经典载体**
          //   P-only ⇒ 稳态误差（= 实测"静姿 sag"）⇒ 用 K=48 放大误差换支撑；
          //   I 项 ⇒ 累积出稳态力矩（≈ 重力矩 −11~+20 N·m 量级）⇒ P 可降。
          //   抗饱和：积分值夹在 ±`KI_MAX`（N·m 当量，默认 40）；只在**非越界**时积。
          {
            const kiRaw = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).KI;
            if (kiRaw !== undefined && kiRaw !== '') {
              const KI = Number(kiRaw);
              if (Number.isFinite(KI) && KI !== 0) {
                const imaxRaw = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).KI_MAX ?? '');
                const imax = Number.isFinite(imaxRaw) && imaxRaw > 0 ? imaxRaw : 40;
                const dtI = this.lastDt > 1e-6 ? this.lastDt : 1 / 240;
                this.motorInt[idx] = this.motorInt[idx]! + dRefUse * KI * dtI;
                if (this.motorInt[idx]! > imax) this.motorInt[idx] = imax;
                else if (this.motorInt[idx]! < -imax) this.motorInt[idx] = -imax;
                err += this.motorInt[idx]!;
              }
            }
          }
          {
            const zp = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).ZEROPASS;
            if ((zp === '1' || zp === 'on') && this.motorTarget[idx] === 0) {
              kpUse = 0;
              err = -kdUse * ts * relL[k] * KD_SIGN;
              this.motorErrP[idx] = 0;
              this.motorErrD[idx] = -kdUse * ts * relL[k];
            }
          }
          this.motorErrP[idx] = kpUse * ts * (thRef - a);
          this.motorErrD[idx] = -kdUse * ts * relL[k];
        }

        // ⚠ 已回退（2026-10-02）：曾在这里加「越界就清零该轴相对角速度」并注释为"速度级硬限位"、
    //   "接触力再大也过不去"。**那个注释是错的** —— `relL` 只是马达的误差项，
    //   清零它只让马达不再往外推，**不会改变关节的真实角速度**；实测踝从 +45°
    //   恶化到 **+117°**。
    // ─────────────────────────────────────────────────────────────────────
    // ★★★ **真正的关节限位**：越界时对两刚体施加**角冲量**，把越界方向的相对角速度
    //   **精确抵消为零**（零穿透反弹）。这才是物理约束，接触力再大也过不去。
    //
    //   为什么必须自己做（Rapier 0.14 的限制，已查源码确认）：
    //     · `JointData.spherical()` 的球铰**不启用限位**；
    //     · JS 封装只读 `limits[0]` / `limits[1]` —— **单一 (min,max) 对**
    //       （`dynamics/impulse_joint.js:399-400`），**没有逐轴限位**；
    //     · `JointData.generic` 只有 1 个自由度，替代不了 3 自由度的球铰。
    //   ⇒ 逐轴限位只能自己在**冲量层**实现。
    //
    //   实现：设该轴的相对角速度为 ω_rel（越界方向），施加冲量
    //       J = −ω_rel · I_eff
    //   给子体 `+J`、给父体 `−J`（沿该轴的世界方向）⇒ ω_rel 恰好归零，
    //   等价于一个恢复系数 e=0 的限位挡块。惯量取 `jointIeff`（该轴有效惯量）。

        // ★★ 不能在这里短路：力矩通道与位置环**是两条独立的路径**。
        //   旧代码 `if (err === 0) continue;` 在加上力矩之前就跳过了整个关节，
        //   于是 `torqueCmd` 也一起被丢掉。
        //   后果（实测，箭態站立）：
        //     大脑算出 `q_vip = 25.5°` → `τ = −120 N·m`（顶到限位），
        //     但那一轴**没有人写角度目标** ⇒ `err = thRef−a → 0` 位于平衡点
        //     → 短路触发 ⇒ 力矩从未下发。
        //   实测体现：腰台归属“保持”（= bind，未有人提询）、腰力矩权限仅 **30%**。
        //   → “正常的身体、神经系统、大脑不发令”——大脑发了，令被中途丢掉。
        // ★ 逐帧回读用：参考角 / 误差 / 二分之后的实际 α
        this.motorThRef[idx] = thRef;
        this.motorErr[idx] = err;
        this.motorTauFF[idx] = this.torqueCmd[idx]!;
        const ffEarly = this.torqueCmd[idx]!;
        // 只有“位置环错差为 0 **且**力矩通道也没使用”才真的无事可做。
        if (err === 0 && ffEarly === 0) continue;

        const tauMax = j.maxTorque[k] * scale;
        let tau = err * (tauMax / (JOINT_MAX_SPEED * JMS_SCALE));
        if (tau > tauMax) tau = tauMax;
        else if (tau < -tauMax) tau = -tauMax;
        // ★★★ 与 `τ = JᵀF` 的直接力矩通道**相加**后再饱和。
        //   位置环给反馈、力矩通道给前馈；不叠加就只能二选一，而单腿站立
        //   需要前馈（52 N·m 量级的静态髋力矩）在位。
        let tq = this.torqueCmd[idx]!;
        // ★★★★★ 2026-10-06 **GRAVTAU：解析重力补偿 → τ 通道**（两条分支共用！
        //   支撑腿走 branch 2 让位 ⇒ 只有 τ 通道能到它）
        {
          const gRaw = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).GRAVTAU;
          if (gRaw === '1' || gRaw === 'on' || V4_MODULE_MODE()) {
            const gff = this.computeGravityTau()[idx]!;
            const gsRaw = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).GRAVSIGN ?? '');
            const gs = Number.isFinite(gsRaw) && gsRaw !== 0 ? Math.sign(gsRaw) : 1;
            tq += gs * gff;
          }
        }
        if (tq !== 0) {
          tau += tq;
          if (tau > tauMax) tau = tauMax;
          else if (tau < -tauMax) tau = -tauMax;
        }
        // ★★★★★ 2026-10-06 **执行器 slew-rate 限**（`TAUSLEW` N·m/s；0=关）——
        //   环路稳定候选#2：速率限是非线性消振（小振幅极限环被描述函数衰减），
        //   而低通已证负。此处是**最后一道执行器物理**，不含控制延迟。
        {
          const sl = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).TAUSLEW;
          if (sl !== undefined && sl !== '') {
            const rate = Number(sl);
            if (Number.isFinite(rate) && rate > 0) {
              const prev = this.tauApplied[idx]!;
              const maxD = rate * dt;
              if (tau - prev > maxD) tau = prev + maxD;
              else if (prev - tau > maxD) tau = prev - maxD;
            }
          }
        }
        // ★★★★★ 2026-10-06 **滑移安全帽（用户诊断：一发力脚就打滑）**
        //   物理：关节 τ 通过肢体传到地面成切向力 Fh ≈ τ/h（h=关节离地高度），
        //   滑移判据 Fh ≤ μFv ⇒ **τ_j ≤ μ·Fv·h_j**。
        //   实测量级：μ=0.75、Fv=560、踝 h≈0.07 ⇒ 踝上限 ≈ 30 N·m；
        //   而我们的踝 τ 打到 120（4×）⇒ 每次发力都超滑移极限。
        //   人体站立踝 5~15 N·m 正是这个物理的结果。
        //   `V4SLIPCAP=1` 开；`V4MU`（默认 0.7）安全系数；`V4CAPM` 全局缩放。
        {
          const sc = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V4SLIPCAP;
          if ((sc === '1' || sc === 'on') && (V4_MODULE_MODE() || sc === '1')) {
            const mu = (() => {
              const raw = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V4MU ?? '');
              return Number.isFinite(raw) && raw > 0 ? raw : 0.7;
            })();
            let fvTot = 0;
            const dtS = this.physicsDt > 1e-9 ? this.physicsDt : 1 / 240;
            for (let q = 0 as 0 | 1; q < 2; q++) {
              const f = this.soleForceProfile((q as 0 | 1), dtS).fz;
              if (Number.isFinite(f) && f > 0) fvTot += f;
            }
            if (fvTot < 40) fvTot = this.sk.massTotal * 9.81;
            this.jointWorld(i, this.axisWorldTmp);
            const hJ = Math.max(0.02, this.axisWorldTmp[1] - 0.0);
            const capM = (() => {
              const raw = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V4CAPM ?? '');
              return Number.isFinite(raw) && raw > 0 ? raw : 1.0;
            })();
            const cap = mu * fvTot * hJ * capM;
            if (tau > cap) tau = cap;
            else if (tau < -cap) tau = -cap;
          }
        }
        // ★★★★★ 2026-10-06 **极性保驰（用户：「脚发力后必须保证真能把腰拽过来」）**
        //   实测：支撑踝 τ 的 0.2s 净均值 = −24~−33 N·m（真实持续拉力 ✓），
        //   但逐拍在 ±120 翻号 ⇒ SNR 1:5 ⇒ 抖动盖过信号。
        //   `SIGNHOLD=<秒>`：τ 要翻号时，若距上次翻号不足该时长 ⇒ **归零等待**
        //   （不在新极性上抖，也不带着旧极性硬顶）——让每个极性段至少持续 dwell。
        {
          const shRaw = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).SIGNHOLD ?? '');
          if (Number.isFinite(shRaw) && shRaw > 0) {
            const now = this.clock;
            const sgn = tau > 1e-6 ? 1 : tau < -1e-6 ? -1 : 0;
            const last = this.signState[idx] ?? 0;
            if (sgn !== 0 && sgn !== last) {
              if (last !== 0 && now - (this.signT[idx] ?? 0) < shRaw) {
                tau = 0;   // 保驰期内：翻号 → 归零等待
              } else {
                this.signState[idx] = sgn;
                this.signT[idx] = now;
              }
            } else if (sgn !== 0) {
              this.signT[idx] = now;   // 同号持续：刷新
            }
          }
        }
        this.tauApplied[idx] = tau;
        this.motorDemand[idx] = tau;   // ★ 削之前的"想要值"，供诊断
        let imp = tau * dt;

        // ★ 稳定性上限：|imp| ≤ α·|err|·Ieff ⇒ 每步最多吃掉 α 比例的相对角速度误差
        // ★ 有 `τ = JᵀF` 前馈在该轴时，稳定性护栏对**前馈部分**不适用
        //   （护栏的物理含义是"每步最多吃掉 α 比例的相对角速度误差"，
        //    只对反馈项有意义）。前馈单独记账、不受此限。
        const ff = this.torqueCmd[idx]!;
        // 弹簧分量的冲量（护栏要用，见下面的说明）
        const impSpring = Math.abs(kPSpring * ts * (thRef - a))
          * (j.maxTorque[k] * scale / (JOINT_MAX_SPEED * JMS_SCALE)) * dt;
        // ★★★ **护栏只该管阻尼项，不管弹簧项**（2026-10-05 修，柔性足 F2 逼出来的）。
        //
        //   原式 `|imp| ≤ α·|err|·Ieff + |ff|·dt` 里的 `err = kP·Δθ + kD·ω`
        //   **混了弹簧与阻尼**。物理上：
        //     · **阻尼项** `kD·ω` 的作用就是"每步吃掉 α 比例的相对角速度误差"
        //       ⇒ 对它用 `α·|kD·ω|·Ieff` 是**正确**的稳定上限；
        //     · **弹簧项** `kP·Δθ` 的职责是**对抗外载**（重力、地面反力），
        //       它要多大由**平衡**决定，上限本来就该由 **τmax** 兜底
        //       （上面 `tau` 已经夹过一次）。把它也套进 `α·Ieff` 是错的。
        //
        //   ⚠⚠ 对**小惯量刚体**这个错误是致命的：弓 `m=0.123kg`、质心离关节
        //   ~40mm ⇒ `Ieff ≈ 2e-4 kg·m²`。护栏上限 = `1×9×2e-4 = 1.8e-3`，
        //   而弹簧项需要的冲量是 `τ=16.8 N·m × dt(1/120) = 0.14`
        //   ⇒ **被限到 1.3%**。实测后果：`archStiffness` 从 3 扫到 **260
        //   N·m/rad，弓角摆幅恒为 20°（满限位）、结果逐位相同** ——
        //   马达根本推不动，弓被地面反力直接压到限位。
        // ★★★★★ 2026-10-06 **阻尼护栏的量纲 bug**（`DMPFIX=1` 修）：
        //   "每步最多吃掉 α 比例的相对角速度误差" ⇒ `Δω = α·|relL|` ⇒
        //   `imp = Ieff·Δω = α·|relL|·Ieff`。原式**多乘了 `kDd·ts·dt`**
        //   （≈1/120）⇒ 允许量小 **120 倍** ⇒ D 项被剪到 ~0.7% ⇒ **全身等于没有阻尼**
        //   （实测 `motorAuthority` 常显 0~4%）。这是"泵能无人吸收"的直接原因。
        // ★★★★★ 2026-10-06（用户："脚部必须有阻尼，脚部没阻尼只会一直抖"）
        //   V4 架构下**强制**用正确量纲（真阻尼），不再受历史调参包围影响。
        const dampFix = DMPFIX || V4_MODULE_MODE();
        const impDamp = dampFix
          ? alpha * Math.abs(relL[k]) * Ieff
          : alpha * Math.abs(kDdEff * ts * relL[k]) * Ieff * dt;
        const impStable = impDamp + Math.abs(ff) * dt + Math.abs(impSpring);
        const impWant = imp;
        if (imp > impStable) imp = impStable;
        else if (imp < -impStable) imp = -impStable;
        if (imp === 0) continue;
        // ★ 记录权限：护栏放行了百分之多少。<1 ⇒ 被护栏卡住（不是"指令小"）
        this.motorAuthority[idx] = Math.min(1, Math.abs(imp) / Math.max(1e-12, Math.abs(impWant)));
        this.footAuthUsed[idx] = gf;

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

      // ══════════════════════════════════════════════════════════════════════
      // ★★★ **逐轴物理限位**（冲量层，见上方说明：Rapier 0.14 球铰不支持逐轴限位）
      //   越界且还在往外走 ⇒ 施加 `J = −ω_rel·I_eff` 的角冲量，把该轴相对角速度**归零**。
      //   这是恢复系数 e=0 的限位挡块：可以停在限位上，但过不去。
      //   实测依据（不加这个的代价）：
      //     · 踝标称限位 `[−10°, +18°]`，实测跑到 **+117°**（超 6.5 倍）
      //     · 踝过背屈 ⇒ 脚尖压地 ⇒ 摆动脚高度 **−18mm**（在地面以下）
      //     · 膝屈 −70° 带来的抬升被完全抵消 ⇒ 摆动腿**从未离地** ⇒ 换脚恒为 0
      //   只在**确实越界**时介入，限位内的正常 PD 完全不受影响。
      for (let k = 0; k < 3; k++) {
        const lo2 = j.minRad[k], hi2 = j.maxRad[k];
        // ⚠⚠ 2026-10-06：这行 `continue` 曾经把**脊柱全部三轴**排除在限位之外。
        //
        //   注释写的是「该轴不限位（脊柱等）」—— 但脊柱是**有限位**的：
        //   `skeleton.ts` 的 `SPINE_XY_DEG = [15, 20]`、`SPINE_FLEX_DEG = [−25, 25]`
        //   ⇒ `hi − lo` 是 30°/40°/50°，远小于 `2π` ⇒ 这条 continue **不会命中**。
        //   （真正的「不限位」判据是 `spherical()` 球铰没有限位 API，
        //     而不是量程大。所以这行注释本身也是错的。）
        //
        //   ⇒ 结论：脊柱确实走本函数，问题**不在**这里，而在下面两处（都已修）：
        //     ① 惯量用 `jointIeff`（最大主惯量并联）⇒ 施加效果远小于算出的权限；
        //     ② `wErr = bias − wRel` 里 `wRel` 无界 ⇒ 冲量本身可成为甩飞源。
        if (hi2 - lo2 >= Math.PI * 1.99) continue;      // 真的是 360° 全开（不限位）
        const a2 = this.jointRotAxis(i, k);
        const out = a2 > hi2 ? 1 : a2 < lo2 ? -1 : 0;
        if (out === 0) continue;
        // 该轴相对角速度（沿本地轴 k，世界方向由父体姿态决定）
        let w: number;
        if (k === AXIS_X) w = c.angvel().x - p.angvel().x;
        else if (k === AXIS_Y) w = c.angvel().y - p.angvel().y;
        else w = c.angvel().z - p.angvel().z;
        if (k === AXIS_X) quatRotate(qp.x, qp.y, qp.z, qp.w, 1, 0, 0, this.axisW);
        else if (k === AXIS_Y) quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 1, 0, this.axisW);
        else quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 0, 1, this.axisW);
        // 世界角速度在该轴上的分量
        const av = c.angvel(), ap = p.angvel();
        const wRel = (av.x - ap.x) * this.axisW[0] + (av.y - ap.y) * this.axisW[1] + (av.z - ap.z) * this.axisW[2];
        void w;
        // ══════════════════════════════════════════════════════════
        // ★★★★★ 2026-10-06 **位置回正**（修"轴停在界外 58°"的真虫）。
        //
        //   原判据「只有还在往越界方向走才拦（`wRel≤0` 就 continue）」——
        //   它只做**速度归零**，没有**位置回正**：外载把轴推出界后一旦速度
        //   反向（振荡/载荷变化），限位就"放假"，轴**停在界外**
        //   （实测 `spine1/0` 峰值 **58.3°** vs 限位 15°）。
        //
        //   修法：越界时设定一个**回正目标角速度** `wTar = −out·vRest`：
        //     · `vRest = clamp(LIMIT_BIAS_RATE(=20) × 越界量, 0, LREST(=3 rad/s))`
        //       —— 越界越多、回正越快，但封顶（防止把脊柱再甩一次）；
        //     · 只要**没达到回正目标速度**就施加冲量 `J = (wTar − wRel)·Iax`
        //       （不再只看方向）⇒ 界外必有回正力。
        //   `LREST=0` 回退旧行为（A/B）。
        const vRestCap = (() => {
          const v = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).LREST ?? '');
          return Number.isFinite(v) && v > 0 ? v : 3.0;
        })();
        const violR = out > 0 ? a2 - hi2 : lo2 - a2;
        const wTar = -out * Math.min(LIMIT_BIAS_RATE * violR, vRestCap);
        if (out > 0 ? wRel <= wTar : wRel >= wTar) continue;
        // ★★ 冲量惯量必须是「**该轴**」的并联折合惯量，不能用预存的
        //   `jointIeff`（2026-10-04 修踝限位失效）。
        //
        //   `jointIeff[i]` 在构造里算的是**两个刚体各自主惯量的最大值**的并联
        //   （`1/(1/max(I_s) + 1/max(I_f))`）—— 那是给**马达稳定性护栏**用的
        //   "保守上界"，因为护栏卡紧不会破坏物理。
        //   但**限位冲量要的是"恰好归零"**，用偏大的惯量 ⇒ 实际角速度变化
        //   `Δω = J / I_该轴` 远超需要的 `−ω_rel` ⇒ **过冲并反向** ⇒ 再次越界
        //   ⇒ 再过冲（正反馈）。
        //
        //   实测（踝 foot_l，脚掌 m=1.01kg、主惯量 I=(1.07e-2, 5.88e-3, 6.70e-3)）：
        //     jointIeff(踝) = 8.77e-3（用两个 max 的并联）
        //     轴0 roll  该轴真实惯量 5.88e-3 ⇒ 冲量偏大 **1.5×**
        //     轴1 twist 该轴真实惯量 4.12e-3 ⇒ 冲量偏大 **2.1×**
        //   过冲被驱动力平衡 ⇒ 角度**停在稳定值**（实测 +87.1° / −59.7°，
        //   而限位是 ±14 / −10）—— 这也解释了为什么改判据（角速度→位置）
        //   或把增益放大 33 倍都只改善个位数度数：**错的不是判据也不是增益，
        //   是惯量**。
        //
        //   这里按 `axisW` 把两体的主惯量旋到该轴上再取分量，做真正的轴向折合。
        const Iax = this.axisInertia(i, k);
        const J = (wTar - wRel) * Iax;   // ★ 位置回正版（原为 −wRel·Iax = 只归零）
        const jv = this.iv;
        jv.x = this.axisW[0] * J; jv.y = this.axisW[1] * J; jv.z = this.axisW[2] * J;
        c.applyTorqueImpulse(jv, true);
        jv.x = -jv.x; jv.y = -jv.y; jv.z = -jv.z;
        p.applyTorqueImpulse(jv, true);
        this.limitHits++;
      }
    }
  }

  /**
   * ★★★ **足底虚拟支撑点**（Virtual Support Point）—— 让踝获得 CoP 权限。
   *
   *   ── 为什么需要（2026-10-02 实测确立）───────────────────────────
   *     物理账户：体重 687 N、CoP 杠杆 75 mm ⇒ 撑住不动需要 **52 N·m** 踝力矩；
   *     人类跖屈肌 MVC ~120~140 N·m，我们的踝只有 45 N·m。
   *     但把踝从 45 抬到 120/160/220 N·m，存活反而**变差**（1.77s → 0.65s）——
   *     说明**不是力矩不够**，而是**力矩传不到地面**。
   *     原因：**足底是刚性平底盒**，压在平地上时踝一转只是把盒面压实，
   *     压力中心被几何锁在接触面形心 ⇒ 踝**无法移动 CoP**
   *     （这一现象已被四种独立测法确认：kCop×33 / ankleTorque×9 / VIP刚度比×3.7
   *      / 踝限幅收紧，全都不改变 CoM 与存活）。
   *     ⇒ 踝策略（= CoP 策略，文献里的**主力**）在本 rig 里结构性失效，
   *       矢状面只能由髋代偿，而髋效率只有跖屈肌的 **1/4**
   *       （Neptune & Perry, Front Neurol 2019, 10:999）⇒ 必然饱和 ⇒ 必然倒。
   *
   *   ── 物理依据 ──────────────────────────────────────────────────
   *     Morasso et al., Front Comput Neurosci 2022, 15:956932：
   *       踝策略 = "**CoP strategy**" —— "the role of the active intermittent control
   *       is to shift the position of the **CoP** on the support base"。
   *     Michaels & Ting, Sci Rep 2025, 15:97637：
   *       "The biomechanical constraint was defined as the **CoP range limitation to
   *       the metatarsal joint**" ⇒ CoP 能在**脚掌内**前后移动，出界则踝力矩饱和。
   *     Wright et al.（同上引述）：脚**不是刚性基座，而是有柔性的**，
   *       "sensitive to minute deformations" ⇒ 压力中心可移动有物理来源。
   *
   *   ── 本实现的做法（不是加肌肉）──────────────────────────────────
   *     在足底维护一个**沿足长轴滑动的虚拟接触点** `copOffset`：
   *       · `copOffset ∈ [−halfLen, +halfLen]`（跖骨头 ↔ 足跟，Sci Rep 2025 的行程）
   *       · 每步在**真实接触点**处施加一个支撑力，而不是让刚体盒自己决定压力中心
   *       · 位置由踝指令（VIP 的 `ankleSag`）驱动
   *     等价于"足底有微小柔性"，让踝力矩真正产生 GRF 力矩 ⇒ CoP 可控。
   *
   *   ⚠ 已知局限：`copOffset` 是**运动学**的（直接给定位置），不含足底软组织的
   *     本构关系；要更真实需要把足底建成若干带弹簧的子段。
   */
  private copOffset = new Float64Array(2);   // [左, 右]，沿足长轴，单位 m

  /** 设置某只脚的 CoP 位置（相对踝/足中心，沿足长轴；超出 ±halfLen 会被钳住） */
  setCoP(side: 0 | 1, offset: number, halfLen: number): void {
    this.copOffset[side] = Math.max(-halfLen, Math.min(halfLen, offset));
  }

  getCoP(side: 0 | 1): number { return this.copOffset[side]; }

  /**
   * ★★★ **逐轴物理限位**（冲量层）—— **必须在 `world.step()` 之后调用**。
   *
   * 为什么自己做（Rapier 0.14 的限制，已查源码确认）：
   *   · `JointData.spherical()` 的球铰不启用限位；
   *   · JS 封装只读 `limits[0]`/`limits[1]` —— **单一 (min,max) 对**
   *     （`dynamics/impulse_joint.js:399-400`），**没有逐轴限位**；
   *   · `JointData.generic` 只有 1 自由度，替代不了 3 自由度的球铰。
   *
   * 机制：越界且还在往外走 ⇒ 施加 `J = −ω_rel·I_eff` 的角冲量，把该轴相对角速度
   * **归零**（恢复系数 e=0 的限位挡块）。往回走不拦，否则锁死回程。
   *
   * ★★ 为什么必须放在步**后**（2026-10-02，两次踩坑）：
   *   ① 放步前（= `driveMotors` 里，而它在 `world.step()` 之前）⇒ 求解器在步内
   *      产生的接触响应完全看不见 ⇒ 踝实测跑到 **+96.5°**（限位 +18°，88% 帧越界）。
   *   ② 惯量不能用 `jointIeff`（它取的是**主惯量的最小值**，`Math.min(I.x,I.y,I.z)`，
   *      对细长的脚掌极小）⇒ 冲量严重不足。这里改用**两体沿该轴的惯量之和**，
   *      由 `principalInertia()` 在该轴上的分量估一个保守下界。
   */
  /**
   * 某关节某轴的**并联折合惯量**（限位冲量用）。
   *
   * ★ 必须按**该轴**取值，不能用 `jointIeff`（那是两个刚体各自主惯量**最大值**
   *   的并联，是给马达护栏用的保守上界）。偏大 ⇒ 限位冲量过冲 ⇒ 正反馈发散。
   *   详见 `enforceLimits` 里 `J = -wRel * Iax` 处的长注释。
   */

  /** 关节世界位置复用缓冲（`axisInertiaAtJoint` 用） */
  private readonly jwTmp = new Float64Array(3);

  /**
   * ★★★★★ **绕关节轴的有效惯量（含平行轴项 `m·d²`）** —— 2026-10-06 修。
   *
   *   原实现（`jointIeff` 与 `axisInertia` **两处都**）只用了刚体**绕自身质心**的
   *   主惯量（`Iax = 1/(1/Ip + 1/Ic)`，`Ip = n·(I_p∘n)`）——**完全没有平行轴项**。
   *   而关节的有效惯量里 `m·d²` 是**主导项**：
   *     膝：小腿+脚 ~4kg、质心离膝 ~0.2m ⇒ `m·d² ≈ 0.16 kg·m²`，
   *     绕质心的主惯量只有 ~0.02 ⇒ **实测 `jointIeff` 报 0.037，真值在 0.2 量级**。
   *
   *   ⇒ 后果（本轮实测，`probe-firstframes` 逐拍）：
   *     拍0 `knee_l/2` imp 0.048 N·m·s（τ 仅 **5.7 N·m**）、I_eff 0.037 **⇒ Δω 73°/s**
   *     拍6 `knee_r/2` imp 0.256（τ 30.7）                                   **⇒ 390°/s**
   *     而 τ **没饱和**（τmax 120~200）、护栏也没夹 ⇒ 执行器层等效增益大 5~20 倍
   *     ⇒ **逐拍"上劲"**（`max|ω|` 31→277°/s 而 CoM 一动不动）⇒ 踝的阻尼响应它
   *     ⇒ CoP 被推到脚尖侧 ⇒ 水平力向后 ⇒ **开始后倒**。
   *   ⇒ 这才是"一开始明明没问题，却站不准"的**根**。
   *
   *   ★ 构造期算一次就够：旋转关节的轴在该刚体**体坐标系**里固定，
   *     质心到该轴线的垂距**不随姿态变** ⇒ 一次计算是**精确**的。
   */
  private axisInertiaAtJoint(i: number, k: number): number {
    const p = this.bodies[this.jointBodies[i * 2]!];
    const c = this.bodies[this.jointBodies[i * 2 + 1]!];
    const ip = p.principalInertia(), ic = c.principalInertia();
    const q = p.rotation();
    const axk = k === 0 ? 1 : 0, ayk = k === 1 ? 1 : 0, azk = k === 2 ? 1 : 0;
    quatRotate(q.x, q.y, q.z, q.w, axk, ayk, azk, this.axisW);
    const a = this.axisW;
    this.jointWorld(i, this.jwTmp);
    const jw = this.jwTmp;
    const par = (rb: RAPIER.RigidBody): number => {
      const m = rb.mass();
      if (!(m > 1e-9)) return 0;
      const cw = rb.worldCom();
      const rx = cw.x - jw[0]!, ry = cw.y - jw[1]!, rz = cw.z - jw[2]!;
      const d2 = rx * rx + ry * ry + rz * rz - (rx * a[0]! + ry * a[1]! + rz * a[2]!) ** 2;
      return m * Math.max(0, d2);
    };
    const Ip = a[0]! * a[0]! * ip.x + a[1]! * a[1]! * ip.y + a[2]! * a[2]! * ip.z + par(p);
    const Ic = a[0]! * a[0]! * ic.x + a[1]! * a[1]! * ic.y + a[2]! * a[2]! * ic.z + par(c);
    return Math.max(1e-9, 1 / (1 / Math.max(1e-9, Ip) + 1 / Math.max(1e-9, Ic)));
  }

  /** ★ 平行轴修正是否已用真实 wasm 句柄重算过 `jointIeff` */
  private iEffRefined = false;

  /**
   * ★★★★★ **在运行期把平行轴项补进 `jointIeff`**（2026-10-06）。
   *
   *   为什么不能在构造期做：构造期 `jointWorld`/`body.worldCom()` 会拿到**未就绪**
   *   的 wasm 句柄 ⇒ `probe:domain` 在 `World.step` 里 **RuntimeError: unreachable**。
   *   ⇒ 改成**首拍懒算**（`driveMotors` 第一行调用），此时一切句柄都合法。
   *
   *   背景（本轮实测，`probe-t0`）：
   *     · 前 0.1s 重心**不动**，但执行器在**泵能量**（KE 0.024→1.13J/0.12s，
   *       正功率 5.7→420W；而**不调控制时恰好 0W**）
   *     · 泵是 `hip_l`/`knee_l` **全 `bind`**（无人写、目标=0=静姿态）的轴：
   *       角度仅 0.1~0.6°、ω=±17~41°/s、τ=±1~69 N·m ⇒ **τ·ω>0**
   *     · 消融 sag/lat/weight/qp/waistHold/sagJf **逐位相同** ⇒ 泵在常开 PD 里
   *     · `KD_SIGN=-1` 灾难性更糟、`JMS×6` 更糟 ⇒ 不是符号也不是简单增益
   *
   *   本修的作用：护栏 `impStable = α·|kd·ω|·Ieff·dt + |impSpring|` 里的 `Ieff`
   *   从"只有绕质心主惯量"（0.037）变成**含 `m·d²`**（0.09~0.2，+3~5×）。
   *   ⚠ 注意方向性：`Ieff` 变大 ⇒ `impStable` 变大 ⇒ 护栏**更宽松**；
   *     它的目的是让 `Δω = imp/I_real` 与"每步吃掉 α 比例速度误差"这句话**一致** ——
   *     原值偏小 3~5× ⇒ 那句话实际不成立。**是否解决泵，由 `probe-t0` 的 KE 判定。**
   */
  /** ★★★★★ 2026-10-06 **GRAVTAU：解析重力补偿（几何法，无 FK）**
   *
   *  τ_grav(关节 i, 轴 k) = Σ_{b∈子树(子)} m_b·g·((pos_b − anchor) × ŷ)·â
   *
   *  · `anchor = pos(父) + R(q父)·parentLocal`（关节世界锚点）
   *  · `â = R(q父)·ê_k`（轴世界方向，与 `enforceLimits` 同约定）
   *  · `pos_b` = 刚体世界位置（Rapier 现读，**姿态自动精确**——修掉"固定 FF 失配"）
   *  · `ŷ` = (0,1,0)；`g` = 9.81
   *  符号由调用处的 `GRAVSIGN` 标定。
   */
  private buildGravSub(): void {
    if (this.gravSub) return;
    const nj = this.sk.joints.length;
    const nb = this.sk.bodies.length;
    // 父子关系：关节 i 连接 jointBodies[2i]（父）→ jointBodies[2i+1]（子）
    const childrenOf: number[][] = Array.from({ length: nb }, () => []);
    for (let i = 0; i < nj; i++) {
      const p = this.jointBodies[i * 2]!, c = this.jointBodies[i * 2 + 1]!;
      if (p >= 0 && c >= 0 && p < nb && c < nb) childrenOf[p]!.push(c);
    }
    const sub: number[][] = [];
    for (let i = 0; i < nj; i++) {
      const c0 = this.jointBodies[i * 2 + 1]!;
      const list: number[] = [];
      const stack = [c0];
      while (stack.length) {
        const b = stack.pop()!;
        if (b < 0 || b >= nb) continue;
        list.push(b);
        for (const cc of childrenOf[b]!) stack.push(cc);
      }
      sub.push(list);
    }
    this.gravSub = sub;
    this.gravFFCache = new Float64Array(nj * 3);
  }

  /** 每拍算一遍重力矩 FF（N·m，未定符号）。返回长度 nj*3 的缓存。 */
  private computeGravityTau(): Float64Array {
    this.buildGravSub();
    const out = this.gravFFCache;
    const nj = this.sk.joints.length;
    const G = 9.81;
    for (let i = 0; i < nj; i++) {
      const jd = this.sk.joints[i]!;
      const pb = this.bodies[this.jointBodies[i * 2]!];
      if (!pb) { out[i * 3] = 0; out[i * 3 + 1] = 0; out[i * 3 + 2] = 0; continue; }
      const q = pb.rotation();
      const pp = pb.translation();
      const pl = jd.parentLocal;
      // anchor = pos(父) + R(q父)·parentLocal
      let axR = 0, ayR = 0, azR = 0;
      quatRotate(q.x, q.y, q.z, q.w, pl[0]!, pl[1]!, pl[2]!, this.axisWorldTmp);
      axR = pp.x + this.axisWorldTmp[0]!; ayR = pp.y + this.axisWorldTmp[1]!; azR = pp.z + this.axisWorldTmp[2]!;
      // 三轴的世界方向
      const sub = this.gravSub![i]!;
      for (let k = 0; k < 3; k++) {
        let tau = 0;
        // â = R(q父)·ê_k
        quatRotate(q.x, q.y, q.z, q.w, k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0, this.axisWorldTmp);
        const ax = this.axisWorldTmp[0]!, ay = this.axisWorldTmp[1]!, az = this.axisWorldTmp[2]!;
        for (const bi of sub) {
          const bb = this.bodies[bi]!;
          const t = bb.translation();
          const m = bb.mass();
          const rx = t.x - axR, ry = t.y - ayR, rz = t.z - azR;
          // (r × ŷ) = (rz, 0, −rx)   [ŷ=(0,1,0)]
          // τ = m·g·((r×ŷ)·â) = m·g·(rz·ax + 0·ay + (−rx)·az)
          tau += m * G * (rz * ax - rx * az);
        }
        out[i * 3 + k] = tau;
      }
    }
    return out;
  }

  private refineJointIeff(): void {
    if (this.iEffRefined) return;
    this.iEffRefined = true;
    for (let i = 0; i < this.sk.joints.length; i++) {
      let mx = 0;
      for (let k = 0; k < 3; k++) mx = Math.max(mx, this.axisInertiaAtJoint(i, k));
      if (mx > 0 && Number.isFinite(mx)) this.jointIeff[i] = mx;
    }
  }

  private axisInertia(i: number, k: number): number {
    const p = this.bodies[this.jointBodies[i * 2]];
    const c = this.bodies[this.jointBodies[i * 2 + 1]];
    const ip = p.principalInertia(), ic = c.principalInertia();
    // 把该局部轴旋到世界（用父体姿态，和 enforceLimits 里 axisW 一致）
    const q = p.rotation();
    const ax = [0, 0, 0];
    ax[0] = k === 0 ? 1 : 0; ax[1] = k === 1 ? 1 : 0; ax[2] = k === 2 ? 1 : 0;
    quatRotate(q.x, q.y, q.z, q.w, ax[0], ax[1], ax[2], this.axisW);
    const a = this.axisW;
    // I_world = R · diag(Ix,Iy,Iz) · Rᵀ ⇒ 取该轴分量 I_k = a·(I∘a)
    // ⚠ 2026-10-06：这里也试过加平行轴项 `m·d²`（+3×，见 `axisInertiaAtJoint`），
    //   与 `jointIeff` 同时改会触发构造期句柄问题 ⇒ 一起回退。
    //   单改这一处（运行期）应当安全，但**必须先单独验证**（本会话未做）。
    let Ip = a[0] * a[0] * ip.x + a[1] * a[1] * ip.y + a[2] * a[2] * ip.z;
    let Ic = a[0] * a[0] * ic.x + a[1] * a[1] * ic.y + a[2] * a[2] * ic.z;
    // ★★★★★ 2026-10-06 P0：**平行轴项 `m·d²`**（只改这一处，运行期，安全）。
    //
    //   病史：本函数此前只有"绕**自身质心**的 I_k 分量"，而限位冲量转的是**关节轴**
    //   （过关节锚点）⇒ 每条肢体绕该轴的真实惯量是 `I_com + m·d²`（d = 质心到轴的垂距），
    //   对四肢 d≈0.15~0.45 m、m≈1~10 kg ⇒ **真实惯量是旧值的 3~10 倍**。
    //   冲量效果 ∝ 惯量 ⇒ 旧值算出来的"限位权限"比实际施加的**强 3~10 倍**的假象，
    //   实际上限位弱得赢不了马达（`probe-jointtrace`：膝 ball 窄轴被撕到 −187°、
    //   脊柱 −55.9°/−104.8°）。
    //   ⚠ 与 `jointIeff` 的区别：那个是**构造期**调用（句柄未就绪，一起改会崩，
    //     2026-10-06 已回退并记档）；本函数是**运行期**每一物理步调用，句柄合法。
    const jw = new Float64Array(3);
    this.jointWorld(i, jw);
    const parAx = (b: { translation(): { x: number; y: number; z: number }; mass(): number }, Icom: number): number => {
      const t = b.translation();
      const dx = t.x - jw[0]!, dy = t.y - jw[1]!, dz = t.z - jw[2]!;
      const along = dx * a[0]! + dy * a[1]! + dz * a[2]!;
      const d2 = Math.max(0, dx * dx + dy * dy + dz * dz - along * along);
      return Icom + b.mass() * d2;
    };
    // ★★★★★ 2026-10-06 **回退（当天改错、当天回退，用户实测"落地散架"）**：
    //   本函数的冲量是 `applyTorqueImpulse`（**力偶**，见下方施加处）。
    //   力偶的角速度响应是 `Δω = J / I_com`（绕**质心**、沿偶矩方向的惯量分量），
    //   **与关节锚点的位置无关** ⇒ 正确的惯量就是 `I_com` 分量，
    //   **不能**加平行轴项 `m·d²`（那是"过关节点的**力**冲量"才需要的）。
    //
    //   病史：P0 误把 `m·d²` 加上（以为限位是过点的力冲量）⇒ 惯量放大 3~10 倍
    //   ⇒ `J = wErr·Iax` 过冲 3~10 倍 ⇒ 每子步反向放大 ⇒ **速度指数发散**
    //   （角度看着贴住限位，其实是在剧烈抖振里被"钉住"）⇒
    //   瘫软/落地后**直接散架**。`AXPAR=1` 保留仅作该结论的对照。
    if (AX_PAR) { Ip = parAx(p, Ip); Ic = parAx(c, Ic); }
    const Iax = 1 / (1 / Math.max(1e-9, Ip) + 1 / Math.max(1e-9, Ic));
    // ⚠ 2026-10-06：`Math.min(Iax, jointIeff)` 这道**上界**必须去掉。
    //   `jointIeff` 用的是**最大**主惯量的并联，对细长段（脊柱）可以比该轴
    //   真实惯量**小** —— 于是这行把一个**偏小**的惯量返回给冲量计算，
    //   而冲量效果 ∝ 该值 ⇒ 施加的限位回复比"算出来的权限"**弱得多**
    //   ⇒ 限位 unenforceable（实测 `spine1/2` 越限后单调发散到限位的 2.9 倍）。
    //   ⇒ 冲量效果要精确，就必须用**该轴**的 `Iax`，不能被任何别的量截断。
    return Math.max(1e-9, Iax);
  }

  /** 调试用：跳过逐轴限位投影（测探 60Hz 周期-2 振动可否来自它） */
  skipLimits = false;
  enforceLimits(): void {
    if (this.skipLimits) return;
    for (let i = 0; i < this.sk.joints.length; i++) {
      const j = this.sk.joints[i];
      // ★★★ 2026-10-04 修：**跳过 revolute 的那根轴** —— 它已经有**引擎级限位**。
      //   踝（`foot_l/r`）与中足（`midfoot_l/r`）建成 `RevoluteImpulseJoint`，
      //   `createJoints` 里对 revoluteAxis 对应的那一轴调了 `joint.setLimits()`
      //   ⇒ Rapier 求解器**已经在管**它。再走一遍本函数 = 同一个限位被执行两遍：
      //     · 求解器先零掉越界方向的相对角速度；
      //     · 本函数看到"位置仍越界"又施加一次冲量 + 一次**位置级投影**，
      //       而投影把两体硬拽回界内 ⇒ 在步内反复触发。
      //   实测（tools/probe-midfoot.ts J 段）：踝角速峰值 **1815°/s**、鞋底滑移 87mm；
      //   关踝基线的髋也有 521°/s。角速上千度/秒就是这种"限位打架"泵能量。
      //   球铰（`GenericImpulseJoint`）**没有**任何 limits 方法（见 createJoints 注释），
      //   所以它们仍然必须走本函数 —— 这也正是本函数存在的理由。
      const revAx = j.revoluteAxis
        ? (j.revoluteAxis[0] !== 0 ? 0 : j.revoluteAxis[1] !== 0 ? 1 : 2)
        : -1;
      const pi = this.jointBodies[i * 2], ci = this.jointBodies[i * 2 + 1];
      const p = this.bodies[pi], c = this.bodies[ci];
      const qp = p.rotation();
      for (let k = 0; k < 3; k++) {
        if (k === revAx) continue;                     // ← 引擎已管
        const lo2 = j.minRad[k], hi2 = j.maxRad[k];
        if (hi2 - lo2 >= Math.PI * 1.99) continue;      // 该轴不限位（脊柱等）
        const a2 = this.jointRotAxis(i, k);
        const out = a2 > hi2 ? 1 : a2 < lo2 ? -1 : 0;
        if (out === 0) continue;
        // 该本地轴的世界方向（用父体姿态）
        if (k === AXIS_X) quatRotate(qp.x, qp.y, qp.z, qp.w, 1, 0, 0, this.axisW);
        else if (k === AXIS_Y) quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 1, 0, this.axisW);
        else quatRotate(qp.x, qp.y, qp.z, qp.w, 0, 0, 1, this.axisW);
        const av = c.angvel(), ap = p.angvel();
        const wRel = (av.x - ap.x) * this.axisW[0] + (av.y - ap.y) * this.axisW[1] + (av.z - ap.z) * this.axisW[2];
        // ★★★ 惯量必须用**并联折合惯量**，不是两个主惯量**求和**（2026-10-04 修）。
        //   限位冲量的意义是"恰好把越界方向的相对角速度归零"（恢复系数 e=0），
        //   这要求 `J = wRel × I_reduced`，其中两体被冲量耦合时的折合惯量是
        //       I_reduced = 1 / (1/I_parent + 1/I_child)   ← 并联，正是 `jointIeff`
        //   原来写成 `max(Ip) + max(Ic)`（**求和**），比折合值大 2~9 倍
        //   （等惯量时 sum = 2×harmonic；主惯量各不相等时可到 9×）⇒ 施加后
        //   实际角速度变化 `J/I_real` 远超 `wRel` ⇒ **不是归零而是过冲并反向**
        //   ⇒ 再次越界 → 再次触发 → 每子步放大 4~9 倍的正反馈
        //   ⇒ 肢体指数自旋（用户说的「到处乱飞」）。
        //
        //   实测（30 个随机基因组，walk 模式）：关掉本函数后最差 ωmax
        //   从 **157441** 降到 **104**；只关马达只能压到 5461（只是不触发）。
        //   诊断：逐子步对比 `|ω_rel|` 前后，neck 1.0→4.3 (4.2×)、
        //   shoulder_l 2.2→21.0 (9.4×)、elbow_l 26.6→96.7 (3.6×)。
        //
        //   ⚠ `jointIeff` 用的是两体**最大**主惯量的并联（见构造处注释），
        //     那条注释里"取最小值太小"是旧结论，早已改成 max；此处曾按旧结论
        //     改成求和，方向反了。
        const Iax = this.jointIeff[i];
        // ★★★ 2026-10-06：**这才是真正的权限**，上面那段注释里的 `jointIeff` 是错的。
        //
        //   `jointIeff` 是**两体各自最大主惯量的并联**：
        //       Iax = 1 / (1/max(I_parent) + 1/max(I_child))
        //   它对**限位冲量的效果**是**严重高估**的：施加 `J = wErr × Iax` 后，
        //   实际角速度变化是 `Δω_rel = J × (1/I_p(轴) + 1/I_c(轴))`
        //   而分子分母里的 `I(轴)` 是**该轴**的真实惯量（对脊柱那种细长段，
        //   最小主惯量可以比最大主惯量小 2~4 倍）。
        //
        //   实测（`probe-readout` ⑦）：
        //       spine1 的 `jointIeff` = 0.0414 kg·m²
        //       但 `spine1/2` 越限后**单调发散**（−1.4° → −52.9°，限位的 2.9 倍）
        //       ⇒ 冲量效果远小于"算出来的权限" ⇒ **按 `jointIeff` 算的限位在物理上
        //         并不存在**，无论 `biasCap` 调多大。
        //
        //   ⇒ 改成 `axisInertia(i, k)`：与 `driveMotors` 的护栏**同一个**折合惯量，
        //     且是**逐轴**的。这样「算出来的权限」与「实际施加的效果」才相等。
        const IaxEff = this.axisInertia(i, k);
        const jv = this.iv;
        // ── ① 速度级 + **位置级投影**（2026-10-04）
        //
        //   ⚠⚠ 此前这里**只有速度级**：`out>0 ? wRel>0 : wRel<0` 时把 `wRel` 归零
        //   （恢复系数 e=0）。**越界后 `wRel` 被归零 ⇒ 下一子步条件不再成立
        //   ⇒ 限位永久失效**，角度停在限位外、没有任何回复力。
        //   而 `RAPIER.JointData.revolute` **默认没有角度限位**
        //   （只锁 5 自由度、放开 1 转动）⇒ 本函数是唯一的角度约束。
        //   ⇒ 踝屈伸轴（轴2 = 绕 Z = 前视里脚长边的旋转方向）能一路转到 ±174°、
        //     越限 20~30% ⇒ 脚在前视图里侧翻 40~90°。
        //
        //   位置投影：给越界后的**目标角速度**一个指向限位内的偏置
        //       w_target = −clamp(20·excess, 0, 12)     （时间常数 50 ms）
        //   再把 `wRel` 驱到 `w_target`（而不是驱到 0）⇒ 关节被推回限位内。
        //   ⚠ **不能沿用原来那个方向守卫**：有了目标角速度之后，
        //     上侧限位（out=+1，需 `wRel` 变负）会因 `wErr > 0` 永不成立而**完全失效**。
        const excess = out > 0 ? a2 - hi2 : lo2 - a2;          // 超出量（>0）
        // ★★★ 2026-10-06：`LIMIT_MAX_BIAS`（全局 12 rad/s）彻底换掉。
        //
        //   原值 12 是**拍脑袋的角速度**，与该轴的惯量、马达权限都无关。
        //   而限位真正要赢的对象是马达：`τmax / physicsHz` 的角冲量。
        //   实测（`probe-readout` ⑦）：
        //       spine1/2  I_轴=0.0407 kg·m²  τmax=120  ⇒  马达角冲量 0.5000 N·m·s
        //       原限位上限 12 × 0.0407        = 0.4884 N·m·s
        //       比值 1.02× ⇒ ★ 限位数学上拦不住，角度单调发散到限位的 3.2 倍
        //
        //   ⇒ 改为按**同一条式子**反解，使限位角冲量**恒压过**马达 k 倍：
        //       biasCap · I_轴 · physicsHz  =  k · τmax
        //       ⇒ biasCap = k · τmax / (I_轴 · physicsHz)
        //
        //   ⚠ 用 `I_轴`（`axisInertia`）而**不是** `jointIeff`：
        //     施加冲量的效果 ∝ 施加时乘的那个惯量，两处必须同一个。
        const biasCap = this.limitBiasMax[i * 3 + k]!;
        // 目标角速度 = 回收速度 ∝ 越界量，但**上限就是上面那个推导值**
        const bias = -Math.sign(excess) * Math.min(excess * LIMIT_BIAS_RATE, biasCap);
        const wErr = bias - wRel;
        // ★★★ 2026-10-06：**必须**按「剩余越界量」给回收速度，**不能**被 `wRel` 拖走。
        //
        //   原式 `wErr = bias − wRel` 有个致命性质：`wRel` 可以任意大（电机反向猛拉时
        //   ±100 rad/s 量级）⇒ `wErr` 也任意大 ⇒ 单步注入的冲量
        //     = (bias − wRel) × Iax
        //   随之任意大。而这个冲量是**显式**施加的（`applyTorqueImpulse`），
        //   Rapier 求解器不会替它做单步稳定性保护 ⇒ **它自己就成了那个把腰甩出去的力**。
        //
        //   实测（`probe-readout` ⑦，修正前后逐物理步）：
        //     修正前 `spine1/2`：−1.4° 单调冲到 −52.9°（限位的 2.9 倍），从不回复
        //     修正后 `spine1/2`：−1.4° 冲到 −79.6° —— **更糟**
        //   ⇒ 说明「夹住 wErr」这条路本身就是错的（夹住之后仍被 `wRel` 的符号牵着走，
        //     而 `wRel` 的方向恰好是继续越界的方向）。
        //
        //   ⇒ 正确形式：**只由越界量决定**回收速度，完全不看 `wRel`：
        //         w_target = −sign(excess) · min(rate · excess, biasCap)
        //     这是标准的「位置投影」：目标角速度是位置的函数，
        //     再由冲量把 `wRel` **驱到** `w_target`（这才是"投影"）。
        //     `wErr` 是 `w_target − wRel`，它可以大（这才对：要追上目标速度就得有冲量），
        //     但**符号由 `w_target` 决定** ⇒ 永远不会把关节往越界方向推。
        const wTarget = bias;                    // bias 已经是 −sign(excess)·min(rate·excess, cap)
        const wErrNew = wTarget - wRel;
        if (wErrNew > 1e-6 || wErrNew < -1e-6) {
          // ★★★★★ 2026-10-06 **冲量上限（修"腰部向下弯曲然后转一圈"）**：
          //   上面那句注释自己说了「`wRel` 可以任意大 ⇒ 单步注入的冲量
          //   `(bias − wRel)×Iax` 随之任意大 ⇒ **它自己就成了那个把腰甩出去的力**」，
          //   但当时的修法只改了**目标速度**、**没夹冲量** ⇒ 问题仍在：
          //   马达把关节拽飞（wRel 上百 rad/s）时，限位一步就要把它掉头，
          //   反作用**全打在父体（骨盆/躯干）上** ⇒ **整机转圈**（实测 `spine1/0`
          //   折到 179.8°、`spine1/1` 扭转 −104.8°、落地后转一整圈）。
          //   ⇒ 夹到与**马达同尺度**的角冲量：`|J| ≤ 3·τmax·dt`（3 = `LIMIT_BIAS_SAFETY`，
          //     与 `biasCap` 的推导同一系数）。碰上限 ⇒ 限位变"多步软推"，
          //     反作用有界 ⇒ 不会再甩身体。
          const dtL = this.lastDt > 1e-9 ? this.lastDt : 1 / ASSUMED_PHYSICS_HZ;
          // ★★★★★ 2026-10-06 **脊柱的限位权限按"骨/韧带"量级**（实测：`spine1/0`
          //   冲到 58.3° vs 限位 15°——`τmax=72` 的 3× 上限扛不住躯干载荷）。
          //   物理：关节限位 = **骨/韧带**止挡，本就比**肌肉**（motor τmax）强数倍。
          //   非脊柱轴维持 `LBIAS=3`（其注释：3× 是给接触冲击的余量）。
          // 脊柱：骨/韧带量级（12×）。其余轴：默认 3×，但**大幅越界**（>5°）时
          // 也提到 12× —— 位置回正只在界外动作（方向安全），而实测膝侧向被压到
          // −44.7° vs 限位 −6°（3× 权限扛不住跌倒期载荷）。`LREST=0` 时回退旧行为。
          const jnL = (j as { name?: string }).name ?? '';
          const overR = Math.max(a2 - hi2, lo2 - a2);
          const DEGR = Math.PI / 180;
          const bias = (jnL.startsWith('spine') || overR > 5 * DEGR)
            ? (Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).LBIAS_SPINE ?? '') || 12)
            : LIMIT_BIAS_SAFETY;
          const Jcap = bias * Math.abs(j.maxTorque[k] ?? 0) * dtL;
          let J = wErrNew * IaxEff;
          if (J > Jcap) J = Jcap; else if (J < -Jcap) J = -Jcap;
          jv.x = this.axisW[0] * J; jv.y = this.axisW[1] * J; jv.z = this.axisW[2] * J;
          c.applyTorqueImpulse(jv, true);
          jv.x = -jv.x; jv.y = -jv.y; jv.z = -jv.z;
          p.applyTorqueImpulse(jv, true);
          this.limitHits++;
        }
      }
    }
  }
  /**
   * ★★★ **在虚拟支撑点处施加支撑力**（力偶）。
   *
   * 让踝获得 CoP 权限的唯一途径。此前踝指令对动力学**零效力**
   * （`kCop`×33 / `ankleTorque`×9 / VIP 刚度比×3.7 三种测法结果**逐位相同**），
   * 根因是**刚性平底盒**把压力中心锁死在接触面形心 —— 踝一转只是压实盒面，CoP 移不动。
   * 改为显式把支撑力作用在足底沿长轴偏移 `copOffset` 的点上，闭合
   * 「踝倾角 → 力臂 → GRF 力矩 → CoM 加速度」这条链（Morasso 2022 的 CoP 策略）。
   *
   * ⚠ 必须是**力偶**（偏移点 +F、脚心 −F）：净力为 0、只有力矩 F·copOffset。
   *   第一版写成"额外的力"，体重被算两遍，存活 1.77s → 0.40s。
   * ⚠ 默认关闭（`supportPointOn = false`）：用户反馈"支撑腿打滑的感觉" ——
   *   它绕过接触与摩擦，物理上不成立。纯物理路径（靠踝力矩撬脚）才不打滑。
   * ⚠ 已知局限：`copOffset` 是**运动学**的（直接给定位置），不含足底软组织的本构关系；
   *   要更真实需要把足底建成若干带弹簧的子段。
   */
  applySupportPoint(dt: number): void {
    const [fl, fr] = this.footLoadFrac(dt);
    let mSum = 0;
    for (const b of this.bodies) mSum += b.mass();
    for (const side of [0, 1] as const) {
      const frac = side === 0 ? fl : fr;
      if (frac <= 0.01) continue;                     // 摆动腿不施加
      const foot = this.bodies[this.indexByKey.get(side === 0 ? 'foot_l' : 'foot_r') ?? 0];
      const F = mSum * 9.81 * frac;
      const q = foot.rotation();
      quatRotate(q.x, q.y, q.z, q.w, 1, 0, 0, this.axTmp);
      const ax = this.axTmp;
      const p = foot.translation();
      this.pcTmp.x = p.x; this.pcTmp.y = p.y; this.pcTmp.z = p.z;   // 脚心（力偶的另一端）
      this.ptTmp.x = p.x + ax[0] * this.copOffset[side];
      this.ptTmp.y = p.y + ax[1] * this.copOffset[side];
      this.ptTmp.z = p.z + ax[2] * this.copOffset[side];
      // ★★★ **力偶，不是额外的力**（第一版写错了，实测存活 1.77s → 0.40s）。
      //   第一版在偏移点单施加 +F·dt ⇒ 脚本来就有的地面法向支撑之外**又加了一份**，
      //   体重被算两遍 ⇒ 直接被顶飞（存活 1.77s 塌到 0.40s）。
      //   正确做法：**净力为 0、只有力矩** —— 在偏移点 +F、在脚心 −F：
      //       ΣF = 0（不改变竖直平衡）
      //       Στ = F · copOffset（对踝产生 CoP 力矩 ⇒ **这才是 CoP 策略**）
      this.ivUp.x = 0; this.ivUp.y = F * dt; this.ivUp.z = 0;
      foot.applyImpulseAtPoint(this.ivUp, this.ptTmp, true);
      // 脚心处的反向冲量（构成力偶）
      this.ivUp.x = 0; this.ivUp.y = -F * dt; this.ivUp.z = 0;
      foot.applyImpulseAtPoint(this.ivUp, this.pcTmp, true);
    }
  }

  /** 该关节第 k 轴的当前角度（rad）—— 限位判定用 */
  private jointRotAxis(i: number, k: number): number {
    this.jointRot(i, this.rv);
    return this.rv[k];
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
   * 刚体系统绕某个关节的**当前姿态**转动惯量（kg·m²）。
   *
   * ★ 为什么必须有这个读回（DIP/VIP 的阻尼项要它）：
   *   文献的临界阻尼是 `B = 2ζ√(K·I)`，其中 `I` 是**摆绕其铰链**的惯量
   *   （Morasso 2019 PLOS ONE 14:e0213870：`I` = 刚体绕踝的转动惯量），
   *   **不是** `jointIeff`。后者是"两个自由体的折合惯量"
   *   （踝实测 0.0015 kg·m²），拿它算阻尼会**低估两个数量级**
   *   ⇒ 阻尼系数 4 而不是 323 ⇒ 等效阻尼比 0.01 ⇒ 踝无阻尼 ⇒ 必然发散。
   *
   *   算法：`I = Σᵢ [ mᵢ·|rᵢ|² + I_com,ᵢ ]`，`rᵢ` = 质心到铰链的向量。
   *   （平行轴定理；`principalInertia` 给的是绕自身质心的主惯量。）
   *
   * @param jointIdx 关节下标（`sk.joints` 的下标）
   * @param side     只统计某一侧子树时传 `'l'`/`'r'`（髋的 DIP 只管上身 ⇒ 传侧别）
   */
  inertiaAboutJoint(jointIdx: number, side?: 'l' | 'r', excludeLegs?: boolean): number {
    const j = this.sk.joints[jointIdx];
    if (!j) return 0;
    const aj = this.bodies[this.jointBodies[jointIdx * 2 + 1]]!;
    const ap = aj.translation();
    // 子侧子树（含该关节的子体）——side 限定时只算这一侧
    const inSub = new Set<number>();
    if (side) {
      inSub.add(this.jointBodies[jointIdx * 2 + 1]);
      let frontier = [this.sk.joints[jointIdx]!.childKey];
      while (frontier.length) {
        const k = frontier.pop()!;
        for (let bi = 0; bi < this.sk.bodies.length; bi++) {
          if (inSub.has(bi)) continue;
          if (this.sk.joints.some((jj) => jj.parentKey === k && jj.childKey === this.sk.bodies[bi]!.key)) {
            inSub.add(bi); frontier.push(this.sk.bodies[bi]!.key);
          }
        }
      }
    }
    // ★ DIP 的分段定义：绕髋的惯量只算 **HAT**（头+臂+躯干），**不含双腿**。
    //   而髋的子侧子树从 `torso` 出发会把**对侧整条腿**也带上（髋挂在躯干上）
    //   ⇒ 不排掉的话 `I_hip` 会从 ~7 涨到 ~11 kg·m²，阻尼系数跟着大 √2 倍。
    //   （腿绕髋的转动惯量已经体现在"绕踝"那一段里了，不能重复计入。）
    const LEG = /^(thigh|shin|foot|forefoot)_/;
    let sum = 0;
    for (let bi = 0; bi < this.sk.bodies.length; bi++) {
      if (side && !inSub.has(bi)) continue;
      if (excludeLegs && LEG.test(this.sk.bodies[bi]!.key)) continue;
      const b = this.bodies[bi]!;
      const t = b.translation();
      const dx = t.x - ap.x, dy = t.y - ap.y, dz = t.z - ap.z;
      const Ic = b.principalInertia();
      const selfI = Math.max(Ic.x, Math.max(Ic.y, Ic.z));
      sum += this.sk.bodies[bi]!.mass * (dx * dx + dy * dy + dz * dz) + selfI;
    }
    return sum;
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
    const heelPt = this.heelTmp;
    {
      const b = this.bodies[idx];
      const sole = this.sk.bodies[idx].colliders.find((c) => c.shape === 'cuboid');
      const ly = sole ? sole.offsetY - sole.hy : -this.sk.bodies[idx].length / 2;
      const t = b.translation();
      this.toWorld(b, 0, ly, 0, heelPt);
      heelPt[0] += t.x; heelPt[1] += t.y; heelPt[2] += t.z;
    }
    out[0] = heelPt[0]!; out[1] = heelPt[1]!; out[2] = heelPt[2]!;

    // ★★ 柔性足 F1（2026-10-04 修）：**前足是独立刚体**，它才是真正着地的那块。
    //   只量 `foot_*` 的话，中足一旦旋前/旋后（实测能走到限位 34°），前足就会
    //   一头扎进地面或翘起来，而 `soleY()`/`soleXZ()` **完全看不见** ——
    //   离地高度门、步长、重心支撑点全部读错。
    //   ⇒ 取「跟块最低点」与「前掌最低点」里**更低的那个**（那才是鞋底真正的高度）。
    //   x/z 也跟着取同一个块，免得 y 与 x/z 来自不同刚体（支撑点会算歪）。
    const foreKey = side === 'l' ? 'forefoot_l' : 'forefoot_r';
    const fidx = this.indexByKey.get(foreKey);
    if (fidx !== undefined) {
      const fb = this.bodies[fidx]!;
      const fc = this.sk.bodies[fidx]!.colliders.find((c) => c.shape === 'cuboid');
      if (fc) {
        const forePt = this.foreTmp;
        const ft = fb.translation();
        this.toWorld(fb, 0, fc.offsetY - fc.hy, 0, forePt);
        forePt[0] += ft.x; forePt[1] += ft.y; forePt[2] += ft.z;
        if (forePt[1]! < out[1]!) { out[0] = forePt[0]!; out[1] = forePt[1]!; out[2] = forePt[2]!; }
      }
    }
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
  /** `footPoint` 的两块鞋底中间量（跟块 / 前掌），避免调用方的 out 被踩 */
  private readonly heelTmp = new Float64Array(3);
  private readonly foreTmp = new Float64Array(3);

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
