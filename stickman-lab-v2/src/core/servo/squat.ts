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
import { allocateLateralLoad } from './lateralLoadAllocator';
import { backMusclePassive, backMuscleDifferential } from './backMuscles';

import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { HIP, FOOT, SPINE, NECK } from '../dofAxes';
import { courtStep, courtInject } from '../court';

/** 基础力缓存（释放瞬间捕获一次；离开蹲姿清空） */
/**
 * 蹲姿每帧写手链：pairBase → ankleVec → hipStab → supportClean.arm。
 * 基础力 = 法庭 setup 时 captureSquatBase() 解一次（ctl.warner.sqBaseBuf），每帧原样读；
 * 虚拟踝→髋支撑是基础力分量：τ_a 并进 ankleVec 的 Mdes，τ_k 并进 pairBase 的 knee/2，
 * 不是独立写手。回正力 = pair 的 kp·(ref−θ) − kd·ω（ref = 释放姿势）。
 */
export function squatPairBase(w: World, ctl: ControlModule, st?: CS): void {
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
    propose({ dof: d.dofIndex, kind: 'pair', pri: PRI.action, c, rad: refEff, tau: base, src: lateralPair ? 'squat.pairBase.lat' : 'squat.pairBase' });
  }
}

/** 被动刚度模式的独立阻尼：只耗散速度，不定义位置。
 *  与 pair 分开，避免把阻尼塞进肌肉/求解器。 */
function squatPassiveDamp(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_PASSIVE_MODE ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
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
function lateralTriggerMx(w: World, ctl: ControlModule, st: CS): number {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_LAT_TRIG ?? '0') !== '1') return 0;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return 0;
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
export function squatAnkleVector(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_ANKLE_VEC ?? '1') === '0') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
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
      targetZ = passiveOnly ? ankZ : (servoOn ? ankZ + servoCop : zAlloc[side]);
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
    if (passiveOnly) Mx = 0;
    const Mz = Mbase[2] - kd * dPitch.vel;
    const Mpre = musclePreMoment(w, side);   // 申请制前馈：虚拟肌肉线 → 踝力矩
    const latTrig = lateralTriggerMx(w, ctl, st);
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

/** 侧向 fine：CoM→CoP + 躯干 roll（hip/0 + spine1） + knee/1 关节 P。 */
const _latLoadState = new WeakMap<CS, { hold: number; prev: boolean }>();
function torsoRollRobust(w: World): number {
  const i = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
  if (i === undefined) return 0;
  const q = w.body.bodies[i]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  return Math.atan2(uz, Math.hypot(ux, uy));
}
const _hipDampState = new WeakMap<CS, { l: number; r: number }>();
const _hipStratState = new WeakMap<CS, { prevC: number; tau: number }>();
const _latLockOrig = new WeakMap<CS, Map<number, { min: number; max: number }>>();
function torsoPitchRoll(w: World): { pitch: number; roll: number } {
  const i = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
  if (i === undefined) return { pitch: 0, roll: 0 };
  const q = w.body.bodies[i]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  return { pitch: Math.atan2(ux, uy), roll: Math.atan2(uz, Math.hypot(ux, uy)) };
}

/** 髋策略：CMP/角动量，相平面间歇（论文版）。默认 cmp。
 *  只在 CP 出踝区、TtB 低时接；近中心 off；cap 小；无 posture 双 PD。 */
function squatHipStrategy(w: World, ctl: ControlModule, st: CS, force = false): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (!force && String(env.SQC_HIP_STRAT ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const hl = w.body.dofByName('hip_l', 0);
  const hr = w.body.dofByName('hip_r', 0);
  if (hl < 0 || hr < 0) return;
  const mode = String(env.SQC_HIP_STRAT_MODE ?? 'cmp');
  const cap = Math.abs(Number(env.SQC_HIP_STRAT_CAP ?? 5));
  const sign = Number(env.SQC_HIP_STRAT_SIGN ?? -1) < 0 ? -1 : 1;
  let ss = _hipStratState.get(st);
  if (!ss) { ss = { prevC: (w.body.dofs[hl]!.anchorWorld[2]! + w.body.dofs[hr]!.anchorWorld[2]!) / 2, tau: 0 }; _hipStratState.set(st, ss); }
  let want = 0;
  let dbg = '';

  if (mode === 'posture') {
    const { roll } = torsoPitchRoll(w);
    const eR = (st.r0 ?? roll) - roll;
    const hipC = (w.body.dofs[hl]!.anchorWorld[2]! + w.body.dofs[hr]!.anchorWorld[2]!) / 2;
    const refC = ((st.hipRefL ?? hipC) + (st.hipRefR ?? hipC)) / 2;
    const eC = refC - hipC;
    const vC = (hipC - ss.prevC) / Math.max(1e-6, w.dt);
    ss.prevC = hipC;
    const wr = ctl.sensors.torsoAngVel[0]!;
    const deadR = Math.abs(Number(env.SQC_HIP_STRAT_DEAD_R ?? 0.5)) / 57.3;
    const deadC = Math.abs(Number(env.SQC_HIP_STRAT_DEAD_C ?? 0.5)) / 1000;
    const outside = Math.abs(eR) > deadR || Math.abs(eC) > deadC || Math.abs(wr) > 0.05 || Math.abs(vC) > 0.005;
    if (outside) {
      const tauR = Number(env.SQC_HIP_STRAT_KP_ROLL ?? 80) * eR - Number(env.SQC_HIP_STRAT_KD_ROLL ?? 6) * wr;
      const tauC = Number(env.SQC_HIP_STRAT_KP_CENTER ?? 2000) * eC - Number(env.SQC_HIP_STRAT_KD_CENTER ?? 200) * vC;
      want = sign * (tauR + tauC);
    }
    dbg = `eR=${(eR * 57.3).toFixed(2)}° eC=${(eC * 1000).toFixed(2)}mm`;
  } else {
    const L = ctl.lateral.state;
    const comY = Math.max(0.3, ctl.perception.com[1]!);
    const omega = Math.sqrt(9.81 / comY);
    const err = L.xiZ - L.refZ;
    const dead = Math.abs(Number(env.SQC_HIP_STRAT_DEAD ?? 0.01));
    const ttbTh = Math.abs(Number(env.SQC_HIP_STRAT_TTB ?? 0.12));
    if (Math.abs(err) >= dead && L.ttb <= ttbTh) {
      const kCp = Number(env.SQC_HIP_STRAT_CP ?? 1.5);
      const cmpDes = L.xiZ + kCp * err / omega;
      const hdotDes = w.sk.massTotal * 9.81 * (L.copZ - cmpDes);
      want = sign * Number(env.SQC_HIP_STRAT_K ?? 1.0) * hdotDes;
    }
    dbg = `xi=${(L.xiZ * 1000).toFixed(2)} err=${(err * 1000).toFixed(2)} cop=${(L.copZ * 1000).toFixed(2)} ttb=${L.ttb.toFixed(3)}`;
  }

  const rateMax = Math.abs(Number(env.SQC_HIP_STRAT_RATE ?? 300));
  const dMax = rateMax * w.dt;
  want = Math.max(-cap, Math.min(cap, want));
  ss.tau += Math.max(-dMax, Math.min(dMax, want - ss.tau));
  if (Math.abs(ss.tau) < 1e-9) return;
  propose({ dof: hl, kind: 'ext', pri: PRI.reflex, tau: ss.tau, src: 'squat.hipStrategy' });
  propose({ dof: hr, kind: 'ext', pri: PRI.reflex, tau: ss.tau, src: 'squat.hipStrategy' });
  if (String(env.SQC_HIP_STRAT_DBG ?? '0') === '1' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
    console.log(`HIPSTRAT t=${w.clock.toFixed(2)} mode=${mode} ${dbg} tau=${ss.tau.toFixed(2)} part=${ctl.lateral.state.dominantPart}`);
  }
}

/** 悬空腿 knee/1 P（原 fineLateral 里唯一保留的部分）。 */
function squatSwingKnee(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_SWING_KNEE ?? '1') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const useKnee = String(env.SQC_FINE_KNEE ?? '1') === '1';
  if (!useKnee) return;
  const kpKnee = Number(env.SQC_FINE_KP_KNEE ?? 300);
  const capKnee = Math.abs(Number(env.SQC_FINE_CAP_KNEE ?? 20));
  for (const side of ['l', 'r'] as const) {
    const fzSide = w.body.footNormalForce(side, w.dt);
    if (fzSide >= 0.1 * w.sk.massTotal * 9.81) continue;
    const ki2 = w.body.dofByName(`knee_${side}`, 1);
    if (ki2 < 0) continue;
    const d = w.body.dofs[ki2]!;
    const eK = (baseAng(`knee_${side}`, 1) ?? d.angle) - d.angle;
    if (Math.abs(eK) <= 0.1 / 57.3) continue;
    const tK = Math.max(-capKnee, Math.min(capKnee, kpKnee * eK));
    if (Math.abs(tK) > 1e-9) propose({ dof: ki2, kind: 'ext', pri: PRI.reflex, tau: tK, src: 'squat.swingKnee' });
  }
}

/** 承重相关被动锁：只锁 knee/1（frontal），不锁矢状；deadband + 载荷刚度。 */
function squatPassiveLock(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_LOCK ?? '1') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const W = w.sk.massTotal * 9.81;
  const k0 = Number(env.SQC_LOCK_K0 ?? 20);
  const kLoad = Number(env.SQC_LOCK_KL ?? 800);
  const kd = Number(env.SQC_LOCK_KD ?? 2);
  const cap = Math.abs(Number(env.SQC_LOCK_CAP ?? 30));
  const dead = Math.abs(Number(env.SQC_LOCK_DEAD ?? 1.5)) / 57.3;
  const pairLatOn = String(env.SQC_PAIR_LAT ?? '0') === '1';
  const pairLatDof = String(env.SQC_PAIR_LAT_DOF ?? 'all');
  const pairLatProbe = String(env.SQC_PAIR_LAT_PROBE ?? '');
  const pairLatOff = Number(env.SQC_PAIR_LAT_OFF ?? 0);
  const hipStratOn = String(env.SQC_HIP_STRAT ?? '0') === '1';
  const hipStrutOn = String(env.SQC_HIP_STRUT ?? '0') === '1' && String(env.SQC_UPPER_UNIFIED ?? '0') === '1' && String(env.SQC_HIP_LOCK_WITH_STRUT ?? '1') !== '1';
  const useHipLock = String(env.SQC_LOCK_HIP ?? '1') === '1' && !pairLatOn && !hipStratOn && !hipStrutOn;
  const hipDamp = Number(env.SQC_HIP_DAMP ?? 1000);
  const hipLockCap = Math.abs(Number(env.SQC_HIP_LOCK_CAP ?? 50));
  const hipLockKLoad = Number(env.SQC_HIP_LOCK_KLOAD ?? 150);
  const hipCommonCap = Math.abs(Number(env.SQC_HIP_COMMON_CAP ?? 1e9));
  const hipDiffCap = Math.abs(Number(env.SQC_HIP_DIFF_CAP ?? hipLockCap));
  const hipRaw = new Map<'l' | 'r', number>();
  let ds = _hipDampState.get(st);
  if (!ds) { ds = { l: 0, r: 0 }; _hipDampState.set(st, ds); }
  const deadH = Math.abs(Number(env.SQC_LOCK_HIP_DEAD ?? 2.0)) / 57.3;
  const useSpineLock = String(env.SQC_LOCK_SPINE ?? '1') === '1';
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
      for (const [ax, kh, kload, cH0] of [[0, 10, 150, 15]] as const) {
        const cH = hipLockCap;
        const hi = w.body.dofByName(`hip_${side}`, ax);
        if (hi < 0) continue;
        const hd = w.body.dofs[hi]!;
        const eh = (baseAng(`hip_${side}`, ax) ?? hd.angle) - hd.angle;
        const hz = hd.anchorWorld[2]!;
        const prev = side === 'l' ? ds.l : ds.r;
        const vz = (hz - prev) / Math.max(1e-6, w.dt);
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
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const lockOn = String(env.SQC_LAT_LOCK ?? '1') === '1';
  const sphereLock = String(env.SQC_LAT_LOCK_SPHERE ?? '0') === '1';
  const W = w.sk.massTotal * 9.81;
  const pairLatOn = String(env.SQC_PAIR_LAT ?? '0') === '1';
  const pairLatDof = String(env.SQC_PAIR_LAT_DOF ?? 'all');
  const pairLatProbe = String(env.SQC_PAIR_LAT_PROBE ?? '');
  const pairLatOff = Number(env.SQC_PAIR_LAT_OFF ?? 0);
  const upperHipOn = pairLatOn || String(env.SQC_HIP_STRAT ?? '0') === '1';
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
      o = { min: d.min, max: d.max };
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
function squatLateralServo(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_LAT_SERVO ?? '1') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const srv = ctl.lateralServo;
  if (!srv.active || Math.abs(srv.fzReq) < 0.5) return;
  const alloc = allocateLateralLoad(srv.fzReq, {
    hipCap: Math.abs(Number(env.SQC_LAT_SERVO_HIP_CAP ?? 10)),
    kneeCap: Math.abs(Number(env.SQC_LAT_SERVO_KNEE_CAP ?? 30)),
    hipShare: Number(env.SQC_LAT_SERVO_HIP_SHARE ?? 0.5),
  });
  const kl = w.body.dofByName('foot_l', FOOT.invert);
  const kr = w.body.dofByName('foot_r', FOOT.invert);
  const hl = w.body.dofByName('hip_l', HIP.abduct);
  const hr = w.body.dofByName('hip_r', HIP.abduct);
  if (kl >= 0) propose({ dof: kl, kind: 'ext', pri: PRI.reflex, tau: alloc.knee2, src: 'squat.lateralServo', channel: 'active' });
  if (kr >= 0) propose({ dof: kr, kind: 'ext', pri: PRI.reflex, tau: -alloc.knee2, src: 'squat.lateralServo', channel: 'active' });
  if (hl >= 0) propose({ dof: hl, kind: 'ext', pri: PRI.reflex, tau: alloc.hip2, src: 'squat.lateralServo', channel: 'active' });
  if (hr >= 0) propose({ dof: hr, kind: 'ext', pri: PRI.reflex, tau: -alloc.hip2, src: 'squat.lateralServo', channel: 'active' });
}

/** 蹲姿每物理步：法庭（目标/判死）+ 当前写手链 */
/** 被动踝侧向弹簧：只对 foot/0 位移/速度反应，不写 CoP。 */
function squatPassiveAnkle(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_PASSIVE_ONLY ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
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
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
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
      const Fz = Math.max(-Fmax, Math.min(Fmax, Kz * zerr - Bz * hb.linvel().z));
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
function squatHATRel(w: World, ctl: ControlModule, st: CS, force = false): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (!force && String(env.SQC_HAT_REL ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const thoraxKey = w.body.indexByKey.has('spine4') ? 'spine4' : 'spine3';
  const cur = relVec(w, 'torso', thoraxKey);
  if (!cur) return;
  let ref = _hatRel.get(st);
  if (!ref) {
    ref = { rel: new Float64Array(cur), head: new Float64Array(3) };
    const h = relVec(w, thoraxKey, 'head');
    if (h) ref.head.set(h);
    _hatRel.set(st, ref);
  }
  const eR = ref.rel[0]! - cur[0]!;
  const eP = ref.rel[2]! - cur[2]!;
  const ti = w.body.indexByKey.get(thoraxKey);
  const wv = ti !== undefined ? w.body.bodies[ti]!.angvel() : { x: 0, y: 0, z: 0 };
  const K = Math.abs(Number(env.SQC_HAT_K ?? 1200));
  const B = Math.abs(Number(env.SQC_HAT_B ?? 20));
  const cap = Math.abs(Number(env.SQC_HAT_CAP ?? 15));
  const tauR = Math.max(-cap, Math.min(cap, K * eR - B * wv.x));
  const tauP = Math.max(-cap, Math.min(cap, K * eP - B * wv.z));
  const wts = [0.25, 0.35, 0.40] as const;
  for (let k = 0; k < 3; k++) {
    const name = (['spine1', 'spine2', 'spine3'] as const)[k]!;
    const di = w.body.dofByName(name, 0);
    if (di >= 0) propose({ dof: di, kind: 'ext', pri: PRI.direct, tau: tauR * wts[k]!, src: 'squat.HATRel.roll' });
    const pi = w.body.dofByName(name, 2);
    if (pi >= 0) propose({ dof: pi, kind: 'ext', pri: PRI.direct, tau: tauP * wts[k]!, src: 'squat.HATRel.pitch' });
  }
}
function squatNeckHeadRel(w: World, ctl: ControlModule, st: CS, force = false): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (!force && String(env.SQC_NECK_HEAD_REL ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
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
  squatNeckHeadRel(w, ctl, st, true);
  backMusclePassive(w, st);
}

/** 背肌+脊柱联合侧向伺服：救 HAT 侧弯，不推腿/髋。 */
const _backSpineRef = new WeakMap<CS, Float64Array>();
const _backSpinePos = new WeakMap<CS, { z: number }>();
const _trunkSenseRef = new WeakMap<CS, { z: number; roll: number }>();
function squatBackSpineServo(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_BACK_SPINE_SERVO ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
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
      if (!sr) { sr = { z: tr.z, roll: tr.roll }; _trunkSenseRef.set(st, sr); }
      const sgn = Number(env.SQC_BSS_SENSE_SIGN ?? 1) < 0 ? -1 : 1;
      if (String(env.SQC_BSS_SENSE) === '1') eR = sgn * (sr.roll - tr.roll);
      eZ = sgn * (sr.z - tr.z);
      vz = tr.vzRel;
      rate = wv.x;
    }
  }
  const e = eR + eZ * Number(env.SQC_BSS_EZ_K ?? 5);
  backMuscleDifferential(w, st, e, rate + vz * Number(env.SQC_BSS_EZ_D ?? 0));
  if (String(env.SQC_BSS_FORCE ?? '0') === '1' && ti !== undefined) {
    const pi = w.body.indexByKey.get('torso');
    if (pi !== undefined) {
      const tb = w.body.bodies[ti]!;
      const pb = w.body.bodies[pi]!;
      const Fmax = Math.abs(Number(env.SQC_BSS_FMAX ?? 0.2)) * w.sk.massTotal * 9.81;
      const F = Math.max(-Fmax, Math.min(Fmax,
        Math.abs(Number(env.SQC_BSS_FZ ?? 5000)) * eZ - Math.abs(Number(env.SQC_BSS_FZD ?? 300)) * vz));
      const imp = F * w.dt;
      tb.applyImpulse({ x: 0, y: 0, z: imp }, true);
      pb.applyImpulse({ x: 0, y: 0, z: -imp }, true);
    }
  }
  const K = Math.abs(Number(env.SQC_BSS_K ?? 1200));
  const B = Math.abs(Number(env.SQC_BSS_B ?? 20));
  const Kz = Math.abs(Number(env.SQC_BSS_KZ ?? 0));
  const Bz = Math.abs(Number(env.SQC_BSS_BZ ?? 0));
  const cap = Math.abs(Number(env.SQC_BSS_CAP ?? 20));
  let tau = Math.max(-cap, Math.min(cap, K * eR - B * rate + Kz * eZ - Bz * vz));
  if (String(env.SQC_BSS_CAL ?? '0') === '1' && w.clock >= 2.2 && w.clock < 2.3) {
    tau = Number(env.SQC_BSS_CAL_TAU ?? 10);
  }
  if (String(env.SQC_BSS_DBG ?? '0') === '1' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
    console.log(`BSSDBG t=${w.clock.toFixed(2)} eR=${(eR * 57.3).toFixed(2)}° eZ=${(eZ * 1000).toFixed(1)}mm rate=${rate.toFixed(2)} tau=${tau.toFixed(1)}`);
  }
  const wts = [0.25, 0.35, 0.40] as const;
  for (let k = 0; k < 3; k++) {
    const name = (['spine1', 'spine2', 'spine3'] as const)[k]!;
    const di = w.body.dofByName(name, SPINE.lateral);
    if (di < 0) continue;
    propose({ dof: di, kind: 'ext', pri: PRI.direct, tau: tau * wts[k]!, src: 'squat.backSpine', channel: 'active' });
  }
}

export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_PASSIVE_ONLY ?? '0') === '1') {
    squatPairBase(w, ctl, st);
    if (String(env.SQC_UPPER_UNIFIED ?? '0') === '1') {
      squatUpperBodyUnified(w, ctl, st);
      squatPassiveDamp(w, st);
      if (String(env.SQC_PASSIVE_ANKLE_UNIFIED ?? '1') === '1') squatPassiveAnkle(w, st);
      squatAnkleVector(w, ctl, st);
      squatPassiveLock(w, ctl, st);
      courtInject(w, ctl);
      squatJointLoad(w, st);
      squatHipStrut(w, st);
      squatLateralLock(w, st);
      return;
    }
    squatHATRel(w, ctl, st);
    squatNeckHeadRel(w, ctl, st);
    squatPassiveDamp(w, st);
    squatPassiveAnkle(w, st);
    squatLateralServo(w, ctl, st);
    squatSwingKnee(w, st);
    squatAnkleVector(w, ctl, st);
    squatPassiveLock(w, ctl, st);
    courtInject(w, ctl);
    squatJointLoad(w, st);
    squatHipStrut(w, st);
    backMusclePassive(w, st);
    squatLateralLock(w, st);
    return;
  }
  squatPairBase(w, ctl, st);
  squatPassiveDamp(w, st);
  squatLateralServo(w, ctl, st);
  squatHipStrategy(w, ctl, st);
  squatSwingKnee(w, st);
  squatAnkleVector(w, ctl, st);
  squatPassiveLock(w, ctl, st);
  courtInject(w, ctl);
  squatJointLoad(w, st);
  squatLateralLock(w, st);
}
