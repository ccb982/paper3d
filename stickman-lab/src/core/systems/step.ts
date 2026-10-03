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
}

export const DEFAULT_STEP_PARAMS: StepParams = {
  halfPeriod: 1.10,
  lift: 0.32,
  hipFlexPeakDeg: 30,
  kneeFlexPeakDeg: KNEE_FLEX_PEAK,
  liftHold: 0.25,
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
  const hipDeg = p.hipFlexPeakDeg * bell;
  rs.requestSwingLegAngle(swing, jHip, 2, clamp(-hipDeg * D2R, 0.6), '摆动髋屈', lift > 0.01);

  // ══════════════════════════════════════════════════════════════
  // ③ 摆动腿膝屈（Oberg/Perry 63°，峰值在摆动中段）
  //   膝的符号与髋相反约定：膝"屈" = 目标角更负
  // ══════════════════════════════════════════════════════════════
  const kneeDeg = p.kneeFlexPeakDeg * bell;
  // ⚠⚠ `clamp(v, m)` 的第二个参数是**上限幅值**（限到 ±m），必须为正。
  //   这里曾写成 `clamp(..., -1.2)` ⇒ `v > -1.2` 恒真 ⇒ **恒返回 −1.2**
  //   ⇒ 摆动腿膝被永久命令到 −69°，与相位无关 ⇒ 开局就塌，存活 0.98s。
  //   而且它在**迈步系统**里，所以把平衡系统的通道全部消融也照样触发。
  rs.requestSwingLegAngle(swing, jKnee, 2, clamp(-kneeDeg * D2R, 1.2), '摆动膝屈', lift > 0.01);

  // ══════════════════════════════════════════════════════════════
  // ④ 摆动相髋外展（让开支撑腿；注意：单支撑时这也是搬 CoM 的配重）
  // ══════════════════════════════════════════════════════════════
  if (lift > 0.01) rs.requestSwingLegAngle(swing, jHip, 1, 0.12, '摆动外展', false);

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