/**
 * 伺服 · 侧向稳定（躯干侧倾调重心）——**唯一伺服**的侧向项（2026-10 自动作层收编）。
 *
 * 文献：Mouchnino 1996（稳定模式 = 躯干侧倾修重心；人类单腿躯干侧倾 1–5°）；
 * 灵敏度 `_probe-lean-sign` 实测。调用方 = 动作层相位（时序由动作掌握）。
 * 纪律：非最小相位通道（腰）低带宽、小权限——实测 0.18 rad/节（~24°）会"腰落下"，
 *       收进人类域 ±0.06/节（~3.5°），其余交给髋/骨盆（伺服横向）。
 *
 * ★ 2026-10 末（用户："腰部主动对抗侧抖"，随后"发力有点猛/还是太猛/可能太早"）：
 *   腰 = NMP 通道（纯 P 高增益实测 gain2→19237N 发散）。按 NMP 理论：
 *   **低增益 + 误差速度前馈（相位超前）+ 输出限速（慢半拍，让扰动先来）**。
 */
import type { ServoRefs } from './supportReg';

export const LATERAL = {
  /** 闭环增益（0=关）——三连降 1.4→0.8→0.55 */
  stabKz: 0.55,
  /** ★ 权限（rad/节），人类域 */
  cap: 0.15,
  stabKx: 1.4,
  /** 实测灵敏度：spine 侧倾(0/2 轴) → CoM 位移（m/rad） */
  sensZ: 0.30,    // lean0 正 → comZ 正
  /** ★ 误差速度增益（相位超前，NMP 补偿）——0.8→0.35→0.2 */
  kvz: 0.2,
  /** ★ 输出限速（rad/s）——"慢半拍，让扰动先来" */
  rate: 0.9,
  sensX: -0.36,   // lean2 正 → comX 负
};

/** ★ 限速状态（模块级；单动作场景足够） */
let leanNow = 0;

/** 输入：横向重心误差（实际−基准，米）→ 输出写到 spine1–3 的侧屈目标（限速跟随） */
export function lateralStab(ctx: ServoRefs, errZ: number, dt = 1 / 240): void {
  if (LATERAL.stabKz === 0) return;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const vz = ctx.sensors.comVel[2]!;
  const want = clamp(-(LATERAL.stabKz * errZ + LATERAL.kvz * vz) / LATERAL.sensZ, -LATERAL.cap, LATERAL.cap);
  const stp = LATERAL.rate * dt;
  const d = want - leanNow;
  leanNow += Math.abs(d) <= stp ? d : Math.sign(d) * stp;
  for (const sn of ['spine1', 'spine2', 'spine3']) {
    // ★ 动作声明（pin）→ 伺服暂停该关节（用户架构 2026-10）
    if (ctx.bal.manual.isPinned(sn, 0)) continue;
    ctx.bal.manual.setAngle(sn, 0, leanNow, 500, 40);
  }
}
