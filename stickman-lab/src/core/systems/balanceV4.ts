/**
 * ★★★★★ 2026-10-06 **V4 平衡模块（全新架构）**
 *
 * 用户定调：「我想让你重新写 v4 架构而不是调参，旧架构也要丢弃。
 *   脚不知为何一直在抖，然后向前，导致重心改变然后倒了，可能是力矩还是太大导致的抖」。
 *
 * 诊断（本会话全部实测的收束）：
 *   · V3 = 位置伺服范式（K=48 弹簧 + 目标钉死）：
 *     ① 支撑必须靠"静姿 sag × K"（K 降就塌）；
 *     ② K 放大一切高频扰动 = **抖**；抖动破坏摩擦 → 脚滑前移 → 倒。
 *   · V4 = 力矩范式：关节执行器只输出力矩（`V4MODE` 里 K≡0）：
 *     τ_joint = τ_grav（几何精确 FF，见 ragdoll 的 GRAVTAU）
 *             + τ_damp（阻尼）
 *             + **τ_bal（本文件）**
 *
 * 本模块是 V4 里**唯一**的姿势/平衡写者：
 *   ① 踝策略：CoP 追随 XcoM（Hof 2010；`ξ = CoM + v/ω₀`），
 *      `τ = (CopCmd − CopNow)·Fz` 是精确的静力换算（k=1 即物理值）；
 *   ② 髋策略：XcoM 超出足缘（CoP 饱和）后，髋补角度冲量；
 *   ③ 侧向：同构（踝轴 0 / 髋轴 0）。
 *
 * 所有量纲都是 N·m——**命令即力矩，没有 K 放大**。
 */
import type { RigState, Side } from '../rigState';

const G = 9.81;
/** 垂直 SLIP 的标称高度（慢 LPF 状态；模块级，跨帧保持） */
let z0LPF = 0;
/** ★ 间歇控制状态（模块级）：剩余发力时间 / 上次触发 */
let actT = 0;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

const num = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const raw = env[k];
  if (raw == null || raw === '') return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};

export function driveBalanceV4(rs: RigState, doll: { jointWorld: (i: number, out: Float64Array) => void }, _dt: number): void {
  const sup: Side = rs.supportLeg();
  const sIdx = sup === 'l' ? 0 : 1;
  const jn = rs.sk.joints.map((j) => j.name);
  const jHip = jn.indexOf(`hip_${sup}`);
  const jAnk = jn.indexOf(`foot_${sup}`);
  if (jAnk < 0) return;

  // ── 几何（全部物理现读；姿态自适应）─────────────────────────
  const footX = rs.soleX[sup];
  const footZ = rs.soleZ[sup];
  const h = Math.max(0.25, rs.com.y - Math.max(0, rs.soleY[sup] ?? 0));
  const w0 = Math.sqrt(G / h);

  // ── XcoM（外推重心，Hof 2010）───────────────────────────────
  const xiX = rs.com.x + rs.com.vx / w0;
  const xiZ = rs.com.z + rs.com.vz / w0;

  // ── 支持范围（米；可扫标定）─────────────────────────────────
  const xF = num('V4X_F', 0.13);   // 脚趾方向余量
  const xB = num('V4X_B', 0.05);   // 脚跟方向余量
  const zH = num('V4Z_H', 0.055);  // 足宽
  const copXcmd = clamp(xiX, footX - xB, footX + xF);
  const copZcmd = clamp(xiZ, footZ - zH, footZ + zH);

  // ── 实测 CoP / Fz ───────────────────────────────────────────
  const fzMeas = rs.soleCopFz[sIdx] ?? 0;
  const Fz = fzMeas > 60 ? fzMeas : rs.sk.massTotal * G;
  const copX = rs.soleCopValid[sIdx] ? rs.soleCopX[sIdx]! : footX;
  const copZ = rs.soleCopValid[sIdx] ? rs.soleCopZ[sIdx]! : footZ;

  // ── ① 踝策略：**间歇控制**（Gawthrop 2011：continuous observation,
  //    intermittent action；Bottaro 2005：摆动=间歇稳定的残余颤振）────
  //    连续观测：每拍算 ξ 与误差；
  //    间歇动作：误差进入**死区**就**完全安静**（τ=0）；出死区才触发，
  //    触发后**最短发力 `V4TMIN`**（一个安静的"拍"），再回观察。
  //    ⇒ 把 V3 的"连续抖振"换成"间歇的安静拍"。
  const kA = num('V4KA', 1.0);
  const sz = num('V4SZ', 1);
  const dead = num('V4DEAD', 0.02);     // 死区（m）：ξ 相对支撑脚
  const tMin = num('V4TMIN', 0.06);     // 最短发力（s）
  const dtI = _dt > 1e-6 ? _dt : 1 / 120;
  // 触发量 = XcoM 冲出"安全子范围"的量（脚缘内退 dead 为界；出界即事件）
  const safeLoX = footX - xB + dead, safeHiX = footX + xF - dead;
  const safeLoZ = footZ - zH + dead, safeHiZ = footZ + zH - dead;
  const xiErrX = xiX - Math.min(safeHiX, Math.max(safeLoX, xiX));
  const xiErrZ = xiZ - Math.min(safeHiZ, Math.max(safeLoZ, xiZ));
  if (actT > 0) actT -= dtI;
  const trig = Math.abs(xiErrX) > dead || Math.abs(xiErrZ) > dead;
  if (trig && actT <= 0) actT = tMin;
  if (actT > 0) {
    // 发力拍：把 CoP 压到 ξ 方向（静力换算，姿态精确）
    // 符号（实测约定）：正踝 τ ⇒ CoP **后移** ⇒ 要 CoP 前移取负。
    const tauAnkX = -(copXcmd - copX) * Fz * kA;
    const tauAnkZ = (copZcmd - copZ) * Fz * kA;
    rs.requestTorque(jAnk, 2, tauAnkX, 'balance', 'V4·踝CoP(拍)', true);
    rs.requestTorque(jAnk, 0, tauAnkZ * sz, 'balance', 'V4·踝侧(拍)', true);
  }
  // 死区内且无剩余发力 ⇒ τ=0 ⇒ 完全安静（骨骼+FF 支撑）

  // ── ② 垂直：SLIP 弹簧-质量（经典站立模型）────────────────────
  //    关节级 D 打不到"整身垂直弹跳"模态（相对角速度几乎为零），
  //    必须用 CoM 级的垂直弹簧-阻尼映射到腿伸展力矩。
  //    zRef 用"起立期 LPF"自动标定（人不需要知道绝对高度，只需要稳在当下）。
  const kZ = num('V4KZ', 0);
  const cZ = num('V4CZ', 0);
  const jKnee = jn.indexOf(`knee_${sup}`);
  if (jKnee >= 0 && (kZ !== 0 || cZ !== 0)) {
    // zRef = **慢 LPF**（τ_z 默认 1.5s）：跟踪姿态的慢变化、滤掉 12Hz 弹跳。
    // （用户观察修正）：实测抖 = 12Hz 垂直振荡（CoM.y ±2.5mm、Fz 0↔1200、
    //  等效垂直刚度 ~320kN/m —— 人的 10~30 倍）。SLIP 的作用是**用主动弹簧
    //  把它软下来**（目标 2~3Hz），不是叠加更多力。
    const tauZ = num('V4ZTAU', 1.5);
    const dtEff = _dt > 1e-6 ? _dt : 1 / 120;
    const kk = Math.min(1, dtEff / tauZ);
    z0LPF = z0LPF === 0 ? rs.com.y : z0LPF + (rs.com.y - z0LPF) * kk;
    const zRef = z0LPF + num('V4Z_OFF', 0);
    const dFz = kZ * (zRef - rs.com.y) - cZ * rs.com.vy;
    // ★★★★★ 2026-10-06 修正（单关节 lever 是错的形态）：
    //   垂直力必须按**空间力臂**分配到整条腿（V3 的 `M(p)=Fv×(copT−p.x)` 同构）：
    //     τ_joint = sJ · dFz · (CoP − p_joint.x)
    //   ——同一竖直力的矩对每个关节自动正确，且**不含水平分量**
    //   （单关节伸展 = 斜向蹬，会带水平扰动，实测负）。
    const sJ = num('V4SLIP_S', -1);
    const copT = copXcmd;
    const tmp = new Float64Array(3);
    const pJ = (j: number): number => { doll.jointWorld(j, tmp); return tmp[0]!; };
    const applyLeg = (j: number, label: string): void => {
      if (j < 0) return;
      rs.requestTorque(j, 2, sJ * dFz * (copT - pJ(j)), 'balance', label, true);
    };
    applyLeg(jHip, 'V4·SLIP髋');
    applyLeg(jKnee, 'V4·SLIP膝');
    applyLeg(jAnk, 'V4·SLIP踝');
  }

  // ── ③ 髋策略：XcoM 超出足缘（CoP 命令饱和）后补力矩 ─────────
  //    Vlutters/Hof：大扰动的恢复主要靠髋（地面反力不够）。
  //    简化：τ_hip 直接按 XcoM 超界量给（角度冲量语义）。
  const overX = xiX - copXcmd;
  const overZ = xiZ - copZcmd;
  const kH = num('V4KH', 0.0);   // 默认关（先只测踝策略）
  if (kH > 0 && jHip >= 0) {
    const tauHipX = -overX * Fz * kH;
    const tauHipZ = -overZ * Fz * kH;
    rs.requestTorque(jHip, 2, tauHipX, 'balance', 'V4·髋CoP', true);
    rs.requestTorque(jHip, 0, tauHipZ * sz, 'balance', 'V4·髋侧', true);
  }
}
