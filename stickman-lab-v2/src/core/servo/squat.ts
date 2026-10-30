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
import { SquatComMonitor, type SquatComReading } from './squatComMonitor';
import { ShankTaskPD } from './legTaskPD';
import { HipTaskPD } from './hipTaskPD';

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


const _taskPD = new WeakMap<CS, ShankTaskPD>();
interface ShankTarget { tilt: number; sag: number; copZ: number; copX: number; fz: number; comY: number; foot0: number; foot2: number }
const _taskTarget = new WeakMap<CS, { l: ShankTarget; r: ShankTarget }>();
const _hipPD = new WeakMap<CS, HipTaskPD>();
const _taskTargetSag = new WeakMap<CS, number>();

/** 两个 task PD 的唯一 active 入口（默认关）。 */
function squatTaskPD(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_TASKPD ?? '0') !== '1' || baseState() !== 'squat' || !st.released) return;
  let pd = _taskPD.get(st);
  if (!pd) {
    const n = (k: string, d: number): number => { const v = Number(env[k]); return Number.isFinite(v) ? v : d; };
    pd = new ShankTaskPD({ kp: n('SQC_TP_K', 30), kd: n('SQC_TP_B', 3), wKnee: n('SQC_TP_WK', 0.6), wCop: n('SQC_TP_WC', 1), kneeCap: n('SQC_TP_KCAP', 40), footCap: n('SQC_TP_FCAP', 20), footSagCap: n('SQC_TP_FCAPS', 90), kCop: n('SQC_TP_KCOP', 0.02), kCopSag: n('SQC_TP_KCOPS', 0.05), ankleKp: n('SQC_TP_AK', 40), ankleKd: n('SQC_TP_AB', 2), ankleRight: n('SQC_TP_AR', -1), ankleRightSag: n('SQC_TP_ARS', -1), ankleKpSag: n('SQC_TP_AKS', 40), ankleKdSag: n('SQC_TP_ABS', 2), sagAssistLat: n('SQC_TP_SAGLAT', 1), copUse: n('SQC_TP_COP_USE', 0.85), copSign: n('SQC_TP_COPSIGN', 1), wAnkle: n('SQC_TP_WA', 0.1), wAnkleSag: n('SQC_TP_WAS', 1.0), kCom: n('SQC_TP_KCOM', 10), footSign: n('SQC_TP_FSIGN', 1), kneeSign: n('SQC_TP_KSIGN', 1), kSupport: n('SQC_TP_KS', 300), kVert: n('SQC_TP_NVERT', 0.1), dSupport: n('SQC_TP_DS', 8), supportCap: n('SQC_TP_SCAP', 120), kpSag: n('SQC_TP_KSAG', 1000), kdSag: n('SQC_TP_BSAG', 4), wKneeSag: n('SQC_TP_WKS', 1), kneeSagCap: n('SQC_TP_KSCAP', 60) });
    _taskPD.set(st, pd);
  }
  let tgt = _taskTarget.get(st);
  if (!tgt) { tgt = { l: { tilt: 0, sag: NaN, copZ: NaN, copX: NaN, fz: NaN, comY: NaN, foot0: NaN, foot2: NaN }, r: { tilt: 0, sag: NaN, copZ: NaN, copX: NaN, fz: NaN, comY: NaN, foot0: NaN, foot2: NaN } }; _taskTarget.set(st, tgt); }
  const W = w.sk.massTotal * 9.81;
  const fzMin = 0.15 * W;
  const com = (globalThis as { __COM_MON?: SquatComReading }).__COM_MON;
  for (const side of ['l', 'r'] as const) {
    if (w.body.footNormalForce(side, w.dt) < 0.1 * W) continue;
    const ki = w.body.dofByName(`knee_${side}`, 2);
    const ai = w.body.dofByName(`foot_${side}`, 2);
    const fi = w.body.dofByName(`foot_${side}`, 0);
    if (ki < 0 || ai < 0 || fi < 0) continue;
    const kd = w.body.dofs[ki]!, ad = w.body.dofs[ai]!;
    const fbi = w.body.indexByKey.get(`foot_${side}`);
    const qf = fbi !== undefined ? w.body.bodies[fbi]!.rotation() : { x: 0, y: 0, z: 0, w: 1 };
    const up = { x: 2 * (qf.x * qf.y - qf.w * qf.z), y: 1 - 2 * (qf.x * qf.x + qf.z * qf.z), z: 2 * (qf.w * qf.x + qf.y * qf.z) };
    const sy = kd.anchorWorld[1]! - ad.anchorWorld[1]!, sz = kd.anchorWorld[2]! - ad.anchorWorld[2]!;
    const tilt = Math.atan2(sz * up.y - sy * up.z, Math.max(0.05, sy * up.y + sz * up.z));
    const f = ctl.sensors.feet[side === 'l' ? 0 : 1]!;
    const budget = com?.feet[side === 'l' ? 0 : 1];
    // 双脚共享 CoP 目标：用 monitor 的总 CoP 请求，不再各脚用释放 CoP 当独立目标
    const sharedCopZ = budget && budget.fz > fzMin ? budget.request : tgt[side].copZ;
    const sharedCopX = com?.copXTarget ?? tgt[side].copX;
    const ankleShare = 1;
    const ankleCopMin = budget?.copMin ?? ad.anchorWorld[2]! - 0.05;
    const ankleCopMax = budget?.copMax ?? ad.anchorWorld[2]! + 0.05;
    const ki1 = w.body.dofByName(`knee_${side}`, 1);
    const fd = w.body.dofs[fi]!;
    const dx = kd.anchorWorld[0]! - ad.anchorWorld[0]!;
    const dy = kd.anchorWorld[1]! - ad.anchorWorld[1]!;
    const sag = Math.atan2(dx, Math.max(0.05, dy));
    if (!Number.isFinite(tgt[side].sag)) {
      // 矢状小腿角：脚已固定，这是唯一需要捕获/反解的角度
      // 侧向目标 = 0：脚位置已定，小腿侧倾不应被当成目标
      tgt[side] = { tilt: 0, sag, copZ: f.copZ, copX: f.copX, fz: f.fz, comY: ctl.sensors.com[1]!, foot0: fd.angle, foot2: ad.angle };
    }
    const out = pd.step({ tilt, targetTilt: tgt[side].tilt, rateLat: kd.vel - ad.vel, sag, targetSag: tgt[side].sag, rateSag: kd.vel - ad.vel, fz: f.fz, fzMin, baseFz: tgt[side].fz, copZ: f.copZ, baseCopZ: sharedCopZ, copMin: ankleCopMin, copMax: ankleCopMax, copX: f.copX, baseCopX: sharedCopX, copMinX: budget?.copMinX ?? ad.anchorWorld[0]! - 0.06, copMaxX: budget?.copMaxX ?? ad.anchorWorld[0]! + 0.06, sideSign: side === 'l' ? 1 : -1, comPredicted: com?.predicted ?? 0, comY: ctl.sensors.com[1]!, targetComY: tgt[side].comY, comYRate: ctl.sensors.comVel[1]!, foot0Angle: fd.angle, foot2Angle: ad.angle, targetFoot0: tgt[side].foot0, targetFoot2: tgt[side].foot2, foot0Rate: fd.vel, foot2Rate: ad.vel });
    if (Math.abs(out.kneeTau) > 1e-6) propose({ dof: w.body.dofByName(`knee_${side}`, 1), kind: 'ext', pri: PRI.reflex, tau: out.kneeTau, src: 'squat.taskPD.shank.knee', channel: 'support' });
    if (Math.abs(out.footTau) > 1e-6) propose({ dof: fi, kind: 'ext', pri: PRI.reflex, tau: out.footTau, src: 'squat.taskPD.shank.foot', channel: 'support' });
    if (Math.abs(out.kneeSagTau) > 1e-6) propose({ dof: ki, kind: 'ext', pri: PRI.reflex, tau: out.kneeSagTau, src: 'squat.taskPD.shank.knee2', channel: 'support' });
    if (Math.abs(out.footSagTau) > 1e-6) propose({ dof: ai, kind: 'ext', pri: PRI.reflex, tau: out.footSagTau, src: 'squat.taskPD.shank.foot2', channel: 'support' });
    if (Math.abs(out.supportTau) > 1e-6) propose({ dof: ki, kind: 'ext', pri: PRI.reflex, tau: out.supportTau, src: 'squat.taskPD.shank.support', channel: 'support' });

    const ledK = w.executor.ledger[ki];
    const ledF = w.executor.ledger[fi];
    (globalThis as { __TP_DBG?: unknown }).__TP_DBG = {
      t: st.t, side, tilt, targetTilt: tgt[side].tilt, targetSag: tgt[side].sag, targetCop: tgt[side].copZ, err: tilt - tgt[side].tilt,
      sag, errSag: sag - tgt[side].sag,
      taskLat: out.taskLat, taskSag: out.taskSag, normal: out.normal, copZTarget: out.copZTarget, copXTarget: out.copXTarget, copZ: f.copZ, copX: f.copX,
      kneeTau: out.kneeTau, footTau: out.footTau, kneeSagTau: out.kneeSagTau, footSagTau: out.footSagTau, supportTau: out.supportTau, marginZ: out.marginZ, marginX: out.marginX, contact: out.contact, ankleCapZ: out.ankleCapZ, ankleCapX: out.ankleCapX,
      knee1Angle: ki1 >= 0 ? w.body.dofs[ki1]!.angle : 0, foot0Angle: fd.angle, foot2Angle: ad.angle, comZ: ctl.sensors.com[2]!, comY: ctl.sensors.com[1]!, targetComY: tgt[side].comY,
      appliedKnee: ledK?.applied ?? 0, appliedFoot: ledF?.applied ?? 0,
      fz: f.fz, copMin: budget?.copMin ?? 0, copMax: budget?.copMax ?? 0,
    };

  }
  // 矢状小腿目标左右取同一个合理角；侧向目标始终为 0
  if (Number.isFinite(tgt.l.sag) && Number.isFinite(tgt.r.sag)) {
    const mS = (tgt.l.sag + tgt.r.sag) / 2;
    tgt.l.sag = mS; tgt.r.sag = mS;
    tgt.l.tilt = 0; tgt.r.tilt = 0;
  }
}

interface UpperRightState { alpha: number; armed: boolean; }
const _upperRight = new WeakMap<CS, UpperRightState>();

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
  const fzMin = 0.15 * W;
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
  const fzMin = 0.15 * W;
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
  const fzMin = 0.15 * W;
  const dead = Math.abs(Number(env.SQC_FP_DEAD_DEG ?? 1.0)) / 57.3;
  const cap = Math.abs(Number(env.SQC_FP_CAP ?? 20));
  const gains: Array<['hip' | 'knee' | 'foot', number, number]> = [
    ['knee', Math.abs(Number(env.SQC_FP_KNEE_K ?? 15)), Math.abs(Number(env.SQC_FP_KNEE_B ?? 2))],
  ];
  // 髋 passive 是初始收紧/抵抗小扰动，不是主动回正；允许与 HipTask 并联
  gains.push(['hip', Math.abs(Number(env.SQC_FP_HIP_K ?? 30)), Math.abs(Number(env.SQC_FP_HIP_B ?? 3))]);
  // 脚掌不写目标角：脚负责接触/N，不追 0° 翻滚
  void env.SQC_FP_FOOT_K;
  for (const side of ['l', 'r'] as const) {
    if (w.body.footNormalForce(side, w.dt) < 0.1 * W) continue;
    for (const [part, K, B] of gains) {
      const di = w.body.dofByName(`${part}_${side}`, 0);
      if (di < 0) continue;
      // 主动 HipTask 正在回正时，passive hip/0 必须让位，不能和回正力对拉
      if (part === 'hip' && String(env.SQC_FP_HIP_YIELD ?? '1') === '1') {
        const active = (globalThis as { __HIP_ACTIVE?: { l: number; r: number } }).__HIP_ACTIVE;
        if (active && Math.abs(active[side]) > 0.5) continue;
      }
      const d = w.body.dofs[di]!;
      if (Math.abs(d.angle) < dead) continue;
      const oneWay = part === 'hip'
        ? String(env.SQC_FP_HIP_ONE_WAY ?? '1') !== '0'
        : part === 'knee'
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
  // HipTask 接管 hip/0、hip/1 时，软限位不得抢轴
  if (String(env.SQC_HIP_TASK ?? '0') === '1') return;
  if (baseState() !== 'squat') return;
  const W = w.sk.massTotal * 9.81;
  const fzMin = 0.15 * W;
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
function squatAnkleFeedforward(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_ANKLE_FF ?? '1') !== '1') return;
  if (baseState() !== 'squat' || !st.released) return;
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




/** 髋策略：XCoM/COM 误差 → 期望地面侧向力 → hip/1 力矩。 */
function squatHipTask(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_HIP_TASK ?? '0') !== '1' || baseState() !== 'squat' || !st.released) return;
  let pd = _hipPD.get(st);
  if (!pd) {
    const n = (k: string, d: number): number => { const v = Number(env[k]); return Number.isFinite(v) ? v : d; };
    pd = new HipTaskPD({ kx: n('SQC_HIP_KX', 2500), dv: n('SQC_HIP_DV', 180), ma: n('SQC_HIP_MA', 40), lever: n('SQC_HIP_LEVER', 0.18), cap: n('SQC_HIP_CAP', 300), budgetK: n('SQC_HIP_BUDGET', 0.8), pairSign: n('SQC_HIP_PAIR_SIGN', 1) });
    _hipPD.set(st, pd);
  }
  const li = w.body.dofByName('hip_l', 0), ri = w.body.dofByName('hip_r', 0);
  if (li < 0 || ri < 0) return;
  const lat = ctl.lateral.state;
  const mon = (globalThis as { __COM_MON?: SquatComReading }).__COM_MON;
  const fzL = w.body.footNormalForce('l', w.dt), fzR = w.body.footNormalForce('r', w.dt);
  const stt = _taskTarget.get(st);
  const baseFzL = stt?.l.fz ?? fzL;
  const baseFzR = stt?.r.fz ?? fzR;
  const fzMin = 0.15 * w.sk.massTotal * 9.81;
  const copMarginZL = mon?.feet[0] ? Math.min(mon.feet[0].copZ - mon.feet[0].copMin, mon.feet[0].copMax - mon.feet[0].copZ) : 0;
  const copMarginZR = mon?.feet[1] ? Math.min(mon.feet[1].copZ - mon.feet[1].copMin, mon.feet[1].copMax - mon.feet[1].copZ) : 0;
  const out = pd.step({
    xcomZ: Number.isFinite(lat.xiZ) ? lat.xiZ : (ctl.sensors.com[2] ?? 0),
    targetXcomZ: mon?.targetZ ?? 0,
    comVelZ: Number.isFinite(lat.comVelZ) ? lat.comVelZ : (ctl.sensors.comVel[2] ?? 0),
    comAccZ: Number.isFinite(lat.comAccZ) ? lat.comAccZ : 0,
    fzL, fzR, fzMin,
    baseFzL, baseFzR,
    copMarginZL, copMarginZR, loadDiff: fzL - fzR, hipYL: w.body.dofs[w.body.dofByName('hip_l', 0)]!.anchorWorld[1]!, hipYR: w.body.dofs[w.body.dofByName('hip_r', 0)]!.anchorWorld[1]!,
    onset: ctl.lateral.state.onset,
    ttb: ctl.lateral.state.ttb,
    confidence: ctl.lateral.state.confidence,
    leadT: Math.max(0.05, Math.min(0.35, (ctl.lateral.state.onset ? 0.2 : 0.1) + (Number.isFinite(ctl.lateral.state.ttb) ? Math.max(0, 0.3 - ctl.lateral.state.ttb) : 0))),
  });
  (globalThis as { __HIP_ACTIVE?: { l: number; r: number } }).__HIP_ACTIVE = { l: out.tauL, r: out.tauR };
  if (Math.abs(out.tauL) > 1e-6) propose({ dof: li, kind: 'ext', pri: PRI.reflex, tau: out.tauL, src: 'squat.hipTask.l', channel: 'support' });
  if (Math.abs(out.tauR) > 1e-6) propose({ dof: ri, kind: 'ext', pri: PRI.reflex, tau: out.tauR, src: 'squat.hipTask.r', channel: 'support' });
  (globalThis as { __HIP_DBG?: unknown }).__HIP_DBG = { t: st.t, xcom: out.error, force: out.force, tauL: out.tauL, tauR: out.tauR, budgetL: out.budgetL, budgetR: out.budgetR, support: out.support, loadTarget: out.loadTarget, fzL, fzR, hipL: w.body.dofs[li]!.angle, hipR: w.body.dofs[ri]!.angle, comZ: ctl.sensors.com[2]!, fzMin, appliedL: w.executor.ledger[li]?.applied ?? 0, appliedR: w.executor.ledger[ri]?.applied ?? 0, cmdL: w.executor.ledger[li]?.cmd ?? 0, cmdR: w.executor.ledger[ri]?.cmd ?? 0, passiveL: w.executor.ledger[li]?.passive ?? 0, passiveR: w.executor.ledger[ri]?.passive ?? 0, pairL: w.executor.ledger[li]?.pair ?? 0, pairR: w.executor.ledger[ri]?.pair ?? 0, limitL: w.executor.ledger[li]?.limit ?? 0, limitR: w.executor.ledger[ri]?.limit ?? 0, ffL: ctl.warner.drive.lastBreakdown[li]?.ff ?? 0, actL: ctl.warner.drive.lastBreakdown[li]?.act ?? 0, dampL: ctl.warner.drive.lastBreakdown[li]?.damp ?? 0, stiffL: ctl.warner.drive.lastBreakdown[li]?.stiff ?? 0 };
}

export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  let mon = _comMonitors.get(st);
  if (!mon) { mon = new SquatComMonitor(); _comMonitors.set(st, mon); }
  (globalThis as { __COM_MON?: unknown }).__COM_MON = mon.step(w, ctl, st);
  // 唯一回正链路：基础力 + 被动 + 两个回正 PD
  squatPairBase(w, ctl);
  squatFrontalPassive(w);
  squatHipTwistPassive(w);
  squatSpinePassive(w);
  squatTaskPD(w, ctl, st);
  squatHipTask(w, ctl, st);
}
