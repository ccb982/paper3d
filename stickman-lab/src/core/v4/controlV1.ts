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
  warn: { xiX: number; xiZ: number; urgency: number; dirX: number; dirZ: number } | null,
  /** ★ 提案包：重心偏移意图（shiftDemandF，N；立法："弱重心偏移属于提案包"） */
  shiftDemandF = 0,
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
  const bTrunk = envNum('V4BTRUNK', cfg.bTrunk);

  const h = Math.max(0.25, com.y);
  const w0 = Math.sqrt(G / h);

  // ══ (a) 力层核算器：XcoM → F*（每脚），摩擦在**力层**截断 ═════════
  const xiX = warn ? warn.xiX : com.x + com.vx / w0;   // 消费预警包（立法：不自算）
  const xiZ = warn ? warn.xiZ : com.z + com.vz / w0;
  let fzTot = 0;
  for (let q = 0; q < 2; q++) fzTot += Math.max(0, feet.fz[q] ?? 0);
  const m = doll.sk.massTotal;
  const W = m * G;
  const Fx = [0, 0], Fy = [0, 0], Fz2 = [0, 0];
  let clampFx = 0;
  let stepReqX = 0, stepReqZ = 0;
  for (let q = 0; q < 2; q++) {
    const share = fzTot > 40 ? Math.max(0, feet.fz[q]!) / fzTot : 0.5;
    const fz = W * share;
    Fy[q] = fz;
    const copNowX = feet.valid[q] ? feet.copX[q]! : feet.x[q]!;
    const copNowZ = feet.valid[q] ? feet.copZ[q]! : feet.z[q]!;
    const copCmdX = Math.min(feet.x[q]! + cfg.xF, Math.max(feet.x[q]! - cfg.xB, xiX));
    const copCmdZ = Math.min(feet.z[q]! + cfg.zH, Math.max(feet.z[q]! - cfg.zH, xiZ));
    // 裂缝①：饱和量 = 步请求（唯一合法接口）
    if (Math.abs(xiX - copCmdX) > Math.abs(stepReqX)) stepReqX = xiX - copCmdX;
    if (Math.abs(xiZ - copCmdZ) > Math.abs(stepReqZ)) stepReqZ = xiZ - copCmdZ;
    // ★★ LIPM 正解（2026-10-06 修一处符号错误）：
    //   倒立摆动力学 ẍ = ω₀²·(x − p)（加速度与 (CoM−CoP) **同号**——远离支撑才失稳）。
    //   要 CoP 落在 copCmd ⇒ 所需加速度 a* = (g/h)·(com − copCmd)
    //   ⇒ Fx = m_share·a* = W_share·(com − copCmd)/h。
    //   （曾写成 (copCmd − com)：符号翻转 ⇒ 正反馈 ⇒ CoM 一漂就再也回不来。）
    let fx = (W * share * (com.x - copCmdX)) / h;
    let fzz = (W * share * (com.z - copCmdZ)) / h;
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
    // ★★★ 提案包消费（立法）：重心偏移意图 → 侧向力目标（直接叠加，单位同为 N）
    //   无此项时重心永不转移 ⇒ LOAD 卡死（packages 回读实证）。
    fzz += shiftDemandF * share * 0.5;
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
      if (/^hip_/.test(nmA) && envNum('V4A6', 0) === 0) {   // V4A6=1 ⇒ 退回纯 6 列对照
        if (k === 2) A[idx * 8 + 6] = 1.0;    // 髋矢状 → Ḣx(俯仰)
        if (k === 0) A[idx * 8 + 7] = 1.0;    // 髋侧向 → Ḣz(侧倾)
      }
      for (let q = 0; q < 2; q++) {
        const rx = feet.x[q]! - tmp.jw[0]!;
        const ry = 0 - tmp.jw[1]!;
        const rz = feet.z[q]! - tmp.jw[2]!;
        // a×r 的分量
        const cx = ay * rz - az * ry;
        const cy = az * rx - ax * rz;
        const cz = ax * ry - ay * rx;
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
  // ★★★★★ 2026-10-06 **支撑/修正分离**（修一处致命分类错误）：
  //   实测教训：WLN 把膝 τ 降到 3 N·m ⇒ 膝是**支撑链**关节、垂直支撑必须
  //   每关节各担其份（否则膝 buckles、腿塌、关节飞到 −174°）。
  //   ⇒ 垂直分量（Fy）走 **A·Fy**（每关节自己的静力支撑）；
  //     水平修正（Fx/Fz2/Ḣ）才是"冗余可分配"，走 WLN。
  const FyOnly = [0, Fy[0]!, 0, 0, Fy[1]!, 0, 0, 0];
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
    const ACT = [0, 2, 3, 5, 6, 7];
    const NA = ACT.length;
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
    const G8i = tmp.N;
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
    if (invN(G8, G8i)) {
      const WtAll = [Fx[0]!, 0, Fz2[0]!, Fx[1]!, 0, Fz2[1]!, hdotX, hdotZ];
      const Wt = ACT.map((c) => WtAll[c]!);
      let u = new Float64Array(8);        // u = G8i·W*（活跃列）
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
      (globalThis as { __v4spectra?: Record<string, unknown> }).__v4spectra = {
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
      }
    }
    // 恢复 G6 的原义（后面 N 投影要重算 Gram，无所谓——其 Gram 循环会覆盖）
  }

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
        // ★ 脊柱：朝向 step 的提案（关节零位=素材姿势 ⇒ 目标换算同 risState 约定）
        const tgt = targets ? (targets[idx] ?? 0) : 0;
        const ref = doll.motorRef(i, k, tgt);
        d += -envNum('V4KSPINE', cfg.kSpine) * (q[k]! - ref);
      } else {
        // ★ 其余关节（含摆动腿）：朝向 step 的提案——**迈步提提案、这里实施**
        const tgt = targets ? (targets[idx] ?? 0) : 0;
        const ref = doll.motorRef(i, k, tgt);
        d += -envNum('V4KPOST', cfg.kPost) * (q[k]! - ref);
        d += -envNum('V4BDAMP', cfg.bDamp) * tmp.rj[k]!;
      }
      dtau[idx] = d;
    }
  }

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
  for (let i = 0; i < nj * 3; i++) {
    out[i] = tau1[i]! + dtauP[i]!;
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
  return { tau: out, stepReqX, stepReqZ, clampFx, l1Leak, leakFromT2, leakFromL1, Wt: WtDbg, sUsed };
}
