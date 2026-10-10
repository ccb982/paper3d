/**
 * 伺服 · L0 姿势层（posture, tonic，慢）——`保护预警与反射弧.md` §2.18 目标架构第一层。
 *
 * 文献（Ivanenko & Gurfinkel 2018）：姿势控制分两层——**posture**（tonic 肌张力分布，慢/set）
 * 与 **equilibrium**（扰动补偿，快）；神经底层不同。本模块 = 前者：
 * **常开、不参与开关、不做修正决策**——只提供"身体有个基本姿势/支撑"的底。
 *
 * 内容（行为保持地自 supportReg/baseline 收编）：
 *   · 躯干支撑 tonic：脊柱伸肌常开（−20/节）——顶住上身重力矩（原 supportReg.trunkSupport 的常开项；
 *     APA 增量仍归 L1-Future）；
 *   · 支撑柱 tonic：支撑腿的踝/膝/髋小份额（原 supportReg 的 brace，常开部分）；
 *   · 姿势张力：由 `StabilityWarner.contributeBaseline` 执行（已在位，属 L0）。
 *
 * 纪律：本层只写 tonic（常值/慢变），不含事件/门控/增益切换；L1 在其上加修正。
 */
import type { ServoRefs } from './supportReg';

export const POSTURE = {
  /** 躯干支撑 tonic（N·m/节，负=伸展） */
  trunkTonic: -20,
  /** 支撑柱 tonic（N·m；踝/膝/髋按份额分——Winter：跖屈肌持续激活，触发=所需踝力矩非载荷） */
  supportTonic: 50,   // （标准 ~90 需与锁/份额协调后启用，单点 100 级联）
};

/** L0：躯干支撑 tonic（每帧常开；L1 的 APA 增量另行叠加） */
export function postureTrunk(ctx: ServoRefs): void {
  for (const sn of ['spine1', 'spine2', 'spine3']) {
    const di = ctx.body.dofByName(sn, 2);
    if (di < 0) continue;
    ctx.bal.drive.setTorque(di, POSTURE.trunkTonic);
  }
}
