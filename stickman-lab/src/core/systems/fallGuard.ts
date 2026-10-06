/**
 * ══════════════════════════════════════════════════════════════════
 * systems/fallGuard.ts —— **摔倒方向预测**（§22.19.4 第 ① 步）
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-06：
 *   「**想后倒的时候脚后跟是需要发更大的力的**」
 *   「应该是还需要一个**预测摔倒方向从而在对应方向发力**的模块？」
 *
 * 文献依据（`架构_v2_三模块协作.md` §22.19）：
 *   · **方向与紧迫度可由 CoM 位置+速度算出**：
 *     Hof, Gazendam & Sinke 2005（*J Biomech* 38:1，XcoM/捕获点）、
 *     Pai & Patton 1997（*J Biomech* 30:347，速度-位置联合预测）；
 *   · **平衡修正按方向不同**：Carpenter 1999（PMID 10550507）、
 *     Grüneberg 2005（PMID 16033938，roll/pitch 时间上分离）；
 *   · **策略按"可用权限"级联**：Runge 1999（*J Neurophysiol* 82:2153）、
 *     Maki & McIlroy 1997（change-in-support）；
 *   · **踝是矢状执行器**：Carpenter 2001（PMID 11500802，踝力矩向量 primarily
 *     along the pitch plane）—— 与本 rig 实测的 62 N·m 侧向天花板互证（§22.11.2）。
 *
 * ★★ 本模块**只读**（不写任何目标/力矩）—— 第 ① 步的全部内容就是"把方向与
 *    紧迫度算出来并回读"，零风险、可先验收；策略级联（②③④）等验收过再上。
 *
 * 方向约定（与全项目一致）：x = 矢状(前) / y = 竖直 / z = 额状(左)。
 *   `dirDeg`：0 = +x（前），+90 = +z（左），−90/−270 折到 (−180,180]。
 */
import type { RigState } from '../rigState';

/**
 * ★ 各方向的**可用权限**（相对前向 = 1.0）—— §22.19.1 的力臂 × 肌力。
 *
 *   前向：踝轴→脚尖 ≈ 150~200mm，跖屈 120~160 N·m
 *   后向：踝轴→脚跟 ≈ **50~60mm**，背屈 **30~40 N·m** ⇒ 双重劣势（各 ~3 倍）
 *   侧向：本 rig 实测脚半宽 ±90mm、内外翻 28 N·m，且 Carpenter 2001 实测
 *         「踝力矩向量 primarily along the pitch plane」⇒ 侧向权限最小
 *
 *   ⚠ 这三个数是**量级比值**（工程初值），不是逐项标定值；
 *     标定判据见 §22.19.4 验收②（后向应比前向更早触发髋/迈步）。
 */
export const DIR_AUTHORITY = {
  front: 1.0,
  back: 1 / 3,
  left: 0.3,
  right: 0.3,
} as const;

export type FallRegion = keyof typeof DIR_AUTHORITY | 'center';

export interface FallGuardParams {
  /** 脚掌的**半长/半宽**（m）—— 支撑面边界由"实测脚中心 ± 它"给出 */
  footHalfX?: number;
  footHalfZ?: number;
  /** 紧迫度归一化尺度（m）：到边界余量小于它就开始计紧迫度 */
  urgencyScale?: number;
  /** 死区（m）：余量大于它 ⇒ `urgency = 0`（静止时不要满屏噪声） */
  deadZone?: number;
  /** 总开关 */
  enabled?: boolean;
  /**
   * ★★★★ **三档阈值**（用户 2026-10-06：「**对于各向摔倒都要有一个明确的应对机制**」
   *   「**要摔倒了，也别管承重腿摆动腿了，优先稳住身体**」）。
   *
   *   `urgency < warn`            ⇒ `normal`：正常，角色分离（边界② 有效）
   *   `warn ≤ u < emergency`      ⇒ `warn`  ：**预警**——按方向**提前**介入（后向阈值更低）
   *   `u ≥ emergency`             ⇒ `emergency`：**应急**——**解除角色分离**，
   *                                  双踝/双髋/腰全部可用于"稳住身体"
   */
  warnUrgency?: number;
  emergencyUrgency?: number;
}

export const DEFAULT_FALL_GUARD: Required<Pick<FallGuardParams,
  'footHalfX' | 'footHalfZ' | 'urgencyScale' | 'deadZone' | 'enabled'
  | 'warnUrgency' | 'emergencyUrgency'>> = {
  // 本 rig 实测：脚半宽 ±90mm（§22.11.2 的 62 N·m 天花板就是它算出来的）
  footHalfZ: 0.09,
  // 脚全长约 240mm ⇒ 半长 ~120mm
  footHalfX: 0.12,
  urgencyScale: 0.10,
  deadZone: 0.02,
  enabled: true,
  warnUrgency: 0.35,
  emergencyUrgency: 0.70,
};

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** 把角度折到 (−180, 180]（度） */
function wrapDeg(a: number): number {
  let x = a % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
}

/**
 * 摔倒方向预测（一拍，**纯读**）。结果写进 `rs.fall`。
 *
 * 用**捕获点**（`rs.dcm`，XcoM）而不是裸 CoM：捕获点把速度也算了进去，
 * 是"再不动就必须换支撑"的那个判据（Hof 2005）。`rs.mos` 是它的一维版本
 * （只算前向），本模块把它推广到**四个方向 + 象限 + 权限**。
 */
export function fallGuard(rs: RigState, p: FallGuardParams = DEFAULT_FALL_GUARD): void {
  const fg = rs.fall;
  fg.ran++;
  const uWarn = p.warnUrgency ?? DEFAULT_FALL_GUARD.warnUrgency;
  const uEmg = p.emergencyUrgency ?? DEFAULT_FALL_GUARD.emergencyUrgency;
  if (p.enabled === false) { fg.note = '关闭'; return; }

  const hx = p.footHalfX ?? DEFAULT_FALL_GUARD.footHalfX;
  const hz = p.footHalfZ ?? DEFAULT_FALL_GUARD.footHalfZ;

  // ── 支撑面（由**实测脚中心** ± 脚半尺寸）──
  //   不用 `rs.support.halfX` 的初值：那是接触统计出来的，抖动大；
  //   几何量（脚中心 + 脚尺寸）是**确定性**的，适合当"边界"。
  //   ⚠ 只有真正着地（`grounded`）的脚才算边界 —— 摆动脚不算支撑。
  const gl = rs.grounded.l, gr = rs.grounded.r;
  if (!gl && !gr) { fg.note = '双脚离地（无支撑面）'; fg.valid = false; return; }
  fg.valid = true;
  const zs: number[] = [], xs: number[] = [];
  if (gl) { zs.push(rs.soleZ.l); xs.push(rs.soleX.l); }
  if (gr) { zs.push(rs.soleZ.r); xs.push(rs.soleX.r); }
  const xMin = Math.min(...xs) - hx, xMax = Math.max(...xs) + hx;
  const zMin = Math.min(...zs) - hz, zMax = Math.max(...zs) + hz;
  fg.xMin = xMin; fg.xMax = xMax; fg.zMin = zMin; fg.zMax = zMax;

  // ── 方向与紧迫度（基于**捕获点**）──
  const px = rs.dcm.x, pz = rs.dcm.z;
  fg.px = px; fg.pz = pz;
  const mFront = xMax - px, mBack = px - xMin;
  const mLeft = zMax - pz, mRight = pz - zMin;
  fg.mFront = mFront; fg.mBack = mBack; fg.mLeft = mLeft; fg.mRight = mRight;
  const margin = Math.min(mFront, mBack, mLeft, mRight);
  fg.margin = margin;

  const dz = p.deadZone ?? 0;
  const sc = Math.max(1e-6, p.urgencyScale ?? 0.1);
  fg.urgency = Math.max(0, Math.min(1, (sc - (margin - dz)) / sc));

  // ── 方向向量：从**支撑中心**指向捕获点（水平面），单位化 ──
  const cx = (xMin + xMax) / 2, cz = (zMin + zMax) / 2;
  const fx = px - cx, fz = pz - cz;
  const len = Math.hypot(fx, fz);
  if (len < 1e-6) { fg.dirX = 0; fg.dirZ = 0; fg.dirDeg = 0; }
  else { fg.dirX = fx / len; fg.dirZ = fz / len; fg.dirDeg = wrapDeg(Math.atan2(fz, fx) * R2D); }

  // ── 象限（哪个方向的余量最紧）+ 该方向的**可用权限** ──
  const cand: [FallRegion, number][] = [
    ['front', mFront], ['back', mBack], ['left', mLeft], ['right', mRight],
  ];
  cand.sort((a, b) => a[1] - b[1]);
  const region = cand[0]![0];
  fg.region = margin > (p.urgencyScale ?? 0.1) ? 'center' : region;
  fg.authorityScale = fg.region === 'center' ? 1 : DIR_AUTHORITY[fg.region];
  // ── 三档模式（用户：「各向摔倒都要有明确的应对机制」）──
  fg.mode = fg.urgency >= uEmg ? 'emergency' : fg.urgency >= uWarn ? 'warn' : 'normal';
  // 应急时**解除角色分离**（「别管承重腿摆动腿了」）—— 读端据此放开边界②
  fg.roleSuspended = fg.mode === 'emergency';
  if (fg.mode === 'emergency') fg.emergencyTicks++; else fg.emergencyTicks = 0;
  if (fg.mode === 'warn') fg.warnTicks++; else fg.warnTicks = 0;
  fg.note = fg.region === 'center'
    ? `稳（余量 ${(margin * 1000).toFixed(0)}mm，方位 ${fg.dirDeg.toFixed(0)}°）`
    : `${fg.mode === 'emergency' ? '★应急' : fg.mode === 'warn' ? '⚠预警' : ''}`
      + `${fg.region}（余量 ${(margin * 1000).toFixed(0)}mm，权限 ${(fg.authorityScale * 100).toFixed(0)}%）`;
}
