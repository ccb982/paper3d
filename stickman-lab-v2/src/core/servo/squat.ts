/** squat.ts — 新支撑/回正架构（2026-10-27 清理版）
 *
 * 只保留：
 *   - 矢状 pair/base 支撑
 *   - 踝矢状前馈
 *   - 下盘倒向侧 hip/2、knee/2、foot/0 支撑
 *   - 上盘 HAT 回正（默认关）
 *   - 正面/脊柱被动刚度、髋软限位
 *
 * 旧 ankleVector / backSpine / rc2 / passiveLock / hipStrut 等回正写手已删除。
 */
import { baseState, baseParams, baseAng } from './baseTable';
import { propose, PRI } from '../proposalBus';
import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep } from '../court';
import { SquatComMonitor } from './squatComMonitor';

export { squatCourtSetup, courtStep, type CourtState } from '../court';

const _dofLimitsOrig = new Map<number, { min: number; max: number }>();
const _comMonitors = new WeakMap<CS, SquatComMonitor>();
const _footTarget = new WeakMap<CS, number>();

export function squatPairBase(w: World, ctl: ControlModule): void {
  if (baseState() !== 'squat') return;
  const baseBuf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  if (!baseBuf) return;   // 未捕获 → 蹲姿不写 pair
  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_PAIR_OFF ?? '0') === '1') return;
  const body = w.body;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const bp = baseParams() as unknown as { pairC?: number };
  const cPair = Number(env.SQC_PAIR_C ?? bp.pairC ?? 0.7);
  const vecMode = String(env.SQC_ANKLE_VEC ?? '1') !== '0';   // 3D 矢量转接口模式
  const pairLatOn = String(env.SQC_PAIR_LAT ?? '0') === '1';
  const coOn = String(env.SQC_COACT ?? '1') === '1';
  const coK = Number(env.SQC_COACT_K ?? 200);
  const coB = Number(env.SQC_COACT_B ?? 20);
  const coCap = Math.abs(Number(env.SQC_COACT_CAP ?? 30));
  const coHipK = Number(env.SQC_COACT_HIP_K ?? 0);
  const coHipB = Number(env.SQC_COACT_HIP_B ?? 0);
  const coHipCap = Math.abs(Number(env.SQC_COACT_HIP_CAP ?? 30));
  const pairScale = Math.abs(Number(env.SQC_PAIR_SCALE ?? 1));
  for (const d of body.dofs) {
    if (d.engineMotor) continue;
    // ★ 预环（ring0）已被物理锁死 [rest,rest]，写手 skip（防脏账/浪费算力）
    if (d.preRing) continue;
    // ★ 基础力全走矢状面：foot/ankle 只放行 pitch（轴 2）；侧向/扭转（0/1）不给权限
    //   vecMode：foot/ankle 全部交给 ankleVec 的 3D 分配器，pair 不再写脚踝
    // ★ vec 模式：基础力只允许矢状轴 2；hip/knee/spine/neck 的轴 0 也排除
    const lateralPair = pairLatOn && d.axis === 0 && /^(hip|knee|spine|neck)/.test(d.name);
    if (vecMode && d.axis !== 2 && !lateralPair) continue;
    const isTrunkLeg = /^(hip|knee|spine|neck)/.test(d.name) && (d.axis === 0 || d.axis === 2);
    // v3：矢状 pair 只写 axis 2；横向交给被动刚度/软限位，不混入 pair
    if (String(env.SQC_PAIR_SAGITTAL_ONLY ?? '1') === '1' && d.axis !== 2) continue;
    const isFootPitch = !vecMode && /^(foot|ankle)/.test(d.name) && d.axis === 2;
    if (!(isTrunkLeg || isFootPitch || lateralPair)) continue;
    let base = lateralPair ? 0 : (baseBuf[d.dofIndex] ?? 0);
    let ref = baseAng(d.name, d.axis) ?? d.angle;
    let c = lateralPair ? Number(env.SQC_PAIR_C_LAT ?? 0.25) : cPair;
    if (String(env.SQC_PASSIVE_MODE ?? '0') === '1' && !lateralPair) {
      const side = d.name.endsWith('_l') ? 'l' : d.name.endsWith('_r') ? 'r' : null;
      const fz = side ? body.footNormalForce(side, w.dt) : (body.footNormalForce('l', w.dt) + body.footNormalForce('r', w.dt)) / 2;
      const loadK = Math.max(0, Number(env.SQC_PB_C_LOAD ?? 0.5));
      c = Math.min(0.9, c * (1 + loadK * (fz / Math.max(1, w.sk.massTotal * 9.81))));
    }
    if (coOn && /^knee_/.test(d.name) && d.axis === 2) {
      const e = ref - d.angle;
      const tco = Math.max(-coCap, Math.min(coCap, coK * e - coB * d.vel));
      base += tco;
    }
    if (coOn && /^hip_/.test(d.name) && d.axis === 2) {
      const e = ref - d.angle;
      const tco = Math.max(-coHipCap, Math.min(coHipCap, coHipK * e - coHipB * d.vel));
      base += tco;
    }
    let refEff = ref;
    if (String(env.SQC_PASSIVE_MODE ?? '0') === '1' && !lateralPair) {
      // 短程刚度：K/C 不变，只让目标误差饱和 → 力饱和，不软化弹簧。
      const sat = Math.abs(Number(env.SQC_PB_SAT_DEG ?? 10.0)) / 57.3;
      const e = ref - d.angle;
      refEff = d.angle + Math.max(-sat, Math.min(sat, e));
    }
    propose({ dof: d.dofIndex, kind: 'pair', pri: PRI.action, c, rad: refEff, tau: base * pairScale, src: lateralPair ? 'squat.pairBase.lat' : 'squat.pairBase' });
  }
}

/** 下盘强软限位：膝竖直 + 髋线水平。
 *  不做硬 setLimits；只在超出死区时给大力矩，承重腿才生效。 */
function squatLegSoftLock(w: World): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_LEG_SOFT ?? '0') !== '1') return;
  if (baseState() !== 'squat') return;
  const W = w.sk.massTotal * 9.81;
  const dead = Math.abs(Number(env.SQC_LS_DEAD_DEG ?? 1.0)) / 57.3;
  const K = Math.abs(Number(env.SQC_LS_K ?? 200));
  const KHip = Math.abs(Number(env.SQC_LS_HIP_K ?? K));
  const KKnee = Math.abs(Number(env.SQC_LS_KNEE_K ?? K * 0.5));
  const B = Math.abs(Number(env.SQC_LS_B ?? 10));
  const cap = Math.abs(Number(env.SQC_LS_CAP ?? 80));
  const hipSign = Number(env.SQC_LS_HIP_SIGN ?? 1) < 0 ? -1 : 1;
  const kneeSign = Number(env.SQC_LS_KNEE_SIGN ?? 1) < 0 ? -1 : 1;
  const hipL = w.body.dofByName('hip_l', 0), hipR = w.body.dofByName('hip_r', 0);
  if (hipL < 0 || hipR < 0) return;
  const hl = w.body.dofs[hipL]!, hr = w.body.dofs[hipR]!;
  const loadedL = w.body.footNormalForce('l', w.dt) >= 0.1 * W;
  const loadedR = w.body.footNormalForce('r', w.dt) >= 0.1 * W;
  if (loadedL && loadedR) {
    const yL = hl.anchorWorld[1]!, yR = hr.anchorWorld[1]!;
    const e = yL - yR;
    const hipDead = Math.abs(Number(env.SQC_LS_HIP_DEAD_M ?? 0.002));
    if (Math.abs(e) > hipDead) {
      const d = e - Math.sign(e) * hipDead;
      const tau = Math.max(-cap, Math.min(cap, hipSign * (-KHip * d - B * (hl.vel + hr.vel))));
      propose({ dof: hipL, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.legSoft.hipL', channel: 'support' });
      propose({ dof: hipR, kind: 'ext', pri: PRI.reflex, tau: -tau, src: 'squat.legSoft.hipR', channel: 'support' });
    }
  }
  for (const side of ['l', 'r'] as const) {
    if (w.body.footNormalForce(side, w.dt) < 0.1 * W) continue;
    const ki = w.body.dofByName(`knee_${side}`, 1);
    if (ki < 0) continue;
    const kd = w.body.dofs[ki]!;
    if (Math.abs(kd.angle) <= dead) continue;
    const d = kd.angle - Math.sign(kd.angle) * dead;
    const tau = Math.max(-cap, Math.min(cap, kneeSign * (-KKnee * d - B * kd.vel)));
    propose({ dof: ki, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.legSoft.knee', channel: 'support' });
  }
}

/** 髋线水平辅助：hip/0 差动，目标左右 hipY 等高；脚承重才出力。 */
function squatHipLevelAssist(w: World): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_HIP_LEVEL ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;
  const W = w.sk.massTotal * 9.81;
  if (w.body.footNormalForce('l', w.dt) < 0.1 * W || w.body.footNormalForce('r', w.dt) < 0.1 * W) return;
  const hl = w.body.dofByName('hip_l', 0), hr = w.body.dofByName('hip_r', 0);
  if (hl < 0 || hr < 0) return;
  const a = w.body.dofs[hl]!, b = w.body.dofs[hr]!;
  const d = a.anchorWorld[1]! - b.anchorWorld[1]!;
  const dead = Math.abs(Number(env.SQC_HL_DEAD_M ?? 0.002));
  if (Math.abs(d) <= dead) return;
  const lvl = Number((globalThis as { __COM_MON?: { level?: number } }).__COM_MON?.level ?? 0);
  const K = Math.abs(Number(env.SQC_HL_K ?? 500)) * (lvl >= 2 ? Math.abs(Number(env.SQC_COM_HIP_BOOST ?? 1.5)) : 1);
  const B = Math.abs(Number(env.SQC_HL_B ?? 0));
  const cap = Math.abs(Number(env.SQC_HL_CAP ?? 80));
  const e = d - Math.sign(d) * dead;
  const tau = Math.max(-cap, Math.min(cap, K * e - B * (a.vel + b.vel)));
  propose({ dof: hl, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.hipLevel.l', channel: 'support' });
  propose({ dof: hr, kind: 'ext', pri: PRI.reflex, tau: -tau, src: 'squat.hipLevel.r', channel: 'support' });
}

/** 脊柱被动刚度：只写 spine1-3 的侧向/扭转（轴 0/1）。
 *  中性角=0，不读 CoM；超死区才出力，纯弹簧+阻尼。 */
function squatSpinePassive(w: World): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_SPINE_PASSIVE ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;
  const K = Math.abs(Number(env.SQC_SP_K ?? 80));
  const B = Math.abs(Number(env.SQC_SP_B ?? 4));
  const cap = Math.abs(Number(env.SQC_SP_CAP ?? 30));
  const dead = Math.abs(Number(env.SQC_SP_DEAD_DEG ?? 0.5)) / 57.3;
  for (const nm of ['spine1', 'spine2', 'spine3'] as const) {
    for (const ax of [0, 1] as const) {
      const di = w.body.dofByName(nm, ax);
      if (di < 0) continue;
      const d = w.body.dofs[di]!;
      if (Math.abs(d.angle) < dead && Math.abs(d.vel) < 0.01) continue;
      const oneWay = String(env.SQC_SP_ONE_WAY ?? '0') !== '0';
      let tau: number;
      if (oneWay) {
        // 单向被动：只在“向外”被拉长时出力；回程完全不出力
        const away = d.angle * d.vel > 0;
        const sgn = d.angle >= 0 ? 1 : -1;
        const oSign = Number(env.SQC_SP_ONE_WAY_SIGN ?? 1) < 0 ? -1 : 1;
        tau = away && Math.abs(d.angle) > dead ? oSign * (-K * (d.angle - sgn * dead) - B * d.vel) : 0;
      } else {
        tau = -K * d.angle - B * d.vel;
      }
      tau = Math.max(-cap, Math.min(cap, tau));
      if (Math.abs(tau) > 1e-6) propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'squat.spinePassive', channel: 'passive' });
    }
  }
}

/** 脚支撑中心：目标从实际脚位置计算，不读固定 c0。 */
function footSupportCenterZ(w: World): number {
  const li = w.body.indexByKey.get('foot_l');
  const ri = w.body.indexByKey.get('foot_r');
  if (li === undefined || ri === undefined) return 0;
  const zL = w.body.bodies[li]!.translation().z;
  const zR = w.body.bodies[ri]!.translation().z;
  return (zL + zR) * 0.5;
}


interface AnkleWriterState { hold: number; }
const _ankleWriter = new WeakMap<CS, AnkleWriterState>();
const _legTarget = new WeakMap<CS, Float64Array>();
const LEG_TARGET_KEYS: Array<[string, number]> = [
  ['hip_l', 0], ['hip_r', 0], ['knee_l', 1], ['knee_r', 1], ['foot_l', 0], ['foot_r', 0],
  ['hip_l', 2], ['hip_r', 2], ['knee_l', 2], ['knee_r', 2], ['foot_l', 2], ['foot_r', 2],
];
/** 每腿目标角：脚位/法庭姿势确定后只捕获一次，后续不更新。 */
function legTarget(w: World, st: CS): Float64Array {
  let t = _legTarget.get(st);
  if (!t) {
    t = new Float64Array(LEG_TARGET_KEYS.length);
    LEG_TARGET_KEYS.forEach(([n, a], i) => { const di = w.body.dofByName(n, a); t![i] = di >= 0 ? w.body.dofs[di]!.angle : 0; });
    _legTarget.set(st, t);
  }
  return t;
}


/** 新踝回正写手：每只脚独立的 foot/0 力矩，目标 CoP，burst/hold。
 *  不碰 hip/knee/上盘；不是直接写 GRF。 */
function squatAnkleWriter(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_AW ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released) return;
  const p = ctl.perception;
  const acc = Math.max(-5, Math.min(5, p.comAcc[2]!));
  const T = Math.max(0, Math.min(0.2, Number(env.SQC_AW_T ?? 0.08)));
  const eRaw = (ctl.sensors.com[2]! - footSupportCenterZ(w)) + ctl.sensors.comVel[2]! * T + 0.5 * acc * T * T;
  // CoM 监控器只做粗略参考；关节角触发/目标仍由下面精确层决定
  const cm = (globalThis as { __COM_MON?: { level?: number; predicted?: number } }).__COM_MON;
  const comUse = String(env.SQC_AW_COM ?? '1') === '1' && (cm?.level ?? 0) >= 1 && Number.isFinite(cm?.predicted);
  const cmReq = (globalThis as { __COM_MON?: { feet?: Array<{ request?: number }> } }).__COM_MON?.feet;
  const testReq = Number(env.SQC_AW_TEST_REQ ?? NaN);
  const testSide = String(env.SQC_AW_TEST_SIDE ?? '');
  const e = comUse ? cm!.predicted! : eRaw;
  const dead = Math.max(1e-4, Math.abs(Number(env.SQC_AW_DEAD ?? 0.002)));
  let aw = _ankleWriter.get(st);
  if (!aw) { aw = { hold: 0 }; _ankleWriter.set(st, aw); }
  const angleBand = Math.abs(Number(env.SQC_AW_ABAND_DEG ?? 1.0)) / 57.3;
  const velBand = Math.max(1e-3, Math.abs(Number(env.SQC_AW_VBAND ?? 0.3)));
  const ref = legTarget(w, st);
  const keys: Array<[string, number]> = [['hip_l',0],['hip_r',0],['knee_l',1],['knee_r',1],['foot_l',0],['foot_r',0]];
  let qMax = 0;
  keys.forEach(([n,a],i)=>{const di=w.body.dofByName(n,a);if(di<0)return;const d=w.body.dofs[di]!;qMax=Math.max(qMax,Math.abs(d.angle-ref[i]!)/angleBand,Math.abs(d.vel)/velBand);});
  if (qMax > 1 || Math.abs(e) > dead) aw.hold = Math.max(aw.hold, Math.abs(Number(env.SQC_AW_HOLD ?? 0.15)));
  else aw.hold = Math.max(0, aw.hold - w.dt);
  if (aw.hold <= 0) return;
  const lim = Math.abs(Number(env.SQC_AW_COP_LIMIT ?? 0.05));
  const cop = new Float64Array(3);
  for (const side of ['l', 'r'] as const) {
    const fi = w.body.dofByName(`foot_${side}`, 0); if (fi < 0) continue;
    const fz = w.body.footNormalForce(side, w.dt); if (fz < 1) continue;
    if (!w.body.footCoP(side, w.dt, cop)) continue;
    const sgnKey = side === 'l' ? 'SQC_AW_L_SIGN' : 'SQC_AW_R_SIGN';
    const kKey = side === 'l' ? 'SQC_AW_L_K' : 'SQC_AW_R_K';
    const sgn = Number(env[sgnKey] ?? 1) < 0 ? -1 : 1;
    const K = Math.abs(Number(env[kKey] ?? Number(env.SQC_AW_K ?? 1)));
    const cap = Math.abs(Number(env.SQC_AW_CAP ?? 30));
    const az = w.body.dofs[fi]!.anchorWorld[2]!;
    const req = cmReq?.[side === 'l' ? 0 : 1]?.request;
    const testOn = Number.isFinite(testReq) && (!testSide || testSide === side);
    if (Number.isFinite(testReq) && testSide && testSide !== side) continue;
    const target = testOn
      ? Math.max(az - lim, Math.min(az + lim, az + testReq))
      : String(env.SQC_AW_USE_REQ ?? '0') === '1' && Number.isFinite(req)
        ? Math.max(az - lim, Math.min(az + lim, req!))
        : Math.max(az - lim, Math.min(az + lim, az + Math.max(-lim, Math.min(lim, e))));
    const tau = Math.max(-cap, Math.min(cap, sgn * K * fz * (target - cop[1]!)));
    if (Math.abs(tau) > 1e-6) propose({ dof: fi, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.ankleWriter', channel: 'support' });
  }
}

/** 手动逐轴标定：只开一个关节轴，对目标角做 PD。默认关。 */
function squatJointCalib(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const axisName = String(env.SQC_CAL_AXIS ?? '');
  if (!axisName || baseState() !== 'squat' || !st.released) return;
  const m = /^(hip|knee|foot)([012])?([lr])?$/.exec(axisName);
  if (!m) return;
  const part = m[1]!;
  const ax = Number(m[2] ?? 0);
  const only = m[3] as 'l' | 'r' | undefined;
  const K = Math.abs(Number(env.SQC_CAL_K ?? 20));
  const B = Math.abs(Number(env.SQC_CAL_B ?? 2));
  const sign = Number(env.SQC_CAL_SIGN ?? 1) < 0 ? -1 : 1;
  const dead = Math.abs(Number(env.SQC_CAL_DEAD_DEG ?? 0.5)) / 57.3;
  const cap = Math.abs(Number(env.SQC_CAL_CAP ?? 30));
  const W = w.sk.massTotal * 9.81;
  const tgt = legTarget(w, st);
  const key = `${part}_${ax}`;
  const baseIndex: Record<string, number> = { hip0: 0, knee1: 2, foot0: 4, hip2: 6, knee2: 8, foot2: 10 };
  const bi = baseIndex[key];
  if (bi === undefined) return;
  for (const side of ['l', 'r'] as const) {
    if (only && only !== side) continue;
    if (w.body.footNormalForce(side, w.dt) < 0.1 * W) continue;
    const di = w.body.dofByName(`${part}_${side}`, ax);
    if (di < 0) continue;
    const d = w.body.dofs[di]!;
    const ref = tgt[bi + (side === 'l' ? 0 : 1)]!;
    const e = ref - d.angle;
    if (Math.abs(e) < dead) continue;
    const tau = Math.max(-cap, Math.min(cap, sign * (K * e - B * d.vel)));
    if (Math.abs(tau) > 1e-6) propose({ dof: di, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.jointCalib', channel: 'support' });
  }
}

/** 下盘倒向侧支撑偏置：侧倒那一条腿的髋/膝在矢状面多撑；
 *  只是支撑增益，不做上身回正，不读目标角。 */
function squatFallSideSupport(w: World, ctl: ControlModule, st: CS): Record<'l' | 'r', number> {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const lvl = Number((globalThis as { __COM_MON?: { level?: number } }).__COM_MON?.level ?? 0);
  const k = Math.abs(Number(env.SQC_FALL_SUPPORT ?? 0)) * (lvl >= 2 ? Math.abs(Number(env.SQC_COM_FALL_BOOST ?? 1.3)) : 1);
  if (k <= 0 || baseState() !== 'squat' || !st.released) return { l: 0, r: 0 };
  const tr = ctl.lateral.parts['trunk'];
  const eUpper = (tr?.roll ?? 0) - (st.trunkRoll0 ?? 0);
  const eK = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_FALL_TRUNK_K ?? 0);
  const p = ctl.perception;
  const accRaw = Number.isFinite(p.comAcc[2]!) ? p.comAcc[2]! : ctl.lateral.state.comAccZ;
  const accZ = Math.max(-5, Math.min(5, accRaw));
  const T = Math.max(0, Math.min(0.2, Number(env.SQC_PRED_T ?? 0.08)));
  const aGain = Number(env.SQC_PRED_A ?? 0.5);
  let footTarget = _footTarget.get(st);
  if (footTarget === undefined) { footTarget = footSupportCenterZ(w); _footTarget.set(st, footTarget); }
  const targetW = Math.max(0, Math.min(1, Number(env.SQC_TARGET_FEET_W ?? 1)));
  const targetZ = String(env.SQC_TARGET_FROM_FEET ?? '1') === '1' ? st.c0.z + targetW * (footTarget - st.c0.z) : st.c0.z;
  const e = (ctl.sensors.com[2]! - targetZ) + ctl.sensors.comVel[2]! * T + 0.5 * aGain * accZ * T * T + eK * eUpper;
  const fallSide = e < 0 ? 'r' : 'l';
  const buf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  const cap = Math.abs(Number(env.SQC_FALL_CAP ?? 40));
  const nonFall = Math.abs(Number(env.SQC_FALL_NON_FALL ?? 0.35));
  const W = w.sk.massTotal * 9.81;
  const out: Record<'l' | 'r', number> = { l: 0, r: 0 };
  const loadDemand = W * 0.15 * Math.max(0, Math.min(1, Math.abs(e) / 0.05));
  for (const side of ['l', 'r'] as const) {
    const isFall = side === fallSide;
    const fz = w.body.footNormalForce(side, w.dt);
    const target = W * 0.5 + (isFall ? 1 : -1) * loadDemand;
    const loadNeed = Math.max(0, Math.min(1, (target - fz) / Math.max(1, W * 0.15)));
    const sLat = isFall
      ? Math.max(0, Math.min(1, Math.abs(e) / 0.05))
      : Math.max(0, Math.min(1, loadNeed * nonFall));
    const sMin = isFall ? Math.abs(Number(env.SQC_FALL_S_MIN ?? 0.2)) : 0;
    const s = Math.max(sMin, sLat);
    out[side] = s;
    if (isFall) (globalThis as { __FALLS?: number }).__FALLS = s;
    for (const [part, ax, gain] of [
      ['hip', 2, k],
      ['knee', 2, k],
      ['foot', 2, Math.abs(Number(env.SQC_FALL_FOOT ?? 0))],
    ] as const) {
      if (gain <= 0) continue;
      const di = w.body.dofByName(`${part}_${side}`, ax);
      if (di < 0) continue;
      const base = buf ? buf[di] ?? 0 : 0;
      const tau = Math.max(-cap, Math.min(cap, base * gain * s));
      if (Math.abs(tau) > 1e-6) propose({ dof: di, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.fallSupport', channel: 'support' });
    }
  }
  (globalThis as { __FALLDBG?: unknown }).__FALLDBG = { t: st.t, e, side: fallSide, s: fcSafe(w) };
  return out;
}

/** 下盘踝支撑：独立写手，消费 fallSideSupport 的 per-leg s；不是基础力。 */
function squatFallAnkleSupport(w: World, st: CS, fallS: Record<'l' | 'r', number>): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (baseState() !== 'squat' || !st.released) return;
  const ankleK = Math.abs(Number(env.SQC_FALL_ANKLE ?? 0));
  if (ankleK <= 0) return;
  const aCap = Math.abs(Number(env.SQC_FALL_ANKLE_CAP ?? 12));
  const aSign = Number(env.SQC_FALL_ANKLE_SIGN ?? 1) < 0 ? -1 : 1;
  for (const side of ['l', 'r'] as const) {
    const fi = w.body.dofByName(`foot_${side}`, 0);
    if (fi < 0) continue;
    const tau = Math.max(-aCap, Math.min(aCap, aSign * ankleK * fallS[side]));
    if (Math.abs(tau) > 1e-6) propose({ dof: fi, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.fallAnkleSupport', channel: 'support' });
  }
}

function fcSafe(w: World): number { return Number((globalThis as { __FALLS?: number }).__FALLS ?? 0); }

interface UpperRightState { alpha: number; armed: boolean; }
const _upperRight = new WeakMap<CS, UpperRightState>();

// TODO(2026-10-28)：上盘回正后续主要消费 CoM 数据（predicted/level/每脚预算）；
//   当前先保留 trunk roll 安全区，不接 CoM 统筹。

/** 上身回正：预测 HAT roll，安全区内小力矩、区外大力矩，带滞回和渐入渐出。
 *  只写 spine1-3 轴0；预算受双脚 fz/CoP 余量限制，脚没余量就不发。 */
function squatUpperRighting(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_UPPER_RIGHTING ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released) return;
  let u = _upperRight.get(st);
  if (!u) { u = { alpha: 0, armed: false }; _upperRight.set(st, u); }
  const tr = ctl.lateral.parts['trunk'];
  const e = (tr?.roll ?? 0) - (st.trunkRoll0 ?? 0);
  const rate = ctl.sensors.torsoAngVel[0]!;
  const lead = Math.abs(Number(env.SQC_UR_LEAD ?? 0.12));
  const pred = e + lead * rate;
  const inner = Math.abs(Number(env.SQC_UR_INNER_DEG ?? 1.2)) / 57.3;
  const outer = Math.abs(Number(env.SQC_UR_OUTER_DEG ?? 3.5)) / 57.3;
  const mag = Math.abs(pred);
  if (!u.armed && mag >= outer) u.armed = true;
  else if (u.armed && mag <= inner * 0.7) u.armed = false;
  const target = u.armed ? 1 : 0;
  const tIn = Math.max(1e-3, Number(env.SQC_UR_IN_T ?? 0.2));
  const tOut = Math.max(1e-3, Number(env.SQC_UR_OUT_T ?? 0.35));
  const a = 1 - Math.exp(-w.dt / (target > u.alpha ? tIn : tOut));
  u.alpha += (target - u.alpha) * a;
  if (u.alpha < 1e-4) return;
  const fzL = w.body.footNormalForce('l', w.dt);
  const fzR = w.body.footNormalForce('r', w.dt);
  const W = w.sk.massTotal * 9.81;
  const footMargin = Math.max(0, Math.min(fzL, fzR) - 0.1 * W);
  const budget = Math.min(Math.abs(Number(env.SQC_UR_CAP ?? 18)), footMargin * Math.abs(Number(env.SQC_UR_FOOT_K ?? 0.04)));
  if (budget <= 1e-6) return;
  const K = Math.abs(Number(env.SQC_UR_K ?? 180));
  const D = Math.abs(Number(env.SQC_UR_D ?? 8));
  const urSign = Number(env.SQC_UR_SIGN ?? 1) < 0 ? -1 : 1;
  let tau = urSign * (K * pred + D * rate);
  tau = Math.max(-budget, Math.min(budget, tau));
  tau *= u.alpha;
  (globalThis as { __URDBG?: unknown }).__URDBG = { t: st.t, e, rate, pred, alpha: u.alpha, budget, tau };
  const wts = [0.25, 0.35, 0.40] as const;
  for (let k = 0; k < 3; k++) {
    const di = w.body.dofByName((['spine1','spine2','spine3'] as const)[k]!, 0);
    if (di < 0) continue;
    propose({ dof: di, kind: 'ext', pri: PRI.direct, tau: tau * wts[k]!, src: 'squat.upperRighting', channel: 'active' });
  }
}

/** 大腿轴向被动刚度：hip/1 的内外旋，单向、只在继续外旋时出力。
 *  小腿旋转由 knee/0（物理扭转轴）的 frontalPassive 承担。 */
function squatHipTwistPassive(w: World): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_HIP_TWIST_PASSIVE ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;
  const W = w.sk.massTotal * 9.81;
  const K = Math.abs(Number(env.SQC_HT_K ?? 15));
  const B = Math.abs(Number(env.SQC_HT_B ?? 1.5));
  const cap = Math.abs(Number(env.SQC_HT_CAP ?? 10));
  const slack = Math.abs(Number(env.SQC_HT_SLACK_DEG ?? 2)) / 57.3;
  for (const side of ['l', 'r'] as const) {
    if (w.body.footNormalForce(side, w.dt) < 0.1 * W) continue;
    const di = w.body.dofByName(`hip_${side}`, 1);
    if (di < 0) continue;
    const d = w.body.dofs[di]!;
    const away = d.angle * d.vel > 0;
    if (!away || Math.abs(d.angle) <= slack) continue;
    const sg = d.angle >= 0 ? 1 : -1;
    const tau = Math.max(-cap, Math.min(cap, -K * (d.angle - sg * slack) - B * d.vel));
    if (Math.abs(tau) > 1e-6) propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'squat.hipTwistPassive', channel: 'passive' });
  }
}

/** 正面被动刚度：hip/0、knee/0、foot/0 的中性弹簧+阻尼。
 *  只承重腿，不读 CoM；被动层单独记账。 */
function squatFrontalPassive(w: World): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_FRONTAL_PASSIVE ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;
  const W = w.sk.massTotal * 9.81;
  const dead = Math.abs(Number(env.SQC_FP_DEAD_DEG ?? 1.0)) / 57.3;
  const cap = Math.abs(Number(env.SQC_FP_CAP ?? 20));
  const gains: Array<['hip' | 'knee' | 'foot', number, number]> = [
    ['hip', Math.abs(Number(env.SQC_FP_HIP_K ?? 30)), Math.abs(Number(env.SQC_FP_HIP_B ?? 3))],
    ['knee', Math.abs(Number(env.SQC_FP_KNEE_K ?? 15)), Math.abs(Number(env.SQC_FP_KNEE_B ?? 2))],
    ['foot', Math.abs(Number(env.SQC_FP_FOOT_K ?? 8)), Math.abs(Number(env.SQC_FP_FOOT_B ?? 1))],
  ];
  for (const side of ['l', 'r'] as const) {
    if (w.body.footNormalForce(side, w.dt) < 0.1 * W) continue;
    for (const [part, K, B] of gains) {
      const di = w.body.dofByName(`${part}_${side}`, 0);
      if (di < 0) continue;
      const d = w.body.dofs[di]!;
      if (Math.abs(d.angle) < dead) continue;
      const oneWay = part === 'knee'
        ? String(env.SQC_FP_KNEE_ONE_WAY ?? '0') !== '0'
        : String(env.SQC_FP_ONE_WAY ?? '0') !== '0';
      if (oneWay && d.angle * d.vel <= 0) continue;
      const tau = Math.max(-cap, Math.min(cap, -K * d.angle - B * d.vel));
      if (Math.abs(tau) > 1e-6) propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'squat.frontalPassive', channel: 'passive' });
    }
  }
}

/** 髋关节软限位：只在大腿外展/轴转超过解剖范围后，产生单向弹簧+阻尼；
 *  不超过时限位力=0，不参与基础力，不是凭空维持某个姿态。 */
function squatHipSoftLimit(w: World): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_HIP_SOFT ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;
  const W = w.sk.massTotal * 9.81;
  const K = Math.abs(Number(env.SQC_HIP_SOFT_K ?? 30));
  const B = Math.abs(Number(env.SQC_HIP_SOFT_B ?? 3));
  const cap = Math.abs(Number(env.SQC_HIP_SOFT_CAP ?? 25));
  const abd = Math.abs(Number(env.SQC_HIP_SOFT_ABD_DEG ?? 20)) / 57.3;
  const rot = Math.abs(Number(env.SQC_HIP_SOFT_ROT_DEG ?? 15)) / 57.3;
  for (const side of ['l', 'r'] as const) {
    if (w.body.footNormalForce(side, w.dt) < 0.1 * W) continue;
    for (const [ax, lim] of [[0, abd], [1, rot]] as const) {
      const di = w.body.dofByName(`hip_${side}`, ax);
      if (di < 0) continue;
      const d = w.body.dofs[di]!;
      let tau = 0;
      if (d.angle > lim) tau = -K * (d.angle - lim) - B * d.vel;
      else if (d.angle < -lim) tau = -K * (d.angle + lim) - B * d.vel;
      tau = Math.max(-cap, Math.min(cap, tau));
      if (Math.abs(tau) > 1e-6) propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'squat.hipSoftLimit', channel: 'passive' });
    }
  }
}

/** 踝矢状前馈：按 GRF 把 CoP 从踝下推到 CoM 下。
 *  τ_ff = −Fz·(clamp(comX, footSupport) − ankleX)
 *  这是静态重力矩的前馈，不是 (com−cop) 反馈，避免正负高频翻。 */
function squatAnkleFeedforward(w: World, ctl: ControlModule): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_ANKLE_FF ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;
  const gain = Number(env.SQC_ANKLE_FF_GAIN ?? 1);
  const cap = Math.abs(Number(env.SQC_ANKLE_FF_CAP ?? 80));
  const stick = Math.abs(Number(env.SQC_ANKLE_FF_STICK ?? 0.10));
  const comX = ctl.sensors.com[0]!;
  for (const sd of ['l', 'r'] as const) {
    const i = w.body.dofByName(`foot_${sd}`, 2);
    if (i < 0) continue;
    const d = w.body.dofs[i]!;
    const fz = w.body.footNormalForce(sd, w.dt);
    if (fz <= 1) continue;
    const ax = d.anchorWorld[0]!;
    const targetCopX = Math.max(ax - stick, Math.min(ax + stick, comX));
    const tau = Math.max(-cap, Math.min(cap, -gain * fz * (targetCopX - ax)));
    if (Math.abs(tau) > 1e-6) propose({ dof: i, kind: 'ext', pri: PRI.action, tau, src: 'squat.ankleFF', channel: 'support' });
  }
}

/** 恢复 lateralLock 改过的关节限位；World.reset 不做这件事。 */
export function squatResetLimits(w: World): void {
  for (const [di, o] of _dofLimitsOrig) {
    const d = w.body.dofs[di];
    if (!d) continue;
    d.min = o.min;
    d.max = o.max;
    if (d.engineLimited && d.engineJoint) d.engineJoint.setLimits(d.rest + o.min, d.rest + o.max);
  }
  // ★ 2026-10-26 诊断钩子（用户："回正力需要脚多发力申请；不发力的话，踝就直接偏了"）：
  //   实测蹲姿里 `foot_*/0`（踝 roll）静止就被推到 **11.2°**，而限位是 ±14°
  //   ⇒ 只剩 2.8° 行程；同时力矩只用了预算的 7~40% —— **卡的是行程，不是力矩**。
  //   这个 env 只用于确认"行程是不是瓶颈"，默认 0 = 不改任何东西。
  const rollLim = Number(
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_FOOT_ROLL_LIM ?? 0,
  );
  if (rollLim > 0) {
    for (const n of ['foot_l', 'foot_r']) {
      const i = w.body.dofByName(n, 0);
      if (i < 0) continue;
      const d = w.body.dofs[i]!;
      const r = rollLim / 57.3;
      d.min = -r; d.max = r;
      if (d.engineLimited && d.engineJoint) d.engineJoint.setLimits(d.rest - r, d.rest + r);
    }
  }
}




export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  let mon = _comMonitors.get(st);
  if (!mon) { mon = new SquatComMonitor(); _comMonitors.set(st, mon); }
  (globalThis as { __COM_MON?: unknown }).__COM_MON = mon.step(w, ctl, st);
  squatPairBase(w, ctl);
  squatFrontalPassive(w);
  squatHipTwistPassive(w);
  squatSpinePassive(w);
  squatHipSoftLimit(w);
  squatHipLevelAssist(w);
  squatAnkleFeedforward(w, ctl);
  squatJointCalib(w, st);
  squatAnkleWriter(w, ctl, st);
  squatUpperRighting(w, ctl, st);
  const fallS = squatFallSideSupport(w, ctl, st);
  squatFallAnkleSupport(w, st, fallS);
}
