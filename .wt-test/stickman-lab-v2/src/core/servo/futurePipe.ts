/**
 * 伺服层 · Future 管道（预测与预期）——`保护预警与反射弧.md` §2.13 双管道架构
 *
 * 职责：从当前状态**外推"未来"**（XCoM / 支撑边界余量 / TTB / 风险等级）；
 * 只读纯计算——不写任何关节、不读 Now 管道的中间量；输出经整合层进入
 * `StabilityCorrection` 提案（唯一出口）。"坠落在预警"即本管道的输出。
 */
export interface FutureInput {
  comX: number; comZ: number;
  velX: number; velZ: number;
  /** 矢状加速度（预警的早期量：文献"早期 burst 按加速度缩放"） */
  accX: number;
  hCoM: number;
  gAbs: number;
  /** 支撑区边界（矢状 xlo/xhi、侧向 lo/hi） */
  xlo: number; xhi: number; lo: number; hi: number;
}

export interface FutureOutput {
  xcomX: number; xcomZ: number;
  marginX: number; marginZ: number;
  ttbX: number; ttbZ: number;
  risk: 0 | 1 | 2;
  /** ★ 矢状起手建议（§2.15）：速度快或 TTB 短 → 立即起手（不等位置死区） */
  sagTrigger: boolean;
}

export class FuturePipe {
  compute(i: FutureInput): FutureOutput {
    const omega0 = Math.sqrt(i.gAbs / i.hCoM);
    const xcomX = i.comX + i.velX / omega0;
    const xcomZ = i.comZ + i.velZ / omega0;
    const marginX = Math.min(xcomX - i.xlo, i.xhi - xcomX);
    const marginZ = Math.min(xcomZ - i.lo, i.hi - xcomZ);
    // TTB = 按速度方向最近边界 / 速度（s）；静止/背离 → Infinity
    const ttbX = i.velX > 0.02 ? Math.max(0, (i.xhi - xcomX) / i.velX)
      : i.velX < -0.02 ? Math.max(0, (xcomX - i.xlo) / -i.velX) : Infinity;
    const ttbZ = i.velZ > 0.02 ? Math.max(0, (i.hi - xcomZ) / i.velZ)
      : i.velZ < -0.02 ? Math.max(0, (xcomZ - i.lo) / -i.velZ) : Infinity;
    const risk: 0 | 1 | 2 = (marginX < -0.01 || marginZ < -0.01) ? 2
      : Math.min(ttbX, ttbZ) < 0.35 ? 1 : 0;
    // ★ 起手阈值提前（用户定调：预警不到位→小力没被及时消）：
    //   小力阶段（|vx|>0.02）就预警；或后向加速度（ax<−0.15）；或 TTB<0.8s（更早）
    const sagTrigger = Math.abs(i.velX) > 0.02 || i.accX < -0.15 || ttbX < 0.8;
    return { xcomX, xcomZ, marginX, marginZ, ttbX, ttbZ, risk, sagTrigger };
  }
}
