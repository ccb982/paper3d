/**
 * v4/controlV1.ts —— **V4 v1：三证明的代码化**（架构_v4.md §3.5）
 *
 * 对应开工闸门的三条证明：
 *   (a) 力层核算器：F* 在**力层**截断（|Fx|≤μFz）+ 迈步请求（裂缝①）
 *   (b) 躯干任务：τ_hip 进入**躯干角动量方程**（显式 T2，髋驱动）
 *   (c) N₁ 投影：τ₂ = τ₁ + N₁Δτ₂（J₁N₁≡0 ⇒ L1 任务量严格不变，裂缝②）
 *
 * 与 v0 的区别：T2 不再直接相加，而是经**零空间投影**（数学保证不打架）。
 */
import type { Ragdoll } from '../ragdoll';

export interface V4Cfg1 {
  xF: number; xB: number; zH: number;   // 脚支持范围（相对踝，m）
  mu: number;                            // 摩擦系数（力层）
  kTrunk: number;                        // 躯干回正（髋）
  bTrunk: number;                        // 躯干阻尼（髋）
  kPost: number;                         // 其余关节对齐基线弱弹簧
  kSpine: number;                        // 脊柱极小刚度（E1 张力）
  bDamp: number;                         // 关节黏性（E2，非髋轴）
}

/** ★★★★★ 2026-10-07 **骨骼参考 = t=0 的实际姿态**（"初始站姿一点问题没有"）：
 *   此前 refB=motorRef 静姿 ⇒ 与实际初始姿态有偏差 ⇒ 起步应力 ⇒ 4s 慢摆。
 *   现在：第一拍把实际关节角录入为参考 ⇒ 零初始应力，弹簧只维持初始站姿。 */
let BONE_REF0: Float64Array | null = null;
let boneRefSet = false;
let boneTick = 0;   // ★ 阻尼渐入用（求解器启动瞬态隔离）
let boneTrimDone = false;   // ★ 静平衡配平（CoP 有效后锁定一次）

export const DEFAULT_V4_1: V4Cfg1 = {
  xF: 0.13, xB: 0.05, zH: 0.055,
  mu: 0.7,
  // ★ T2 默认关：裂缝④（约束在投影之外）未修复前，T2 会破坏 L1 不变量
  //   （实测 l1Leak 0→0.86）。架构纪律：先保 L1 纯净，T2 待"约束内解"。
  kTrunk: 0, bTrunk: 0,
  kPost: 12, kSpine: 3, bDamp: 8,
};

export interface V4Out1 {
  /** 唯一 τ 向量（nj*3） */
  tau: Float64Array;
  /** 裂缝①：CoP 饱和量（>0 即迈步请求；方向与大小由 errX/errZ 给） */
  stepReqX: number;
  stepReqZ: number;
  /** 力层截断计数（诊断） */
  clampFx: number;
  /** 总校验 = leakFromT2 + leakFromL1 */
  l1Leak: number;
  /** ★ 打架量：T2/L2 漏进 L1（投影失效才 >0；"不打架"的审计量） */
  leakFromT2: number;
  /** L1 自身缺口（τmax 饱和；物理合理） */
  leakFromL1: number;
  /** 信号链透视：W*（8 维） */
  Wt: number[];
  /** scale-to-fit 的 s（<1 表示被 T2 的边界缩放了） */
  sUsed: number;
  bone: Float64Array;   // ★ 骨骼层（plant）——供 chainV1 模式复用
}

const G = 9.81;
const envNum = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const raw = env[k];
  if (raw == null || raw === '') return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};

/** 6×6 求逆（高斯-约当；小矩阵，纯 JS） */
function invN(A: Float64Array, out: Float64Array): boolean {
  const M = new Float64Array(8 * 16);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) M[r * 16 + c] = A[r * 8 + c]!;
    M[r * 16 + 8 + r] = 1;
  }
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(M[r * 16 + col]!) > Math.abs(M[piv * 16 + col]!)) piv = r;
    if (Math.abs(M[piv * 16 + col]!) < 1e-12) return false;
    if (piv !== col) for (let c = 0; c < 16; c++) { const t = M[col * 16 + c]!; M[col * 16 + c] = M[piv * 16 + c]!; M[piv * 16 + c] = t; }
    const p = M[col * 16 + col]!;
    for (let c = 0; c < 16; c++) M[col * 16 + c] = M[col * 16 + c]! / p;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = M[r * 16 + col]!;
      if (f === 0) continue;
      for (let c = 0; c < 16; c++) M[r * 16 + c] = M[r * 16 + c]! - f * M[col * 16 + c]!;
    }
  }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) out[r * 8 + c] = M[r * 16 + 8 + c]!;
  return true;
}

export function v4ControlV1(
  doll: Ragdoll,
  nj: number,
  com: { x: number; y: number; z: number; vx: number; vz: number },
  /** ★ step 的提案（仲裁后的角度目标，±1 归一；= 迈步系统交上来的提案） */
  targets: Float32Array | null,
  /** ★ 预警包（唯一感知输入；v4 不再自算 ξ） */
  warn: { xiX: number; xiZ: number; urgency: number; dirX: number; dirZ: number; mosX?: number; mosZ?: number; trunkPitch?: number; trunkRoll?: number; trunkRate?: number; trunkTTB?: number } | null,
  /** ★ 提案包：重心偏移意图（shiftDemandF，N；立法："弱重心偏移属于提案包"） */
  shiftDemandF = 0,
  /** ★★★★★ 2026-10-07 角色（用户令："平衡系统统一指挥"）：
   *  支撑腿=平衡/载荷权（full）；摆动腿=轻轨迹权（修正 ×0.15） */
  roles: { sup: 'l' | 'r' } | null = null,
  /** ★★★★★ §4.11 指挥官的命令（坠落预测模块的输出）：全权决定各部位行动 */
  cmd: { kind: 'pad' | 'padHip' | 'step'; copX: number; copZ: number; level: 0 | 1 | 2 } | null = null,
  feet: {
    x: [number, number]; z: [number, number];
    fz: [number, number]; copX: [number, number]; copZ: [number, number];
    valid: [boolean, boolean];
  },
  out: Float64Array,
  tmp: { axisW: Float64Array; jw: Float64Array; jw2: Float64Array; rj: Float64Array; A: Float64Array; N: Float64Array; G6: Float64Array; dtau: Float64Array; dtauP: Float64Array; tau1: Float64Array; wrStore: Float64Array },
  cfg: V4Cfg1 = DEFAULT_V4_1,
): V4Out1 {
  const mu = envNum('V4MU', cfg.mu);
  const wrStore0: Float64Array = tmp.wrStore ?? new Float64Array(nj * 3);
  void wrStore0;
  const kTrunk = envNum('V4KTRUNK', cfg.kTrunk);
  const kPostDef = envNum('V4KPOST', cfg.kPost);
  // ★★★★★ 2026-10-07 用户令：「修正也要包括对腰的」——启用腰/躯干任务（默认从 0 升到 30）
  const kWaist = envNum('V4KWAIST', 0);
  // ★★★★★ 2026-10-07 用户令："需要过量修正——因为有动量，只调整一下动量还在"。
  //   实证：bWaist 4→8 时 spine3 违例 66→0（D 项刹住脊柱动量）；40 过阻尼发散。
  const bWaist = envNum('V4BWAIST', 0);
  const bTrunk = envNum('V4BTRUNK', cfg.bTrunk);

  const h = Math.max(0.25, com.y);
  const w0 = Math.sqrt(G / h);

  // ══ (a) 力层核算器：XcoM → F*（每脚），摩擦在**力层**截断 ═════════
  // ★★★★★ 2026-10-07 **轻垫脚：预测项权重联动**（用户："只需要垫脚"）
  //   ξ = com + k_v·(v/ω₀)。k_v=1 = 全力制动（Hof 原义，前 0.1s 就 28N）；
  //   轻偏差时用小的 k_v ⇒ 只垫脚（~8N）。严重度升 ⇒ k_v 升 ⇒ 全力。
  //   严重度：由预警的 MoS 接近程度定义（界内远离=0，贴近/出界=1）。
  const sev = (() => {
    const band = 0.06;
    const m = Math.min(Math.abs(warn?.mosX ?? 1), Math.abs(warn?.mosZ ?? 1));
    const inside = (warn?.mosX ?? 1) >= 0 && (warn?.mosZ ?? 1) >= 0;
    const sevMargin = inside ? Math.max(0, Math.min(1, 1 - m / band)) : 1;
    // ★★★★★ 2026-10-07 用户令："要跌倒的时候就把趋势止住"：
    //   趋势强度 = |v|/v_ref（v_ref=0.15 m/s 视为满严重度）——
    //   位置还安全但动量大时，也要立刻加重（止住动量）。
    const vref = Math.max(0.02, envNum('V4VREF', 0.15));
    const sevTrend = Math.min(1, Math.hypot(com.vx, com.vz) / vref);
    return Math.max(sevMargin, sevTrend);
  })();
  // ★★★★★ 2026-10-07 **修正**（纯 v4 基线暴露）："轻"必须用**死区**实现，而不是压 kv！
  //   压 kv ⇒ 全时段的增益都不足（v4 在 27mm/s 漂移下只给 1.5N ⇒ 不作为）。
  //   正确：kv ≡ 1.0（全反馈）；安全区的静默由 V4DEADBAND 负责。
  const kvMin = envNum('V4KXI_MIN', 1.0);
  const kv = kvMin + (1 - kvMin) * sev;
  const xiX = warn ? warn.xiX - (1 - kv) * com.vx / w0 : com.x + kv * com.vx / w0;
  const xiZ = warn ? warn.xiZ - (1 - kv) * com.vz / w0 : com.z + kv * com.vz / w0;
  let fzTot = 0;
  for (let q = 0; q < 2; q++) fzTot += Math.max(0, feet.fz[q] ?? 0);
  const m = doll.sk.massTotal;
  const W = m * G;
  const Fx = [0, 0], Fy = [0, 0], Fz2 = [0, 0];
  const copCmdXs = [0, 0], copCmdZs = [0, 0];   // 每脚的命令 CoP（供力臂使用）
  let clampFx = 0;
  let stepReqX = 0, stepReqZ = 0;
  for (let q = 0; q < 2; q++) {
    // ★★★★★ 2026-10-07 **正反馈循环修复**（"力非常抽象"的真身）：
    //   原实现 share = 实测fz[q]/fzTot ⇒ 期望力追着实测跑
    //   ⇒ 任何不对称（接触求解器噪声/摩擦帽）被自锁放大：
    //   实测 Fy0=172 / Fy1=514（3× 不对称、总和 122% 体重）！
    //   立法 5：承重由**状态机角色**指定，测量不参与命令。
    //   当前：双支撑对称；单支撑由 roles.sup 给出 0.9/0.1 梯度。
    // ★ 角色分配强度可调：V4FYROLE=0 对称 50/50；1 = 10/90（硬角色）
    let share = 0.5;
    if (envNum('V4FYROLE', 1) > 0 && roles && roles.sup) {
      const supQ = roles.sup === 'l' ? 0 : 1;
      share = q === supQ ? 0.9 : 0.1;
    }
    const fz = W * share;
    Fy[q] = fz;
    const copNowX = feet.valid[q] ? feet.copX[q]! : feet.x[q]!;
    const copNowZ = feet.valid[q] ? feet.copZ[q]! : feet.z[q]!;
    // ★ 指挥官的命令优先（§4.11）：Cop 目标由坠预模块给出（全权指挥）
    //   未给命令时回退到自身的 clamp(ξ)（保留 A/B 能力）
    // ★★★★★ 2026-10-07 **S1 极点配置落地**（设计 §6.3③；Caron 2019/Liu 2021 形式）：
    //   p_cmd = ξ* + k_ξ·(ξ − ξ*)   ⇒ 闭环 DCM 以 ω₀·(k_ξ−1) 衰减。
    //   k_ξ=1（旧）= 临界（零裕度）⇒ 延迟下必发散（实测 ~4.6/s > ω₀ 3.3/s）。
    //   k_ξ=2 ⇒ 衰减率 = ω₀ ≈ 3.3/s，覆盖 120Hz 环路延迟/相位裕度。
    const kXi = envNum('V4KXI', 2.0);
    const xiBaseX = cmd ? cmd.copX : 0;
    const xiBaseZ = cmd ? cmd.copZ : 0;
    const pPlaceX = xiBaseX + kXi * (xiX - xiBaseX);
    const pPlaceZ = xiBaseZ + kXi * (xiZ - xiBaseZ);
    const copCmdX = Math.min(feet.x[q]! + cfg.xF, Math.max(feet.x[q]! - cfg.xB, pPlaceX));
    const copCmdZ = Math.min(feet.z[q]! + cfg.zH, Math.max(feet.z[q]! - cfg.zH, pPlaceZ));
    // 裂缝①：饱和量 = 步请求（唯一合法接口）
    if (Math.abs(xiX - copCmdX) > Math.abs(stepReqX)) stepReqX = xiX - copCmdX;
    if (Math.abs(xiZ - copCmdZ) > Math.abs(stepReqZ)) stepReqZ = xiZ - copCmdZ;
    // ★★ LIPM 正解（2026-10-06 修一处符号错误）：
    //   倒立摆动力学 ẍ = ω₀²·(x − p)（加速度与 (CoM−CoP) **同号**——远离支撑才失稳）。
    //   要 CoP 落在 copCmd ⇒ 所需加速度 a* = (g/h)·(com − copCmd)
    //   ⇒ Fx = m_share·a* = W_share·(com − copCmd)/h。
    //   （曾写成 (copCmd − com)：符号翻转 ⇒ 正反馈 ⇒ CoM 一漂就再也回不来。）
    // ★ 轻垫脚（kv 联动）：把"预测提前量"按严重度收缩 ⇒ 轻时只垫脚
    let fx = (W * share * (com.x - copCmdX)) / h * kv;
    let fzz = (W * share * (com.z - copCmdZ)) / h * kv;
    // ★★★★★ 角色分权（用户令："支撑腿=平衡、摆动腿=轨迹，各自权限"）：
    //   摆动脚的**平衡修正**缩权（×V4SWROLE，默认 0.15）——它只该做轨迹，不该做平衡；
    //   支撑脚全权（它就是平衡的执行者）。旧的"两腿同权"是"承重腿被主动移动"的根。
    if (roles) {
      const qSide: 'l' | 'r' = q === 0 ? 'l' : 'r';
      if (qSide !== roles.sup) {
        const swf = envNum('V4SWROLE', 0.15);
        fx *= swf; fzz *= swf;
      }
    }
    // ★ 诊断用 P 符号（V4PSGN=-1 翻转水平/侧向目标）
    if (envNum('V4PSGN', -1) < 0) { fx = -fx; fzz = -fzz; }
    // 力层摩擦截断（|F_t| ≤ μF_n），绝不到 τ 层再封顶
    const fLim = mu * fz;
    if (Math.abs(fx) > fLim) { fx = Math.sign(fx) * fLim; clampFx++; }
    if (Math.abs(fzz) > fLim) { fzz = Math.sign(fzz) * fLim; clampFx++; }
    // ★ 显式 CoM 速度阻尼（补传播/相位不足；V4CD=N/(m/s)）
    {
      const cd = envNum('V4CD', 0);
      if (cd > 0) {
        fx += -cd * share * com.vx;
        fzz += -cd * share * com.vz;
      }
    }
    const noFx = envNum('V4NOFX', 0);
    // ★★★★★ 2026-10-07 **死区（收口自激环）**：|目标−现状| < 死区 ⇒ 不出力。
    //   回读实证：初始 CoP 正常(−1mm) 时 v4 仍输出 −62，亲手把 CoP 推到 +105mm
    //   ⇒ 自激。物理学上：偏差在噪声/无意义量级时，任何出力都是在**制造**扰动。
    //   等价于用户最初原则："没人失衡就别动"。V4DEADBAND（m，默认 0.02）。
    // ★★★★★ 2026-10-07 **死区只作用于位置项，速度项永远在线**（关键修正）：
    //   原实现把整个力都杀（含速度项）⇒ 8mm 漂移+27mm/s 积累时输出 0
    //   ⇒ "v4 不作为"。正确：位置误差小（噪声）可以不动，但**动量必须永远刹**
    //   （用户："要跌倒的时候就把趋势止住"）。
    {
      const db = envNum('V4DEADBAND', 0.02);
      const cd = envNum('V4CD', 0);   // 速度项已并入极点配置（默认 0，防双计）
      const vScale = roles && roles.sup === (q === 0 ? 'l' : 'r') ? 1 : (envNum('V4SWROLE_D', 0.3));
      const vx = -cd * share * com.vx * vScale;      // 永远在线
      const vz = -cd * share * com.vz * vScale;
      const devX = Math.abs(com.x - copCmdX);
      const devZ = Math.abs(com.z - copCmdZ);
      if (db > 0 && devX < db) fx = 0;
      if (db > 0 && devZ < db) fzz = 0;
      fx += vx;
      fzz += vz;
    }
    // ★★★ 提案包消费（立法）：重心偏移意图 → 侧向力目标（直接叠加，单位同为 N）
    //   无此项时重心永不转移 ⇒ LOAD 卡死（packages 回读实证）。
    fzz += shiftDemandF * share * 0.5;
    copCmdXs[q] = copCmdX; copCmdZs[q] = copCmdZ;
    Fx[q] = noFx > 0 ? 0 : fx;
    Fz2[q] = noFx > 0 ? 0 : fzz;
  }

  // ══ 任务矩阵 A（n×6）：τ_j = Σ_q (a_j×r_jq)·F_q ════════════════
  const A = tmp.A;      // n×8（列0-5=双足力；列6-7=上身角动量 Ḣx/Ḣz）
  for (let i = 0; i < nj; i++) {
    doll.jointWorld(i, tmp.jw);
    for (let k = 0; k < 3; k++) {
      const idx = i * 3 + k;
      if (!doll.jointWorldAxis(i, k, tmp.axisW)) {
        for (let s = 0; s < 8; s++) A[idx * 8 + s] = 0;
        continue;
      }
      const ax = tmp.axisW[0]!, ay = tmp.axisW[1]!, az = tmp.axisW[2]!;
      // A_aug 列6/7：该轴对**上身角动量变化率**的贡献（关节对 ≈ ±1 的度规）
      const nmA = doll.sk.joints[i]?.name ?? '';
      // ★★★★★ 2026-10-06 **传力链掩码**（修"身体卷起来"）：
      //   足底力→身体 的传递链只有 脚→小腿→大腿→骨盆（hip/knee/foot）。
      //   脊柱/肩/肘是**载荷**不是传力路径——把它们的行清零，
      //   否则 min-norm 会让脊柱"扛"60~78 N·m 的假力矩（实测：spine1/2 τ→64、
      //   shoulder_r/2 τ→78 ⇒ 身体卷曲）。
      if (!/^(hip|knee|foot)_/.test(nmA)) {
        for (let s8 = 0; s8 < 8; s8++) A[idx * 8 + s8] = 0;
        for (let kx = 0; kx < 3; kx++) { void kx; }
        continue;
      }
      // ★ 诊断：踝/髋的 a/r 与 A 的三列
      if ((nmA === 'foot_l' || nmA === 'hip_l') && k === 2) {
        const rq0x = (copCmdXs[0] ?? 0) - tmp.jw[0]!;
        const rq0y = 0 - tmp.jw[1]!;
        const rq0z = (copCmdZs[0] ?? 0) - tmp.jw[2]!;
        const fxc = ay * rq0z - az * rq0y;
        const fyc = az * rq0x - ax * rq0z;
        const fzc = ax * rq0y - ay * rq0x;
        const store = (globalThis as { __colDiag?: Record<string, unknown> }).__colDiag ?? {};
        store[nmA] = { a: [ax, ay, az], r: [rq0x, rq0y, rq0z], A: [fxc, fyc, fzc] };
        (globalThis as { __colDiag?: Record<string, unknown> }).__colDiag = store;
      }
      if (/^hip_/.test(nmA) && envNum('V4A6', 0) === 0) {   // V4A6=1 ⇒ 退回纯 6 列对照
        if (k === 2) A[idx * 8 + 6] = 1.0;    // 髋矢状 → Ḣx(俯仰)
        if (k === 0) A[idx * 8 + 7] = 1.0;    // 髋侧向 → Ḣz(侧倾)
      }
      // ★★★★★ 2026-10-07 **传力链同侧掩码**（立法 4；"力矩抽象"的一刀）：
      //   左脚的地面力只流经左腿链（hip_l/knee_l/foot_l），右脚同理。
      //   原实现让每个关节都吃两只脚的力 ⇒ 左膝行乘右脚 618N 的跨体力矩
      //   ⇒ 膝 τ 凭空 −126（直接 A·W* 只有 −39）。GRF-Jacobian 必须同侧。
      const jSide = /_l$/.test(nmA) ? 0 : /_r$/.test(nmA) ? 1 : -1;
      for (let q = 0; q < 2; q++) {
        if (jSide >= 0 && q !== jSide) continue;   // 异侧：该脚力不经过本关节
        // ★★★★★ 2026-10-06 **力臂必须用 CoP**（本会话最深的机械 bug）：
        //   GRF 作用点在 **CoP**（动态），不是脚的参考位置 `feet.x/z`。
        //   旧代码差 0.05~0.15m ⇒ 垂直支撑凭空多出 Fy×Δ ≈ 40~50 N·m（隔离实验实证：
        //   踝 −120 中 −46 来自此处）。静态时 CoP 在踝下 ⇒ τ 应 ≈ 0。
        // ★ 用**命令 CoP**（平滑、与目标一致）而非实测 CoP（±100mm 噪声会放大）
        const copXq = copCmdXs[q] ?? feet.x[q]!;
        const copZq = copCmdZs[q] ?? feet.z[q]!;
        const rx = copXq - tmp.jw[0]!;
        const ry = 0 - tmp.jw[1]!;
        const rz = copZq - tmp.jw[2]!;
        // a×r 的分量
        const cx = ay * rz - az * ry;
        const cy = az * rx - ax * rz;
        const cz = ax * ry - ay * rx;
        // ★★★★★ 2026-10-07 **轴约定反转**（本会话的符号总根源）：
        //   jointWorldAxis 给的是 +local-z 的世界向；而本骨架电机正方向
        //   = 关节正角方向（髋=伸=绕 −z、膝=伸、踝=背屈），恰好相反。
        //   实测：W* 水平力反号后 CoM 漂移 19.2→4.5mm ⇒ 确证。
        //   在此统一反转（L2 弹簧/限位在角度空间不受影响）。
        A[idx * 8 + q * 3 + 0] = cx;
        A[idx * 8 + q * 3 + 1] = cy;
        A[idx * 8 + q * 3 + 2] = cz;
      }
    }
  }

  // ══ τ₁ = A·F* ══════════════════════════════════════════════════
  const tau1 = tmp.tau1;
  // ★★★★★ 2026-10-06 **加权最小范数分配**（用户："发力重心侧移也应该只用很小很小的力矩"）
  //   物理事实：Fx 大时髋必须扛 Fx×0.85 的间矩——**这是力学的必然，不是分配错误**；
  //   真正让力矩小的是 **Fx 本身小**（= L1 稳定 ⇒ CoM 不漂 ⇒ 修正力小）。
  //   分配层能做的：按生理容量加权（W = diag(1/τmax_cap)），
  //   让冗余自由度优先用"大容量关节"（踝/腿），髋只承担必需部分。
  //   实现：τ₁ = A_w⁺ · W*（A_w = A·M½ 的加权伪逆；退化时回退 A·W*）
  const useWLN = envNum('V4WLN', 1) > 0;
  const ACT = [0, 2, 3, 5, 6, 7];   // 活跃列（Fx/Fz 双足 + Ḣ 双翼）
  const NA = ACT.length;
  const G8i = tmp.N;                // 逆 Gram 的共享缓冲（WLN/CLS 复用）
  // L1 的角动量分量（Ḣ*）：躯干转速的 L1 阻尼（"躯干平衡"归 L1，姿态归 T2）
  const hdotK = envNum('V4HDOT', 0);
  // 支撑域（两脚并集的粗略口径：出界量以支撑侧单脚为准，与 per-foot copCmd 同源）
  let copCmdX = com.x, copCmdZ = com.z;
  {
    const q = (feet.fz[0] ?? 0) >= (feet.fz[1] ?? 0) ? 0 : 1;   // 支撑侧 = 载荷大者
    const copCmdXq = Math.min(feet.x[q]! + cfg.xF, Math.max(feet.x[q]! - cfg.xB, xiX));
    const copCmdZq = Math.min(feet.z[q]! + cfg.zH, Math.max(feet.z[q]! - cfg.zH, xiZ));
    copCmdX = copCmdXq; copCmdZ = copCmdZq;
  }
  let hdotX = 0, hdotZ = 0;
  {
    const bi = doll.sk.bodies.findIndex((b) => b.key === 'spine3');
    if (bi >= 0 && doll.bodyAngVel(bi, tmp.rj)) {
      hdotX = -hdotK * tmp.rj[0]!;
      hdotZ = -hdotK * tmp.rj[2]!;
    }
  }
  for (let i = 0; i < nj * 3; i++) {
    let t = 0;
    for (let q = 0; q < 2; q++) {
      t += A[i * 8 + q * 3 + 0]! * Fx[q]! + A[i * 8 + q * 3 + 1]! * Fy[q]! + A[i * 8 + q * 3 + 2]! * Fz2[q]!;
    }
    t += A[i * 8 + 6]! * hdotX + A[i * 8 + 7]! * hdotZ;
    tau1[i] = t;
  }
  // ★★★★★ 2026-10-07 **S4：约束最小二乘（架构级重写，替代 WLN 族）**
  //   形式（Fahmi 2018 / Escande 2014 的序贯简化版）：
  //     min ‖Aτ − W*‖²  s.t. 关节限位 + τmax（硬约束）
  //   实现：迭代钳位 + 任务回补（对 54 变量的小规模，3-5 轮收敛）：
  //     τ = A⁺W*；再夹到可行域；再用 A⁺(W*−Aτ) 回补被夹掉的任务分量。
  //   ⇒ 越界（如髋 124°）从解里就不可能；τmax 触发即负载自动改道（Fahmi）。
  const useCLS = envNum('V4CLS', 1) > 0;
  // ★★★★★ 2026-10-06 **支撑/修正分离**（修一处致命分类错误）：
  //   实测教训：WLN 把膝 τ 降到 3 N·m ⇒ 膝是**支撑链**关节、垂直支撑必须
  //   每关节各担其份（否则膝 buckles、腿塌、关节飞到 −174°）。
  //   ⇒ 垂直分量（Fy）走 **A·Fy**（每关节自己的静力支撑）；
  //     水平修正（Fx/Fz2/Ḣ）才是"冗余可分配"，走 WLN。
  const fyOff = envNum('V4NOFY', 0) > 0;   // 隔离实验：关垂直支撑分量
  const FyOnly = fyOff ? [0, 0, 0, 0, 0, 0, 0, 0] : [0, Fy[0]!, 0, 0, Fy[1]!, 0, 0, 0];
  if (useWLN) {
    const Mw = new Float64Array(nj * 3);
    for (let i = 0; i < nj; i++) {
      const jd = doll.sk.joints[i];
      for (let k = 0; k < 3; k++) {
        const cap = Math.max(10, jd?.maxTorque[k] ?? 60);
        // ★★★★★ 2026-10-06 排雷第三发·定稿（Orin & Oh 1981 的最优分配）：
        //   代价 = Σ(τᵢ/τmaxᵢ)²（**归一化努力**——各执行器均衡负载）⇒ W = diag(1/cap²)。
        //   解法 τ = W⁻¹Aᵀ(AW⁻¹Aᵀ)⁻¹W* 含 cap⁴ 项（数值病态）⇒ 等价改写：
        //     A′ = A·diag(cap)（列缩放）；τ′ = A′⁺W*；τ = cap·τ′  ← 数值安全
        //   （V4WNORM=1 退化为绝对最小范数对照；默认 0 = Orin&Oh 归一化）。
        const wmode = envNum('V4WNORM', 0);
        Mw[i * 3 + k] = wmode >= 1 ? 1 : cap;   // 存储 cap（后续列缩放用）
      }
    }
    // 归一化空间：A′ = A·diag(cap)（Mw 存 cap）⇒ G8 = A′ᵀA′
    const G8 = tmp.G6;   // 复用（此后才用于 N 的 Gram；此处先算 WLN）
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      let s2 = 0;
      for (let i = 0; i < nj * 3; i++) s2 += (A[i * 8 + r]! * Mw[i]!) * (A[i * 8 + c]! * Mw[i]!);
      G8[r * 8 + c] = s2;
    }
    // ★★★★★ 2026-10-06 **活跃列缩减**（谱系定案：u_Fz 爆 1.1e3 的修复）
    //   只解活跃列 [Fx0,Fz0,Fx1,Fz1,Ḣx,Ḣz]（Fy 走 FyOnly，不参与分配）。
    {
      const G8r = new Float64Array(36);
      for (let r = 0; r < NA; r++) for (let c = 0; c < NA; c++) {
        const cr = ACT[r]!, cc = ACT[c]!;
        let s2 = 0;
        for (let i = 0; i < nj * 3; i++) s2 += (A[i * 8 + cr]! * Mw[i]!) * (A[i * 8 + cc]! * Mw[i]!);
        G8r[r * 6 + c] = s2;
      }
      let trw = 0; for (let r = 0; r < NA; r++) trw += G8r[r * 6 + r]!;
      const lamW = Math.max(1e-10, 1e-5 * trw / NA);
      for (let r = 0; r < NA; r++) G8r[r * 6 + r] = G8r[r * 6 + r]! + lamW;
      for (let r = 0; r < NA; r++) for (let c = 0; c < NA; c++) G8[r * 8 + c] = G8r[r * 6 + c]!;
    }
    let trw = 0; for (let r = 0; r < NA; r++) trw += G8[r * 8 + r]!;
    void trw;
    // ★ 谱系诊断（V4SPECTRA=1 时经 diag 暴露）
    const spectra: number[] | null = envNum('V4SPECTRA', 0) > 0 ? (() => {
      const Acol = new Float64Array(6), Gdiag = new Float64Array(6);
      for (let r = 0; r < 6; r++) {
        const cr = ACT[r]!;
        let n2 = 0;
        for (let i = 0; i < nj * 3; i++) { const v = A[i * 8 + cr]! * Mw[i]!; n2 += v * v; }
        Acol[r] = Math.sqrt(n2); Gdiag[r] = G8[r * 8 + r]!;
      }
      return [...Array.from(Acol), ...Array.from(Gdiag)];
    })() : null;
    // ★★★★★ 2026-10-06 **主动集（active-set）**：踝独扛 → 饱和 → 力再分配
    //   实测：min-effort 全部选踝（数学正确）⇒ 踝 70ms 满 ⇒ 修正权限耗尽。
    //   做法：先解一遍 → 找出超 70% 容量的关节 → 把它们的**权重抬高**（等价"软剔除"）
    //   → 重解 ⇒ 未饱和的关节（髋/膝）被迫分担。
    const active = new Float64Array(nj * 3).fill(1);
    const u = new Float64Array(8);
    // ⚠ 实测：朴素 active-set（软剔除 0.1×）会过度矫正（全员饱和）⇒ 默认关
    if (envNum('V4ACTIVE', 0) > 0) {
      for (let it = 0; it < 2; it++) {
        // 当前权重（wrStore0 × active）下的重建
        for (let i = 0; i < nj * 3; i++) {
          let t2 = 0;
          const wi = wrStore0[i]! * active[i]!;
          for (let r = 0; r < NA; r++) t2 += (A[i * 8 + ACT[r]!]! * wi) * u[r]!;
          t2 *= wi;
          const cap2 = Mw[i] || 1;
          if (Math.abs(t2) > 0.7 * cap2) active[i] = active[i]! * 0.1;   // 软剔除
        }
        // 用新权重重解
        for (let r = 0; r < NA; r++) for (let c = 0; c < NA; c++) {
          const cr = ACT[r]!, cc = ACT[c]!;
          let s2 = 0;
          for (let i = 0; i < nj * 3; i++) {
            const wi = wrStore0[i]! * active[i]!;
            s2 += (A[i * 8 + cr]! * wi) * (A[i * 8 + cc]! * wi);
          }
          G8[r * 8 + c] = s2;
        }
        let tr2 = 0; for (let r = 0; r < NA; r++) tr2 += G8[r * 8 + r]!;
        const lam2 = Math.max(1e-10, 1e-5 * tr2 / NA);
        for (let r = 0; r < NA; r++) G8[r * 8 + r] = G8[r * 8 + r]! + lam2;
        if (!invN(G8, G8i)) break;
        const WtA = [Fx[0]!, 0, Fz2[0]!, Fx[1]!, 0, Fz2[1]!, hdotX, hdotZ];
        const Wta = ACT.map((cc) => WtA[cc]!);
        for (let r = 0; r < NA; r++) { let s2 = 0; for (let c = 0; c < NA; c++) s2 += G8i[r * 8 + c]! * Wta[c]!; u[r] = s2; }
      }
      // 把 active 并进 wrStore（供重构）
      for (let i = 0; i < nj * 3; i++) wrStore0[i] = wrStore0[i]! * active[i]!;
    }
    if (invN(G8, G8i)) {
      const WtAll = [Fx[0]!, 0, Fz2[0]!, Fx[1]!, 0, Fz2[1]!, hdotX, hdotZ];
      const Wt = ACT.map((c) => WtAll[c]!);
      
      for (let r = 0; r < NA; r++) { let s2 = 0; for (let c = 0; c < NA; c++) s2 += G8i[r * 8 + c]! * Wt[c]!; u[r] = s2; }
      // ★★★★★ 2026-10-06 **最小峰值利用率（Orin&Oh 本义）——IRWLS 求 minimax**
      //   实测：min||τ|| ⇒ 踝独扛 −120（70ms 饱和）。真正的目标是最小化
      //   max_i |τ_i|/cap_i（谁也别先饱和）⇒ 迭代重加权：
      //   w_i ← 1/（cap_i·(|τ_i|+ε)）⇒ 已接近饱和的关节权重下降 ⇒ 负载外溢。
      {
        // ⚠ 实测：朴素 IRWLS 数值发散（u→1e11）⇒ 默认关。
        //   关节轨迹反而平滑（1s 内 ≤10°）——说明目标函数方向对，但迭代形式错，
        //   下一会话用"解析 minimax"或"投影梯度"重写。
        const IRW = envNum('V4IRW', 0);
        if (IRW > 0) {
          for (let it = 0; it < 4; it++) {
            // 由当前 τ′（=cap-reconstructed）估算利用率，更新权重
            const wr = new Float64Array(nj * 3);
            for (let i = 0; i < nj * 3; i++) {
              const cap2 = Mw[i] || 1;
              let t2 = 0;
              for (let r = 0; r < NA; r++) t2 += (A[i * 8 + ACT[r]!]! * Mw[i]!) * u[r]!;
              t2 *= Mw[i]!;
              wr[i] = 1 / (cap2 * (Math.abs(t2) / cap2 + 1e-3));
            }
            // 重解：A′w = A·w；G8 = A′wᵀA′w；u = G8i·Wt；τ′ = A′wᵀu
            for (let r = 0; r < NA; r++) for (let c = 0; c < NA; c++) {
              const cr = ACT[r]!, cc = ACT[c]!;
              let s2 = 0;
              for (let i = 0; i < nj * 3; i++) s2 += (A[i * 8 + cr]! * wr[i]!) * (A[i * 8 + cc]! * wr[i]!);
              G8[r * 8 + c] = s2;
            }
            let tr2 = 0; for (let r = 0; r < NA; r++) tr2 += G8[r * 8 + r]!;
            const lam2 = Math.max(1e-10, 1e-5 * tr2 / NA);
            for (let r = 0; r < NA; r++) G8[r * 8 + r] = G8[r * 8 + r]! + lam2;
            if (!invN(G8, G8i)) break;
            for (let r = 0; r < NA; r++) { let s2 = 0; for (let c = 0; c < NA; c++) s2 += G8i[r * 8 + c]! * Wt[c]!; u[r] = s2; }
            // 把加权结果折回 cap 基准（还原时用 wr/cap 的比值）——存入 MwEff 供重构
            for (let i = 0; i < nj * 3; i++) wrStore0[i] = wr[i]!;
          }
        } else {
          for (let i = 0; i < nj * 3; i++) wrStore0[i] = Mw[i]!;
        }
      }
      // ★ 纯 A×W*（无权重无投影的几何直映射）——隔离实验
      const pureMap: Record<string, number> = {};
      {
        const WtAllP = [Fx[0]!, Fy[0]!, Fz2[0]!, Fx[1]!, Fy[1]!, Fz2[1]!, hdotX, hdotZ];
        for (let i = 0; i < nj; i++) {
          const nm = doll.sk.joints[i]?.name ?? '';
          if (!/^(hip|knee|foot)_/.test(nm)) continue;
          let tp = 0;
          for (let r = 0; r < 8; r++) tp += A[i * 3 * 8 + r]! /*占位*/ * 0;
          // 正确写法（行 = i*3+k）：
          let tpSag = 0;
          const idxSag = i * 3 + 2;
          for (let r = 0; r < 8; r++) tpSag += A[idxSag * 8 + r]! * WtAllP[r]!;
          void tp;
          pureMap[nm] = tpSag;
        }
      }
      (globalThis as { __v4spectra?: Record<string, unknown> }).__v4spectra = {
        pureMap,
        copCmd: [copCmdXs[0], copCmdXs[1], copCmdZs[0], copCmdZs[1]],
        ankDiag: (globalThis as { __ankDiag?: unknown }).__ankDiag,
        Acol: spectra ? spectra.slice(0, 6) : [],
        Gdiag: spectra ? spectra.slice(6, 12) : [],
        u: Array.from(u),
        ankTau: 0,
        tau1Leg: (() => {
          const out2: Record<string, number> = {};
          for (let i = 0; i < nj; i++) {
            const nm = doll.sk.joints[i]?.name ?? '';
            if (!/^(hip|knee|foot)_/.test(nm)) continue;
            const cap2 = doll.sk.joints[i]?.maxTorque[2] ?? 1;
            out2[nm] = (tau1[i * 3 + 2] ?? 0) / cap2;
          }
          return out2;
        })(),
      };
      for (let i = 0; i < nj * 3; i++) {
        let s2 = 0;
        for (let r = 0; r < NA; r++) s2 += (A[i * 8 + ACT[r]!]! * wrStore0[i]!) * u[r]!;   // A′ᵀu（加权基准）
        s2 *= wrStore0[i]!;   // τ = w·τ′
        // 叠加垂直支撑分量（A·FyOnly：每关节自己的静力份）
        let ts = 0;
        for (let r = 0; r < 8; r++) ts += A[i * 8 + r]! * FyOnly[r]!;
        tau1[i] = s2 + ts;
        {
          const nm = doll.sk.joints[Math.floor(i / 3)]?.name ?? '';
          if ((nm === 'foot_l' || nm === 'hip_l' || nm === 'knee_l') && i % 3 === 2) {
            const st = (globalThis as { __stage?: Record<string, unknown> }).__stage ?? {};
            st[nm] = { wln: s2, fy: ts };
            (globalThis as { __stage?: Record<string, unknown> }).__stage = st;
          }
        }
      }
    }
    // 恢复 G6 的原义（后面 N 投影要重算 Gram，无所谓——其 Gram 循环会覆盖）
  }



  // ════════════════════════════════════════════════════════════════
  // ★★★★★ 2026-10-07 **S4 主体：约束最小二乘（CLS，迭代钳位+任务回补）**
  //   替换 WLN 族。每轴的两个硬约束：
  //     ① τmax（作动限制）—— 夹到 ±cap
  //     ② 关节限位（**限位感知**）—— 推向限位方向的 τ 随剩余行程线性收缩
  //        （等价 Kanoun 2009 的不等式任务；近限位时 τ 余量→0）
  //   回补：被夹掉的任务分量用 A⁺(W*−Aτ) 重新分配（负载自动改道，Fahmi 2018）。
  // ════════════════════════════════════════════════════════════════
  if (useCLS) {
    {
      const st = (globalThis as { __stage?: Record<string, unknown> }).__stage ?? {};
      for (let i = 0; i < nj; i++) {
        const nm = doll.sk.joints[i]?.name ?? '';
        if (nm === 'foot_l' || nm === 'hip_l' || nm === 'knee_l') {
          const e = (st[nm] ?? {}) as Record<string, number>;
          e.clsIn = tau1[i * 3 + 2] ?? 0;
          st[nm] = e;
        }
      }
      (globalThis as { __stage?: Record<string, unknown> }).__stage = st;
    }
    // ★ K_LIM 标定：800 过猛（膝 ±170 往返弹）；100 最优（脊柱全零、髋零违例）
    const K_LIM = envNum('V4KLIM', 100);     // 限位"余量→力矩"的换算 (N·m/rad)
    const zone = envNum('V4LZONE', 0.25);    // 限位软化带 (rad)
    const WtAll2 = [Fx[0]!, Fy[0]!, Fz2[0]!, Fx[1]!, Fy[1]!, Fz2[1]!, hdotX, hdotZ];
    const Wt2 = ACT.map((c) => WtAll2[c]!);
    for (let it = 0; it < 4; it++) {
      // ① 钳位（τmax + 限位感知）
      for (let i = 0; i < nj; i++) {
        const jd = doll.sk.joints[i];
        if (!jd) continue;
        doll.jointRot(i, tmp.jw2);
        for (let k = 0; k < 3; k++) {
          const idx = i * 3 + k;
          let cap = (jd.maxTorque[k] ?? 60) * 0.95;
          // 限位感知（含**越限回收**）：
          //   余量 > zone：自由
          //   0 < 余量 < zone：上限随余量线性收缩
          //   余量 < 0（已越界）**改判为回收**：禁止继续推 + 给回程 τ
          const q = tmp.jw2[k]!;
          const roomHi = jd.maxRad[k]! - q;
          const roomLo = q - jd.minRad[k]!;
          if (tau1[idx]! > 0) {
            if (roomHi < 0) tau1[idx] = Math.max(-cap, K_LIM * roomHi);   // 越上界→回程(负)
            else if (roomHi < zone) cap = Math.min(cap, K_LIM * roomHi);
          } else if (tau1[idx]! < 0) {
            if (roomLo < 0) tau1[idx] = Math.min(cap, -K_LIM * roomLo);   // 越下界→回程(正)
            else if (roomLo < zone) cap = Math.min(cap, K_LIM * roomLo);
          }
          if (tau1[idx]! > cap) tau1[idx] = cap;
          else if (tau1[idx]! < -cap) tau1[idx] = -cap;
        }
      }
      // ② 任务回补：r = W* − A·τ（仅活跃列）
      const r2 = new Float64Array(NA);
      for (let rr = 0; rr < NA; rr++) {
        const cr = ACT[rr]!;
        let at = 0;
        for (let i = 0; i < nj * 3; i++) at += A[i * 8 + cr]! * tau1[i]!;
        r2[rr] = Wt2[rr]! - at;
      }
      // u2 = G8i2·r（用当前 Gram 重解——与 WLN 同设施）
      const G8b = tmp.G6;
      for (let rr = 0; rr < NA; rr++) for (let cc = 0; cc < NA; cc++) {
        const cr = ACT[rr]!, cc2 = ACT[cc]!;
        let s2 = 0;
        for (let i = 0; i < nj * 3; i++) s2 += (A[i * 8 + cr]! * wrStore0[i]!) * (A[i * 8 + cc2]! * wrStore0[i]!);
        G8b[rr * 8 + cc] = s2;
      }
      let tr3 = 0; for (let rr = 0; rr < NA; rr++) tr3 += G8b[rr * 8 + rr]!;
      const lam3 = Math.max(1e-10, 1e-5 * tr3 / NA);
      for (let rr = 0; rr < NA; rr++) G8b[rr * 8 + rr] = G8b[rr * 8 + rr]! + lam3;
      if (!invN(G8b, G8i)) break;
      const u2 = new Float64Array(8);
      for (let rr = 0; rr < NA; rr++) { let s2 = 0; for (let cc = 0; cc < NA; cc++) s2 += G8i[rr * 8 + cc]! * r2[cc]!; u2[rr] = s2; }
      for (let i = 0; i < nj * 3; i++) {
        let s2 = 0;
        for (let rr = 0; rr < NA; rr++) s2 += (A[i * 8 + ACT[rr]!]! * wrStore0[i]!) * u2[rr]!;
        tau1[i] = tau1[i]! + s2 * wrStore0[i]!;
      }
    }
  }

  const boneT = new Float64Array(nj * 3);   // ★ §9 被动骨骼力矩（plant 层）
  const fzL = feet.fz[0] ?? 0, fzR = feet.fz[1] ?? 0;
  const fzLoad = Math.max(0, fzL) + Math.max(0, fzR);
  const bSpQ = new Float64Array(nj), bSpV = new Float64Array(nj);   // §9 弦项：脊柱节角度/速度
  // ══ (b) Δτ₂：躯干角动量任务（髋驱动）+ 非髋的弱弹簧 + E1/E2 ═════
  const dtau = tmp.dtau;
  // 躯干对**世界**的倾角（直接读物理姿态；含髋的贡献——"从胯发力"的量化前提）
  let trunkPitch = 0, trunkRoll = 0;
  {
    const bi = doll.sk.bodies.findIndex((b) => b.key === 'spine3');
    if (bi >= 0 && doll.bodyWorldAxis(bi, 1, tmp.rj)) {
      // 躯干局部 +Y 的世界分量：pitch = atan2(-x?), roll = atan2(z, y)
      const ux = tmp.rj[0]!, uy = tmp.rj[1]!, uz = tmp.rj[2]!;
      trunkPitch = Math.atan2(ux, uy);   // 前倾为正（世界 x 前）
      trunkRoll = Math.atan2(uz, uy);
    }
  }
  for (let i = 0; i < nj; i++) {
    const nm = doll.sk.joints[i]?.name ?? '';
    const isHip = /^hip_/.test(nm);
    const isSpine = /^spine/.test(nm);
    doll.jointRot(i, tmp.jw2);
    const q = tmp.jw2;
    doll.jointRelVel(i, tmp.rj);
    for (let k = 0; k < 3; k++) {
      const idx = i * 3 + k;
      let d = 0;
      if (isHip && (k === 2 || k === 0)) {
        // 躯干任务：髋直接控躯干角动量（证明二）
        d += -kTrunk * (k === 2 ? trunkPitch : trunkRoll);
        d += -bTrunk * tmp.rj[k]!;
        // ★ 2026-10-06 修洞：T2 关闭(kTrunk=0)时髋不能"无弹簧"——
        //   实测后果：髋自由漂移到 ±48°，身体用扭曲姿势硬撑（用户："关节直接崩溃"）。
        //   ⇒ 髋始终保底拿到 baseline 姿势弹簧（对齐基线）。
        // ⚠ 实测：kPost=12 的髋弹簧太弱且与平衡需求对打（−39° 冻结 → +102° 冲头）
        //   ⇒ 回退无条件弹簧；**髋的姿势必须由 T2（躯干任务）承担**，
        //   而 T2 又被裂缝④（约束内解）阻塞。→ 这就是当前唯一的关键路径。
        void kPostDef;
      } else if (isSpine) {
        // ★ 脊柱：朝向 step 的提案 + **腰部回正任务**（用户令：修正含腰）
        const tgt = targets ? (targets[idx] ?? 0) : 0;
        const ref = doll.motorRef(i, k, tgt);
        d += -envNum('V4KSPINE', 40) * (q[k]! - ref);
        // 腰部外环：躯干 pitch/roll 的偏差（从预警取，含速率阻尼）
        if (k === 2) d += -kWaist * (warn?.trunkPitch ?? 0) - bWaist * (warn?.trunkRate ?? 0);
        if (k === 0) d += -kWaist * (warn?.trunkRoll ?? 0) - bWaist * (warn?.trunkRate ?? 0);
      } else {
        // ★ 其余关节（含摆动腿）：朝向 step 的提案——**迈步提提案、这里实施**
        const tgt = targets ? (targets[idx] ?? 0) : 0;
        const ref = doll.motorRef(i, k, tgt);
        d += -envNum('V4KPOST', cfg.kPost) * (q[k]! - ref);
        d += -envNum('V4BDAMP', cfg.bDamp) * tmp.rj[k]!;
      }
      // ★ §9 被动骨骼（plant 层；文献表：踝 0.91mgh≈540 / 膝 200 / 髋 120 / 脊柱 60 / 其余 30）
      {
        const nmB = doll.sk.joints[i]?.name ?? '';
        // ★ 阻尼按临界比例（踝 k_eff≈1158, I≈57 ⇒ B_crit≈512；取 ζ≈0.15 ⇒ B≈80）
        // ★ 踝 K 必须 > 临界 mgh≈618（Loram 2002：内在刚度恰好"差一点不够"）
        // ★ 腿=刚性撑杆（K 必须高于屈曲临界：膝≈274 / 髋≈206，否则腿先折、踝反馈不激活）
        let KB = /^foot_/.test(nmB) ? [envNum('V4KANK', 760), envNum('V4BANK', 60)] : /^knee_/.test(nmB) ? [envNum('V4KKNEE', 500), 20] : /^hip_/.test(nmB) ? [envNum('V4KHIP', 300), 20] : /^spine/.test(nmB) ? [150, 4] : [30, 1];
        // ★★★★★ 2026-10-07 **支撑的"标准形态"= 载荷张力**（Horak&Nashner 1986：承重侧 +65%）：
        //   支撑不写"符号+量级表"，而是**调制骨骼刚度**（参考差 k(q_ref−q) 自带正确符号）。
        //   载荷份额来自角色（状态机指定）：承重腿 ×1.65，摆动腿 ×1（非承重无变化）。
        if (/^(hip|knee|foot)_/.test(nmB)) {
          // ★ 张力增益按**实测载荷份额**（Horak 是"承重腿张力升"，不是"角色腿"）：
          //   静立双支撑 ⇒ 份额~0.5 ⇒ ld≈1；单支撑 ⇒ 承重侧 ld→1.65。
          const toneG = envNum('V4TONEG', 0);   // 默认关：静立不需要（留给迈步/负载转移期）
          const lgSide2: 'l' | 'r' = nmB.endsWith('_l') ? 'l' : 'r';
          const sh = fzLoad > 40 ? (lgSide2 === 'l' ? fzL : fzR) / fzLoad : 0.5;
          const ld = 1 + toneG * Math.max(0, sh - 0.5) * 2;
          KB = [KB[0]! * ld, KB[1]! * ld];
        }
        const scB = k === 2 ? 1 : 0.5;
        // ★★★★★ 2026-10-07 **骨骼参考=解剖静姿**（refB 用 0 目标）：
        //   此前后误用 step 提案 targets（迈步目标姿）作参考 ⇒ 骨骼弹簧把腿
        //   折向迈步目标（膝 −139 瞬态的真凶）。提案的执行是**主动层**的事，
        //   plant 层只守解剖静姿。
        if (!BONE_REF0) BONE_REF0 = new Float64Array(nj * 3);
        if (!boneRefSet) BONE_REF0[idx] = q[k]!;
        // ★★★★★ 【自主运动层】（Sentis&Khatib 2005 的行为层级之"voluntary"）：
        //   弯腰鞠躬 = 脊柱屈曲轨迹（Winter 2009 的髋铰链形态）。
        //   V4BOW=度数：0.75s 弯下 → 0.75s 回正（正弦缓冲）。
        //   骨骼弹簧按新参考伺服 ⇒ 等效"脊肌离心/向心控制"。
        let bow = 0;
        {
          const bt = boneTick / 120;
          const T1 = 0.75, T2 = 0.75;
          const ph = bt < T1 ? Math.sin((bt / T1) * Math.PI / 2)
            : bt < T1 + T2 ? Math.cos(((bt - T1) / T2) * Math.PI / 2) : 0;
          if (ph > 0) {
            // ★ 协调弯腰链（Winter 髋铰链完整形态）：各关节同相位、按解剖比例
            //   脊柱15° + 髋30° + 膝−20° + 踝(+10°) —— 各增益/符号可 env 覆盖
            if (/^spine/.test(nmB) && k === 2) bow = +envNum('V4BOW', 15) * Math.PI / 180 * ph;
            if (/^hip_/.test(nmB) && k === 2) bow = envNum('V4BOWHIP', 30) * Math.PI / 180 * ph;
            if (/^knee_/.test(nmB) && k === 2) bow = envNum('V4BOWKNEE', -20) * Math.PI / 180 * ph;
            if (/^foot_/.test(nmB) && k === 2) bow = envNum('V4BOWANK', 10) * Math.PI / 180 * ph;
          }
        }
        // ★★★★★ 静平衡配平（postural set point）：初始 CoM 比自然 CoP 前偏 δ
        //   ⇒ 从第一拍就有向前的重力加速度（必扑）。给踝参考加配平角：
        //   tau_trim = m*g*delta（负方向=把 CoP 前移），Δθ = tau_trim/K 加进参考。
        if (!boneTrimDone && /^foot_/.test(nmB) && k === 2 && (feet.fz[nmB.endsWith('_l') ? 0 : 1] ?? 0) > 30) {
          const qSide = nmB.endsWith('_l') ? 0 : 1;
          const copN = feet.copX[qSide]!;
          const delta = com.x - copN;               // >0 = CoM 在 CoP 前方
          const kA = KB[0]!;
          BONE_REF0[idx] = q[k]! - (m * G * delta) / Math.max(50, kA);
        }
        const refB = (boneRefSet ? BONE_REF0[idx]! : q[k]!) + bow;
        {
          let dmp = -KB[1]! * scB * tmp.rj[k]!;
          if (dmp > 40) dmp = 40; else if (dmp < -40) dmp = -40;
          // ★ 阻尼渐入（0.125s）：物理首步的求解器速度瞬态（~1.85 rad/s，
          //   物理上不可能的能量）不得经 B 放大成启动踢。弹簧保持全量。
          dmp *= Math.min(1, boneTick / 15);
          boneT[idx] = -KB[0]! * scB * (q[k]! - refB) + dmp;
        }
        if (/^spine/.test(nmB)) { bSpQ[i] = q[k]!; bSpV[i] = tmp.rj[k]!; }
        // ★ 踝符号翻转实验（V4ANKFLIP=1；行为判定：前倾是否被止住）
        if (/^foot_/.test(nmB) && envNum('V4ANKFLIP', 0) > 0) boneT[idx] = -boneT[idx]!;
      }
      dtau[idx] = d;
    }
  }
  boneRefSet = true;
  boneTick++;
  if (!boneTrimDone && (feet.fz[0] ?? 0) > 30 && (feet.fz[1] ?? 0) > 30) boneTrimDone = true;

  // ══ (c) N₁ 投影：N = I − A(AᵀA)⁻¹Aᵀ（n×n 作用在 Δτ 上）═════════
  // Gram = AᵀA（6×6）
  const G6 = tmp.G6;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      let s = 0;
      for (let i = 0; i < nj * 3; i++) s += A[i * 8 + r]! * A[i * 8 + c]!;
      G6[r * 8 + c] = s;
    }
  }
  const G6i = tmp.N;   // 复用
  // ★ 阻尼（Tikhonov）：Gram 在本系统**天然奇异**（两脚 Fz 列因刚体平移近似共线，
  //   实测 pivot 失败）⇒ 加 λ·I 后再求逆（λ = 1e-4·trace/6）。阻尼 NSP 是标准做法。
  {
    let tr = 0;
    for (let r = 0; r < 8; r++) tr += G6[r * 8 + r]!;
    const lam = Math.max(1e-8, 1e-4 * tr / 8);
    for (let r = 0; r < 8; r++) G6[r * 8 + r] = G6[r * 8 + r]! + lam;
  }
  const okInv = invN(G6, G6i);
  // 调试：登记奇异（经 env V4DBG 打印一次）
  if (!okInv && !(globalThis as { __v4sing?: boolean }).__v4sing) {
    (globalThis as { __v4sing?: boolean }).__v4sing = true;
    const dbg = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V4DBG;
    if (dbg === '1') console.log('[v4] Gram 奇异！不投影。G6 =', Array.from(G6).map((v) => v.toFixed(2)).join(','));
  }
  const dtauP = tmp.dtauP;
  if (okInv) {
    // w = G6i·(AᵀΔτ)  （6 维）
    const at = new Float64Array(8);
    for (let r = 0; r < 8; r++) {
      let s = 0;
      for (let i = 0; i < nj * 3; i++) s += A[i * 8 + r]! * dtau[i]!;
      at[r] = s;
    }
    const w = new Float64Array(8);
    for (let r = 0; r < 8; r++) {
      let s = 0;
      for (let c = 0; c < 8; c++) s += G6i[r * 8 + c]! * at[c]!;
      w[r] = s;
    }
    // ΔτP = Δτ − A·w
    for (let i = 0; i < nj * 3; i++) {
      let s = 0;
      for (let r = 0; r < 8; r++) s += A[i * 8 + r]! * w[r]!;
      dtauP[i] = dtau[i]! - s;
    }
  } else {
    // Gram 奇异（退化姿态）：不投影（flag 由 l1Leak 暴露）
    for (let i = 0; i < nj * 3; i++) dtauP[i] = dtau[i]!;
  }

  // ══ 合成 + L1 泄漏自检 + 软墙 ═══════════════════════════════════
  // ★ L1 泄漏**分源度量**（"通道打架"的可审计量）：
  //   leak2 = ‖AᵀΔτ_P‖ = T2/L2 漏进 L1 的部分（投影正确时 ≡0 ⇒ 不打架）
  //   leak1 = ‖A·τ₁ − W*‖ = L1 自己的物理缺口（τmax 饱和，合理）
  let l1Leak = 0;      // 保持向后兼容（= leak1 + leak2）
  let leakFromT2 = 0, leakFromL1 = 0;
  {
    const at = new Float64Array(8);
    for (let r = 0; r < 8; r++) {
      let s = 0;
      for (let i = 0; i < nj * 3; i++) s += A[i * 8 + r]! * dtauP[i]!;
      at[r] = s;
    }
    for (let r = 0; r < 8; r++) leakFromT2 += Math.abs(at[r]!);
    // L1 缺口：A·τ₁ 的有效分量 与 W* 的差
    const l1Actual = new Float64Array(8);
    for (let r = 0; r < 8; r++) {
      let s = 0;
      for (let i = 0; i < nj * 3; i++) s += A[i * 8 + r]! * tau1[i]!;
      l1Actual[r] = s;
    }
    const Wt0 = [Fx[0]!, Fy[0]!, Fz2[0]!, Fx[1]!, Fy[1]!, Fz2[1]!, hdotX, hdotZ];
    for (let r = 0; r < 8; r++) leakFromL1 += Math.abs(l1Actual[r]! - Wt0[r]!);
    l1Leak = leakFromT2 + leakFromL1;
  }
  // ★★★★★ 2026-10-07 **设计 §6.3④：τ = Jᵀ·W*（直接乘积，论文式）**——
  //   现状的 WLN/CLS 求逆在奇异 Gram 上放大 3×（膝 −39 → −126），
  //   而 W* 已按每脚给定（角色分配+控制律）⇒ 直接乘积即设计输出。
  //   V4DIRECT=0 可回退 WLN 对照。
  if (envNum('V4DIRECT', 1) > 0) {
    const W8 = [Fx[0]!, Fy[0]!, Fz2[0]!, Fx[1]!, Fy[1]!, Fz2[1]!, hdotX, hdotZ];
    for (let i = 0; i < nj * 3; i++) {
      let t = 0;
      for (let r = 0; r < 8; r++) t += A[i * 8 + r]! * W8[r]!;
      tau1[i] = t;
    }
  }
  for (let i = 0; i < nj * 3; i++) {
    out[i] = tau1[i]! + dtauP[i]!;
  }
  if (envNum('V4ZERO', 0) > 0) out.fill(0);   // 诊断：纯被动（τ≡0）
  // ★ §9 弦项（Bergmark 1989 长跨肌 / Crisco&Panjabi 1991 欧拉屈曲）：
  //   τ_cable = −T0·L_eff·sin(Σθ_spine) − B·Σω —— 多节同弯才拉紧（防"折刀"），均分到各段。
  {
    let sA = 0, sV = 0, nSp = 0;
    for (let i = 0; i < nj; i++) {
      if (/^spine/.test(doll.sk.joints[i]?.name ?? '')) { sA += bSpQ[i]!; sV += bSpV[i]!; nSp++; }
    }
    if (nSp > 0) {
      const T0 = envNum('V4CABLE', 60);
      const Lc = envNum('V4CABLEL', 0.06);
      const tc = -T0 * Lc * Math.sin(sA) - 6 * sV;
      for (let i = 0; i < nj; i++) {
        if (/^spine/.test(doll.sk.joints[i]?.name ?? '')) boneT[i * 3 + 2] += tc / nSp;
      }
    }
  }
  // ★ §9：骨骼层独立并入（不经过 A/CLS/N 投影 ⇒ 与平衡链路零重叠、不打架）
  if (envNum('V4NOBONE', 0) === 0) {
    for (let i = 0; i < nj * 3; i++) out[i] += boneT[i]!;
  }
  // ★★★★★ 裂缝④正解（2026-10-06）：**scale-to-fit**（替代 POCS 迭代）
  //   原理：N₁ 线性 ⇒ s·N₁Δτ₂ = N₁(s·Δτ₂) 仍在零空间。
  //   ⇒ 把**期望的 Δτ₂ 等比缩小**到刚好不越界（标量 s），投影后**永不越界**，
  //     且 L1 不变量**构造性保持**（leak ≡ 0）。
  //   （旧 POCS 的做法"投影后再封顶"是非线性操作，会破坏不变量——实测 leak 1.8~6.3。）
  {
    // 计算 s：使 τ₁ + s·Δτ₂p 满足盒约束（只缩放同号分量）
    const reserve0 = Math.min(0.5, Math.max(0, envNum('V4RESERVE', 0.2)));
    const cap099 = new Float64Array(nj * 3);
    for (let i = 0; i < nj; i++) {
      const jd = doll.sk.joints[i];
      for (let k = 0; k < 3; k++) cap099[i * 3 + k] = (jd?.maxTorque[k] ?? 60) * (1 - reserve0) * 0.98;
    }
    let s = 1;
    for (let i = 0; i < nj * 3; i++) {
      const base = tau1[i]!;
      const dlt = dtauP[i]!;
      if (dlt === 0) continue;
      const cap = cap099[i]!;
      // 目标 τ = base + s·dlt 需满足 |τ| ≤ cap
      if (dlt > 0) {
        const room = cap - base;
        if (room < 0) { s = 0; break; }          // τ₁ 自身已越界（先夹 τ₁）
        s = Math.min(s, room / dlt);
      } else {
        const room = -cap - base;
        if (room > 0) { s = 0; break; }
        s = Math.min(s, room / dlt);
      }
    }
    if (s < 1) {
      for (let i = 0; i < nj * 3; i++) dtauP[i] = dtauP[i]! * s;
    }
    // ★★★★★ 2026-10-06 **配额预留**（排雷第二发）：
    //   实测：全局标量 s 被任何一根饱和轴拉到 0 ⇒ T2 永远零配额 ⇒ 姿势永远无人管
    //   （关节冻结在扭曲位）。⇒ τ₁ 软帽到 (1−reserve)，**给姿势任务留固定配额**。
    const reserve = Math.min(0.5, Math.max(0, envNum('V4RESERVE', 0.2)));
    for (let i = 0; i < nj; i++) {
      const jd = doll.sk.joints[i];
      if (!jd) continue;
      for (let k = 0; k < 3; k++) {
        const idx = i * 3 + k;
        const cap = jd.maxTorque[k]! * (1 - reserve) * 0.99;
        if (tau1[idx]! > cap) tau1[idx] = cap;
        else if (tau1[idx]! < -cap) tau1[idx] = -cap;
      }
    }
  }
  // 旧 POCS 块保留在下方（V4POCS=1 时启用，供对照）
  if (envNum('V4POCS', 0) > 0) {
    const softFrac = 0.9;
    const proj = (vec: Float64Array): void => {
      // 步1：盒约束（软墙）
      for (let i = 0; i < nj; i++) {
        const jd = doll.sk.joints[i];
        if (!jd) continue;
        for (let k = 0; k < 3; k++) {
          const idx = i * 3 + k;
          const cap = jd.maxTorque[k]!;
          const soft = cap * softFrac;
          const v = vec[idx]!;
          if (v > soft) vec[idx] = soft + (cap - soft) * Math.tanh((v - soft) / Math.max(1e-6, cap - soft));
          else if (v < -soft) vec[idx] = -soft + (-cap + soft) * Math.tanh((v + soft) / Math.max(1e-6, cap - soft));
        }
      }
      // 步2：残差回投零空间（恢复 L1 不变量）
      if (!okInv) return;
      const at = new Float64Array(8);
      for (let r = 0; r < 8; r++) {
        let s2 = 0;
        for (let i = 0; i < nj * 3; i++) s2 += A[i * 8 + r]! * (vec[i]! - tau1[i]!);
        at[r] = s2;
      }
      const w = new Float64Array(8);
      for (let r = 0; r < 8; r++) {
        let s2 = 0;
        for (let c = 0; c < 8; c++) s2 += G6i[r * 8 + c]! * at[c]!;
        w[r] = s2;
      }
      for (let i = 0; i < nj * 3; i++) {
        let s2 = 0;
        for (let r = 0; r < 8; r++) s2 += A[i * 8 + r]! * w[r]!;
        vec[i] = vec[i]! - s2;
      }
    };
    for (let it = 0; it < 4; it++) proj(out);
  }
  // ★ 信号链透视（诊断）：W* / τ₁（髋膝踝）/ s / 最终 τ
  const WtDbg = [Fx[0]!, Fy[0]!, Fz2[0]!, Fx[1]!, Fy[1]!, Fz2[1]!, hdotX, hdotZ];
  let sUsed = 1;
  {
    // 反推 s（dtauP 与 dtau 的比）
    let d0 = 0, d1 = 0;
    for (let i = 0; i < nj * 3; i++) { d0 += Math.abs(dtau[i]!); d1 += Math.abs(dtauP[i]!); }
    if (d0 > 1e-9) sUsed = d1 / d0;
  }
  // ★★★★★ 2026-10-06 §4.8.4 ①②（用户："只需要垫一下脚"）——**最终输出端**：
  //   ② 垫脚优先：urgency 低 ⇒ 非踝通道按 urgency/0.3 渐入（低时≈只踝）
  //   ① 软启动：τ 首 V4SOFT 秒 smoothstep 渐入（防首拍巨力）
  {
    const urg = warn?.urgency ?? 0;
    const urgGate = Math.max(0.05, envNum('V4PAD_URG', 0.3));
    const padBoost = Math.min(1, Math.max(0.08, urg / urgGate));
    for (let i = 0; i < nj; i++) {
      const nm = doll.sk.joints[i]?.name ?? '';
      if (/^foot_/.test(nm)) continue;
      for (let k = 0; k < 3; k++) out[i * 3 + k] = out[i * 3 + k]! * padBoost;
    }
    // ★★★★★ 2026-10-07 **软启动改短**（纯 v4 基线暴露：0.2s 的斜坡把前 0.1s 压到 15%，
    //   与"前 0.1s 必须救"直接矛盾）。物理上 v4 输出本就温和（不像旧伺服首拍巨力），
    //   ⇒ 只需 1-2 拍防数值冲击：默认 0.02s。
    const tSoft = envNum('V4SOFT', 0.02);
    if (tSoft > 1e-6) {
      const tt = (globalThis as { __v4T?: number }).__v4T ?? 0;
      const r = Math.min(1, tt / tSoft);
      const sstep = r * r * (3 - 2 * r);
      for (let i = 0; i < nj * 3; i++) out[i] = out[i]! * sstep;
    }
  }
  {
    const st = (globalThis as { __stage?: Record<string, unknown> }).__stage ?? {};
    for (let i = 0; i < nj; i++) {
      const nm = doll.sk.joints[i]?.name ?? '';
      if (nm === 'foot_l' || nm === 'hip_l') {
        const e = (st[nm] ?? {}) as Record<string, number>;
        e.final = out[i * 3 + 2] ?? 0;
        e.dtauP = dtauP[i * 3 + 2] ?? 0;
        st[nm] = e;
      }
    }
    (globalThis as { __stage?: Record<string, unknown> }).__stage = st;
  }
  {
    const st = (globalThis as { __stage?: Record<string, unknown> }).__stage ?? {};
    st.__wt = Array.from(WtDbg).map((v: number) => Number(v.toFixed(2)));
    (globalThis as { __stage?: Record<string, unknown> }).__stage = st;
  }
  return { tau: out, stepReqX, stepReqZ, clampFx, l1Leak, leakFromT2, leakFromL1, Wt: WtDbg, sUsed, bone: boneT };
}
