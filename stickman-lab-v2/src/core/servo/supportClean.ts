/** supportClean.ts —— 支撑柱骨架重构版（2026-10-15 用户："架构重置"）
 *
 *  第一性公式（无闸门 / 无锁 / 无模式 / 无捕获事件）：
 *      支撑腿每轴：τ = B0_j（真·常值力矩通道） + kP·(θ_ref − θ) + 单向阻尼
 *      单向阻尼（用户："只有往外偏是阻尼"）：dev·θ̇ > 0（往外）才 τ_damp=−kD·θ̇；回程零写入
 *      θ_ref：首帧捕获（=抬腿结束那刻），此后恒定
 *
 *  · B0 标定目标 = 初态静态载荷（对账工具直接量）——纯基础力维持初态的"由构造保证"
 *  · 全部走提案总线（PRI.action）；不写 pair（不走 λ 弹簧通道）
 *  · 摆动腿：同一公式（B0 小档=持位力矩）
 */
import { propose, PRI } from '../proposalBus';
import type { ServoRefs } from './supportReg';

const envOf = (): Record<string, string> =>
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});

const _ref = new Map<string, number>();
let _tref: [number, number] | null = null;   // 世界倾角初始参考 [pitch, roll]
export function supportCleanReset(): void {
  _ref.clear();
  _tref = null;
}

const AXES: Array<[string, number]> = [
  ['hip', 0], ['hip', 1], ['hip', 2],
  ['knee', 0], ['knee', 1], ['knee', 2],
  ['foot', 0], ['foot', 1], ['foot', 2],
];

export function supportClean(ctx: ServoRefs, side: 'l' | 'r'): void {
  const e = envOf();
  // 支撑侧默认（=现名册）；摆动侧默认（=今日实测定档 髋2:+80 / 膝2:−55）
  const sup = side === 'r';
  const B0: Record<string, number> = sup
    ? { hip0: Number(e.SC_HIP0 ?? 200), hip1: 0, hip2: Number(e.SC_HIP2 ?? 40),   // ★ 用户标准（预状态）：hip0=200——预状态分布 2.6→4.4s 中位；干净起点有崖（175→3.81）
        knee0: Number(e.SC_KNEE0 ?? 30), knee1: 0, knee2: Number(e.SC_KNEE2 ?? 0),
        foot0: Number(e.SC_FOOT0 ?? 0), foot1: 0, foot2: Number(e.SC_FOOT2 ?? 0) }
    : { hip0: Number(e.SW_HIP0 ?? 0), hip1: 0, hip2: Number(e.SW_HIP2 ?? 80),
        knee0: Number(e.SW_KNEE0 ?? 0), knee1: 0, knee2: Number(e.SW_KNEE2 ?? -55),
        foot0: Number(e.SW_FOOT0 ?? 0), foot1: 0, foot2: Number(e.SW_FOOT2 ?? 0) };
  const kP = sup ? Number(e.SC_KP ?? 120) : Number(e.SW_KP ?? 120);   // ★ 用户："摆动腿可以单独一套"
  const kD = sup ? Number(e.SC_KD ?? 12) : Number(e.SW_KD ?? 12);
  const cap = Number(e.SC_CAP ?? 100);  // 单轴出力钳（★ 12s 定档 150→100——关键》）
  const kTilt = Number(e.SC_KTILT ?? 0);   // 世界倾角回正增益 N·m/rad（默认0=关）
  const kCom = Number(e.SC_KCOM ?? 2500);  // CoM 误差回拉增益 N·m/m（★ 用户"回拉的力"——定峰 2500：真抬腿动作流 5.59s；800→4.57、1500→1.46、4000→1.84 崖式）
  const kComSgn = Number(e.SC_KCOM_SGN ?? 1)
  const kSgn = Number(e.SC_KTILT_SGN ?? -1);   // 符号（可调）
  for (const [jn, ax] of AXES) {
    const di = ctx.body.dofByName(`${jn}_${side}`, ax);
    if (di < 0) continue;
    const d0 = ctx.body.dofs[di]!;
    const key = `${jn}_${side}:${ax}`;
    if (!_ref.has(key)) _ref.set(key, d0.angle);
    const dev = _ref.get(key)! - d0.angle;
    const outward = dev * d0.vel > 0;
    const damp = outward ? -kD * d0.vel : 0;
    // ★ 用户："瞬间反作用交给回拉的力"——CoM 误差回拉（支撑腿髋部；旧 M2 分配器已删，pad 踝路径太弱→装执行器）
    let tqCom = 0;
    if (sup && kCom !== 0) {
      const tgtC = (ctx.bal as unknown as { getComTarget?: () => { x: number; z: number } }).getComTarget?.() ?? { x: 0, z: 0 };
      const ez = tgtC.z - ctx.sensors.com[2]!;
      const ex = tgtC.x - ctx.sensors.com[0]!;
      if (ax === 0 && jn === 'hip') tqCom = kCom * ez * kComSgn;
      else if (ax === 2 && jn === 'hip') tqCom = kCom * ex * kComSgn;
    }
    // ★ 用户："回正需要改世界倾角了"——世界倾角回正（支撑腿；侧向轴吃 roll、矢状轴吃 pitch）
    let tqTilt = 0;
    if (sup && kTilt > 0) {
      const pit = ctx.sensors.torsoTilt[0]!, rol = ctx.sensors.torsoTilt[1]!;
      if (!_tref) _tref = [pit, rol];
      const dPit = pit - _tref[0], dRol = rol - _tref[1];
      if (ax === 0 && jn === 'hip') tqTilt = kSgn * kTilt * dRol;        // 每轴单一执行者（全关节摊=重复计数过驱）
      else if (ax === 2 && jn === 'hip') tqTilt = kSgn * kTilt * dPit;
    }
    const tau = Math.max(-cap, Math.min(cap, (B0[`${jn}${ax}`] ?? 0) + kP * dev + damp + tqTilt + tqCom));
    if (Math.abs(tau) < 0.5) continue;   // ★ 用户："瞬间反作用交给回拉的力"——近零不写，让位给 pad(CoM回拉)/其他写手（防 setTorque 置零顶掉）
    propose({ dof: di, kind: 'torque', pri: PRI.action, tau, src: 'supportClean' });
  }
}
