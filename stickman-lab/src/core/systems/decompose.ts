/**
 * ══════════════════════════════════════════════════════════════════
 * decompose.ts —— **平衡监督层：感知 → 逐轴分解**（`架构_v2_三模块协作.md` §21.11）
 * ══════════════════════════════════════════════════════════════════
 *
 * 职责（**一层一个输出**，绝不产生第二个判据）：
 *   输入：捕获点 ξ（来自 `fallGuard`/`dcm`）+ 实测支撑面（`rs.fall`/`rs.support`）
 *        + **原始** CoP（`rs.soleCopX/Fz`）
 *   输出：`CopPlan` ——
 *     · `needX/needZ`  = clamp(ξ, 支撑面)          —— 能救的最优 CoP
 *     · `overX/overZ`  = ξ − need                  —— **溢出量**（脚放不下、必摔的部分）
 *     · `actionability`= 1 − |over|/scale          —— **"要不要摔倒"** 只判这一条
 *     · `kX/kZ`        = 方向权限 × (1+urgency)     —— 紧迫度**只调系数**，不新增通道
 *
 * 分解规则（§21.10 的 4 个方向）：
 *   矢状 errX = needX − CoP_obs_x  → 踝 `foot/2`（执行层 = `ANKLE_COP`）
 *   额状 errZ = needZ − CoP_obs_z  → 中足 `midfoot/0` + 髋外展 `hip/0`
 *   溢出（|over|）                 → 腿链水平力 `τ=JᵀF`（剪力）→ 再溢出 = 落足
 *
 * ⚠ 本模块**纯计算**：不发目标、不发力矩、不改 `rs` 的其它字段（只写 `rs.copPlan`）。
 */
import type { RigState } from '../rigState';

/** 方向权限（与 `fallGuard.DIR_AUTHORITY` 同一口径；§22.19.1 实测） */
const K_FRONT = 1.0;      // 前：CoP 可到脚尖（权限足）
const K_BACK = 1 / 3;     // 后：只能到脚跟（劣势方向）
const K_SIDE = 0.3;       // 侧：中足 + 髋，权限最小

/** 溢出量的归一化尺度（m）：超过它 ⇒ `actionability = 0`（必须落足） */
const OVER_SCALE = 0.10;

/**
 * 每拍一次：把"防摔感知"切成逐轴修正量，写进 `rs.copPlan`。
 *
 * @param onFall 是否用 `rs.fall`（fallGuard）的捕获点/支撑面；false 时退化用
 *   `rs.dcm` + `rs.support`（两条口径同源，仅用于回退）。
 */
export function decomposeCop(rs: RigState, onFall = true): void {
  const f = rs.fall;
  const sp = rs.support;
  const useFall = onFall && f.valid;
  const xiX = useFall ? f.px : rs.dcm.x;
  const xiZ = useFall ? f.pz : rs.dcm.z;
  const xMin = useFall ? f.xMin : sp.cx - sp.halfX;
  const xMax = useFall ? f.xMax : sp.cx + sp.halfX;
  const zMin = useFall ? f.zMin : sp.cz - sp.halfZ;
  const zMax = useFall ? f.zMax : sp.cz + sp.halfZ;
  const valid = xMax > xMin && zMax > zMin;

  const cl = (v: number, lo: number, hi: number): number => (v > hi ? hi : v < lo ? lo : v);
  const needX = cl(xiX, xMin, xMax);
  const needZ = cl(xiZ, zMin, zMax);
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

  // 逐轴权限：方向 × (1+urgency)。紧迫度只在这里起作用（§21.11 的唯一耦合点）。
  const urg = useFall ? f.urgency : 0;
  const kX = (errX >= 0 ? K_FRONT : K_BACK) * (1 + urg);
  const kZ = K_SIDE * (1 + urg);

  const overMag = Math.hypot(overX, overZ);
  const actionability = Math.max(0, Math.min(1, 1 - overMag / OVER_SCALE));

  rs.copPlan = {
    valid: valid,
    copOk,
    xiX, xiZ,
    needX, needZ,
    overX, overZ,
    errX, errZ,
    kX, kZ,
    urgency: urg,
    region: useFall ? f.region : 'center',
    actionability,
    fallNeeded: actionability <= 0,
    copX, copZ,
  };
}
