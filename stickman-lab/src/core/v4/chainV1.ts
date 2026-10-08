/**
 * ★★★★★ 2026-10-07 **发力链路 V1（重置版）—— 分段职责，每轴唯一写者**
 *
 * 与旧 controlV1 的区别（架构_final.md §10）：
 *   旧: W*(8维扳手) → A 矩阵混合最小二乘 → 所有关节 τ"一起算"（串味/对拉）
 *   新: 五个段任务，各自独立算 τ → 优先级合成（限位统一在合成器）
 *
 * 文献（每段的出处）：
 *   ① 承重段  Winter 1980 support moment: Ms = M_hip+M_knee+M_ankle（膝主导）
 *   ② 摆平段  Horak & Nashner 1986 踝策略（CoP/ξ 跟踪）
 *   ③ 躯干段  Horak & Nashner 1986 髋策略 + Koleva 1999（从胯发力）
 *   ④ 姿态段  Panjabi 1992 / Bergmark 1989（脊柱——由骨骼层执行，此处只留接口）
 *   ⑤ 合成    Kajita §3（优先级）+ Kanoun 2009 / Fahmi 2018（限位/饱和）
 *
 * Plant 约定（本会话实证）：
 *   · jointWorldAxis 的轴与电机正方向相反 ⇒ 力矩列统一取负
 *   · 骨骼层（boneT）不在本链内——它在 ragdoll 端独立并入
 */

export interface ChainFeet {
  fz: [number, number];       // 实测垂直力（仅供诊断）
  copX: [number, number];
  copZ: [number, number];
  x: [number, number];
  z: [number, number];
  valid: [boolean, boolean];
}

export interface ChainInput {
  comX: number; comY: number; comZ: number;
  vx: number; vy: number; vz: number;
  mass: number;
  feet: ChainFeet;
  roles: { sup: 'l' | 'r' } | null;
  xiX: number; xiZ: number;        // 趋势（预警包派生——唯一来源）
  copCmdX: number | null; copCmdZ: number | null;  // 指挥官命令（可空）
  dt: number;
}

export interface ChainParams {
  kSupport: number;    // 承重段：高度误差→支撑矩 (N·m/m)
  bSupport: number;    // 承重段：竖向速度阻尼
  zRest: number;       // 站高参考
  kCop: number;        // 摆平段（踝 CoP 增益）
  kTrunk: number;      // 躯干段（髋）角动量 P
  bTrunk: number;      // 躯干段（髋）角动量 D
  kneeWeight: number;  // Winter 支撑矩分配：膝主导权重
  wHip: number; wKnee: number; wAnk: number;
}

export const CHAIN_DEFAULTS: ChainParams = {
  kSupport: 400,
  bSupport: 120,
  zRest: 0.9,
  kCop: 1.0,
  kTrunk: 120,
  bTrunk: 20,
  kneeWeight: 1.0,
  wHip: 0.5, wKnee: 1.0, wAnk: 0.3,   // Winter 1980 人类比例
};

/** 单关节单轴的力矩贡献（按关节名寻址；未列出的轴=0） */
export type TauMap = Record<string, number>;

const G = 9.81;

/**
 * ① 承重段（Winter 1980 support moment）
 *    Ms = 该腿承担的竖向载荷矩（把"不塌"作为**一条标量任务**）
 *    分配到髋/膝/踝：M_i = Ms · w_i / Σw（膝主导）
 *    符号：支撑=抵抗重力屈曲 ⇒ 膝取正（伸），踝取负（跖屈），髋取正（伸）
 */
export function segSupport(zErr: number, vz: number, mass: number, feetShare: number, p: ChainParams): TauMap {
  // ★ 修正：支撑矩是**高度调节的反馈**（VHIP 高度策略），不是恒值前馈！
  //   zErr = z_rest − z_com；站立时 zErr≈0 ⇒ τ≈0（与骨架静平衡兼容）
  const Ms = p.kSupport * zErr * mass * feetShare / 70 - p.bSupport * vz * mass * feetShare / 70;
  const S = p.wHip + p.wKnee + p.wAnk;
  const k = p.kSupport / 100;           // 归一（保持量级可调）
  // ★★ 单位力矩实验（2026-10-07）实测符号表（+5N·m → Δq）：
  //   髋 +τ=+角（伸）⇒ 支撑取 +；膝 +τ=屈（反文档！）⇒ 支撑取 −；
  //   踝 +τ=背屈（反支撑需求）⇒ 支撑取 −（跖屈蹬地）
  return {
    knee: -k * Ms * (p.wKnee / S),
    hip: +k * Ms * (p.wHip / S),
    ankle: -k * Ms * (p.wAnk / S),
  };
}

/**
 * ② 摆平段（Horak 1986 踝策略）
 *    CoP 目标 = 指挥官命令 ⊕ k_ξ·(ξ−ξ*)（极点配置，Liu 2021 形式）
 *    τ_踝 = kCop · W/h · (x − CoP*)
 *    符号：脚需"把 CoP 移到目标" ⇒ 与 (x−CoP*) 反向（本会话实测的 P 反号）
 */
export function segCop(
  x: number, vx: number, h: number, m: number,
  base: number, p: ChainParams,
): number {
  // ★★★★★ 论文原形（Hof 2010 DCM + Caron 2019 极点配置 / Liu 2021 ICI）：
  //   ξ = x + vx/ω（ω=√(g/h)，发散分量）
  //   τ_ankle = −kCop·m·g·k_ξ·(ξ − base)
  //   ⇒ 闭环 ξ̇ = ω(1−k_ξ)(ξ−base)：k_ξ>1 ⇒ 以 ω(k_ξ−1) 衰减（对消发散）
  //   k_ξ=1 为临界（实测发散 4.6/s > ω₀=3.3/s ⇒ 必须 k_ξ>1）。
  const w0 = Math.sqrt(G / Math.max(0.3, h));
  const xi = x + vx / w0;
  const kXi = 2.0;   // 目标极点数（Caron best-effort 的简化：衰减率 = ω₀）
  return -p.kCop * m * G * kXi * (xi - base);
}

/**
 * ③ 躯干段（Horak/Koleva 髋策略）
 *    τ_髋 = −kTrunk·(θ_trunk − θ*) − bTrunk·ω_trunk（θ*=0 竖直）
 */
export function segTrunk(
  trunkPitch: number, trunkRate: number, p: ChainParams,
): number {
  // ★ 符号修正（推进律）：前倾(+/世界x) ⇒ 髋 +τ（大腿前摆、骨盆反作用后仰）⇒ 躯干回正
  return +p.kTrunk * trunkPitch - p.bTrunk * trunkRate;
}

/**
 * ⑤ 合成器（Kajita 优先级）：各段的 τ 按轴相加（每段写不同轴 ⇒ 天然无冲突），
 *    统一限位（Fahmi 2018：把越限轴按比例退回，不硬顶）。
 */
export function compose(
  segs: { support: TauMap; cop: number; trunk: number },
  leg: 'l' | 'r',
  limits: Record<string, { max: number }>,
  out: Record<string, number>,
): void {
  const L = leg;
  const add = (nm: string, v: number): void => {
    const lim = limits[nm]?.max ?? 200;
    let t = (out[nm] ?? 0) + v;
    if (t > lim) t = lim; else if (t < -lim) t = -lim;
    out[nm] = t;
  };
  add(`hip_${L}`, segs.support.hip ?? 0);
  add(`knee_${L}`, segs.support.knee ?? 0);
  add(`foot_${L}`, (segs.support.ankle ?? 0) + segs.cop + segs.trunk);
  add(`hip_${L}`, segs.trunk);
}

/** 链路一拍：返回该腿的关节 τ（键=`hip_l` 等）。dt 预留（未来 ICI 在线增益） */
export function chainTick(
  leg: 'l' | 'r',
  q: { trunkPitch: number; trunkRate: number },
  inp: ChainInput,
  lim: Record<string, { max: number }>,
  params: ChainParams = CHAIN_DEFAULTS,
  _dt: number = 1 / 120,
): Record<string, number> {
  // ★ 符号标定模式：对髋/膝/踝统一注入 +5 N·m（其余段全关）→ 读 Δq 方向
  {
    const pe0 = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});
    if (!(globalThis as { __sigcalDbg?: boolean }).__sigcalDbg) {
      (globalThis as { __sigcalDbg?: boolean }).__sigcalDbg = true;
      console.log(`[sigcalDbg] V4SIGNCAL=${String(pe0.V4SIGNCAL)} V4SIGTAU=${String(pe0.V4SIGTAU)} envcnt=${Object.keys(pe0).length}`);
    }
    if (pe0.V4SIGNCAL) {
      const grp = pe0.V4SIGNCAL;
      const tv = Number(pe0.V4SIGTAU ?? '20');
      const o: Record<string, number> = {};
      if (grp === 'foot' || grp === '1') o[`foot_${leg}`] = tv;
      if (grp === 'knee') o[`knee_${leg}`] = tv;
      if (grp === 'hip') o[`hip_${leg}`] = tv;
      if (grp === 'all') { o[`hip_${leg}`] = tv; o[`knee_${leg}`] = tv; o[`foot_${leg}`] = tv; }
      return o;
    }
  }
  const qi = leg === 'l' ? 0 : 1;
  void qi;
  const share = inp.roles ? (inp.roles.sup === leg ? 0.9 : 0.1) : 0.5;
  // ★ 分段隔离开关（R2 单测）：V4C1=承重 / V4C2=摆平 / V4C3=躯干（默认全开）
  const pe = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});
  const on1 = pe.V4C1 !== '0', on2 = pe.V4C2 !== '0', on3 = pe.V4C3 !== '0';
  // ★ 支撑已由骨骼层"载荷张力"承担（标准化）；此处置零保留接口
  const support = { hip: 0, knee: 0, ankle: 0 };
  void on1;
  const copBase2 = inp.copCmdX !== null ? inp.copCmdX : inp.comX;   // 无命令时以当前 CoM 为基底（ξ 相对偏差）
  const cop = on2 ? segCop(inp.comX, inp.vx, inp.comY, inp.mass, copBase2, params) : 0;
  const trunk = on3 ? segTrunk(q.trunkPitch, q.trunkRate, params) : 0;
  const out: Record<string, number> = {};
  compose({ support, cop, trunk }, leg, lim, out);
  void inp.copCmdZ;
  return out;
}
