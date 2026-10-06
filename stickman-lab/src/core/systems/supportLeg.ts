/**
 * ══════════════════════════════════════════════════════════════════
 * supportLeg.ts —— **承重腿专责模块**（用户 2026-10-06 提案；设计 §21.14）
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户：「**找为何后腿不能承重**。迈步系统也要权保证**后腿不后退、能真的支撑身体**。
 *   平衡保持系统也有权。**可能需要一个专门处理承重腿位置以及如何发力的模块**」
 *
 * 回读实证（`probe-slip`）：支撑腿全程**笔直**（髋 −2°、膝 −0°、踝 −1°），
 *   而 CoM 冲到 +197mm（脚在 x≈−70）⇒ **腿留在身后、不伸髋、不蹬踝**。
 *
 * 本模块的律：**静力映射** —— 给定地面反力（F_h, F_v）与目标 CoP，
 *   每个关节的力矩 = **地面反力对该关节的矩**（精确静力、无求解、不会抖）：
 *
 *     τ_j (矢状) = ∓[ F_v·(CoP − x_j) + F_h·y_j ]
 *
 *   符号按本 rig 的实测约定（`probe-copauth`：**负角 ⇒ CoP 前移**；
 *   `ANkle_COP` 律：`τ = +k·(CoP_obs − CoP_want)`）用 `SIGN_*` 开关标定。
 *
 * 与既有模块的关系：
 *   · ④c 的 `τ=JᵀF` 仍是**全链**（含脊柱）分配 —— 本模块输出**腿的那一份**，
 *     在 `sagJf` 之前写（同轴同系统相加，之后 ④c 若也写就叠加）；
 *   · **让位**与**承重声明**与 ④c 同规（`requestHold` + `loadBearing=true`）。
 *
 * 开关：`SUPLEG=0` 关（默认开）；`SUPLEGK` 水平增益；`SLSIGN_*` 标定符号。
 */
import type { RigState } from '../rigState';
import type { Ragdoll } from '../ragdoll';

const env = (): Record<string, string> =>
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};

export function supportLegTick(rs: RigState, doll: Ragdoll, ablate = ''): void {
  // ★ 必须接 `ablate`（门禁 B：「全消融 == 零输出」）——`supLeg` 是它的门名。
  const OFF = new Set(ablate.split(',').map((x) => x.trim()).filter(Boolean));
  /** 与 balance/step 同名的 `on('…')` 写法（门禁 A2 靠这个写法对账） */
  const on = (ch: string): boolean => !OFF.has(ch);
  if (!on('supLeg')) return;
  const plan = rs.copPlan;
  if (!plan || !plan.valid) return;
  const sup = rs.supportLeg();
  const jn = rs.sk.joints.map((j) => j.name);
  const jHip = jn.indexOf(`hip_${sup}`);
  const jKnee = jn.indexOf(`knee_${sup}`);
  const jAnk = jn.indexOf(`foot_${sup}`);
  if (jHip < 0 || jKnee < 0 || jAnk < 0) return;

  // 支撑载荷（原始，N）与水平力需求
  const side: 0 | 1 = sup === 'l' ? 0 : 1;
  // ★★★ Fv 的稳健来源（2026-10-06 实测：原取「原始 CoP 有效性」→ 瞬时 false 常发
  //   ⇒ 模块静默早退、`supLegTau ≡ 0` ——回读里"承τ=(0,0,0)"就是这个）。
  //   口径：优先原始力；无效时退到**载荷滤波 × 体重**（`loadFrac` 是同一份数据的低通）。
  const rawOk = rs.soleCopValid[side] === true && rs.soleCopFz[side]! > 15;
  const lf = sup === 'l' ? rs.loadFrac.l : rs.loadFrac.r;
  const Fv = rawOk ? rs.soleCopFz[side]! : lf * rs.sk.massTotal * 9.81;
  if (!(Fv > 40)) return;
  const num = (k: string, d: number): number => {
    // ★⚠ `Number('') === 0` 且 `isFinite(0)` 为真 ⇒ 旧写法在**未设环境变量时返回 0，
    //   默认值永远用不上** ⇒ 符号/增益全 0 ⇒ 模块静默输出恒 0（实测：Fh=0、τ=0，
    //   而中间量 M_A=−101.8 —— 就是这里）。必须显式判空串。
    const raw = env()[k];
    if (raw === undefined || raw === '') return d;
    const v = Number(raw);
    return Number.isFinite(v) ? v : d;
  };
  const kH = num('SUPLEGK', 1.0);
  const m = rs.sk.massTotal;
  const w0 = rs.omega0();
  const Fh = kH * (-m * w0 * w0 * plan.overX - 2 * m * w0 * 0.9 * rs.com.vx * 0.5);

  // 目标 CoP 与世界关节位
  const copT = plan.needX;
  const jw = new Float64Array(3);
  const pos = (j: number): { x: number; y: number } => { doll.jointWorld(j, jw); return { x: jw[0]!, y: jw[1]! }; };
  const pH = pos(jHip), pK = pos(jKnee), pA = pos(jAnk);

  // 静力矩：`M_j = F_v·(CoP − x_j) + F_h·(y_j − y_contact)`（contact y≈0）
  const M = (p: { x: number; y: number }): number => Fv * (copT - p.x) + Fh * p.y;

  // 符号标定（默认按"地面反力矩 → 马达力矩取负"）
  const sH = num('SLSIGN_HIP', -1), sK = num('SLSIGN_KNEE', -1), sA = num('SLSIGN_ANK', -1);
  const tauH = sH * M(pH), tauK = sK * M(pK), tauA = sA * M(pA);

  // 让位（位置环只留阻尼；力矩是唯一承重路径）+ 承重声明
  rs.requestHold(jHip, 2, 'balance', '承重腿·让位');
  rs.requestHold(jKnee, 2, 'balance', '承重腿·让位');
  rs.requestHold(jAnk, 2, 'balance', '承重腿·让位');
  for (const [j, t] of [[jHip, tauH], [jKnee, tauK], [jAnk, tauA]] as const) {
    const tmax = rs.sk.joints[j]!.maxTorque[2] ?? 120;
    const tc = Math.max(-tmax, Math.min(tmax, t));
    if (Math.abs(tc) > 0.05) rs.requestTorque(j, 2, tc, 'balance', '承重腿·静力', true);
  }
  rs.supLegTau = { hip: tauH, knee: tauK, ank: tauA, Fh, Fv };
  void pH; void pK;
}
