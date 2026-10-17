/**
 * supportClean.ts —— 回正力写手（2026-10-16 重构：按《基础力写手审计.md》§4.2 + 《张力层迁移设计》）
 *
 * 三层架构：
 *   基础力 = gcomp（抗重力，antiG 通道）——不在本模块
 *   回正力 = **本模块**：回标准弹簧（迁移自旧张力层的"保持"部分）+ 方向项 + 预算
 *   张力   = stability ⓪ 的纯单向阻尼
 *
 * 每轴：τ = kp·(ref−θ) + kd·(−ω) + [方向项]，限幅 = 预算
 *   ref = 抬腿结束那一刻捕获的标准态（_ref；supportCleanReset 清空重捕）
 *   方向项（仅承重/平衡链）：
 *     foot0 → CoP 侧向 = XCoM 需求 → CoP 跟踪
 *     foot2 → CoP 矢状 = XCoM 需求 → CoP 跟踪
 *     hip0  → Kz·(z_std − z_com)
 *     hip2  → Kx·(x_std − x_com)
 *     knee2 → Ky·(y_std − y_com)（com 低于标准→伸膝抬起）
 *   摆动腿：同式（无方向项）+ 静偏置（SW_* env）
 * 已删除（旧体系）：N/P 四套增益、dirState 方向态、kCom+守护器消费、kTilt、模式分套 B0、spineShare。
 */
import { propose, PRI } from '../proposalBus';
import type { ServoRefs } from './supportReg';
import { rescueOffsets } from './rescue';
import { trunkClean } from './trunkClean';

const envOf = (): Record<string, string | undefined> =>
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});

const _ref = new Map<string, number>();
const _lp = new Map<string, number>();   // ★ 2026-10-16 频段分离：回正力低通状态（论文：姿势控制是低频 0.5-2Hz）
let _com0: { x: number; y: number; z: number } | null = null;
export function supportCleanReset(): void {
  _ref.clear();
  _lp.clear();
  _com0 = null;
}

const ARM_AXES: Array<[string, number]> = [
  ['neck', 0], ['neck', 1], ['neck', 2],
  ['shoulder_l', 0], ['shoulder_l', 1], ['shoulder_l', 2],
  ['shoulder_r', 0], ['shoulder_r', 1], ['shoulder_r', 2],
  ['elbow_l', 0], ['elbow_l', 1], ['elbow_l', 2],
  ['elbow_r', 0], ['elbow_r', 1], ['elbow_r', 2],
];

const AXES: Array<[string, number]> = [
  ['hip', 0], ['hip', 1], ['hip', 2],
  ['knee', 0], ['knee', 1], ['knee', 2],
  ['foot', 0], ['foot', 1], ['foot', 2],
];

export function supportClean(ctx: ServoRefs, side: 'l' | 'r'): void {
  rescueOffsets(ctx, 1 / 240);   // standardPose 捕获（保留旧链）
  if (side === 'r' && String(envOf().TR_ON ?? '1') === '1') trunkClean(ctx, side, 1 / 240);   // 躯干链（唯一入口）
  const e = envOf();
  // 支撑模式：双支撑（both/none）两腿都是支撑腿；单腿（l/r）只有支撑侧（对侧=摆动）
  const mode = ctx.bal.supportState.mode;
  const sup = mode === 'both' || mode === 'none' ? true : mode === side;
  const body = ctx.body;
  const sen = ctx.sensors;
  const com = sen.com;
  // ★ 2026-10-16 首帧守卫：传感器未初始化（com.y≈0）时不得捕获标准态——
  //   否则 std=(0,0,0) → 方向项 2500×(0−真实com) = 满格钳位（站立探针首帧 −220@knee2 的根因）
  if (!_com0 && com[1]! > 0.3) _com0 = { x: com[0]!, y: com[1]!, z: com[2]! };
  const std = _com0 ?? { x: com[0]!, y: com[1]!, z: com[2]! };

  // ── 回标准弹簧（★ 2026-10-16 量程归一化：默认=旧张力公式 postureTone×0.5×τmax/lim，
  //    小量程关节（膝0/踝0/脊柱）自动获得大刚度——这是"同效"的关键；env 可覆盖）──
  const tone = ctx.bal.opt.postureTone;
  const kpNorm = (d0: { tauMax: number; min: number; max: number; name: string; axis: number }): number => {
    const tauKp = d0.axis === 0 && (d0.name === 'hip_l' || d0.name === 'hip_r') ? Math.min(d0.tauMax, 120) : d0.tauMax;
    const lim0 = Math.max(Math.abs(d0.min), Math.abs(d0.max), 0.3);
    return tone * 0.5 * tauKp / lim0;
  };
  const kpLat = Number(e.SC_KP_LAT ?? 0) || 0;   // 0=用逐关节归一化（下面每轴算）
  const kpSag = Number(e.SC_KP_SAG ?? 0) || 0;
  const kpTw = Number(e.SC_KP_TW ?? 0) || 0;
  const kdLat = Number(e.SC_KD_LAT ?? 16);
  const kdSag = Number(e.SC_KD_SAG ?? 12);
  const kdTw = Number(e.SC_KD_TW ?? 8);
  // ── 方向项（符号可 env 翻转，便于实测标定）──
  const Kz = Number(e.SC_KZ ?? 20000) * Number(e.SC_SGN_Z ?? 1);   // ★ 2026-10-16 标定（侧向阻尼0.5×联动）：12000→20000（20k 站住✓；25k 过冲）
  const Kx = Number(e.SC_KX ?? 2500) * Number(e.SC_SGN_X ?? 1);
  const Ky = Number(e.SC_KY ?? 2500) * Number(e.SC_SGN_Y ?? -1);   // ★ 符号标定：−1（站立后仰漂移的修复）
  const kCopLat = Number(e.SC_KCOP_LAT ?? 250) * Number(e.SC_SGN_COPLAT ?? -1);
  const kCopSag = Number(e.SC_KCOP_SAG ?? 250) * Number(e.SC_SGN_COPSAG ?? 1);   // ★ 符号标定：+1
  // ── 预算（基于脚上力；用户："预算要基于脚上的力"）──
  const fzS = sen.feet[side === 'l' ? 0 : 1]!.fz;
  const copK = Number(e.SC_COPK ?? 0.7);
  const fw = Number(e.SC_FOOTW ?? 0.10);
  const capFootLat = Math.max(15, fzS * fw * copK);
  const capFootSag = Math.max(15, fzS * 0.12 * copK);
  // ── XCoM 需求（CoP 目标）──
  const hgt = Math.max(0.3, com[1]!);
  const w0 = Math.sqrt(9.81 / hgt);
  const xcomX = com[0]! + sen.comVel[0]! / w0;
  const xcomZ = com[2]! + sen.comVel[2]! / w0;
  const copNowX = sen.feet[side === 'l' ? 0 : 1]!.copX;
  const copNowZ = sen.feet[side === 'l' ? 0 : 1]!.copZ;

  for (const [jn, ax] of AXES) {
    const di = body.dofByName(`${jn}_${side}`, ax);
    if (di < 0) continue;
    const d = body.dofs[di]!;
    if (d.engineMotor) continue;
    const key = `${jn}_${side}:${ax}`;
    if (!_ref.has(key)) _ref.set(key, d.angle);
    const dev = _ref.get(key)! - d.angle;

    let tau: number;
    let lim: number;
    if (sup) {
      const kpEnv = ax === 0 ? kpLat : ax === 2 ? kpSag : kpTw;
      const kp = kpEnv > 0 ? kpEnv : kpNorm(d);   // ★ 默认=量程归一化（旧张力同效）
      const kd = ax === 0 ? kdLat : ax === 2 ? kdSag : kdTw;
      let dir = 0;
      if (jn === 'hip' && ax === 0) dir = Kz * (std.z - com[2]!);
      else if (jn === 'hip' && ax === 2) dir = Kx * (std.x - com[0]!);
      else if (jn === 'knee' && ax === 2) dir = Ky * (std.y - com[1]!);
      else if (jn === 'foot' && ax === 0) dir = kCopLat * (xcomZ - copNowZ);
      else if (jn === 'foot' && ax === 2) dir = kCopSag * (xcomX - copNowX);
      const bias = Number(e[`SC_B0_${jn.toUpperCase()}${ax}`] ?? 0);
      lim = jn === 'foot' ? (ax === 2 ? capFootSag : capFootLat) : (d.tauMax ?? 200);
      // ★ 3 层架构（2026-10-16 用户定调）：回正力=**主动弹簧+方向项**（主动发力）；
      //   单向阻尼归张力层（stability ⓪，被动肌肉张力）；kd 保留给方向项滤波（暂未用）。
      // ★ 2026-10-16 v2 超前项（论文：低频需相位裕度——还没倒就先用力）
      tau = bias + kp * dev + dir + Number(e.SC_LEAD ?? 0) * -d.vel;
    } else {
      // 摆动腿：回标准弹簧（无方向项）+ 静偏置（同款量程归一化）
      const kpEnvS = ax === 0 ? Number(e.SW_KP_LAT ?? 0) : ax === 2 ? Number(e.SW_KP_SAG ?? 0) : Number(e.SW_KP_TW ?? 0);
      const kp = kpEnvS > 0 ? kpEnvS : kpNorm(d);
      const kd = Number(e.SW_KD ?? 12);
      const bias = ax === 2 ? Number(e[`SW_${jn.toUpperCase()}${ax}`] ?? 0) : 0;
      lim = d.tauMax ?? 200;
      tau = bias + kp * dev + Number(e.SC_LEAD ?? 0) * -d.vel;
    }
    const cl = Math.max(-lim, Math.min(lim, tau));
    // ★ 2026-10-16 频段分离：回正力=低频（截止 SC_LP Hz，默认 3）——高频扰动交给张力阻尼
    const fcLp = Number(e.SC_LP ?? 3);
    const aLp = 1 - Math.exp(-(1 / 240) * 2 * Math.PI * fcLp);
    const lpPrev = _lp.get(key) ?? cl;
    const clLp = lpPrev + (cl - lpPrev) * aLp;
    _lp.set(key, clLp);
    if (Math.abs(clLp) < 0.5) continue;
    propose({ dof: di, kind: 'torque', pri: PRI.action, tau: clLp, src: 'supportClean' });
  }

  // ── 上肢/颈姿态保持（§4.2.4/4.2.5）——★ 2026-10-16 补齐：旧张力层弹簧覆盖全身，
  //    干净版漏了肩/肘/颈（15 轴）→ 手臂自由甩动反作用鞭翻躯干（"四足/翻转"真身之一）──
  const kpArmEnv = Number(e.SC_KP_ARM ?? 0);   // 0=逐关节量程归一化
  for (const [jn, ax] of ARM_AXES) {
    const di = body.dofByName(jn, ax);
    if (di < 0) continue;
    const d = body.dofs[di]!;
    if (d.engineMotor) continue;
    const key = `${jn}:${ax}`;
    if (!_ref.has(key)) _ref.set(key, d.angle);
    const dev = _ref.get(key)! - d.angle;
    const lim = d.tauMax ?? 200;
    const kpArm = kpArmEnv > 0 ? kpArmEnv : kpNorm(d);
    const tau = Math.max(-lim, Math.min(lim, kpArm * dev));
    if (Math.abs(tau) < 0.5) continue;
    propose({ dof: di, kind: 'torque', pri: PRI.action, tau, src: 'supportClean.arm' });
  }
}
