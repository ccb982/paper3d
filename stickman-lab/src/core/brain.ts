// ============================================================
// brain —— 极简 MLP（单隐层），零分配前向
// ============================================================
// 为什么用这么小的网络：机器人关节控制是个低维问题。当前（12 关节）输入 94 维、
// 输出 36 维，单隐层 32 单元的 MLP 足够学出步态，参数量 4228 个 float32 ≈ 16.5 KB。
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
 *   inputs  = 2（时钟）+ 4（胸腔四元数）+ 3（线速度）+ 3（角速度）+ 1（高度）+ 1（侧向 z）
 *             + 2（CoM 相对支撑域中心）+ 2（CoM 速度）+ 2（DCM 归一化越界量）
 *             + 3N（关节旋转向量）+ 3N（相对角速度）+ 2（两脚高度）= 22 + 6N
 *   outputs = 3N（每关节 3 轴**目标角**，见 ragdoll.setMotorTargets）
 *
 * ★ 为什么是函数而不是常量：躯干沿脊柱分段后关节数不再是 9（见 SkeletonConfig.spineSegments），
 *   网络形状必须跟着骨架走。调用方拿到骨架后一律用 `shapeForJoints(sk.joints.length)`，
 *   不要写死 BRAIN_SHAPE —— 写死会在换骨架时静默错配（Sim 只会跑出垃圾分数，不会报错）。
 *
 * ★ 22 / 6N 的来历（观测加"重心"那一步，+6 维）：
 *   原来的观测里**没有任何 CoM / CoM 速度 / CoP / DCM** ⇒ 策略在**原理上**拿不到
 *   "我在往哪倒"，只能靠胸腔（占 12.4% 质量、离 CoM 0.4635 m）间接推。
 *   实测症状就是这个："直立占比 48~97% 却只前进 0.37 m、**仍判摔**"。
 */
export function shapeForJoints(jointCount: number): BrainShape {
  return { inputs: 22 + 6 * jointCount, hidden: HIDDEN_UNITS, outputs: 3 * jointCount };
}

export function inputCount(jointCount: number): number {
  return 22 + 6 * jointCount;
}

/** 9 关节骨架（spineSegments = 1）的形状：76 / 32 / 27。仅作默认值/参考 */
export const BRAIN_SHAPE: BrainShape = shapeForJoints(9);

/**
 * 输入维度清单（改这里必须同步 sim.ts 的 controlTick，且更新 INPUT_COUNT）。
 *
 * ★ 用**函数**生成而不是写死一个数组：写死数组没法做"长度 = 观测维数"的自检
 *   （关节段是 N 个重复项），而这条自检是本项目最容易静默失效的地方之一。
 *
 * 3D 之后哪些输入变了、为什么：
 *   · 丢掉了 2D 的「躯干绕 Z 转角 + 绕 Z 角速度」—— 3D 里一个绕 Z 的标量不足以描述姿态；
 *   · 换成【胸腔四元数 4 维】+【胸腔角速度 3 维】：后者是平衡反馈的关键量，
 *     没有它网络感知不到自己在倒（2D 版只有绕 Z 一个分量，等于瞎子）。
 *   · 关节角/角速度从 9 维各变 3N 维（每关节 3 轴）。
 *     ★ 用的是**父体本地**的旋转向量（exponential map）与相对角速度，
 *       不是欧拉角 —— 见 ragdoll.jointRot / jointRelVel。
 *   · 新增【重心块 6 维】—— 见 posture.ts。**这是"能不能主动平衡"的前提**：
 *       没有它，策略连"我在往哪倒"都不知道，只能用胸腔姿态当代理（而胸腔只是代理量）。
 */
export function inputLayout(jointCount: number): string[] {
  const out: string[] = [
    'clock.sin', 'clock.cos',                                   // 0,1
    'chest.quat.x', 'chest.quat.y', 'chest.quat.z', 'chest.quat.w',  // 2..5
    'chest.vx', 'chest.vy', 'chest.vz',                         // 6..8
    'chest.wx', 'chest.wy', 'chest.wz',                         // 9..11
    'chest.height',                                             // 12
    'chest.lateralZ',                                           // 13
    'com.dx', 'com.dz',                                         // 14,15 CoM 相对支撑域中心（m）
    'com.vx', 'com.vz',                                         // 16,17 CoM 水平速度（×2）
    'dcm.nx', 'dcm.nz',                                         // 18,19 DCM 归一化位置（0=中心，±1=域边缘）
  ];
  for (let i = 0; i < jointCount; i++) out.push(`joint[${i}].rot.x`, `joint[${i}].rot.y`, `joint[${i}].rot.z`);
  for (let i = 0; i < jointCount; i++) out.push(`joint[${i}].relw.x`, `joint[${i}].relw.y`, `joint[${i}].relw.z`);
  out.push('sole.l.y', 'sole.r.y');
  return out;
}

/** 12 关节（spineSegments = 4）的清单，长 94 */
export const INPUT_LAYOUT = inputLayout(12);

/** 12 关节（spineSegments = 4）时的观测维数：22 + 6×12 = 94 */
export const INPUT_COUNT = 22 + 6 * 12;

/** 输出：每关节 3 个数（**目标关节角**的比例，父体本地三轴 ∈ [-1,1]，见 ragdoll.posRefScale） */
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
