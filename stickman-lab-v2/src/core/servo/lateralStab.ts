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
  cap: 0.15,   // ★ 0.03→0.15（回读：目标只有±1.7°=算法无权威）
  stabKx: 1.4,
  /** 实测灵敏度：spine 侧倾(0/2 轴) → CoM 位移（m/rad） */
  sensZ: 0.30,    // lean0 正 → comZ 正（翻符号实验测无变化→回滚）
  /** 速度增益（相位超前，NMP 补偿） */
  kvz: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_KV ?? 0.7),   // ★ 0.5→0.9（抬腿后预测灵敏度）
  /** ★ 加速度增益（rad/(m/s²)；扰动主要在加速度里——本日核心修正） */
  kaz: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_KA ?? 0.04),   // ★ 0.02→0.05
  /** ★ 本体反馈增益（rad/m；PCDC 律——CoP 偏离脚下中心即出力） */
  kCop: 0.9,
  /** ★ 慢层增益（长期误差修正，§2.114） */
  slowGain: 3.0,   // ★ 3.0=双指标甜点（危险动量0.0608+对齐50%；4.5→39%退）
  /** 脊柱慢环（次要/前瞻）：趋势项主导、位置为辅 */
  spineKz: 0.3,
  spineKvz: 0.9,
  /** ★ 输出限速（rad/s）——"慢半拍，让扰动先来" */
  rate: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.LAT_RATE ?? 4.0),   // ★ 腰=允许快速（急救；用户定调）；其余平滑
  sensX: -0.36,   // lean2 正 → comX 负
};

/** ★ 急救参数（用户定调：腰=急救、快借快还；Reimann/Jeka 2018 髋策略=角动量临时借贷） */
export const LATERAL_EMERG = {
  /** 触发阈值：marginZ 小于此值 或 TTB 小于此值 → 急救 */
  marginZ: -0.02,
  ttb: 0.6,
  /** 脉冲时长（s）与冷却（s）——快借快还 */
  hold: 0.30,
  cool: 0.5,
  /** 急救放大倍数（增益/cap/速率） */
  boost: 2.0,
};

/** ★ 限速/差分状态（模块级；单动作场景足够） */
let leanNow = 0;
let prevVzRaw = 0;
let azNow = 0;
let latPulseT = 0;   // 间歇脉冲计时（Morasso 2019）
let slowInt = 0;     // ★ 长期误差积分（§2.114）
let emergT = 0;    // 脉冲剩余
let coolT = 0;     // 冷却剩余

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
  // ★ 急救判定（marginZ/TTB）→ 短脉冲放大（快借快还）
  const mz = ctx.bal.supportState?.marginZ ?? 0;
  const ttb = ctx.bal.lastFut?.ttbZ ?? 1;
  const danger = mz < LATERAL_EMERG.marginZ || ttb < LATERAL_EMERG.ttb;
  if (coolT > 0) coolT -= dt;
  if (danger && emergT <= 0 && coolT <= 0) emergT = LATERAL_EMERG.hold;
  if (emergT > 0) emergT -= dt;
  const boost = emergT > 0 ? LATERAL_EMERG.boost : 1;
  if (emergT <= 0 && danger) coolT = LATERAL_EMERG.cool;
  const capX = LATERAL.cap;   // ★ cap 不放大（×1.5 会过冲）
  // ★ 本体反馈（2026-10-11 第二件；Roden-Reynolds 2015：髋本体感觉主导 ML 稳定；
  //   PCDC=比例于 CoP 偏差，Kim & Collins）：用支撑脚 CoP 直接读"脚底压力中心"，
  //   替代 comZ 二阶微分的噪声源——这是离地最近的真信号。
  const sf = ctx.sensors.feet[0]!.loaded ? ctx.sensors.feet[0]! : ctx.sensors.feet[1]!;
  const copDev = sf.copValid ? sf.copZ - sf.z : 0;
  // ★ §2.237 预测性脊柱（用户）：用 T=0.25s 后的误差预报 ePred=errZ+T·vz+½T²·az 驱动侧倾
  //   （原式各项分散加权；预报式=统一到一个未来偏差上，提前倚/提前拉）
  // ★ §2.239 修正为 Hof 2008 XcoM：预测量 = 位置 + 速度/ω₀（原文 ξ=x+v/ω₀）——
  //   无加速度项（旧式 0.25vz+0.031az 是自造的泰勒展开，不是文献形式）
  const omega0h = Math.sqrt(9.81 / Math.max(0.5, ctx.sensors.com[1]!));
  // ★ §2.245 用户：脊柱需要提前多偏移一点——前视加长1.6×XcoM（过度外推=提前倚）
  const ePred = errZ + vz / omega0h;   // ★ §2.245 1.6×前视实测无效（近锁定期vz≈0）→回 1.0；预期偏移改在参考端实现
  // ★ §2.238 间歇开关（Asai 2009/Bottaro 2008：鞍形稳定流形附近=PD关、自滑行；偏离=开）
  //   与预测并联：关闭条件 = 流形距离小 且 预报小（真的不用出手时才静默）
  const sMan = vz + omega0h * errZ;   // （=ω₀·XcoM偏差——开关与预测同源）
  const inDead = Math.abs(sMan) < 0.02 && Math.abs(ePred) < 0.012;
  // 腰快环：位置+速度+加速度（加速度主导扰动响应）+ 本体项
  // ★ 慢层：长期误差积分（泄漏型，防饱和＋自然回中）——"欠债慢慢还"（§2.114 Dalin 2023）
  slowInt += errZ * dt;
  slowInt -= slowInt * (1 - Math.exp(-dt / 2.5));   // 泄漏 τ2.5s
  slowInt = Math.max(-0.05, Math.min(0.05, slowInt));
  const slowTerm = -LATERAL.slowGain * slowInt / LATERAL.sensZ;
  const want = inDead ? leanNow
    : clamp(-(LATERAL.stabKz * boost * ePred + LATERAL.kCop * copDev) / LATERAL.sensZ + slowTerm, -capX, capX);
  const stp = LATERAL.rate * (boost > 1 ? 1.5 : 1) * dt;
  const d = want - leanNow;
  leanNow += Math.abs(d) <= stp ? d : Math.sign(d) * stp;
  // 脊柱慢环：趋势项（速度）为主、位置为辅——"更未来的倾倒趋势"
  const trend = clamp(-(LATERAL.spineKz * errZ + LATERAL.spineKvz * vz) / LATERAL.sensZ, -LATERAL.cap, LATERAL.cap);
  // ★ §2.262 洗脉归因实验：漂移时脊柱伺服吃掉髋纠偏矩——动则让位（kp250→60），停稳才恢复
  const latActive = Math.abs(vz) > 0.02 || Math.abs(errZ) > 0.03;
  if (!latActive && !ctx.bal.manual.isPinned('spine1', 0)) ctx.bal.manual.setAngle('spine1', 0, leanNow, 250, 34);   // ★ §2.262 漂移期完全停写（复现 LAT_KZ=0）   // ★ §2.236 脊柱参战（用户）：kp70→180——需求 0.09rad × 70 = 6 N·m 拉不动 60%体重躯干
  if (!latActive) {
    for (const sn of ['spine2', 'spine3']) {
      if (ctx.bal.manual.isPinned(sn, 0)) continue;
      // ★ §2.255 单模式目标（Krishnamoorthy模式=单标量：同一 leanNow 给全链）；★ §2.262 漂移期停写
      ctx.bal.manual.setAngle(sn, 0, leanNow, 120, 20);
    }
  }
  void trend;
}
