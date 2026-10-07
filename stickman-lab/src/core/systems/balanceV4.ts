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
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

const num = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const raw = env[k];
  if (raw == null || raw === '') return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};

export function driveBalanceV4(rs: RigState, _dt: number): void {
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

  // ── ① 踝策略：CoP 追随 XcoM ─────────────────────────────────
  //    符号（实测约定）：正踝 τ ⇒ CoP **后移**。
  //    ⇒ 要 CoP 前移（copXcmd > copX）时取**负** τ。
  const kA = num('V4KA', 1.0);
  const tauAnkX = -(copXcmd - copX) * Fz * kA;
  const tauAnkZ = (copZcmd - copZ) * Fz * kA;   // 侧向符号待实测标定（V4SZ）
  const sz = num('V4SZ', 1);
  rs.requestTorque(jAnk, 2, tauAnkX, 'balance', 'V4·踝CoP', true);
  rs.requestTorque(jAnk, 0, tauAnkZ * sz, 'balance', 'V4·踝侧', true);

  // ── ② 垂直：SLIP 弹簧-质量（经典站立模型）────────────────────
  //    关节级 D 打不到"整身垂直弹跳"模态（相对角速度几乎为零），
  //    必须用 CoM 级的垂直弹簧-阻尼映射到腿伸展力矩。
  //    zRef 用"起立期 LPF"自动标定（人不需要知道绝对高度，只需要稳在当下）。
  const kZ = num('V4KZ', 0);
  const cZ = num('V4CZ', 0);
  const jKnee = jn.indexOf(`knee_${sup}`);
  if (jKnee >= 0 && (kZ !== 0 || cZ !== 0)) {
    const zRefRaw = num('V4Z_REF', 0);
    const zRef = zRefRaw > 0 ? zRefRaw : (rs.com.y + num('V4Z_OFF', 0));
    const dFz = kZ * (zRef - rs.com.y) - cZ * rs.com.vy;
    // 伸展力矩（腿近似两连杆：Fz→τ 的比例由 V4ZL 标定，默认 0.06 m 等效力臂）
    const lever = num('V4ZL', 0.06);
    rs.requestTorque(jKnee, 2, -dFz * lever, 'balance', 'V4·垂直SLIP', true);
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
