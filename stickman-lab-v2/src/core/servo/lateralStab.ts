/**
 * 伺服 · 侧向稳定（躯干侧倾调重心）——**唯一伺服**的侧向项（2026-10 自动作层收编）。
 *
 * 文献：Mouchnino 1996（稳定模式 = 躯干侧倾修重心；人类单腿躯干侧倾 1–5°）；
 * 灵敏度 `_probe-lean-sign` 实测。调用方 = 动作层相位（时序由动作掌握）。
 * 纪律：非最小相位通道（腰）低带宽、小权限——实测 0.18 rad/节（~24°）会"腰落下"，
 *       收进人类域 ±0.06/节（~3.5°），其余交给髋/骨盆（伺服横向）。
 */
import type { ServoRefs } from './supportReg';

export const LATERAL = {
  /** 闭环增益（0=关） */
  stabKz: 1.4,
  stabKx: 1.4,
  /** 实测灵敏度：spine 侧倾(0/2 轴) → CoM 位移（m/rad） */
  sensZ: 0.30,    // lean0 正 → comZ 正
  sensX: -0.36,   // lean2 正 → comX 负
};

/** 输入：横向/矢状重心误差（实际−基准，米）→ 输出写到 spine1–3 的侧屈/前屈目标 */
export function lateralStab(ctx: ServoRefs, errZ: number): void {
  if (LATERAL.stabKz === 0) return;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const lean0 = clamp(-LATERAL.stabKz * errZ / LATERAL.sensZ, -0.06, 0.06);
  for (const sn of ['spine1', 'spine2', 'spine3']) {
    ctx.bal.manual.setAngle(sn, 0, lean0, 500, 40);
  }
}
