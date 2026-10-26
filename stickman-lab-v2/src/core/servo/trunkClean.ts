/** trunkClean.ts —— 躯干链全新写手（2026-10-15 用户："写一个全新的，一个通道一个写手，审批制安排好"）
 *
 *  通道划分（一通道一写手）：
 *   · 侧向通道（spine1-3 轴0）：基础 B0_LAT + 回正 kP·dev + 单向阻尼
 *   · 矢状通道（spine1-3 轴2）：基础 B0_SAG + 回正 kP·dev + 单向阻尼
 *   · 旋转通道（spine1-3 轴1）：基础 B0_ROT + 回正
 *   · 盆骨拉平通道（dy 驱动 → 叠加到 spine1/0）：B + P·dy + D·dyd（摆动侧沉→托回水平）
 *
 *  预算审批（实时力链，脚→膝→髋→脊柱 依次往上）：
 *   capFoot=fz×脚半宽×k → capKnee=min(300, ×6) → capHip=min(228, ×6) → capSpine=min(470, capHip×2)
 *   全量（基础+回正）走 min(本级预算, 硬件 tauMax)。
 *
 *  调用：由 supportClean 在支撑侧调用一次/帧（唯一入口）；与旧 upperBase/lateralStab 不共存（旧件默认关）。
 */
import { propose, PRI } from '../proposalBus';
import { baseTq, baseAng, baseState, baseParams } from './baseTable';
import { baseTorque, pdDevOneWay } from './kernel';   // ★ v3：基础力矩表
import { isLiftDone } from './supportReg';   // 抬腿完成门（躯干通道=抬腿后上岗）
// ★ 用户："抬腿过程的摆动腿侧上身少用点力，用来抵消抬腿的作用力"——抬腿段躯干横向降档（TR_LIFT_SCALE）
import type { ServoRefs } from './supportReg';

const envOf = (): Record<string, string> =>
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});

const _ref = new Map<string, number>();
let _refStateT = '';
// ★ 2026-10-17（同 supportClean 的修复）：状态变化清缓存——否则蹲下状态仍用站立目标
function syncRefStateT(): void {
  const st = baseState();
  if (st !== _refStateT) { _refStateT = st; _ref.clear(); }
}
const _devLp = new Map<string, number>();
let _dyPrev: number | null = null;
let _dydLp = 0;
export function trunkCleanReset(): void {
  _ref.clear();
  _devLp.clear();
  _dyPrev = null;
  _dydLp = 0;
}

const AXES: Array<[string, number]> = [
  ['spine1', 0], ['spine1', 1], ['spine1', 2],
  ['spine2', 0], ['spine2', 1], ['spine2', 2],
  ['spine3', 0], ['spine3', 1], ['spine3', 2],
];

export function trunkClean(ctx: ServoRefs, side: 'l' | 'r', dt = 1 / 240): void {
  // ★★★ 2026-10-20 用户（'蹲下上升力/单一写手'）：蹲姿脊柱/颈走 supportClean 的脊柱块，trunkClean 让位
  if (baseState() === 'squat') return;
  syncRefStateT();
  const e = envOf();
  // ★ 用户定稿："抬腿的时候上身和支撑腿上岗；抬完腿都上岗"——躯干通道从单腿开始就在岗
  //   （原 isLiftDone 门=违设计；抬腿段由 gL 降档做摆动侧减力；TR_GATE=1 恢复旧门对照）
  // ★ 用户定稿："承重腿和上身在一开始就进入基础力和回正力的状态"——上身从动作启动就在岗（无抬腿门）
  //   （TR_GATE=1 仅作旧门对照；横向的抬腿段降档仍由 gL 做）
  // ★ 2026-10-26 删废：这里原有 `const latGate = String('0') === '1' && !isLiftDone();`
  //   —— 字面量 `String('0') === '1'` 恒为 false，所以 latGate 恒 false，
  //   下面 `if (latGate && ax === 0) continue;` 是永远不会触发的门（横向门实际早已废弃）。
  // ── 基础（人体档：躯干歪几度 → 侧弯 20-35 N·m；先默认小档，法庭标定）──
  const B0: Record<string, number> = {
    lat: Number(2),   // ★ 2026-10-16 受力审计：10→2（脊柱侧向需求≈0）
    sag: Number(-10),   // ★ 2026-10-16 标定：前倾回正 −10（稳定带 −8~−12，−15 以上过强）——严格判死站住✓×2确定性
    rot: Number(0),
  };
  // ★ 2026-10-16 量程归一化：默认 kp = 旧张力公式 postureTone×0.5×τmax/lim（脊柱 ~1727）——
  //   固定 80 比旧软 21 倍 = 冲击穿透脊柱的根因；env TR_KP 可覆盖。
  const tone = ctx.bal.opt.postureTone;
  const kpEnvT = Number(0);
  const kpNormT = (d0: { tauMax: number; min: number; max: number }): number =>
    tone * 0.5 * d0.tauMax / Math.max(Math.abs(d0.min), Math.abs(d0.max), 0.3);
  const kPN = kpEnvT > 0 ? kpEnvT : 0, kPP = kPN;
  const kDN = Number(8), kDP = kDN;
  // ── 盆骨拉平通道（dy 驱动）──
  const pelvB = Number(6);
  const pelvP = Number(200);
  const pelvD = Number(40);
  const pelvClamp = Number(0.05);
  const sup0 = ctx.body.dofByName(`hip_${side}`, 0);
  const sw0 = ctx.body.dofByName(`hip_${side === 'l' ? 'r' : 'l'}`, 0);
  let dy = 0, dyd = 0;
  if (sup0 >= 0 && sw0 >= 0) {
    dy = ctx.body.dofs[sup0]!.anchorWorld[1]! - ctx.body.dofs[sw0]!.anchorWorld[1]!;
    const raw = _dyPrev === null ? 0 : (dy - _dyPrev) / Math.max(dt, 1e-6);
    _dyPrev = dy;
    _dydLp += (raw - _dydLp) * (1 - Math.exp(-dt / 0.05));
    dyd = _dydLp;
  }
  // ── 预算审批（实时力链）──
  // ★ 2026-10-26 删废：原 `const budOn = String('1') !== '0';` 恒为 true（见下方 budget）。
  const fzS = ctx.sensors.feet[side === 'l' ? 0 : 1]!.fz;
  const copK = Number(0.7);
  const capFoot = Math.max(15, fzS * Number(0.045) * copK);   // ★ 柔性足能力（同 supportClean，SC_FOOTW 统一；默认 0.045 待踝控制器重设计）
  const capKnee = Math.min(300, capFoot * 6);
  const capHip = Math.min(228, capKnee * 6);
  const capSpine = Math.min(Number(470), capHip * 2);
  for (const [jn, ax] of AXES) {
    const di = ctx.body.dofByName(jn, ax);
    if (di < 0) continue;
    const d0 = ctx.body.dofs[di]!;
    const key = `${jn}:${ax}`;
    if (!_ref.has(key)) _ref.set(key, baseAng(jn, ax) ?? d0.angle);   // ★ 表驱动（原来只捕获当前角——蹲姿目标永不生效）
    let dev = _ref.get(key)! - d0.angle;
    // ★★ 2026-10-17 用户（'上身受力为0为什么不弯腰'）：脊柱矢状轴读数(rotvec)与物理脱节
    //   （读数-13°物理-100°）→ 回正力以为到位不发力气。改用**几何实测**（spine3 世界俯仰）
    //   算偏差：目标俯仰 vs 实际俯仰（只对 spine1-3 的轴2；每段分担 1/3）。
    if (ax === 2 && jn.startsWith('spine')) {
      const i3 = ctx.body.indexByKey.get('spine3');
      if (i3 !== undefined) {
        const q3 = ctx.body.bodies[i3]!.rotation();
        const upx = 2 * (q3.x * q3.y - q3.w * q3.z), upy = 1 - 2 * (q3.x * q3.x + q3.z * q3.z);
        const pitch = Math.atan2(upx, upy);                       // 实际俯仰（正=前倾）
        const tgt = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).TR_SAG_TGT ?? 0.75);   // 目标前倾 43°
        dev = (tgt - pitch) / 3;                                   // 三段分担
      }
    }
    // ★ 用户："按人类方式回正"——矢状通道=世界俯仰角回正（躯干竖回竖直；人转移期躯干 ±2°）
    const pitchW = ctx.sensors.torsoTilt[0]!;
    const sagWorld = ax === 2 ? -Number(60) * pitchW : 0;
    const gL = isLiftDone() ? 1 : (ax === 0 ? Number(0.35) : 1);
    // ★ 2026-10-26 删废：`if (latGate && ax === 0) continue;` —— latGate 恒 false（见上）。
    const neckKpS = jn === 'neck' ? Number(baseParams().neckKp ?? 0) : 0;
    const aKp = gL * (neckKpS > 0 ? neckKpS : kPN > 0 ? kPN : kpNormT(d0)), aKd = gL * kDN;   // ★ 颈=状态表 neckKp   // ★ 量程归一化（旧张力同效）
    // ★ 2026-10-20 用户（'重构脊柱和颈部'）：单向阻尼 PD 改走共享内核（同公式）
    const post = pdDevOneWay(aKp, aKd, dev, d0.vel);
    const base = Number(e[`TR_B0_${jn.toUpperCase()}${ax}`] ?? baseTorque(jn, ax));   // ★ v3：基础力矩表（env 可覆盖）
    let pelv = 0;
    if (jn === 'spine1' && ax === 0) {
      pelv = Math.max(-pelvClamp, Math.min(pelvClamp, (pelvB + pelvP * dy + pelvD * dyd) / 1000));
    }
    const hw = d0.tauMax ?? 200;
    // ★ 2026-10-26 删废：`const budOn = String('1') !== '0';` 恒为 true，
    //   所以 `budget` 永远 = min(capSpine, hw)，一行写死即可。
    const budget = Math.min(capSpine, hw);
    const tau = Math.max(-budget, Math.min(budget, gL * base + post + gL * pelv * 1000 + sagWorld));
    if (Math.abs(tau) < 0.3) continue;
    propose({ dof: di, kind: 'torque', pri: PRI.action, tau, src: 'trunkClean' });
  }
}
