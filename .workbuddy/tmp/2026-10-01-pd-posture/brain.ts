// ============================================================
// brain —— 极简 MLP（单隐层），零分配前向
// ============================================================
// 为什么用这么小的网络：机器人关节控制是个低维问题。3D 之后输入 70 维、
// 输出 27 维（9 关节 × 3 转动轴），单隐层 32 单元的 MLP 足够学出步态，
// 参数量 3163 个 float32 ≈ 12.6 KB —— 内置进本体占 1MB 预算的 1.3%。
// 参数量再大的网络在进化策略下反而收敛更慢（维度灾难，且 ES 的搜索方向
// 是各向同性的高斯扰动，多余维度只贡献噪声）。
//
// ★ 前向过程零 new：所有中间 buffer 由调用方（Sim）预分配并复用，
//   否则一代几百个个体就会产生几十万次 GC —— 参见本体的"每帧零 new"约定。

/** 网络形状 */
export interface BrainShape {
  inputs: number;
  hidden: number;
  outputs: number;
}

/** 隐层单元数（唯一真源，改这里会连带改参数量） */
export const HIDDEN_UNITS = 32;

/**
 * ★ 按关节数算出网络形状。
 *   inputs  = 2（时钟）+ 4（躯干四元数）+ 3（线速度）+ 3（角速度）+ 1（高度）+ 1（侧向 z）
 *             + 3N（关节旋转向量）+ 3N（相对角速度）+ 2（两脚高度）= 16 + 6N
 *   outputs = 3N（每关节 3 轴目标角速度）
 *
 * ★ 为什么是函数而不是常量：躯干沿脊柱分段后关节数不再是 9（见 SkeletonConfig.spineSegments），
 *   网络形状必须跟着骨架走。调用方拿到骨架后一律用 `shapeForJoints(sk.joints.length)`，
 *   不要写死 BRAIN_SHAPE —— 写死会在换骨架时静默错配（Sim 只会跑出垃圾分数，不会报错）。
 */
export function shapeForJoints(jointCount: number): BrainShape {
  return { inputs: 16 + 6 * jointCount, hidden: HIDDEN_UNITS, outputs: 3 * jointCount };
}

export function inputCount(jointCount: number): number {
  return 16 + 6 * jointCount;
}

/** 9 关节骨架（spineSegments = 1）的形状：70 / 32 / 27。仅作默认值/参考 */
export const BRAIN_SHAPE: BrainShape = shapeForJoints(9);

/**
 * 输入维度清单（改这里必须同步 sim.ts 的 fillInput，且更新 BRAIN_SHAPE）。
 *
 * 3D 之后哪些输入变了、为什么：
 *   · 丢掉了 2D 的「躯干绕 Z 转角 + 绕 Z 角速度」—— 3D 里一个绕 Z 的标量不足以描述姿态；
 *   · 换成【躯干四元数 4 维】+【躯干角速度 3 维】：后者是平衡反馈的关键量，
 *     没有它网络感知不到自己在倒（2D 版只有绕 Z 一个分量，等于瞎子）。
 *   · 关节角/角速度从 9 维各变 27 维（每关节 3 轴）。
 *     ★ 用的是**父体本地**的旋转向量（exponential map）与相对角速度，
 *       不是欧拉角 —— 见 ragdoll.jointRot / jointRelVel。
 *   · 多了一个「躯干侧向 z」：任务要求沿 +X 直走，偏出去要有信号可看。
 */
export const INPUT_LAYOUT = [
  'clock.sin', 'clock.cos',                       // 0,1
  'torso.quat.x', 'torso.quat.y', 'torso.quat.z', 'torso.quat.w',  // 2..5
  'torso.vx', 'torso.vy', 'torso.vz',             // 6..8
  'torso.wx', 'torso.wy', 'torso.wz',             // 9..11
  'torso.height',                                 // 12
  'torso.lateralZ',                               // 13  （走歪了多少）
  'joint[0..8].rot[0..2]',                        // 14..40 （9×3，父体本地旋转向量）
  'joint[0..8].relomega[0..2]',                   // 41..67 （9×3，父体本地相对角速度）
  'sole.l.y', 'sole.r.y',                         // 68,69
] as const;

export const INPUT_COUNT = 2 + 4 + 3 + 3 + 1 + 1 + 27 + 27 + 2; // = 70

/** 输出：每关节 3 个数（目标角速度，父体本地三轴，tanh 后 × JOINT_MAX_SPEED） */
export const OUTPUT_PER_JOINT = 3;

/** 参数总数 */
export function brainParamCount(s: BrainShape): number {
  return s.inputs * s.hidden + s.hidden + s.hidden * s.outputs + s.outputs;
}

/** 参数布局：[W1 (inputs×hidden)] [b1 (hidden)] [W2 (hidden×outputs)] [b2 (outputs)] */
export function brainLayout(s: BrainShape) {
  const w1 = 0;
  const b1 = s.inputs * s.hidden;
  const w2 = b1 + s.hidden;
  const b2 = w2 + s.hidden * s.outputs;
  return { w1, b1, w2, b2, total: b2 + s.outputs };
}

/**
 * 前向：x → hidden → out。
 * hidden 长度 ≥ shape.hidden，out 长度 ≥ shape.outputs，均由调用方复用。
 */
export function brainForward(
  s: BrainShape,
  p: Float32Array,
  x: Float32Array,
  hidden: Float32Array,
  out: Float32Array,
): void {
  const L = brainLayout(s);

  for (let h = 0; h < s.hidden; h++) {
    let acc = p[L.b1 + h];
    const row = L.w1 + h * s.inputs;
    for (let i = 0; i < s.inputs; i++) acc += p[row + i] * x[i];
    hidden[h] = Math.tanh(acc);
  }

  for (let o = 0; o < s.outputs; o++) {
    let acc = p[L.b2 + o];
    const row = L.w2 + o * s.hidden;
    for (let h = 0; h < s.hidden; h++) acc += p[row + h] * hidden[h];
    out[o] = Math.tanh(acc);
  }
}
