/**
 * 矢状上身模块（用户："把所有写手前移到两个模块——只迁移上身的"；§2.667）
 *
 * 承接原 lateralStab 内的矢状（axis2）写手（§2.627/2.636/2.649/2.659/2.662/2.663 全档）：
 *   - 腰(spine1/2)=唯一校正/立起者（trend + 救援份额·钳内）
 *   - 上段(spine2/3/2)=纯刚性保持（C 绷住、λ 不动）
 * 独立状态：θ₀P（单腿起点捕获）、世界俯仰参考 _pitch0W、加速度前馈、trend 低通。
 * 依赖：LATERAL 常量与爆发 boost 取自 lateralStab（export）；救援份额取自 rescue.lastRescue。
 */
import type { ServoRefs } from './supportReg';
import { lastRescue, standardPose, upperOff } from './rescue';
import { LATERAL, getBoost } from './lateralStab';

let _trendXF = 0;                       // trend 低通状态
let _xRawPrev = 0;                      // 前后加速度前馈
let _axNow = 0;

export function planeSagWrite(ctx: ServoRefs, dt: number): void {
  // ★ §2.669 上身总开关（用户："关闭上身所有的力"；Node: UPPER_OFF=1 / 网页: ?upper=off）
  if (upperOff()) return;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  // ★ §2.668 唯一标准位置（rescue 捕获，全系统共享）——未建立（非单腿）不写
  if (!standardPose.ready) return;

  const errX = ctx.sensors.com[0]! - standardPose.comX0;
  const vx = ctx.sensors.comVel[0]!;
  const omega0h = Math.sqrt(9.81 / Math.max(0.5, ctx.sensors.com[1]!));
  // 加速度前馈（旧 sagittalStab 核心件：rawVel 差分 + 30ms 平滑）
  const xRaw = ctx.sensors.rawVel[0]!;
  const axRaw = (xRaw - _xRawPrev) / Math.max(dt, 1e-6);
  _xRawPrev = xRaw;
  _axNow += (axRaw - _axNow) * (1 - Math.exp(-dt / 0.03));
  // 竖直参考（前后）：trunk 世界俯仰回初态（0.36 m/rad 标定换算）
  const errXW = errX + 0.36 * (ctx.sensors.torsoTilt[0]! - standardPose.pitch0W);   // ★ §2.668 初始竖直角（共享）
  const ePredX = errXW + vx / omega0h + 0.02 * _axNow / (omega0h * omega0h);
  // 间歇门（本平面独立：XcoM 流形 + 预报带内静默）
  const sManX = vx + omega0h * errX;
  const inDeadX = Math.abs(sManX) < 0.05 && Math.abs(ePredX) < 0.025;
  const kzX = LATERAL.spineKz * (1 + 2 * Math.min(1, Math.abs(errXW) / 0.08));
  // 越中/背离相位：救急期（|pitch|>10°）不缩弹簧
  const awayScaleX = Math.abs(ctx.sensors.torsoTilt[0] ?? 0) > 0.175 ? 1 : 0.3;
  const towardX = errXW * vx < 0;
  const trendX = inDeadX ? 0 : clamp(
    -(kzX * ePredX * (towardX ? 1 : awayScaleX) + LATERAL.spineKvz * vx * (towardX ? 1 : 1.5)) / LATERAL.sensX,
    -LATERAL.cap, LATERAL.cap,
  );
  const _ttau = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_TTAU ?? 0.12);
  _trendXF += (trendX - _trendXF) * (1 - Math.exp(-dt / Math.max(0.02, _ttau)));
  const boost = getBoost();
  const riskSag = Math.min(1, Math.abs(ctx.sensors.torsoTilt[0] ?? 0) / 0.1745);
  const cSag = Math.max(0.95, 0.55 + 0.35 * riskSag * riskSag);   // 张力高位（腰椎负责矢状面硬）
  for (let sxi = 0; sxi < 3; sxi++) {
    const snX = (['spine1', 'spine2', 'spine3'] as const)[sxi]!;
    const d2 = ctx.body.dofByName(snX, 2);
    if (d2 < 0 || ctx.bal.manual.isPinned(snX, 2)) continue;
    if (ctx.bal.drive.legReflex.side !== null) {
      const base = standardPose.sp0P[sxi]! + 0.06;   // ★ §2.668 初始姿态（共享）+0.06 后仰偏置
      if (sxi === 0) {
        // 腰=唯一校正/立起者（钳内小幅、持续挡位）
        const clampS = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).SAG_OFF_CLAMP ?? 0.25);
        const spineOff = Math.max(-clampS, Math.min(clampS, _trendXF * boost + lastRescue.sag.spine * 2.5));
        ctx.bal.drive.commandMusclePair(d2, cSag, base + spineOff);
      } else {
        // 上段=纯刚性保持（C 绷住、λ 不动）
        ctx.bal.drive.commandMusclePair(d2, cSag, base);
      }
    }
  }
}
