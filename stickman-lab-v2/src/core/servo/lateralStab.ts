/**
 * 伺服 · 侧向稳定（躯干侧倾调重心）——**唯一伺服**的侧向项（2026-10 自动作层收编）。
 *
 * 文献：Mouchnino 1996（稳定模式 = 躯干侧倾修重心）；van Dieën 2015（单腿不稳时躯干反旋使用大增）；
 * Geng/Bruijn/van Dieën 2024（单腿延迟 204ms、增益略高于临界）；Sci Rep 2021（延迟 PD 取
 * node-spiral 分离线=非振荡+稳健）。
 *
 * ★ 2026-10-11 关键教训（与脚部链同源）：平衡时位置/速度误差都是**微量**——律若只吃它们等于
 *   **零作用**（实测 gain 0.9~2.6 扫描全同值）。扰动藏在**加速度**里 → 必须加速度项主导。
 *   加速度用 `sensors.rawVel` 差分（comVel 是 100ms 低通，差分不出量级）。
 *
 * 分层（用户定调）：腰（spine1）= 主/快环；脊柱（spine2/3）= 次/慢环（更未来的倾倒趋势）。
 */
import type { ServoRefs } from './supportReg';

export const LATERAL = {
  /** 位置增益（rad/m；环境变量可覆盖，安全扫描用） */
  stabKz: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_KZ ?? 0.9),
  /** ★ 权限（rad/节），人类域 */
  cap: 0.18,
  stabKx: 1.4,
  /** 实测灵敏度：spine 侧倾(0/2 轴) → CoM 位移（m/rad） */
  sensZ: 0.30,    // lean0 正 → comZ 正
  /** 速度增益（相位超前，NMP 补偿） */
  kvz: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_KV ?? 0.5),
  /** ★ 加速度增益（rad/(m/s²)；扰动主要在加速度里——本日核心修正） */
  kaz: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_KA ?? 0.02),
  /** 脊柱慢环（次要/前瞻）：趋势项主导、位置为辅 */
  spineKz: 0.3,
  spineKvz: 0.9,
  /** ★ 输出限速（rad/s）——"慢半拍，让扰动先来" */
  rate: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_RATE ?? 0.9),
  sensX: -0.36,   // lean2 正 → comX 负
};

/** ★ 限速/差分状态（模块级；单动作场景足够） */
let leanNow = 0;
let prevVzRaw = 0;
let azNow = 0;

/** 输入：横向重心误差（实际−基准，米）→ 输出写到 spine1–3 的侧屈目标（限速跟随） */
export function lateralStab(ctx: ServoRefs, errZ: number, dt = 1 / 240): void {
  if (LATERAL.stabKz === 0) return;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const vz = ctx.sensors.comVel[2]!;
  const vzRaw = ctx.sensors.rawVel[2]!;
  const azRaw = (vzRaw - prevVzRaw) / Math.max(dt, 1e-6);
  prevVzRaw = vzRaw;
  // ★ 轻平滑（30ms）——纯原始差分噪声过大，full 会满幅抡（实测 ±0.18 暴走）
  const aAlpha = 1 - Math.exp(-dt / 0.03);
  azNow += (azRaw - azNow) * aAlpha;
  const az = azNow;
  // 腰快环：位置+速度+加速度（加速度主导扰动响应）
  const want = clamp(-(LATERAL.stabKz * errZ + LATERAL.kvz * vz + LATERAL.kaz * az) / LATERAL.sensZ, -LATERAL.cap, LATERAL.cap);
  const stp = LATERAL.rate * dt;
  const d = want - leanNow;
  leanNow += Math.abs(d) <= stp ? d : Math.sign(d) * stp;
  // 脊柱慢环：趋势项（速度）为主、位置为辅——"更未来的倾倒趋势"
  const trend = clamp(-(LATERAL.spineKz * errZ + LATERAL.spineKvz * vz) / LATERAL.sensZ, -LATERAL.cap, LATERAL.cap);
  if (!ctx.bal.manual.isPinned('spine1', 0)) ctx.bal.manual.setAngle('spine1', 0, leanNow, 300, 24);   // 【折中】500→300（130 会卡死 A 相转移）
  for (const sn of ['spine2', 'spine3']) {
    // ★ 动作声明（pin）→ 伺服暂停该关节（用户架构 2026-10）
    if (ctx.bal.manual.isPinned(sn, 0)) continue;
    ctx.bal.manual.setAngle(sn, 0, trend, 250, 20);
  }
}
