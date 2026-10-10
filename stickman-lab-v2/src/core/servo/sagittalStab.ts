/**
 * 伺服 · 矢状稳定（前后调节）——**唯一伺服**的矢状项（§2.15 重写）。
 *
 * 律的选型（实测）：lean2 式**位置+XCoM 混合调节**优于伺服旧 fold（qX×gain−attS，
 * 其 attS 项在单脚 B 相抬腿的俯仰动态下扰动，实测抬脚 44→27cm）；本模块即该律的
 * 唯一实现（旧 fold 在动作场景被 pin 让位）。
 *
 * 律：输入误差 = comX + 0.15·vx/ω0（借预测提前量；全 XCoM 太猛——B 相前向速度把
 * 腰推过头 44→20cm）；输出 = spine1–3 的轴2 目标（灵敏度 −0.36 m/rad 实测标定）。
 * 文献：Runge 1999（快后移=踝跖屈+髋屈叠加）；Ochi 2019（恢复能力=发力速度）。
 */
import type { ServoRefs } from './supportReg';

export const SAGITTAL = {
  /** 闭环增益（0=关） */
  gain: 1.4,
  /** 实测灵敏度：lean2 正 → comX 负（m/rad） */
  sensX: -0.36,
  /** 权限（rad/节；矢状权限加大——向后倒反复出现） */
  cap: 0.28,
  /** 预测分量：位置 + k·vx/ω0 */
  velBlend: 0.15,
};

/** RTD 纪律：预测触发（速度超阈）后 150 ms 权限 ×1.5（Ochi 2019：恢复=发力速度） */
export const SAG_RTD = { velTrig: 0.05, window: 0.15, boost: 1.5 };

export class SagittalStab {
  private hot = false;
  private hotT = 0;

  /** scale：动作相位给的缩放（C 相 1.0、D/E 0.5——放腿期柔和） */
  step(ctx: ServoRefs, scale: number, dt: number): void {
    if (SAGITTAL.gain === 0) return;
    const h = Math.max(0.3, ctx.sensors.com[1]!);
    const omega0 = Math.sqrt(9.81 / h);
    const vx = ctx.sensors.comVel[0]!;
    const errX = ctx.sensors.com[0]! + SAGITTAL.velBlend * vx / omega0;
    // RTD：速度快 → 起手（预测触发），150ms 内权限放大
    if (Math.abs(vx) > SAG_RTD.velTrig && !this.hot) { this.hot = true; this.hotT = 0; }
    if (this.hot) {
      this.hotT += dt;
      if (this.hotT > SAG_RTD.window) this.hot = false;
    }
    const rtd = this.hot ? SAG_RTD.boost : 1;
    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
    const cap = SAGITTAL.cap * rtd;
    const lean2 = clamp(-SAGITTAL.gain * errX / SAGITTAL.sensX * scale, -cap, cap);
    for (const sn of ['spine1', 'spine2', 'spine3']) {
      ctx.bal.manual.setAngle(sn, 2, lean2, 500, 40);
    }
  }
}
