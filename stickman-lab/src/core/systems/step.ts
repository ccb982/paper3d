/**
 * ══════════════════════════════════════════════════════════════════
 * ⑤  stepSystem.ts —— **迈步系统**（重构版，用户要求"做个大概，只要抬腿"）
 *     作用对象：另一条腿（摆动腿）+ 腰的受限修正槽
 * ══════════════════════════════════════════════════════════════════
 *
 * 与旧版的区别：
 *   · 不再自己判断"该不该抬"——**由状态机的 P1..P4 许可决定**
 *   · 不再自己持有一份数据快照——全部从 `rigState` 读
 *   · 不再直接设 target——只**提需求**
 *   · 抬腿需求走 `requestSwingLeg(..., isLift=true)` ⇒ **锁定闸门能否决它**
 *   · 腰的修正走 `requestWaistSlot()` ⇒ 自动被 ±6° 与 α(t) 夹住
 *
 * ── 文献 ────────────────────────────────────────────────────
 *   · 抬升高度：Oberg / Perry，髋屈峰 ~30°、膝屈峰 ~63°
 *   · 最小离地净空 MFC = 5 cm
 *   · 摆动轨迹两端速度为零（sin(πs) 钟形）
 *   · 躯干反相旋转（Takemura 2007）：幅度按骨盆横断面旋转 6°（Mann 1975）
 *   · 交接必须落在双支撑相（Lee et al.：缺 DSP 会产生不连续力矩）
 */

import { jointIndexByName } from '../skeleton';
import type { RigState, Side } from '../rigState';

/** 摆动相膝屈峰值（deg）—— Oberg / Perry */
export const KNEE_FLEX_PEAK = 63;

export interface StepParams {
  /** 摆动相时长的一半（s） */
  halfPeriod: number;
  /** 抬升峰值高度（m） */
  lift: number;
  /** 髋屈峰值（deg）—— Oberg/Perry 30° */
  hipFlexPeakDeg: number;
  /** 膝屈峰值（deg）—— Oberg/Perry 63° */
  kneeFlexPeakDeg: number;
  /** 单腿模式下摆动腿保持高度（m） */
  liftHold: number;
  /**
   * ★ 单支撑保持角（deg）：进 SINGLE 相后 `sin(πs)=0` 会把摆动腿的钟形项清零，
   *   不加这一项摆动脚就贴地站着（实测单支撑占比 0%、摆动脚 0mm）。
   *   取值按"髋 30° + 膝 65° ⇒ 足跟着地、小腿抬起"，保证足底净空 >100mm。
   */
  hipHoldDeg: number;
  kneeHoldDeg: number;
  /**
   * ★ 末端摆动**髋伸展**峰值（deg，正值 = 伸展）。这是**步长**的来源。
   *   正常步态 terminal swing 把小腿送出去，足跟着地落在身体**前方**；
   *   缺了它（历史实现）脚只落在原地/身后 ⇒ 实测 Δx −644mm、躯干 x 恒为 0。
   *   允许为负（= 仍在屈曲）以便做对照消融。
   */
  hipExtendDeg: number;
  /** 末端伸展的起始相位（0~1），约 0.55~0.7（摆动后半程） */
  reachFrom: number;
}

export const DEFAULT_STEP_PARAMS: StepParams = {
  halfPeriod: 1.10,
  lift: 0.32,
  hipFlexPeakDeg: 30,
  kneeFlexPeakDeg: KNEE_FLEX_PEAK,
  liftHold: 0.25,
  hipHoldDeg: 32,
  kneeHoldDeg: 68,
  // 末端髋伸展：Perry 正常步态 terminal swing 约 10~20°。
  //   实测（扫 0/10/18/28°，判据 = Δx(摆动−支撑) 与存活）：
  //     0°  → Δx 最小 −529mm（脚落在支撑脚**后方** 529mm）  存活 2.38s
  //     10° → Δx 最小 −106mm、净空 405mm                    存活 2.43s
  //     18° → Δx 最小 −401mm（不单调）                      存活 2.77s
  //     28° → Δx 最小 −14mm、最多 +335mm（落在身前）         但净空飙到 1107mm、存活仅 0.75s
  //   ⇒ 取 10°：把脚从"身后 529mm"救回到"身前可放"，且不把腿甩飞。
  //   ⚠ 18°/28° 的 Δx 不单调 ⇒ 幅度一大就变成"甩腿"而不是"送腿"，
  //     末端伸展必须与摆动髋屈曲峰值一起限，不能单独加大。
  hipExtendDeg: 10,
  reachFrom: 0.6,
};

/**
 * ★ 迈步系统。**并发**每拍跑一次，只提需求。
 *
 * 权限完全由状态机给：
 *   · 能不能抬 = `rs.stepPermit.all`
 *   · 能不能抬**这条**腿 = 它没被锁定（否则 `requestSwingLeg` 直接丢弃）
 *   · 腰的修正份额 = `rs.authority`（α(t)）
 */
export function stepSystem(rs: RigState, p: StepParams = DEFAULT_STEP_PARAMS): void {
  const sk = rs.sk;
  const swing: Side = rs.swingLeg();
  const jHip = jointIndexByName(sk, swing === 'l' ? 'hip_l' : 'hip_r');
  const jKnee = jointIndexByName(sk, swing === 'l' ? 'knee_l' : 'knee_r');
  const jSp1 = jointIndexByName(sk, 'spine1');
  const jSp2 = jointIndexByName(sk, 'spine2');
  const jSp3 = jointIndexByName(sk, 'spine3');
  if (jHip < 0 || jKnee < 0) return;

  /** 限到 ±m。⚠ m 必须为正 —— 传负值会让 `v > m` 恒真而恒返回 m（已踩过）。 */
  const clamp = (v: number, m: number): number => (v > m ? m : v < -m ? -m : v);
  const D2R = Math.PI / 180;

  // ══════════════════════════════════════════════════════════════
  // ① 抬腿许可 —— **双钥匙**：状态机许可 AND 摆动腿确实未锁定
  //   R1（Kuindersma）：感知接触与计划接触**都成立**才能离地。
  // ══════════════════════════════════════════════════════════════
  const permit = rs.stepPermit.all;
  // 相内进度 s ∈ [0,1]：STEP 相才推进；其它相保持抬起高度或落下
  const s = rs.phase === 'STEP'
    ? Math.max(0, Math.min(1, rs.phaseT / Math.max(1e-6, p.halfPeriod)))
    : (rs.phase === 'DOUBLE' || rs.phase === 'SHIFT' ? 0 : 1);

  // 抬升量：钟形，两端速度为零（sin(πs)）
  const bell = Math.sin(Math.PI * s);
  const hold = rs.phase === 'SINGLE' || rs.phase === 'STEP';
  const lift = permit && hold
    ? p.lift * bell + (s >= 1 ? p.liftHold : 0)
    : (rs.phase === 'SINGLE' ? p.liftHold : 0);

  // ══════════════════════════════════════════════════════════════
  // ② 摆动腿髋屈（Oberg/Perry 30°）
  //   ⚠ 髋限位不对称（[−95°, +100°]），膝限位 [−145°, +2°] ⇒ **负 = 屈**
  // ══════════════════════════════════════════════════════════════
  // ★★ 单支撑必须**保持抬腿**，否则整段 SINGLE 相等于双脚站着。
  //   `bell = sin(πs)` 在 s=1 时为 0，所以进 SINGLE 相后钟形项归零
  //   ⇒ 髋/膝命令回到 0°（绑姿态）⇒ 摆动脚贴地
  //   ⇒ 实测「站满 12s、倾 3°、但单支撑占比 0%、摆动脚 0mm」——
  //   **相位进了 SINGLE，脚还在地上，等于没抬**（用户："双脚同时站地面毫无意义"）。
  //   修法：s≥1（SINGLE 与 STEP 末段）时把保持角**加到角度上**，不只是加到标量 lift。
  // ★★ 保持角**必须受 `permit` 门控**。
  //   真实单腿站立要求先完成重心转移（APA，约 0.3~0.5 s）再抬腿 ——
  //   腿一抬，支撑腿立刻承全部体重，此时重心若还没到支撑脚上，
  //   倒立摆已经过了不可恢复点，任何水平力都救不回来
  //   （实测不门控：0.85 s 倒、倾 50~83°、`com.z` 离支撑脚仍有 350~400 mm）。
  const holdHip = (s >= 1 && permit) ? p.hipHoldDeg : 0;
  const holdKnee = (s >= 1 && permit) ? p.kneeHoldDeg : 0;
  // ★★ 末端摆动**髋伸展**（terminal swing extension）—— 决定落脚点在身前还是身后。
  //   实测（tools/_sx，2026-10-03，用户报"前脚向后迈"）：
  //     STEP 期间 Δx(摆动脚−支撑脚) = **−644 ~ −1 mm**，躯干 x **恒为 0**。
  //   病根：髋目标全程是 `−hipDeg`（**屈曲**），而**髋屈曲把脚往身后摆**；
  //   `bell = sin(πs)` 只负责抬起和落回**原处**，**没有任何落脚位置控制**。
  //   正常步态（Perry & Burnfield / Winter）：摆动早期屈髋抬高足，
  //   **末端伸展**把小腿送出去 ⇒ 足跟着地落在**身体前方** —— 这才是步长的来源。
  //   缺了这一段，脚只会落在原地或身后，重心永远传不到前脚。
  //   形状：s ∈ [reachFrom, 1] 的平滑上升（0→1），s=1 时最大伸展。
  const sReach = s <= p.reachFrom ? 0
    : (s >= 1 ? 1 : (() => { const u = (s - p.reachFrom) / Math.max(1e-6, 1 - p.reachFrom); return u * u * (3 - 2 * u); })());
  const hipDeg = p.hipFlexPeakDeg * bell + holdHip
    - p.hipExtendDeg * sReach * (permit || rs.phase === 'STEP' ? 1 : 0);
  //   ↑ 末端伸展是**减去**伸展量（往 −x 收回）—— 与髋"正=屈"的约定一致。
  // ⚠⚠⚠ **髋与膝的屈伸符号约定相反**，别再照抄：
  //   实测（tools/_fs，腿自由摆 1.5 s，人物朝 +x）：
  //     髋 +20° → 脚 **+76mm 前** ／ 髋 −20° → 脚 **−100mm 后**
  //     髋 +40° → 脚 **+313mm 前** ／ 髋 −40° → 脚 **−309mm 后**
  //   ⇒ **髋：正 = 屈曲 = 脚往前**
  //   膝限位 [−145°, +2°] ⇒ **膝：负 = 屈曲**（膝不能反屈）
  //   历史实现把膝的 `-` 符号照抄给了髋，注释写着"摆动髋屈"而实际发的是**伸**，
  //   于是摆动脚往身后走 —— 用户报"前脚向后迈"（实测 Δx −644mm、躯干 x 恒为 0）。
  rs.requestSwingLegAngle(swing, jHip, 2, clamp(hipDeg * D2R, 1.05), '摆动髋屈', lift > 0.01);

  // ══════════════════════════════════════════════════════════════
  // ③ 摆动腿膝屈（Oberg/Perry 63°，峰值在摆动中段）
  //   膝的符号与髋相反约定：膝"屈" = 目标角更负
  // ══════════════════════════════════════════════════════════════
  const kneeDeg = p.kneeFlexPeakDeg * bell + holdKnee;
  // ⚠⚠ `clamp(v, m)` 的第二个参数是**上限幅值**（限到 ±m），必须为正。
  //   这里曾写成 `clamp(..., -1.2)` ⇒ `v > -1.2` 恒真 ⇒ **恒返回 −1.2**
  //   ⇒ 摆动腿膝被永久命令到 −69°，与相位无关 ⇒ 开局就塌，存活 0.98s。
  //   而且它在**迈步系统**里，所以把平衡系统的通道全部消融也照样触发。
  rs.requestSwingLegAngle(swing, jKnee, 2, clamp(-kneeDeg * D2R, 1.2), '摆动膝屈', lift > 0.01);

  // ══════════════════════════════════════════════════════════════
  // ④ 摆动相髋外展（让开支撑腿；注意：单支撑时这也是搬 CoM 的配重）
  // ══════════════════════════════════════════════════════════════
  if (lift > 0.01) rs.requestSwingLegAngle(swing, jHip, 1, 0.12 + (s >= 1 ? 0.10 : 0), '摆动外展', false);

  // ══════════════════════════════════════════════════════════════
  // ⑤ 腰的**受限修正槽**（用户 2026-10-03：迈步系统也控腰，但只做一点修正）
  //   · 幅度由 `rigState.requestWaistSlot` 夹在 ±6°（Mann 1975）
  //   · 且乘 α(t)（只��单支撑/摆动相非零）
  //   · 落回地面（s→1）时修正归零，避免残留
  // ══════════════════════════════════════════════════════════════
  if (jSp1 >= 0) {
    const yaw = (bell * 6) * D2R * (swing === 'l' ? 1 : -1);
    rs.requestWaistSlot(jSp1, 0, yaw, '迈步反相');
  }
  if (jSp2 >= 0) rs.requestWaistSlot(jSp2, 0, rs.authority * 3 * D2R * (swing === 'l' ? 1 : -1), '迈步反相');
  if (jSp3 >= 0) rs.requestWaistSlot(jSp3, 0, rs.authority * 2 * D2R * (swing === 'l' ? 1 : -1), '迈步反相');
}