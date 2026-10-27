/** squat.ts —— 蹲下模块（2026-10-21 架构清理版）
 *
 * 蹲姿 = **一个写手**（squat.pairBase）+ **一个捕获点**（释放瞬间）+ **一套参数**（状态表）。
 *
 *   L0 基础力：释放瞬间按标准姿势算一次静态支撑力矩（子树+GRF），固定不变
 *   L1 回正力：pair 的 PD（kp·(ref−θ) − kd·ω），ref = 释放姿势目标角
 *   L2 阻尼：drive.step 的 td（唯一阻尼）
 *
 * 任何新增写手必须先在本文件登记，否则禁止。
 */

import { baseState, baseParams, baseAng } from './baseTable';
import { qOf, qRel, qToRotVec } from '../quat';
import { propose, PRI } from '../proposalBus';
import { mapMomentToAxes, sagittalBaseMoment, type AdapterAxis } from './ankleAxisAdapter';
import { ankleCoPTarget } from './ankleCoP';
import { squatJointLoad } from '../jointLoad';
import { backMusclePassive, backMuscleDifferential } from './backMuscles';

import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { FOOT, SPINE, NECK } from '../dofAxes';
import { RightingControllerV2 } from './rightingController';
import { SquatKneeAnkleController } from './squatKneeAnkle';
import { squatSagittalAssist } from './squatSagittal';
import { squatPassiveStiffness } from './squatPassiveStiffness';
import { squatHatOrientation } from './squatHatOrientation';
import { getSquatLoadBias } from './squatLoadBias';
import { stanceObserve, stanceZone } from './stance';
import { SquatNewBaseController } from './squatNewBase';
import { updateComfort, comfortGate } from './squatComfort';
import { logHipLevel } from './squatHipLevel';
import { allocateSquat, type AllocState } from './balanceAllocation';
import { courtStep, courtInject } from '../court';

/** 基础力缓存（释放瞬间捕获一次；离开蹲姿清空） */
/**
 * 蹲姿每帧写手链：pairBase → ankleVec → hipStab → supportClean.arm。
 * 基础力 = 法庭 setup 时 captureSquatBase() 解一次（ctl.warner.sqBaseBuf），每帧原样读；
 * 虚拟踝→髋支撑是基础力分量：τ_a 并进 ankleVec 的 Mdes，τ_k 并进 pairBase 的 knee/2，
 * 不是独立写手。回正力 = pair 的 kp·(ref−θ) − kd·ω（ref = 释放姿势）。
 */
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

/** 被动刚度模式的独立阻尼：只耗散速度，不定义位置。
 *  与 pair 分开，避免把阻尼塞进肌肉/求解器。 */
function squatPassiveDamp(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_PASSIVE_MODE ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released) return;
  const B = Math.abs(Number(env.SQC_PASSIVE_B ?? 0));
  const velDead = Math.abs(Number(env.SQC_PASSIVE_B_DEAD ?? 0.01));
  const cap = Math.abs(Number(env.SQC_PASSIVE_B_CAP ?? 6));
  for (const d of w.body.dofs) {
    if (d.engineMotor || d.preRing) continue;
    if (d.axis !== 0 && d.axis !== 2) continue;
    if (!/^(hip|knee|foot|ankle|spine|neck)_/.test(d.name)) continue;
    if (Math.abs(d.vel) < velDead) continue;
    const tau = Math.max(-cap, Math.min(cap, -B * d.vel));
    if (Math.abs(tau) > 1e-9) propose({ dof: d.dofIndex, kind: 'ext', pri: PRI.servo, tau, src: 'squat.passiveDamp', channel: 'passive' });
  }
}

// ── 蹲姿编排入口：法庭 + 注入（唯一入口）──
export {
  squatCourtSetup,
  courtStep,
  courtInject,
  type CourtState,
} from '../court';

/** 申请制侧向触发器：dHatHP（net force 高通）→ 额外踝侧向力矩。
 *  只加在 foot 力矩上，不动矢状 base+pair；默认关（SQC_LAT_TRIG=1 开）。 */
function lateralTriggerMx(ctl: ControlModule, st: CS): number {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_LAT_TRIG ?? '0') !== '1') return 0;
  if (baseState() !== 'squat' || !st.released) return 0;
  const p = ctl.perception;
  if (!p || p.confidence < Number(env.SQC_LAT_TRIG_CONF ?? 0.4)) return 0;
  const e = p.dHatHP[2]!;
  const dead = Math.abs(Number(env.SQC_LAT_TRIG_DEAD ?? 8));
  if (Math.abs(e) < dead) return 0;
  const sign = Number(env.SQC_LAT_TRIG_SIGN ?? 1) < 0 ? -1 : 1;
  const k = Number(env.SQC_LAT_TRIG_K ?? 1);
  const h = Math.max(0.3, p.com[1]!);
  const cap = Math.abs(Number(env.SQC_LAT_TRIG_CAP ?? 30));
  return Math.max(-cap, Math.min(cap, sign * k * e * h));
}

/** 蹲姿踝 3D 矢量转接口（SQC_ANKLE_VEC=1）：
 *  - 基础力矩只走矢状：M_base=(0,0,Mz)，x 分量恒 0；
 *  - 侧向回正允许 roll：M_fb_x；
 *  - 用当前真实踝轴 A=[u0,u1,u2] 解最小二乘；
 *  - 只在蹲姿释放后运行；站立完全不调用。 */

/** 踝/髋/背肌协调：本帧分配结果（供回读）。 */

const _allocState = new WeakMap<CS, AllocState>();
function squatUpdateAlloc(w: World, ctl: ControlModule, st: CS): void {
  const tr = ctl.lateral.parts['trunk'];
  let copMargin = 0;
  const cop = new Float64Array(3);
  for (const side of ['l', 'r'] as const) {
    if (!w.body.footCoP(side, w.dt, cop)) continue;
    const ai = w.body.dofByName(`foot_${side}`, 2);
    if (ai >= 0) copMargin = Math.max(copMargin, Math.abs(cop[1]! - w.body.dofs[ai]!.anchorWorld[2]!));
  }
  const comErr = ctl.sensors.com[2]! - st.c0.z;
  const a = allocateSquat({
    copMargin,
    trunkScore: tr?.score ?? 0,
    comErr,
    fall: false,
  });
  _allocState.set(st, a);

}

function squatAnkleVector(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_ANKLE_VEC ?? '1') === '0') return;
  if (baseState() !== 'squat' || !st.released) return;
  const body = w.body;
  const cop = new Float64Array(3);
  const FyHalf = w.sk.massTotal * 9.81 * 0.5;
  const kpRoll = Number(env.SQC_VEC_KP_ROLL ?? env.SQC_VEC_KP ?? 0);
  const kd = Number(env.SQC_VEC_KD ?? 0.2);
  const lambda = Number(env.SQC_VEC_LAMBDA ?? 1e-4);
  const debug = String(env.SQC_VEC_DBG ?? '0') === '1';
  const copXBase = st.c0.x;
  const useCP = String(env.SQC_SAG_CP ?? '1') === '1';
  const lambdaCp = Number(env.SQC_SAG_LAMBDA ?? 1.0);
  const useTorsion = String(env.SQC_TORSION ?? '1') === '1';
  const kpTorsion = Number(env.SQC_TORSION_KP ?? 20);
  const kdTorsion = Number(env.SQC_TORSION_KD ?? 2);
  const capTorsion = Math.abs(Number(env.SQC_TORSION_CAP ?? 10));
  const useAnkleCop = String(env.SQC_ANKLE_COP ?? '1') === '1';
  const zLimAlloc = Math.abs(Number(env.SQC_COP_Z_LIMIT ?? 0.09));
  const sideZ = (s: 'l' | 'r'): number => {
    const i = body.dofByName(`foot_${s}`, 2);
    return i >= 0 ? body.dofs[i]!.anchorWorld[2]! : 0;
  };
  const fzL = body.footNormalForce('l', w.dt);
  const fzR = body.footNormalForce('r', w.dt);
  const zL0 = sideZ('l'), zR0 = sideZ('r');
  const wsum = Math.max(1e-6, fzL + fzR);
  const wL = fzL / wsum, wR = fzR / wsum;
  const omega = Math.sqrt(9.81 / Math.max(0.3, ctl.sensors.com[1]!));
  const rawZ = (useAnkleCop || useCP)
    ? (1 + lambdaCp / omega) * (ctl.sensors.com[2]! + ctl.sensors.comVel[2]! / omega - st.c0.z)
    : 0;
  const totalZ = wL * zL0 + wR * zR0 + rawZ;
  let pL = Math.max(zL0 - zLimAlloc, Math.min(zL0 + zLimAlloc, zL0 + rawZ));
  let pR = Math.max(zR0 - zLimAlloc, Math.min(zR0 + zLimAlloc, zR0 + rawZ));
  for (let it = 0; it < 3; it++) {
    const err = totalZ - (wL * pL + wR * pR);
    if (Math.abs(err) < 1e-9) break;
    const roomL = err > 0 ? zL0 + zLimAlloc - pL : pL - (zL0 - zLimAlloc);
    const roomR = err > 0 ? zR0 + zLimAlloc - pR : pR - (zR0 - zLimAlloc);
    const sum = Math.max(1e-9, wL * Math.max(0, roomL) + wR * Math.max(0, roomR));
    const use = Math.max(-1, Math.min(1, err / sum));
    if (roomL > 0) pL += use * Math.min(Math.abs(err), Math.abs(roomL)) * Math.sign(err);
    if (roomR > 0) pR += use * Math.min(Math.abs(err), Math.abs(roomR)) * Math.sign(err);
    pL = Math.max(zL0 - zLimAlloc, Math.min(zL0 + zLimAlloc, pL));
    pR = Math.max(zR0 - zLimAlloc, Math.min(zR0 + zLimAlloc, pR));
  }
  const zAlloc: Record<'l' | 'r', number> = { l: pL, r: pR };
  const passiveOnly = String(env.SQC_PASSIVE_ONLY ?? '0') === '1';
  const passiveActive = String(env.SQC_PASSIVE_ACTIVE ?? '0') === '1';
  const servoOn = (!passiveOnly || passiveActive) && String(env.SQC_LAT_SERVO ?? '1') === '1' && ctl.lateralServo.active;
  const servoCop = servoOn ? ctl.lateralServo.copReq : 0;
  for (const side of ['l', 'r'] as const) {
    const fz = body.footNormalForce(side, w.dt);
    if (fz < 1 || !body.footCoP(side, w.dt, cop)) continue;
    const pi = body.dofByName(`foot_${side}`, 2);
    const ri = body.dofByName(`foot_${side}`, 0);
    if (pi < 0) continue;
    const dPitch = body.dofs[pi]!;
    const ankX = dPitch.anchorWorld[0]!, ankZ = dPitch.anchorWorld[2]!;
    const rx = cop[0]! - ankX, rz = cop[1]! - ankZ;
    const copZLim = Math.abs(Number(env.SQC_COP_Z_LIMIT ?? 0.09));
    const footLocal = String(env.SQC_FOOT_LOCAL ?? '0') === '1';
    const footAdm = Number(env.SQC_FOOT_ADM ?? 0.5);
    const footKs = Number(env.SQC_FOOT_KSPRING ?? 30);
    const footBs = Number(env.SQC_FOOT_BSPRING ?? 3);
    const footKcop = Number(env.SQC_FOOT_KCOP ?? 0.6);
    const footMxCap = Math.abs(Number(env.SQC_FOOT_MX_CAP ?? 40));
    let targetX = copXBase;
    let targetZ = cop[1]!;
    if (useAnkleCop || useCP) {
      const cp = ankleCoPTarget(
        ctl.sensors.com[0]!, ctl.sensors.com[2]!, ctl.sensors.comVel[0]!, ctl.sensors.comVel[2]!, ctl.sensors.com[1]!,
        copXBase, st.c0.z,
        { minX: ankX - 0.12, maxX: ankX + 0.12, minZ: ankZ - copZLim, maxZ: ankZ + copZLim },
        lambdaCp,
        ankZ,
      );
      targetX = cp.pX;
      // 伺服接管时 servoCop 就是总横向 CoP 目标（相对脚中心），不再叠加 rawZ；
      // 伺服 off 时保留基线 CP 跟踪。
      if (passiveOnly) {
        const eCom = ctl.sensors.com[2]! - st.c0.z;
        const vCom = ctl.sensors.comVel[2]!;
        const al = String(env.SQC_ALLOC ?? '0') === '1' ? _allocState.get(st) : undefined;
        const kpCop = Number(env.SQC_ANKLE_COP_KP ?? 0) * (al?.ankleScale ?? 1);
        const kdCop = Number(env.SQC_ANKLE_COP_KD ?? 0.2) * (al?.ankleScale ?? 1);
        const lim = Math.abs(Number(env.SQC_ANKLE_COP_LIMIT ?? 0.02));
        const pulseOn = String(env.SQC_ANKLE_PULSE ?? '0') === '1';
        let pulseHold = 0;
        if (pulseOn) {
          let ps = _anklePulse.get(st);
          if (!ps) { ps = { hold: 0 }; _anklePulse.set(st, ps); }
          const eThr = Math.abs(Number(env.SQC_ANKLE_PULSE_E ?? 0.003));
          const vThr = Math.abs(Number(env.SQC_ANKLE_PULSE_V ?? 0.02));
          const phaseOn = String(env.SQC_ANKLE_PULSE_PHASE ?? '1') === '1';
          const danger = phaseOn
            ? ((eCom * vCom > 0 && (Math.abs(eCom) > eThr || Math.abs(vCom) > vThr)) || Math.abs(eCom) > 3 * eThr)
            : (Math.abs(eCom) > eThr || Math.abs(vCom) > vThr);
          if (danger) ps.hold = Math.abs(Number(env.SQC_ANKLE_PULSE_HOLD ?? 0.16));
          else ps.hold = Math.max(0, ps.hold - w.dt);
          pulseHold = ps.hold;
        }
        const activePulse = !pulseOn || pulseHold > 0;
        const trScore = ctl.lateral.parts['trunk']?.score ?? 0;
        const trunkPriority = String(env.SQC_TRUNK_PRIORITY ?? '0') === '1' && trScore > Math.abs(Number(env.SQC_TRUNK_PRIORITY_TH ?? 1));
        const kpUse = activePulse && !trunkPriority ? kpCop : 0;
        const kdUse = trunkPriority ? 0 : kdCop;
        const copDemand = kpUse * eCom + kdUse * vCom;
        const off = Math.max(-lim, Math.min(lim, copDemand));
        targetZ = ankZ + off;
      } else {
        // ★★ R1（2026-10-26 旧写手归并）：默认改用 `zAlloc` —— 它就是本函数上面
        //   206-225 行按 Caron-2019 算出来的**侧向 CoP 目标**（含 per-foot 钳位 +
        //   fz 加权三次重分配）。旧行为 `ankZ + servoCop` 会把它**整段丢掉**，
        //   换成 `LateralServo` 的 `postCop`（±6 mm、符号实测是反的、而且它自己
        //   `return` 掉了真正的 CP 环）—— 这是文档里的 P1。
        //   保留 `SQC_ANKLE_COP_SRC=servo` 可一键回到旧链路，便于对账。
        targetZ = String(env.SQC_ANKLE_COP_SRC ?? 'alloc') === 'servo' ? ankZ + servoCop : zAlloc[side];
      }
      const biasZ = Number(env.SQC_ANKLE_BIAS ?? 0);
      if (Math.abs(biasZ) > 1e-9) targetZ = ankZ + biasZ;
      targetZ += getSquatLoadBias(st) * Math.abs(Number(env.SQC_HAT_ROLL_COP ?? 0.02));
      // ★ 2026-10-27：上身侧偏 → 脚 CoP 反作用（预测项，不新增写手）。
      //   预测下一拍 torso roll；脚 CoP 提前移动，把上身回正力接到地面。
      const reactK = Number(env.SQC_FOOT_ROLL_REACT ?? 0);
      if (Math.abs(reactK) > 1e-9) {
        const rNow = ctl.sensors.torsoTilt[1]!;
        const rRate = ctl.sensors.torsoAngVel[0]!;
        const r0 = st.trunkRoll0 ?? 0;
        const lead = Math.abs(Number(env.SQC_FOOT_ROLL_LEAD ?? 0.12));
        const rPred = (rNow - r0) + lead * rRate;
        const rMax = Math.abs(Number(env.SQC_FOOT_ROLL_REACT_MAX ?? 0.04));
        const sign = Number(env.SQC_FOOT_ROLL_REACT_SIGN ?? 1) < 0 ? -1 : 1;
        const react = Math.max(-rMax, Math.min(rMax, reactK * rPred));
        targetZ += sign * react;
      }
      targetZ = Math.max(ankZ - copZLim, Math.min(ankZ + copZLim, targetZ));
    }
    const Mbase = sagittalBaseMoment(FyHalf, targetX, ankX);   // 目标 CoP 随当前 CP 移动
    const rollSign = Number(env.SQC_COP_ROLL_SIGN ?? 1) < 0 ? -1 : 1;
    const rollK = Number(env.SQC_COP_ROLL_K ?? 0.9);
    let Mx: number;
    if (useAnkleCop && footLocal && ri >= 0) {
      const fd = body.dofs[ri]!;
      const phi0 = baseAng(`foot_${side}`, 0) ?? fd.angle;
      const pErr = targetZ - cop[1]!;
      const phiRef = phi0 + footAdm * pErr;
      const spring = footKs * (phiRef - fd.angle) - footBs * fd.vel;
      const copTerm = footKcop * fz * pErr;
      Mx = Math.max(-footMxCap, Math.min(footMxCap, rollSign * (spring + copTerm)));
    } else {
      Mx = useAnkleCop ? rollSign * rollK * fz * (targetZ - cop[1]!) : (kpRoll * fz * rz - kd * (ri >= 0 ? body.dofs[ri]!.vel : 0));
    }
    if (passiveOnly && String(env.SQC_ANKLE_COP_ACTIVE ?? '1') !== '1') Mx = 0;
    {
      const kLeg = Math.abs(Number(env.SQC_ANKLE_LEG_KP ?? 0));
      if (kLeg > 0) {
        let lr = _legRollRef.get(st);
        const shin = body.indexByKey.get(`shin_${side}`);
        if (shin !== undefined) {
          const qs = body.bodies[shin]!.rotation();
          const ux = 2 * (qs.x * qs.y - qs.w * qs.z);
          const uy = 1 - 2 * (qs.x * qs.x + qs.z * qs.z);
          const uz = 2 * (qs.w * qs.x + qs.y * qs.z);
          const roll = Math.atan2(uz, Math.hypot(ux, uy));
          if (!lr) { lr = { l: roll, r: roll }; _legRollRef.set(st, lr); }
          const refRoll = side === 'l' ? lr.l : lr.r;
          const wLeg = body.bodies[shin]!.angvel().x;
          const kdLeg = Math.abs(Number(env.SQC_ANKLE_LEG_KD ?? 2));
          const capLeg = Math.abs(Number(env.SQC_ANKLE_LEG_CAP ?? 20));
          const sgn = Number(env.SQC_ANKLE_LEG_SIGN ?? 1) < 0 ? -1 : 1;
          const tl = Math.max(-capLeg, Math.min(capLeg, sgn * (kLeg * (refRoll - roll) - kdLeg * wLeg)));
          Mx += tl;
        }
      }
    }
    const bssReactK = Number(env.SQC_FOOT_BSS_REACT ?? 0);
    if (Math.abs(bssReactK) > 1e-9) {
      const bssCap = Math.abs(Number(env.SQC_FOOT_BSS_REACT_CAP ?? 40));
      const bss = _bssCmd.get(st) ?? 0;
      Mx += Math.max(-bssCap, Math.min(bssCap, bssReactK * bss));
    }
    if (Mx > 40) Mx = 40; else if (Mx < -40) Mx = -40;
    const Mz = Mbase[2] - kd * dPitch.vel;
    const Mpre = musclePreMoment(w, side);   // 申请制前馈：虚拟肌肉线 → 踝力矩
    const latTrig = lateralTriggerMx(ctl, st);
    const fzShare = fz / Math.max(1e-6, fzL + fzR);
    // 虚拟支撑的扭转通道：髋/骨盆 twist → 踝/foot yaw 反扭矩
    let My = 0;
    if (useTorsion) {
      const hi1 = body.dofByName(`hip_${side}`, 1);
      if (hi1 >= 0) {
        const hd = body.dofs[hi1]!;
        const eY = (baseAng(`hip_${side}`, 1) ?? hd.angle) - hd.angle;
        My = Math.max(-capTorsion, Math.min(capTorsion, kpTorsion * eY - kdTorsion * hd.vel));
      }
    }
    if (String(env.SQC_PASSIVE_ANKLE_IN_VEC ?? '0') === '1') {
      const di0 = body.dofByName(`foot_${side}`, 0);
      if (di0 >= 0) {
        const d0 = body.dofs[di0]!;
        const ref0 = baseAng(`foot_${side}`, 0) ?? d0.angle;
        const paK = Math.abs(Number(env.SQC_PA_K ?? 100));
        const paB = Math.abs(Number(env.SQC_PA_B ?? 4));
        const paC = Math.abs(Number(env.SQC_PA_CAP ?? 5));
        Mx += Math.max(-paC, Math.min(paC, paK * (ref0 - d0.angle) - paB * d0.vel));
      }
    }
    const Mdes: [number, number, number] = [Mx + Mpre[0] + latTrig * fzShare, My, Mz + Mpre[2]];
    const axes: AdapterAxis[] = [];
    const idx: number[] = [];
    for (const k of [0, 1, 2]) {
      const i = body.dofByName(`foot_${side}`, k);
      if (i < 0) { axes.push({ u: [0, 0, 0], tauMax: 0, available: false }); idx.push(-1); continue; }
      const d = body.dofs[i]!;
      axes.push({ u: [d.axisWorld[0]!, d.axisWorld[1]!, d.axisWorld[2]!], tauMax: d.tauMax > 0 ? d.tauMax : 320, available: !d.preRing });
      idx.push(i);
    }
    const out = mapMomentToAxes(Mdes, axes, lambda);
    if (String(env.SQC_PASSIVE_ANKLE_IN_VEC ?? '0') === '1') {
      const di0 = body.dofByName(`foot_${side}`, 0);
      if (di0 >= 0) {
        const d0 = body.dofs[di0]!;
        const ref0 = baseAng(`foot_${side}`, 0) ?? d0.angle;
        const paK = Math.abs(Number(env.SQC_PA_K ?? 100));
        const paB = Math.abs(Number(env.SQC_PA_B ?? 4));
        const paC = Math.abs(Number(env.SQC_PA_CAP ?? 5));
        out.tau[0] = (out.tau[0] ?? 0) + Math.max(-paC, Math.min(paC, paK * (ref0 - d0.angle) - paB * d0.vel));
      }
    }
    for (let k = 0; k < 3; k++) {
      const i = idx[k]!;
      if (i < 0 || !axes[k]!.available) continue;
      propose({ dof: i, kind: 'ext', pri: PRI.reflex, tau: out.tau[k]!, src: 'squat.ankleVec', channel: 'active' });
    }
    if (debug) {
      const Mext: [number, number, number] = [0, 0, 0];
      const Mapp: [number, number, number] = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const i = idx[k]!;
        if (i < 0 || !axes[k]!.available) continue;
        const u = axes[k]!.u;
        const te = out.tau[k]!;
        Mext[0] += te * u[0]; Mext[1] += te * u[1]; Mext[2] += te * u[2];
        const ta = w.executor.ledger[i]!.applied;
        Mapp[0] += ta * u[0]; Mapp[1] += ta * u[1]; Mapp[2] += ta * u[2];
      }
      console.log(`VEC t=${st.t.toFixed(3)} ${side} fz=${fz.toFixed(0)} rx=${(rx * 1000).toFixed(0)} rz=${(rz * 1000).toFixed(0)} Mdes=(${Mdes.map((v) => v.toFixed(1)).join(',')}) Mpre=(${Mpre[0].toFixed(1)},0,${Mpre[2].toFixed(1)}) Fm=${Mpre[3].toFixed(0)} Mext=(${Mext.map((v) => v.toFixed(1)).join(',')}) Mapp=(${Mapp.map((v) => v.toFixed(1)).join(',')}) tau=(${out.tau.map((v) => v.toFixed(1)).join(',')}) res=${out.residualNorm.toFixed(2)}`);
    }
  }
}

/** 蹲姿专属虚拟肌肉线前馈（申请制）：
 *  内侧足 → 内侧膝的斜向内下力线，力 Fm 预计算；取它对踝的力矩作为侧向前馈。
 *  不是 hip/膝常值力矩；踝把 M_pre 变成 CoP 偏移，横向力由 GRF/摩擦出。
 *  预算：Fm ≤ SQC_MUSCLE_F_MAX，|M_pre| ≤ SQC_MUSCLE_M_MAX。 */
function musclePreMoment(w: World, side: 'l' | 'r'): [number, number, number, number] {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const fMax = Math.abs(Number(env.SQC_MUSCLE_F_MAX ?? 2000));
  const fRaw = Number(env.SQC_MUSCLE_F ?? -230);
  if (!Number.isFinite(fRaw) || fRaw === 0) return [0, 0, 0, 0];
  const Fm = Math.max(-fMax, Math.min(fMax, fRaw));
  const body = w.body;
  const ai = body.dofByName(`foot_${side}`, 2);
  const ki = body.dofByName(`knee_${side}`, 2);
  if (ai < 0 || ki < 0) return [0, 0, 0, 0];
  const a = body.dofs[ai]!.anchorWorld;
  const k = body.dofs[ki]!.anchorWorld;
  const med = side === 'l' ? -1 : 1;
  // 内侧附着点（相对踝/膝）：斜向内下（从膝指向足）
  const pFoot = { x: a[0]! + 0.02, y: a[1]! - 0.03, z: a[2]! + med * 0.03 };
  const pKnee = { x: k[0]!, y: k[1]!, z: k[2]! + med * 0.06 };
  const L = { x: pKnee.x - pFoot.x, y: pKnee.y - pFoot.y, z: pKnee.z - pFoot.z };
  const len = Math.hypot(L.x, L.y, L.z) || 1;
  const d = { x: L.x / len, y: L.y / len, z: L.z / len };
  // 肌肉对膝的拉力：从膝指向足（斜向内下）
  const F = { x: -Fm * d.x, y: -Fm * d.y, z: -Fm * d.z };
  const r = { x: pKnee.x - a[0]!, y: pKnee.y - a[1]!, z: pKnee.z - a[2]! };
  const M = {
    x: r.y * F.z - r.z * F.y,
    y: r.z * F.x - r.x * F.z,
    z: r.x * F.y - r.y * F.x,
  };
  const mMax = Math.abs(Number(env.SQC_MUSCLE_M_MAX ?? 50));
  const lim = (v: number): number => Math.max(-mMax, Math.min(mMax, v));
  const useMz = String(env.SQC_MUSCLE_MZ ?? '0') === '1';
  return [lim(M.x), 0, useMz ? lim(M.z) : 0, Fm];
}

const _hipDampState = new WeakMap<CS, { l: number; r: number }>();
const _latLockOrig = new WeakMap<CS, Map<number, { min: number; max: number }>>();
const _bssCmd = new WeakMap<CS, number>();
const _dofLimitsOrig = new Map<number, { min: number; max: number }>();



const _lowerKA = new WeakMap<CS, SquatKneeAnkleController>();

/** 下盘任务锁：蹲姿专属膝对齐 + 踝侧向，高刚度/高阻尼；
 *  不设上身安全区；所有反作用仍经脚。先作为可开关的第一版。 */
function squatLowerTask(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_LOWER_TASK ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;
  let c = _lowerKA.get(st);
  if (!c) {
    c = new SquatKneeAnkleController({
      hipKp: Math.abs(Number(env.SQC_LOWER_HIP_KP ?? 200)),
      hipCap: Math.abs(Number(env.SQC_LOWER_HIP_CAP ?? 30)),
      ankleKp: Math.abs(Number(env.SQC_LOWER_ANK_KP ?? 200)),
      ankleCap: Math.abs(Number(env.SQC_LOWER_ANK_CAP ?? 30)),
      dead: Math.abs(Number(env.SQC_LOWER_DEAD_DEG ?? 0.2)) / 57.3,
      loadScale: String(env.SQC_LOWER_LOAD ?? '1') !== '0',
      ki: Math.abs(Number(env.SQC_LOWER_KI ?? 0)),
      rate: Math.abs(Number(env.SQC_LOWER_RATE ?? 0)),
    });
    _lowerKA.set(st, c);
  }
  const r = c.step(w, 1);
  if (!r) return;
  for (const side of ['l', 'r'] as const) {
    const hi = w.body.dofByName(`hip_${side}`, 0);
    const fi = w.body.dofByName(`foot_${side}`, 0);
    if (hi >= 0) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau: side === 'l' ? r.cmd.hipL : r.cmd.hipR, src: 'squat.lowerTask.hip', channel: 'active' });
    if (fi >= 0) propose({ dof: fi, kind: 'ext', pri: PRI.reflex, tau: side === 'l' ? r.cmd.ankleL : r.cmd.ankleR, src: 'squat.lowerTask.ankle', channel: 'active' });
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
      const tau = Math.max(-cap, Math.min(cap, -K * d.angle - B * d.vel));
      if (Math.abs(tau) > 1e-6) propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'squat.spinePassive', channel: 'passive' });
    }
  }
}

/** 下盘倒向侧支撑偏置：侧倒那一条腿的髋/膝在矢状面多撑；
 *  只是支撑增益，不做上身回正，不读目标角。 */
function squatFallSideSupport(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const k = Math.abs(Number(env.SQC_FALL_SUPPORT ?? 0));
  if (k <= 0 || baseState() !== 'squat' || !st.released) return;
  const tr = ctl.lateral.parts['trunk'];
  const eUpper = (tr?.roll ?? 0) - (st.trunkRoll0 ?? 0);
  const eK = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_FALL_TRUNK_K ?? 0);
  const e = (ctl.sensors.com[2]! - st.c0.z) + ctl.sensors.comVel[2]! / Math.sqrt(9.81 / Math.max(0.3, ctl.sensors.com[1]!)) + eK * eUpper;
  const side = e < 0 ? 'r' : 'l';
  const s = Math.max(0, Math.min(1, Math.abs(e) / 0.05));
  const buf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  const cap = Math.abs(Number(env.SQC_FALL_CAP ?? 40));
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
  const ankleK = Math.abs(Number(env.SQC_FALL_ANKLE ?? 0));
  if (ankleK > 0) {
    const aSign = Number(env.SQC_FALL_ANKLE_SIGN ?? 1) < 0 ? -1 : 1;
    const fi = w.body.dofByName(`foot_${side}`, 0);
    if (fi >= 0) {
      const aCap = Math.abs(Number(env.SQC_FALL_ANKLE_CAP ?? 12));
      const tau = Math.max(-aCap, Math.min(aCap, aSign * ankleK * s));
      if (Math.abs(tau) > 1e-6) propose({ dof: fi, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.fallSupport.ankle', channel: 'support' });
    }
  }
}

/** 足底力控制（下盘第一优先）：脚自己把 CoP 移到 XCoM 下。
 *  不写 hip/knee；先由脚决定撑地力，腿只做姿态跟随。 */
function squatFootForceTask(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_FOOT_FORCE ?? '1') !== '1') return;
  if (baseState() !== 'squat' || !st.released) return;
  const K = Math.abs(Number(env.SQC_FF_K ?? 0.5));
  const cap = Math.abs(Number(env.SQC_FF_CAP ?? 30));
  const lim = Math.abs(Number(env.SQC_FF_LIMIT ?? 0.08));
  const sign = Number(env.SQC_FF_SIGN ?? 1) < 0 ? -1 : 1;
  const omega = Math.sqrt(9.81 / Math.max(0.3, ctl.sensors.com[1]!));
  const raw = (ctl.sensors.com[2]! - st.c0.z) + ctl.sensors.comVel[2]! / omega;
  const cop = new Float64Array(3);
  for (const side of ['l', 'r'] as const) {
    const fi = w.body.dofByName(`foot_${side}`, 2);
    if (fi < 0) continue;
    const d = w.body.dofs[fi]!;
    const fz = w.body.footNormalForce(side, w.dt);
    if (fz < 1 || !w.body.footCoP(side, w.dt, cop)) continue;
    const az = d.anchorWorld[2]!;
    const target = Math.max(az - lim, Math.min(az + lim, az + raw));
    const tau = Math.max(-cap, Math.min(cap, sign * K * fz * (target - cop[1]!)));
    if (Math.abs(tau) > 1e-6) propose({ dof: fi, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.footForce', channel: 'active' });
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

/** 正面被动刚度：只对 hip/0、knee/0、foot/0 做中性弹簧+阻尼。
 *  θ_rest 是机械中性角，不读 CoM，不做主动侧向回正；只在承重腿生效。 */
function squatFrontalPassive(w: World): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_FRONTAL_PASSIVE ?? '1') !== '1') return;
  if (baseState() !== 'squat') return;
  const W = w.sk.massTotal * 9.81;
  const dead = Math.abs(Number(env.SQC_FP_DEAD_DEG ?? 1.0)) / 57.3;
  const cap = Math.abs(Number(env.SQC_FP_CAP ?? 20));
  const gains: Array<['hip'|'knee'|'foot', number, number]> = [
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

/** 踝主动辅助：只写 foot/2（踝矢状），脚趾/足弓保持自主；力矩有独立上限。 */
function squatAnkleAssist(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_ANKLE_ASSIST ?? '0') !== '1') return;
  if (baseState() !== 'squat') return;
  const buf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  if (!buf) return;
  const sign = Number(env.SQC_ANKLE_ASSIST_SIGN ?? 1) < 0 ? -1 : 1;
  const gain = Number(env.SQC_ANKLE_ASSIST_GAIN ?? 1);
  const cap = Math.abs(Number(env.SQC_ANKLE_ASSIST_CAP ?? 30));
  const useCop = String(env.SQC_ANKLE_ASSIST_SRC ?? 'base') === 'cop';
  const rampT = Math.max(1e-3, Number(env.SQC_ANKLE_ASSIST_RAMP ?? 0.15));
  const ramp = Math.max(0, Math.min(1, (st.t - st.settle) / rampT));
  for (const sd of ['l', 'r'] as const) {
    const i = w.body.dofByName(`foot_${sd}`, 2);
    if (i < 0) continue;
    let tau = sign * gain * (buf[i] ?? 0);
    if (useCop) {
      const fz = w.body.footNormalForce(sd, w.dt);
      const copX = ctl.sensors.feet[sd === 'l' ? 0 : 1]!.copX;
      tau = sign * gain * (ctl.sensors.com[0]! - copX) * fz;
    }
    tau = ramp * Math.max(-cap, Math.min(cap, tau));
    if (Math.abs(tau) > 1e-6) propose({ dof: i, kind: 'ext', pri: PRI.action, tau, src: 'squat.ankleAssist', channel: 'support' });
  }
}

/** 承重相关被动锁：只锁 knee/1（frontal），不锁矢状；deadband + 载荷刚度。 */
function squatPassiveLock(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_LOCK ?? '1') !== '1') return;
  if (baseState() !== 'squat' || !st.released) return;
  const W = w.sk.massTotal * 9.81;
  const k0 = Number(env.SQC_LOCK_K0 ?? 20);
  const kLoad = Number(env.SQC_LOCK_KL ?? 800);
  const kd = Number(env.SQC_LOCK_KD ?? 2);
  const cap = Math.abs(Number(env.SQC_LOCK_CAP ?? 30));
  const dead = Math.abs(Number(env.SQC_LOCK_DEAD ?? 1.5)) / 57.3;
  const pairLatOn = String(env.SQC_PAIR_LAT ?? '0') === '1';
  const hipStrutOn = String(env.SQC_HIP_STRUT ?? '0') === '1' && String(env.SQC_UPPER_UNIFIED ?? '0') === '1' && String(env.SQC_HIP_LOCK_WITH_STRUT ?? '1') !== '1';
  const useHipLock = String(env.SQC_LOCK_HIP ?? '1') === '1' && !pairLatOn && !hipStrutOn;
  const hipDamp = Number(env.SQC_HIP_DAMP ?? 1000);
  const hipLockCap = Math.abs(Number(env.SQC_HIP_LOCK_CAP ?? 50));
  const hipLockKLoad = Number(env.SQC_HIP_LOCK_KLOAD ?? 150);
  const hipCommonCap = Math.abs(Number(env.SQC_HIP_COMMON_CAP ?? 1e9));
  const hipDiffCap = Math.abs(Number(env.SQC_HIP_DIFF_CAP ?? hipLockCap));
  const hipRaw = new Map<'l' | 'r', number>();
  let ds = _hipDampState.get(st);
  // ★★ 2026-10-26 修 bug（用户："蹲下法庭一上来就侧翻"）：
  //   原来这里初值是 `{l:0, r:0}`，于是**第一帧** `vz = (hz − 0)/dt`，
  //   而 `hz = hip.anchorWorld[2] ≈ ±0.16 m`、`dt = 1/480` ⇒ `vz ≈ 77 m/s`，
  //   再乘 `hipDamp=1000` ⇒ −77000 N·m，被 cap 一夹就变成 **±cap 的一对纯力偶**。
  //   实测：释放第一帧 `τhip_l=+21.4 / τhip_r=−25.7`（common≈−2, diff≈+24），
  //   下一帧就掉到 ±6 —— 这就是"一上来就侧翻"的真身，不是参数调坏了，是初值错了。
  //   用 NaN 当"还没有上一步"的哨兵（同 `_pbDyPrev = null` 的做法），首帧 vz 记 0。
  if (!ds) { ds = { l: Number.NaN, r: Number.NaN }; _hipDampState.set(st, ds); }
  const deadH = Math.abs(Number(env.SQC_LOCK_HIP_DEAD ?? 2.0)) / 57.3;
  // ★ 2026-10-27 力链回读：passiveLock.spine 会和 backSpine 对拉，
  //   16Ns 时 spine 功率从 +57 变 -92，roll 反而降不下来。默认让位给 backSpine。
  const useSpineLock = String(env.SQC_LOCK_SPINE ?? '0') === '1';
  const kpSpine = Number(env.SQC_LOCK_SPINE_KP ?? 100);
  const kdSpine = Number(env.SQC_LOCK_SPINE_KD ?? 5);
  const capSpine = Math.abs(Number(env.SQC_LOCK_SPINE_CAP ?? 30));
  for (const side of ['l', 'r'] as const) {
    const ki = w.body.dofByName(`knee_${side}`, 1);
    if (ki < 0) continue;
    const fz = w.body.footNormalForce(side, w.dt);
    if (fz < 0.1 * W) continue;
    const d = w.body.dofs[ki]!;
    const e = (baseAng(`knee_${side}`, 1) ?? d.angle) - d.angle;
    if (Math.abs(e) < dead) continue;
    const Kl = k0 + kLoad * (fz / W);
    const tau = Math.max(-cap, Math.min(cap, Kl * e - kd * d.vel));
    if (Math.abs(tau) > 1e-9) propose({ dof: ki, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.passiveLock', channel: 'safety' });
    if (useHipLock) {
      for (const [ax, kh] of [[0, 10]] as const) {
        const cH = hipLockCap;
        const hi = w.body.dofByName(`hip_${side}`, ax);
        if (hi < 0) continue;
        const hd = w.body.dofs[hi]!;
        const eh = (baseAng(`hip_${side}`, ax) ?? hd.angle) - hd.angle;
        const hz = hd.anchorWorld[2]!;
        const prev = side === 'l' ? ds.l : ds.r;
        // ★ 首帧 prev=NaN ⇒ 速度记 0；同时给 vz 上物理限（髋锚点侧向速度不可能超过 3 m/s），
        //   任何"跨局/换状态残留"都不该再靠阻尼项造出力矩。
        const vz = Number.isFinite(prev) ? Math.max(-3, Math.min(3, (hz - prev) / Math.max(1e-6, w.dt))) : 0;
        if (side === 'l') ds.l = hz; else ds.r = hz;
        if (Math.abs(eh) < deadH && Math.abs(hipDamp * vz) < 1e-9) continue;
        const Kh = kh + hipLockKLoad * (fz / W);
        const th = Math.max(-cH, Math.min(cH, Kh * eh - kd * hd.vel - hipDamp * vz));
        hipRaw.set(side, th);
      }
    }
  }
  if (useHipLock && hipRaw.size > 0) {
    const tl = hipRaw.get('l') ?? 0;
    const tr = hipRaw.get('r') ?? 0;
    const common = Math.max(-hipCommonCap, Math.min(hipCommonCap, (tl + tr) / 2));
    const diff = Math.max(-hipDiffCap, Math.min(hipDiffCap, (tl - tr) / 2));
    const hipTest = Number(env.SQC_HIP_TEST ?? 0);
    const outL = common + diff + hipTest;
    const outR = common - diff + hipTest;
    if (Math.abs(outL) > 1e-9) {
      const hi = w.body.dofByName('hip_l', 0);
      if (hi >= 0) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau: outL, src: 'squat.passiveLock.hip', channel: 'safety' });
    }
    if (Math.abs(outR) > 1e-9) {
      const hi = w.body.dofByName('hip_r', 0);
      if (hi >= 0) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau: outR, src: 'squat.passiveLock.hip', channel: 'safety' });
    }
    if (String(env.SQC_HIP_COMMON_DBG ?? '0') === '1' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
      console.log(`HIPCM t=${w.clock.toFixed(2)} raw=${tl.toFixed(1)},${tr.toFixed(1)} common=${common.toFixed(1)} diff=${diff.toFixed(1)} out=${outL.toFixed(1)},${outR.toFixed(1)}`);
    }
  }
  if (String(env.SQC_HIP_TWIST_LOCK ?? '1') === '1') {
    const kt = Number(env.SQC_HIP_TWIST_K ?? 120);
    const bt = Number(env.SQC_HIP_TWIST_B ?? 8);
    const ct = Math.abs(Number(env.SQC_HIP_TWIST_CAP ?? 20));
    const dt = Math.abs(Number(env.SQC_HIP_TWIST_DEAD ?? 0.5)) / 57.3;
    for (const side of ['l', 'r'] as const) {
      if (w.body.footNormalForce(side, w.dt) < 0.1 * W) continue;
      const hi = w.body.dofByName(`hip_${side}`, 1);
      if (hi < 0) continue;
      const d = w.body.dofs[hi]!;
      const e = (baseAng(`hip_${side}`, 1) ?? d.angle) - d.angle;
      if (Math.abs(e) < dt) continue;
      const tau = Math.max(-ct, Math.min(ct, kt * e - bt * d.vel));
      if (Math.abs(tau) > 1e-9) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.hipTwistLock', channel: 'safety' });
    }
  }
  if (String(env.SQC_KNEE_TWIST_LOCK ?? '1') === '1') {
    const kt = Number(env.SQC_KNEE_TWIST_K ?? 80);
    const bt = Number(env.SQC_KNEE_TWIST_B ?? 5);
    const ct = Math.abs(Number(env.SQC_KNEE_TWIST_CAP ?? 15));
    const dt = Math.abs(Number(env.SQC_KNEE_TWIST_DEAD ?? 0.5)) / 57.3;
    for (const side of ['l', 'r'] as const) {
      if (w.body.footNormalForce(side, w.dt) < 0.1 * W) continue;
      const ki = w.body.dofByName(`knee_${side}`, 0);
      if (ki < 0) continue;
      const d = w.body.dofs[ki]!;
      const e = (baseAng(`knee_${side}`, 0) ?? d.angle) - d.angle;
      if (Math.abs(e) < dt) continue;
      const tau = Math.max(-ct, Math.min(ct, kt * e - bt * d.vel));
      if (Math.abs(tau) > 1e-9) propose({ dof: ki, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.kneeTwistLock', channel: 'safety' });
    }
  }
  if (useSpineLock) {
    for (const nm of ['spine1', 'spine2', 'spine3'] as const) {
      for (const ax of [0, 1] as const) {
        const di = w.body.dofByName(nm, ax);
        if (di < 0) continue;
        const d = w.body.dofs[di]!;
        const e = (baseAng(nm, ax) ?? d.angle) - d.angle;
        if (Math.abs(e) < 0.1 / 57.3) continue;
        const tau = Math.max(-capSpine, Math.min(capSpine, kpSpine * e - kdSpine * d.vel));
        if (Math.abs(tau) > 1e-9) propose({ dof: di, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.passiveLock.spine', channel: 'safety' });
      }
    }
  }
}

/** 载荷门控的侧向硬限位：承重腿锁住 hip/0、knee/1、foot/0 的侧向自由度；
 *  卸载腿恢复原限位，允许摆腿。 */
function squatLateralLock(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (baseState() !== 'squat' || !st.released) return;
  // ★ 2026-10-27：任务级硬锁默认关。锁只保留最后的物理止挡；
  //   控制上的“锁”由 passiveLock 的 K(Fz)+阻尼（自身力）承担，不再夹 hip0/knee1/foot0。
  const lockOn = String(env.SQC_LAT_LOCK ?? '0') === '1';
  const sphereLock = String(env.SQC_LAT_LOCK_SPHERE ?? '0') === '1';
  const W = w.sk.massTotal * 9.81;
  const pairLatOn = String(env.SQC_PAIR_LAT ?? '0') === '1';
  const upperHipOn = pairLatOn;
  const hipW = upperHipOn ? 0 : Math.abs(Number(env.SQC_LAT_LOCK_HIP_DEG ?? 1.5)) / 57.3;
  const kneeW = Math.abs(Number(env.SQC_LAT_LOCK_KNEE_DEG ?? 1.0)) / 57.3;
  const footW = Math.abs(Number(env.SQC_LAT_LOCK_FOOT_DEG ?? 2.0)) / 57.3;
  const hipTwistW = Math.abs(Number(env.SQC_LAT_LOCK_HIP_TWIST_DEG ?? 0)) / 57.3;
  const kneeTwistW = Math.abs(Number(env.SQC_LAT_LOCK_KNEE_TWIST_DEG ?? 0)) / 57.3;
  let orig = _latLockOrig.get(st);
  if (!orig) {
    orig = new Map();
    _latLockOrig.set(st, orig);
  }
  const setLim = (name: string, ax: number, width: number, loaded: boolean): void => {
    const di = w.body.dofByName(name, ax);
    if (di < 0) return;
    const d = w.body.dofs[di]!;
    let o = orig.get(di);
    if (!o) {
      let g = _dofLimitsOrig.get(di);
      if (!g) { g = { min: d.min, max: d.max }; _dofLimitsOrig.set(di, g); }
      o = g;
      orig.set(di, o);
    }
    if (width <= 0) {
      d.min = o.min;
      d.max = o.max;
      if (d.engineLimited && d.engineJoint) d.engineJoint.setLimits(d.rest + o.min, d.rest + o.max);
      return;
    }
    const on = lockOn && loaded && (d.engineLimited || sphereLock);
    const c = baseAng(name, ax) ?? d.angle;
    const lo = on ? c - width : o.min;
    const hi = on ? c + width : o.max;
    if (d.engineLimited && d.engineJoint) {
      d.engineJoint.setLimits(d.rest + lo, d.rest + hi);
    } else {
      d.min = lo;
      d.max = hi;
    }
  };
  for (const side of ['l', 'r'] as const) {
    const loaded = w.body.footNormalForce(side, w.dt) >= 0.1 * W;
    setLim(`hip_${side}`, 0, hipW, loaded);
    setLim(`hip_${side}`, 1, hipTwistW, loaded);
    setLim(`knee_${side}`, 1, kneeW, loaded);
    setLim(`knee_${side}`, 0, kneeTwistW, loaded);
    setLim(`foot_${side}`, 0, footW, loaded);
  }
}

/** 侧向伺服 L3：把 LateralServo 的 ΔFz 请求分配到 knee/2 与 hip/2。 */
/** 蹲姿每物理步：法庭（目标/判死）+ 当前写手链 */
/** 被动踝侧向弹簧：只对 foot/0 位移/速度反应，不写 CoP。 */
function squatPassiveAnkle(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_PASSIVE_ONLY ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released) return;
  const K = Math.abs(Number(env.SQC_PA_K ?? 20));
  const B = Math.abs(Number(env.SQC_PA_B ?? 2));
  const cap = Math.abs(Number(env.SQC_PA_CAP ?? 1.5));
  for (const side of ['l', 'r'] as const) {
    const di = w.body.dofByName(`foot_${side}`, FOOT.invert);
    if (di < 0) continue;
    const d = w.body.dofs[di]!;
    const ref = baseAng(`foot_${side}`, FOOT.invert) ?? d.angle;
    const tau = Math.max(-cap, Math.min(cap, K * (ref - d.angle) - B * d.vel));
    if (Math.abs(tau) > 1e-9) propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'squat.passiveAnkle', channel: 'passive' });
  }
}

/** 被动托髋：hip↔foot 的压缩支柱，只承压、不拉伸、不主动发力。
 *  等大反向作用在髋和脚，脚压地、髋被托；不是关节力矩。 */
const _hipStrutRef = new WeakMap<CS, { l: number; r: number; zl: number; zr: number }>();
function squatHipStrut(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_HIP_STRUT ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released) return;
  const body = w.body;
  const W = w.sk.massTotal * 9.81;
  let refs = _hipStrutRef.get(st);
  if (!refs) {
    const hy = (s: 'l' | 'r'): number => {
      const i = body.dofByName(`hip_${s}`, 0);
      return i >= 0 ? body.dofs[i]!.anchorWorld[1]! : 0;
    };
    refs = { l: hy('l'), r: hy('r'), zl: st.hipRefL ?? 0, zr: st.hipRefR ?? 0 };
    _hipStrutRef.set(st, refs);
  }
  const K = Math.abs(Number(env.SQC_HIP_STRUT_K ?? 4000));
  const B = Math.abs(Number(env.SQC_HIP_STRUT_B ?? 200));
  const Fmax = Math.abs(Number(env.SQC_HIP_STRUT_FMAX_BW ?? 0.3)) * W;
  for (const side of ['l', 'r'] as const) {
    const hi = body.dofByName(`hip_${side}`, 0);
    const fi = body.indexByKey.get(`foot_${side}`);
    if (hi < 0 || fi === undefined) continue;
    const hd = body.dofs[hi]!;
    const hb = body.bodies[hd.b1]!;
    const fb = body.bodies[fi]!;
    const p = hd.anchorWorld;
    const ref = side === 'l' ? refs.l : refs.r;
    const e = ref - p[1]!;
    const vy = hb.linvel().y;
    const F = Math.max(0, Math.min(Fmax, K * e - B * vy));
    if (F < 1e-6) continue;
    const imp = F * w.dt;
    hb.applyImpulseAtPoint({ x: 0, y: imp, z: 0 }, { x: p[0]!, y: p[1]!, z: p[2]! }, true);
    fb.applyImpulseAtPoint({ x: 0, y: -imp, z: 0 }, { x: p[0]!, y: p[1]!, z: p[2]! }, true);
    if (String(env.SQC_HIP_STRUT_LAT ?? '0') === '1') {
      const Kz = Math.abs(Number(env.SQC_HIP_STRUT_LAT_K ?? 5000));
      const Bz = Math.abs(Number(env.SQC_HIP_STRUT_LAT_B ?? 300));
      const zref = side === 'l' ? refs.zl : refs.zr;
      const zerr = zref - p[2]!;
      let Fz = Math.max(-Fmax, Math.min(Fmax, Kz * zerr - Bz * hb.linvel().z));
      const alloc = String(env.SQC_ALLOC ?? '0') === '1' ? _allocState.get(st) : undefined;
      const kRes = Math.abs(Number(env.SQC_HIP_STRUT_RES ?? 0));
      if (alloc && alloc.mode === 'hipAssist' && kRes > 0) {
        const eCom = w.perception.com[2]! - st.c0.z;
        const vCom = w.perception.comVel[2]!;
        const sgn = Number(env.SQC_HIP_STRUT_RES_SIGN ?? 1) < 0 ? -1 : 1;
        Fz += sgn * kRes * alloc.w.hip * (eCom + 0.2 * vCom) * Fmax;
        Fz = Math.max(-Fmax, Math.min(Fmax, Fz));
      }
      const impZ = Fz * w.dt;
      hb.applyImpulseAtPoint({ x: 0, y: 0, z: impZ }, { x: p[0]!, y: p[1]!, z: p[2]! }, true);
      fb.applyImpulseAtPoint({ x: 0, y: 0, z: -impZ }, { x: p[0]!, y: p[1]!, z: p[2]! }, true);
    }
    if (String(env.SQC_HIP_STRUT_DBG ?? '0') === '1' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
      console.log(`HIPSTRUT t=${w.clock.toFixed(2)} ${side} e=${(e * 1000).toFixed(2)} F=${F.toFixed(0)}`);
    }
  }
}

/** HAT 相对姿态（四元数版）：thorax 相对 pelvis，目标 court。 */
const _hatRel = new WeakMap<CS, { rel: Float64Array; head: Float64Array }>();
function relVec(w: World, aKey: string, bKey: string): Float64Array | null {
  const ai = w.body.indexByKey.get(aKey);
  const bi = w.body.indexByKey.get(bKey);
  if (ai === undefined || bi === undefined) return null;
  const qa = qOf(w.body.bodies[ai]!.rotation());
  const qb = qOf(w.body.bodies[bi]!.rotation());
  const out = new Float64Array(3);
  qToRotVec(qRel(qa, qb), out);
  return out;
}
function squatNeckHeadRel(w: World, st: CS, force = false): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (!force && String(env.SQC_NECK_HEAD_REL ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released) return;
  const thoraxKey = w.body.indexByKey.has('spine4') ? 'spine4' : 'spine3';
  const cur = relVec(w, thoraxKey, 'head');
  if (!cur) return;
  let ref = _hatRel.get(st);
  if (!ref) {
    ref = { rel: new Float64Array(3), head: new Float64Array(cur) };
    const h = relVec(w, 'torso', thoraxKey);
    if (h) ref.rel.set(h);
    _hatRel.set(st, ref);
  }
  const eR = ref.head[0]! - cur[0]!;
  const eP = ref.head[2]! - cur[2]!;
  const hi = w.body.indexByKey.get('head');
  const hv = hi !== undefined ? w.body.bodies[hi]!.angvel() : { x: 0, y: 0, z: 0 };
  const K = Math.abs(Number(env.SQC_NH_K ?? 300));
  const B = Math.abs(Number(env.SQC_NH_B ?? 5));
  const cap = Math.abs(Number(env.SQC_NH_CAP ?? 6));
  for (const [ax, e, wv] of [[NECK.lateral, eR, hv.x], [NECK.flex, eP, hv.z]] as const) {
    const di = w.body.dofByName('neck', ax);
    if (di < 0) continue;
    const tau = Math.max(-cap, Math.min(cap, K * e - B * wv));
    propose({ dof: di, kind: 'ext', pri: PRI.direct, tau, src: 'squat.neckHeadRel', channel: 'active' });
  }
}

/** UpperBodyServo：L1 被动 HAT/neck/hip + L2 髋策略，统一入口。 */
function squatUpperBodyUnified(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_UPPER_UNIFIED ?? '0') !== '1') return;
  squatBackSpineServo(w, ctl, st);
  squatHatOrientation(w, ctl, st);
  squatNeckHeadRel(w, st, true);
  backMusclePassive(w, st);
}

/** 背肌+脊柱联合侧向伺服：救 HAT 侧弯，不推腿/髋。 */
const _backSpineRef = new WeakMap<CS, Float64Array>();
const _trunkSenseRef = new WeakMap<CS, { z: number; roll: number }>();
const _bssTrim = new WeakMap<CS, { z: number; r: number }>();
const _bssRescue = new WeakMap<CS, boolean>();
const _legRollRef = new WeakMap<CS, { l: number; r: number }>();
const _anklePulse = new WeakMap<CS, { hold: number }>();
function squatBackSpineServo(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_BACK_SPINE_SERVO ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released) return;
  const thoraxKey = w.body.indexByKey.has('spine4') ? 'spine4' : 'spine3';
  const cur = relVec(w, 'torso', thoraxKey);
  if (!cur) return;
  let ref = _backSpineRef.get(st);
  if (!ref) { ref = new Float64Array(cur); _backSpineRef.set(st, ref); }
  const ti = w.body.indexByKey.get(thoraxKey);
  const wv = ti !== undefined ? w.body.bodies[ti]!.angvel() : { x: 0, y: 0, z: 0 };
  let eR = ref[0]! - cur[0]!;
  let eZ = 0;
  let vz = 0;
  let rate = wv.x;
  if (String(env.SQC_BSS_SENSE ?? '0') !== '0') {
    const tr = ctl.lateral.parts['trunk'];
    if (tr) {
      let sr = _trunkSenseRef.get(st);
      if (!sr) { sr = { z: st.trunkZ0 ?? tr.z, roll: st.trunkRoll0 ?? tr.roll }; _trunkSenseRef.set(st, sr); }
      const sgn = Number(env.SQC_BSS_SENSE_SIGN ?? 1) < 0 ? -1 : 1;
      if (String(env.SQC_BSS_SENSE) === '1') eR = sgn * (sr.roll - tr.roll);
      eZ = sgn * (sr.z - tr.z);
      vz = tr.vzRel;
      rate = wv.x;
    }
  }
  const rawER = eR;
  const rawEZ = eZ;
  const dz = Math.abs(Number(env.SQC_BSS_DEAD_Z ?? 0)) / 1000;
  const dr = Math.abs(Number(env.SQC_BSS_DEAD_R ?? 0)) / 57.3;
  const dead = (v: number, d: number): number => (Math.abs(v) <= d ? 0 : v - Math.sign(v) * d);
  const rollInside = Math.max(0, Math.min(1, Number(env.SQC_BSS_ROLL_INSIDE ?? 0)));
  eR = Math.abs(eR) <= dr && rollInside > 0 ? eR * rollInside : dead(eR, dr);
  eZ = dead(eZ, dz);
  if (String(env.SQC_BSS_TRIM ?? '0') === '1' && st.t >= Math.abs(Number(env.SQC_BSS_TRIM_START ?? 2.2))) {
    let tr = _bssTrim.get(st);
    if (!tr) { tr = { z: 0, r: 0 }; _bssTrim.set(st, tr); }
    const comZ = ctl.sensors.com[2]!;
    const comErr = comZ - (st.c0 ? st.c0.z : comZ);
    const safe = Math.abs(comErr) < Math.abs(Number(env.SQC_BSS_TRIM_COM ?? 0.03));
    const quiet = Math.abs(vz) < Math.abs(Number(env.SQC_BSS_TRIM_V ?? 0.03))
      && Math.abs(rate) < Math.abs(Number(env.SQC_BSS_TRIM_RATE ?? 0.15))
      && Math.abs(rawEZ) < Math.abs(Number(env.SQC_BSS_TRIM_ERR ?? 0.008));
    const kiZ = Math.abs(Number(env.SQC_BSS_TRIM_KI_Z ?? 0.15));
    const kiR = Math.abs(Number(env.SQC_BSS_TRIM_KI_R ?? 0.5));
    const capZ = Math.abs(Number(env.SQC_BSS_TRIM_CAP_Z ?? 3)) / 1000;
    const capR = Math.abs(Number(env.SQC_BSS_TRIM_CAP_R ?? 0.5)) / 57.3;
    if (safe && quiet) {
      tr.z += kiZ * rawEZ * w.dt;
      tr.r += kiR * rawER * w.dt;
    }
    if (rawEZ * tr.z < 0) tr.z *= Math.exp(-w.dt / 0.5);
    if (rawER * tr.r < 0) tr.r *= Math.exp(-w.dt / 0.5);
    tr.z = Math.max(-capZ, Math.min(capZ, tr.z));
    tr.r = Math.max(-capR, Math.min(capR, tr.r));
    eZ += tr.z;
    eR += tr.r;
  }
  const allocOn = String(env.SQC_ALLOC ?? '0') === '1';
  const allocTrunk = allocOn ? (_allocState.get(st)?.trunkScale ?? 1) : 1;
  const e = eR + eZ * Number(env.SQC_BSS_EZ_K ?? 5);
  backMuscleDifferential(w, st, e, rate + vz * Number(env.SQC_BSS_EZ_D ?? 0));
  if (String(env.SQC_BSS_FORCE ?? '0') === '1' && ti !== undefined) {
    const pi = w.body.indexByKey.get('torso');
    if (pi !== undefined) {
      const tb = w.body.bodies[ti]!;
      const pb = w.body.bodies[pi]!;
      const Fmax = Math.abs(Number(env.SQC_BSS_FMAX ?? 0.2)) * w.sk.massTotal * 9.81;
      const eCom = (st.c0 ? st.c0.z : ctl.sensors.com[2]!) - ctl.sensors.com[2]!;
      const F = Math.max(-Fmax, Math.min(Fmax,
        allocTrunk * Math.abs(Number(env.SQC_BSS_FZ ?? 5000)) * eZ
        + Math.abs(Number(env.SQC_BSS_COM_K ?? 0)) * eCom
        - Math.abs(Number(env.SQC_BSS_FZD ?? 300)) * vz));
      const imp = F * w.dt;
      tb.applyImpulse({ x: 0, y: 0, z: imp }, true);
      pb.applyImpulse({ x: 0, y: 0, z: -imp }, true);
    }
  }
  // 单写手两档：安全区边界由脚预算动态算，不再固定 4°。
  // τ_budget ≈ min(fzL,fzR) 的侧向余量；HAT 重力矩 ≈ mUpper·g·h·sin(θ_safe)
  const flSafe = w.body.footNormalForce('l', w.dt);
  const frSafe = w.body.footNormalForce('r', w.dt);
  const Wsafe = w.sk.massTotal * 9.81;
  const marginSafe = Math.max(0, Math.min(flSafe, frSafe) - 0.1 * Wsafe);
  const footLS = w.body.dofByName('foot_l', 0);
  const footRS = w.body.dofByName('foot_r', 0);
  const stanceSafe = Math.max(0.05, footLS >= 0 && footRS >= 0
    ? Math.abs(w.body.dofs[footLS]!.anchorWorld[2]! - w.body.dofs[footRS]!.anchorWorld[2]!) : 0.15);
  const safeCopM = Math.abs(Number(env.SQC_BSS_SAFE_COP_M ?? 0.05));
  const tauBudget = marginSafe * Math.min(stanceSafe * 0.5, safeCopM);
  let mUpper = 0;
  for (const b of w.sk.bodies) if (/^(torso|spine|neck|head|arm|hand)/.test(b.key)) mUpper += b.mass;
  const hipY = footLS >= 0 ? (w.body.dofs[w.body.dofByName('hip_l', 0)]?.anchorWorld[1] ?? 0) : 0;
  const torsoI = w.body.indexByKey.get('torso');
  const torsoY = torsoI !== undefined ? w.body.bodies[torsoI]!.translation().y : 1;
  const leverH = Math.max(0.2, torsoY - hipY);
  const dynamicOn = String(env.SQC_BSS_SAFE_DYNAMIC ?? '1') === '1';
  const safeFixed = Math.abs(Number(env.SQC_BSS_SAFE_DEG ?? 4.0)) / 57.3;
  const safeMin = Math.abs(Number(env.SQC_BSS_SAFE_MIN_DEG ?? 2.5)) / 57.3;
  const safeMax = Math.abs(Number(env.SQC_BSS_SAFE_MAX_DEG ?? 8.0)) / 57.3;
  let safeDeg = safeFixed;
  if (dynamicOn && mUpper > 1e-6 && leverH > 1e-6) {
    const ratio = Math.max(0, Math.min(1, tauBudget / (mUpper * 9.81 * leverH)));
    safeDeg = Math.max(safeMin, Math.min(safeMax, Math.asin(ratio)));
  }
  const safeDead = Math.abs(Number(env.SQC_BSS_RESCUE_DEAD ?? 0.5)) / 57.3;
  const safeHyst = Math.abs(Number(env.SQC_BSS_RESCUE_HYST ?? 0.5)) / 57.3;
  const safeLead = Math.abs(Number(env.SQC_BSS_RESCUE_LEAD ?? 0.12));
  const trSafe = ctl.lateral.parts['trunk'];
  const hatSafe = trSafe?.roll ?? 0;
  const hatSafeErr = Math.abs(hatSafe - (st.trunkRoll0 ?? 0));
  const sMag = hatSafeErr + safeLead * Math.abs(ctl.sensors.torsoAngVel[0]!);
  let rescueOn = _bssRescue.get(st) ?? false;
  if (!rescueOn && sMag >= Math.max(0, safeDeg - safeDead)) rescueOn = true;
  else if (rescueOn && sMag <= Math.max(0, safeDeg - safeDead - safeHyst)) rescueOn = false;
  _bssRescue.set(st, rescueOn);
  if (rescueOn && String(env.SQC_BSS_RESCUE_ERR ?? 'spine') === 'hat') {
    const sign = Number(env.SQC_BSS_HAT_SIGN ?? 1) < 0 ? -1 : 1;
    eR = sign * ((st.trunkRoll0 ?? 0) - hatSafe);
    rate = ctl.sensors.torsoAngVel[0]!;
  }
  const K = Math.abs(Number(rescueOn ? (env.SQC_BSS_RESCUE_K ?? 4800) : (env.SQC_BSS_K ?? 1200)));
  const B = Math.abs(Number(env.SQC_BSS_B ?? 20));
  const Kz = Math.abs(Number(env.SQC_BSS_KZ ?? 0));
  const Bz = Math.abs(Number(env.SQC_BSS_BZ ?? 0));
  const cap = Math.abs(Number(rescueOn ? (env.SQC_BSS_RESCUE_CAP ?? 120) : (env.SQC_BSS_CAP ?? 20)));
  const eComTau = (st.c0 ? st.c0.z : ctl.sensors.com[2]!) - ctl.sensors.com[2]!;
  let tau = Math.max(-cap, Math.min(cap, K * eR - B * rate + Kz * eZ + Math.abs(Number(env.SQC_BSS_COM_TAU ?? 0)) * eComTau - Bz * vz));
  _bssCmd.set(st, tau);
  if (String(env.SQC_BSS_CAL ?? '0') === '1' && w.clock >= 2.2 && w.clock < 2.3) {
    tau = Number(env.SQC_BSS_CAL_TAU ?? 10);
  }
  if (String(env.SQC_BSS_DBG ?? '0') === '1' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
    const tr = ctl.lateral.parts['trunk'];
    const hb = w.body.indexByKey.get('head');
    const tb = w.body.indexByKey.get('torso');
    const hz = hb !== undefined ? w.body.bodies[hb]!.translation().z * 1000 : NaN;
    const tz = tb !== undefined ? w.body.bodies[tb]!.translation().z * 1000 : NaN;
    console.log(`BSSDBG t=${w.clock.toFixed(2)} rescue=${rescueOn ? 1 : 0} safe=${(safeDeg * 57.3).toFixed(1)}° budget=${tauBudget.toFixed(1)} trZ=${(tr?.z ? tr.z * 1000 : NaN).toFixed(1)} trR=${(tr?.roll ? tr.roll * 57.3 : NaN).toFixed(2)} eR=${(eR * 57.3).toFixed(2)} eZ=${(eZ * 1000).toFixed(1)} tr=${(_bssTrim.get(st)?.z ? _bssTrim.get(st)!.z * 1000 : 0).toFixed(1)} hZ=${hz.toFixed(1)} tZ=${tz.toFixed(1)} comZ=${(ctl.sensors.com[2]! * 1000).toFixed(1)} rate=${rate.toFixed(2)} tau=${tau.toFixed(1)}`);
  }
  const wts = [0.25, 0.35, 0.40] as const;
  for (let k = 0; k < 3; k++) {
    const name = (['spine1', 'spine2', 'spine3'] as const)[k]!;
    const di = w.body.dofByName(name, SPINE.lateral);
    if (di < 0) continue;
    propose({ dof: di, kind: 'ext', pri: PRI.direct, tau: tau * wts[k]!, src: 'squat.backSpine', channel: 'active' });
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




const _rc2 = new WeakMap<CS, RightingControllerV2>();
const _rc2Seen = new WeakSet<CS>();
const _newBase = new WeakMap<CS, SquatNewBaseController>();
const _ka = new WeakMap<CS, SquatKneeAnkleController>();
/** 新架构低层：小力度回正 residual。 */
function squatRightingV2(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_RC2 ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released) return;
  let rc = _rc2.get(st);
  if (!rc) {
    rc = new RightingControllerV2({
      hipKp: Number(env.SQC_RC2_H_KP ?? 80),
      hipKd: Number(env.SQC_RC2_H_KD ?? 8),
      hipCap: Number(env.SQC_RC2_H_CAP ?? 20),
      backKp: Number(env.SQC_RC2_B_KP ?? 120),
      backKd: Number(env.SQC_RC2_B_KD ?? 4),
      backCap: Number(env.SQC_RC2_B_CAP ?? 20),
      hipSign: Number(env.SQC_RC2_H_SIGN ?? 1),
      backSign: Number(env.SQC_RC2_B_SIGN ?? 1),
    });
    _rc2.set(st, rc);
  }
  const r = rc.step(w, ctl, st);
  if (!r) return;
  if (!_rc2Seen.has(st)) {
    _rc2Seen.add(st);
    console.log(`[RC2] active A=${env.SQC_RC2_A ?? '1'} H=${env.SQC_RC2_H ?? '1'} B=${env.SQC_RC2_B ?? '1'} K=${env.SQC_RC2_K ?? '0'} KA=${env.SQC_RC2_KA ?? '0'}`);
  }
  const enA = String(env.SQC_RC2_A ?? '1') !== '0';
  const enH = String(env.SQC_RC2_H ?? '1') !== '0';
  const enK = String(env.SQC_RC2_K ?? '0') === '1';
  const enKA = String(env.SQC_RC2_KA ?? '0') === '1';
  let ka: ReturnType<SquatKneeAnkleController['step']> = null;
  if (enK || enKA) {
    let c = _ka.get(st);
    if (!c) {
      c = new SquatKneeAnkleController({
        hipKp: Number(env.SQC_RC2_KP ?? 50),
        hipCap: Number(env.SQC_RC2_K_CAP ?? 1),
        ankleKp: Number(env.SQC_RC2_AKP ?? 50),
        ankleCap: Number(env.SQC_RC2_A_CAP ?? 1),
        dead: Number(env.SQC_RC2_K_DEAD ?? 0),
        loadScale: String(env.SQC_RC2_K_LOAD ?? '1') !== '0',
        ki: Number(env.SQC_RC2_KI ?? 10),
        rate: Number(env.SQC_RC2_K_RATE ?? 20),
      });
      _ka.set(st, c);
    }
    const kneeGate = String(env.SQC_RC2_K_ALWAYS ?? '1') === '1' ? 1 : r.safe.gate;
    ka = c.step(w, kneeGate);
  }
  const cg = comfortGate(st);
  const copN = enA ? r.cmd.copOffset * 1000 * 0.3 * cg : 0; // Nm, 实测 0.3Nm/mm
  const ankleL = enKA && ka ? ka.cmd.ankleL : 0;
  const ankleR = enKA && ka ? ka.cmd.ankleR : 0;
  const hipN = enH ? r.cmd.hipTau * cg : 0;
  const slipScaleL = ctl.perception.feet[0]?.slip ? Math.abs(Number(env.SQC_SLIP_SCALE ?? 0.2)) : 1;
  const slipScaleR = ctl.perception.feet[1]?.slip ? Math.abs(Number(env.SQC_SLIP_SCALE ?? 0.2)) : 1;
  const hipKL = enK && ka ? ka.cmd.hipL * slipScaleL * cg : 0;
  const hipKR = enK && ka ? ka.cmd.hipR * slipScaleR * cg : 0;
  for (const side of ['l', 'r'] as const) {
    const ai = w.body.dofByName(`foot_${side}`, 0);
    const hi = w.body.dofByName(`hip_${side}`, 0);
    if (ai >= 0) propose({ dof: ai, kind: 'ext', pri: PRI.reflex, tau: copN + (side === 'l' ? ankleL : ankleR), src: 'squat.rc2', channel: 'active' });
    if (hi >= 0) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau: (side === 'l' ? hipN : -hipN) + (side === 'l' ? hipKL : hipKR), src: 'squat.rc2', channel: 'active' });
  }
  if (String(env.SQC_RC2_DBG ?? '0') === '1' && Math.floor(w.clock * 20) !== Math.floor((w.clock - w.dt) * 20)) {
    const kL = ka ? (ka.state.kneeL * 1000).toFixed(1) : '-';
    const kR = ka ? (ka.state.kneeR * 1000).toFixed(1) : '-';
    const lL = ka ? (ka.state.loadL * 100).toFixed(0) : '-';
    const lR = ka ? (ka.state.loadR * 100).toFixed(0) : '-';
    console.log(`RC2 t=${w.clock.toFixed(2)} gate=${r.safe.gate.toFixed(2)} e=${(r.state.e * 1000).toFixed(2)} trZ=${(r.state.trunkZ * 1000).toFixed(1)} trR=${(r.state.trunkR * 57.3).toFixed(2)} kneeL=${kL}mm kneeR=${kR}mm load=${lL}/${lR}% cop=${(r.cmd.copOffset * 1000).toFixed(2)} hip=${r.cmd.hipTau.toFixed(2)} hipOut=${(hipN + hipKL).toFixed(2)} copN=${copN.toFixed(2)}`);
  }
}

const STANCE_ZONE_ON = String(
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.STANCE_ZONE ?? '1',
) !== '0';

export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  // ★ 2026-10-26（安全区档位·第一步）：把侧向档位算出来，但**什么也不做**。
  //   为什么放最前面：此时 `applyAll` 已经把上一步真正下发的力矩写进 ledger，
  //   `stanceObserve` 读到的是**上一步的实测**，正是它要的。
  //   为什么不会破坏：`stanceZone` 只改 stance 模块自己的计数器，
  //   **不 propose、不碰 drive/executor/body** ⇒ 物理逐位不变（用 probe-golden 指纹证明）。
  //   等验证完"档位切得干净、不抖"，再让它接管增益（第二步，那时指纹才会变）。
  if (STANCE_ZONE_ON) stanceZone(stanceObserve(w, ctl));
  // ★ 诊断档：只留 pairBase 基础力 + drive.td，不跑任何回正/上位写手。
  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_BASE_ONLY ?? '0') === '1') {
    squatPairBase(w, ctl);
    squatFrontalPassive(w);
    squatSpinePassive(w);
    squatHipSoftLimit(w);
    squatAnkleFeedforward(w, ctl);
    squatUpperRighting(w, ctl, st);
    squatFallSideSupport(w, ctl, st);
    squatFootForceTask(w, ctl, st);
    squatAnkleAssist(w, ctl, st);
    return;
  }
  if (st.handoff) {
    if ((st.handoffT ?? 0) < 0.2) {
      // ★ H1：用 squat 自己的保持写手撑住捕获姿势。
      //   manual.setAngle 在蹲姿被 drive 的 tex=0 清零（等于没写），H1 曾因此
      //   整段无腿/踝支撑 → 重力 ramp 时膝踝塌陷、脊柱被甩出 20° 直接判倒。
      //   pairBase 已用捕获角 ref + 捕获基础力；ankleVec 是蹲姿踝唯一写手。
      squatPairBase(w, ctl);
      squatAnkleFeedforward(w, ctl);
  squatAnkleVector(w, ctl, st);
      squatHipStrut(w, st);
      squatPassiveLock(w, st);
      squatLateralLock(w, st);
      return;
    }
    st.handoff = false;
  }
  updateComfort(w, ctl, st);
  logHipLevel(w, st);
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_PASSIVE_ONLY ?? '0') === '1') {
    squatPairBase(w, ctl);
    squatFrontalPassive(w);
    squatSpinePassive(w);
    squatHipSoftLimit(w);
    squatAnkleFeedforward(w, ctl);
    if (String(env.SQC_UPPER_UNIFIED ?? '0') === '1') {
      squatUpdateAlloc(w, ctl, st);
      squatUpperBodyUnified(w, ctl, st);
      squatPassiveDamp(w, st);
      squatPassiveStiffness(w, st);
      if (String(env.SQC_PASSIVE_ANKLE_UNIFIED ?? '1') === '1') squatPassiveAnkle(w, st);
      let nb = _newBase.get(st);
      if (!nb) { nb = new SquatNewBaseController(); _newBase.set(st, nb); }
      nb.step(w, st);
  squatAnkleVector(w, ctl, st);
      squatRightingV2(w, ctl, st);
      squatSagittalAssist(w, st);
      squatPassiveLock(w, st);
      courtInject(w, ctl);
      squatJointLoad(w, st);
      squatHipStrut(w, st);
      squatLateralLock(w, st);
      return;
    }
    squatNeckHeadRel(w, st);
    squatPassiveDamp(w, st);
    squatPassiveAnkle(w, st);
  squatAnkleVector(w, ctl, st);
    squatPassiveLock(w, st);
    courtInject(w, ctl);
    squatJointLoad(w, st);
    squatHipStrut(w, st);
    backMusclePassive(w, st);
    squatLateralLock(w, st);
    return;
  }
  squatPairBase(w, ctl);
  squatAnkleFeedforward(w, ctl);
  squatPassiveDamp(w, st);
  squatAnkleVector(w, ctl, st);
  squatPassiveLock(w, st);
  courtInject(w, ctl);
  squatJointLoad(w, st);
  squatLateralLock(w, st);
}
