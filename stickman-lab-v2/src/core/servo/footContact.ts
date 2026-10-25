/**
 * footContact.ts —— 蹲下/起立过渡的脚底接触伺服（2026-10-25 重做）
 *
 * 定位：动作层的**子伺服**。不是全身平衡器，只负责“脚掌还在、CoP 在脚掌内、不滑”，
 * 并把 CoP 目标变成三轴踝力矩（矢量分配，纯矢状力矩不向侧向泄漏）。
 *
 * 依据（与 docs/架构.md 一致）：
 *   · Horak & Nashner 1986：小扰动=踝策略（CoP 调节）；Winter 1995：CoP/CoM。
 *   · Kuo 1995 / Hof 2005：捕获点 ξ = c + v/ω，p_req = ref + (1 + λ/ω)(ξ − ref)。
 *   · Peterka 2002：CoP 反馈；Loram & Lakie 2002：内在刚度≈临界刚度的 91%。
 *   · 用户 2026-10-21 架构：基础力只走矢状面；踝轴不标准，用 ankleAxisAdapter
 *     把世界系目标力矩 M_des 分解到真实轴（foot/0 + foot/2 合成纯 z 力矩）。
 *
 * 输出：每只脚 3 个轴的力矩（由动作层写入 manual.setTorque）。
 * 不写角度目标 —— 脚的自由度归本伺服。
 *
 * ★★ 写手契约（2026-10-25，必须统一；改之前先读）★★
 *   1) 动作层：只写 hip/knee/spine 的矢状轴（axis 2）角度目标 + 前馈力矩；
 *      左右同值（hip_l/2 与 hip_r/2 世界轴同为 (0,0,1)，同值=对称）。
 *   2) 本伺服：只写 foot 三轴。
 *      · 矢状 Mz：左右同值（共同支撑）；
 *      · 侧向 Mx：**左右反号**（差动 CoP，一压一松）；同号会变成整体 roll（实测 59°）。
 *   3) 张力层：只做阻尼，不写位置；下蹲过程禁止 gcomp。
 *   4) 禁止：侧向基础力矩、单侧写手、脚掌 teleport、两只脚不同时承重。
 */
import type { Body } from '../body';
import type { Sensors } from '../sensors';
import { ankleCoPTarget } from './ankleCoP';
import { mapMomentToAxes, sagittalBaseMoment, type AdapterAxis } from './ankleAxisAdapter';

export interface FootContactState {
  ok: boolean;
  fzL: number;
  fzR: number;
  soleL: number;
  soleR: number;
  riseL: number;
  riseR: number;
  copL: number;
  copR: number;
  /** 旧的单轴踝力矩（兼容旧探针；新动作不用它） */
  ankleTau: number;
  reason: string;
}

export interface FootContactOutput {
  state: FootContactState;
  tauL: [number, number, number];
  tauR: [number, number, number];
  /** 目标 CoP（世界 x） */
  refL: number;
  refR: number;
  /** 实际目标 CoP（世界 x / z） */
  pLx: number;
  pLz: number;
  pRx: number;
  pRz: number;
}

const FOOT_HALF_X = 0.12;
const FOOT_HALF_Z = 0.09;

export class FootContactServo {
  private baseL: number | null = null;
  private baseR: number | null = null;
  private readonly dt = 1 / 240;
  private readonly copBuf = new Float64Array(3);
  // ★ 抗抽搐：CoP/Fz 低通 + 输出力矩速率限制（接触冲量是尖峰，直接进力矩=抖动源）
  private copLpL = Number.NaN;
  private copLpR = Number.NaN;
  private fzLpL = 0;
  private fzLpR = 0;
  private lastTau: Record<'l' | 'r', [number, number, number]> = { l: [0, 0, 0], r: [0, 0, 0] };

  reset(): void {
    this.baseL = null;
    this.baseR = null;
    this.copLpL = Number.NaN;
    this.copLpR = Number.NaN;
    this.fzLpL = 0;
    this.fzLpR = 0;
    this.lastTau = { l: [0, 0, 0], r: [0, 0, 0] };
  }

  /** 每帧接触状态（不写关节）：Fz、脚底高度、CoP。 */
  check(body: Body): FootContactState {
    const y = (k: string): number => {
      const i = body.indexByKey.get(k);
      return i === undefined ? 0 : body.bodies[i]!.translation().y as number;
    };
    const soleL = Math.min(y('foot_l'), y('arch_l'), y('mfoot_l'));
    const soleR = Math.min(y('foot_r'), y('arch_r'), y('mfoot_r'));
    if (this.baseL === null) { this.baseL = soleL; this.baseR = soleR; }
    const riseL = soleL - (this.baseL ?? soleL);
    const riseR = soleR - (this.baseR ?? soleR);
    const fzL = body.footNormalForce('l', this.dt);
    const fzR = body.footNormalForce('r', this.dt);
    const ok = fzL > 5 && fzR > 5 && riseL < 0.01 && riseR < 0.01;
    const copL = body.footCoP('l', this.dt, this.copBuf) ? this.copBuf[0]! : NaN;
    const copR = body.footCoP('r', this.dt, this.copBuf) ? this.copBuf[0]! : NaN;
    const target = -0.03;
    const eL = Number.isFinite(copL) ? copL - target : 0;
    const eR = Number.isFinite(copR) ? copR - target : 0;
    const ankleTau = Math.max(-14, Math.min(14, -80 * (eL + eR) * 0.5));
    const reason = !ok
      ? (fzL <= 5 || fzR <= 5 ? 'FzLost' : 'FootLift')
      : '';
    return { ok, fzL, fzR, soleL, soleR, riseL, riseR, copL, copR, ankleTau, reason };
  }

  /**
   * 每帧计算脚踝三轴力矩。
   * @param refX 当前路径的 CoM 目标 x（世界 m）——CoP 目标跟随它
   * @param refZ 当前路径的 CoM 目标 z（世界 m；对称时≈0）
   */
  step(body: Body, sensors: Sensors, refX: number, refZ = 0): FootContactOutput {
    const st = this.check(body);
    const W = body.bodies.reduce((a, b) => a + b.mass(), 0) * 9.81;
    const com = sensors.com;
    const vel = sensors.comVel;
    const comX = com[0] ?? 0;
    const comZ = com[2] ?? 0;
    const comY = Math.max(0.3, com[1] ?? 1);
    const vX = vel[0] ?? 0;
    const vZ = vel[2] ?? 0;

    const aLp = 1 - Math.exp(-this.dt / 0.03);
    this.fzLpL += (st.fzL - this.fzLpL) * aLp;
    this.fzLpR += (st.fzR - this.fzLpR) * aLp;
    const tau: Record<'l' | 'r', [number, number, number]> = { l: [0, 0, 0], r: [0, 0, 0] };
    const out = { refL: refX, refR: refX, pLx: refX, pLz: refZ, pRx: refX, pRz: refZ };
    for (const side of ['l', 'r'] as const) {
      const di = body.dofByName(`foot_${side}`, 2);
      if (di < 0) continue;
      const d = body.dofs[di]!;
      const ankX = d.anchorWorld[0]!;
      const ankZ = d.anchorWorld[2]!;
      const fz = side === 'l' ? st.fzL : st.fzR;
      if (fz < 1) continue;

      // 捕获点 → CoP 目标（纯策略，钳位在脚掌内）
      const cp = ankleCoPTarget(
        comX, comZ, vX, vZ, comY,
        refX, refZ,
        { minX: ankX - FOOT_HALF_X, maxX: ankX + FOOT_HALF_X, minZ: ankZ - FOOT_HALF_Z, maxZ: ankZ + FOOT_HALF_Z },
        1.0,
        ankZ,
      );

      // 矢状：M_z = −(CoP_x − 踝_x)·N；侧向：CoP 误差反馈（roll）
      const mBase = sagittalBaseMoment(W * 0.5, cp.pX, ankX);
      const copZ = Number.isFinite(side === 'l' ? st.copL : st.copR) ? (side === 'l' ? st.copL : st.copR) : cp.pZ;
      void copZ;
      const copNow = body.footCoP(side, this.dt, this.copBuf) ? this.copBuf[1]! : cp.pZ;
      // ★★ 侧向：直接 CoM PD → **差动**脚踝 roll（左右反号），不是两边同号 roll。
      //   同号 Mx 实测会把整个人 roll 过去；差动才是“一压一松”的 CoP 转移。
      //   符号/增益可现场扫（FC_LAT_SIGN/KP/KD）；默认给小的位置+速度反馈。
      const envF = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
      const latKp = Number(envF.FC_LAT_KP ?? 2.0);
      const latKd = Number(envF.FC_LAT_KD ?? 0.2);
      const latSign = Number(envF.FC_LAT_SIGN ?? -1);
      const latCmd = Math.max(-0.05, Math.min(0.05, latKp * (comZ - refZ) + latKd * vZ));
      const mDiff = latSign * Math.max(-20, Math.min(20, 2 * (W * 0.5) * latCmd));
      const Mx = side === 'l' ? mDiff : -mDiff;
      const Mdes: [number, number, number] = [Mx, 0, mBase[2]];

      // 世界系力矩 → 真实脚轴（用户架构：矢量分解，只许矢状面）
      const axes: AdapterAxis[] = [];
      for (const k of [0, 1, 2] as const) {
        const i = body.dofByName(`foot_${side}`, k);
        if (i < 0) { axes.push({ u: [0, 0, 0], tauMax: 0, available: false }); continue; }
        const a = body.dofs[i]!;
        axes.push({ u: [a.axisWorld[0]!, a.axisWorld[1]!, a.axisWorld[2]!], tauMax: a.tauMax > 0 ? a.tauMax : 320, available: !a.preRing });
      }
      const map = mapMomentToAxes(Mdes, axes, 1e-4);
      // ★ 速率限制：1200 N·m/s（240Hz ≈ 5 N·m/帧）——任何接触尖峰都不会直接变成力矩阶跃
      const slew = 1200 * this.dt;
      for (const k of [0, 1, 2] as const) {
        const prev = this.lastTau[side][k];
        const next = map.tau[k] ?? 0;
        tau[side][k] = prev + Math.max(-slew, Math.min(slew, next - prev));
        this.lastTau[side][k] = tau[side][k];
      }
      if (side === 'l') { this.copLpL = Number.isFinite(this.copLpL) ? this.copLpL + (copNow - this.copLpL) * aLp : copNow; out.pLx = cp.pX; out.pLz = cp.pZ; }
      else { this.copLpR = Number.isFinite(this.copLpR) ? this.copLpR + (copNow - this.copLpR) * aLp : copNow; out.pRx = cp.pX; out.pRz = cp.pZ; }
    }
    return { state: st, tauL: tau.l, tauR: tau.r, ...out };
  }
}
