/**
 * ══════════════════════════════════════════════════════════════════
 * decompose.ts —— **平衡监督层：感知 → 逐轴分解**（`架构_v2_三模块协作.md` §21.11）
 * ══════════════════════════════════════════════════════════════════
 *
 * 职责（**一层一个输出**，绝不产生第二个判据）：
 *   输入：捕获点 ξ（`rs.dcm`）+ 实测支撑面（`rs.support`）
 *        + **原始** CoP（`rs.soleCopX/Fz`）
 *   输出：`CopPlan` ——
 *     · `needX/needZ`  = clamp(ξ, 支撑面)          —— 能救的最优 CoP
 *     · `overX/overZ`  = ξ − need                  —— **溢出量**（脚放不下、必摔的部分）
 *     · `actionability`= 1 − |over|/scale          —— **"要不要摔倒"** 只判这一条
 *     · `kX/kZ`        = 方向权限                  —— 固定方向权限（见下）
 *
 * 分解规则（§21.10 的 4 个方向）：
 *   矢状 errX = needX − CoP_obs_x  → 踝 `foot/2`（执行层 = `ANKLE_COP`）
 *   额状 errZ = needZ − CoP_obs_z  → 中足 `midfoot/0` + 髋外展 `hip/0`
 *   溢出（|over|）                 → 腿链水平力 `τ=JᵀF`（剪力）→ 再溢出 = 落足
 *
 * ⚠ 本模块**纯计算**：不发目标、不发力矩、不改 `rs` 的其它字段（只写 `rs.copPlan`）。
 *
 * ★★★★★ 2026-10-08 **清理**（agent）：原实现有 `useFall` 双分支，读 `rs.fall`
 *   （`systems/fallGuard.ts` 的产物）。但 `fallGuard.ts` **早已删除**，
 *   `rs.fall` 只剩硬编码初值 `valid:false` **无任何写者** ⇒ `useFall` 恒 false
 *   ⇒ 整个分支是死的，且让读者以为这里还有两条路。
 *   已删除 `rs.fall` 依赖与 `onFall` 参数：ξ 唯一来源 = `rs.dcm`，
 *   支撑面唯一来源 = `rs.support`。**行为逐位等价**（原路径就是回退路径）。
 */
import { envNum } from '../env';
import type { RigState } from '../rigState';

/** 方向权限（原与 `fallGuard.DIR_AUTHORITY` 同口径；§22.19.1 实测） */
const K_FRONT = 1.0;      // 前：CoP 可到脚尖（权限足）
const K_BACK = 1 / 3;     // 后：只能到脚跟（劣势方向）
const K_SIDE = 0.3;       // 侧：中足 + 髋，权限最小

/** 溢出量的归一化尺度（m）：超过它 ⇒ `actionability = 0`（必须落足） */
const OVER_SCALE = 0.10;

/**
 * 每拍一次：把"防摔感知"切成逐轴修正量，写进 `rs.copPlan`。
 */
export function decomposeCop(rs: RigState): void {
  const sp = rs.support;
  const xiX = rs.dcm.x;
  const xiZ = rs.dcm.z;
  const xMin = sp.cx - sp.halfX;
  const xMax = sp.cx + sp.halfX;
  const zMin = sp.cz - sp.halfZ;
  const zMax = sp.cz + sp.halfZ;
  const valid = xMax > xMin && zMax > zMin;

  const cl = (v: number, lo: number, hi: number): number => (v > hi ? hi : v < lo ? lo : v);
  // ★★★★★ 2026-10-06 **needX/needZ 规划平滑**（§10.3 待办#1）：
  //   `xiX = dcm.x = CoM + v/ω` 自带**有限差分速度**（240Hz 物理 ⇒ 抖）
  //   ⇒ CoP 目标逐拍抖 ⇒ 几何矩 `Fv·(copT−x_j)` 翻号 ⇒ τ 峰 ±200。
  //   人的规划是**滤波过的**（Winter 1998：COP 与 COM 仅差 4ms，近"无延迟弹簧"）。
  //   `NEEDTAU>0` 启用低通（s）；`=0` 回退（A/B）。
  const tauN = envNum('NEEDTAU', 0, 0);
  let needX = cl(xiX, xMin, xMax);
  let needZ = cl(xiZ, zMin, zMax);
  if (tauN > 0) {
    const dtN = rs.dtCtrl > 1e-6 ? rs.dtCtrl : 1 / 60;
    const kN = Math.min(1, dtN / tauN);
    rs.needXFilt += (needX - rs.needXFilt) * kN;
    rs.needZFilt += (needZ - rs.needZFilt) * kN;
    needX = rs.needXFilt;
    needZ = rs.needZFilt;
  } else {
    rs.needXFilt = needX;
    rs.needZFilt = needZ;
  }
  const overX = xiX - needX;
  const overZ = xiZ - needZ;

  // 原始 CoP（双脚按 fz 加权；都无效则视为"不可测"，err 记 0 并置 valid=false）
  const fl = rs.soleCopValid[0] === true, fr = rs.soleCopValid[1] === true;
  const wl = fl ? rs.soleCopFz[0]! : 0, wr = fr ? rs.soleCopFz[1]! : 0;
  const wsum = wl + wr;
  const copOk = valid && wsum > 15;
  const copX = copOk ? (wl * rs.soleCopX[0]! + wr * rs.soleCopX[1]!) / wsum : 0;
  const copZ = copOk ? (wl * rs.soleCopZ[0]! + wr * rs.soleCopZ[1]!) / wsum : 0;

  const errX = copOk ? needX - copX : 0;
  const errZ = copOk ? needZ - copZ : 0;

  // 逐轴权限：方向固定（原 `× (1+urgency)` 的 urgency 来自已删的 fallGuard ⇒ 恒 0）
  const kX = errX >= 0 ? K_FRONT : K_BACK;
  const kZ = K_SIDE;

  const overMag = Math.hypot(overX, overZ);
  const actionability = Math.max(0, Math.min(1, 1 - overMag / OVER_SCALE));

  // ★★★★★ **应急落足目标**（§21.11 的 W3；用户：「应急的最重要作用是调整脚位置」）
  //   落足点 = 捕获点 ξ，截断到"以**支撑脚**为原点的可及范围"（capture-point 落足）。
  //   可及范围（`STEP_REACH`）：前后 ±0.45 m、侧 ±0.30 m（≈ 腿长 × sin(30°)，保守）。
  //   相对量 ⇒ 与步态的"落脚差"同一口径（`soleX/soleZ`）。
  const supS0 = rs.supportLeg();
  const footX0 = supS0 === 'l' ? rs.soleX.l : rs.soleX.r;
  const footZ0 = supS0 === 'l' ? rs.soleZ.l : rs.soleZ.r;
  const clS = (v: number, m: number): number => (v > m ? m : v < -m ? -m : v);
  // ★★★★★ 2026-10-06 **提案包的幅度上限**（用户令："迈步系统不得大幅度下移动命令"）
  //   物理上限：单步位移 ≤ STEPMAX（默认 0.35m）；提案是"建议"不是"大跳"。
  const STEPMAX = (() => {
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    const v = Number(env.STEPMAX ?? '');
    return Number.isFinite(v) && v > 0 ? v : 0.35;
  })();
  const stepX = clS(xiX - footX0, STEPMAX);
  const stepZ = clS(xiZ - footZ0, STEPMAX * 0.75);
  rs.copPlan = {
    valid: valid,
    copOk,
    xiX, xiZ,
    needX, needZ,
    overX, overZ,
    errX, errZ,
    kX, kZ,
    urgency: 0,          // ★ 原 = fallGuard 的 urg；fallGuard 已删 ⇒ 恒 0（保留字段名以免改类型）
    region: 'center',
    actionability,
    fallNeeded: actionability <= 0,
    copX, copZ,
    stepX, stepZ, stepUrgent: 0,
  };
}
