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
import { propose, PRI } from '../proposalBus';
import { mapMomentToAxes, sagittalBaseMoment, type AdapterAxis } from './ankleAxisAdapter';
import { ankleCoPTarget } from './ankleCoP';
import { legSupportTorque } from './virtualLegSupport';

import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep, courtInject } from '../court';

/** 基础力缓存（释放瞬间捕获一次；离开蹲姿清空） */
/**
 * 蹲姿每帧写手链：pairBase → ankleVec → hipStab → supportClean.arm。
 * 基础力 = 法庭 setup 时 captureSquatBase() 解一次（ctl.warner.sqBaseBuf），每帧原样读；
 * 虚拟踝→髋支撑是基础力分量：τ_a 并进 ankleVec 的 Mdes，τ_k 并进 pairBase 的 knee/2，
 * 不是独立写手。回正力 = pair 的 kp·(ref−θ) − kd·ω（ref = 释放姿势）。
 */
/** 虚拟踝→髋支撑参数（基础力分量；默认开，SQC_LEG_SUPPORT=0 关）。 */
function legSupportParams(): { on: boolean; up: number; signA: number; signK: number; kneeMin: number } {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  return {
    on: String(env.SQC_LEG_SUPPORT ?? '1') === '1',
    up: Number(env.SQC_LEG_UP ?? 18.2),
    signA: Number(env.SQC_LEG_SIGN_A ?? env.SQC_LEG_SIGN ?? 1) < 0 ? -1 : 1,
    signK: Number(env.SQC_LEG_SIGN_K ?? env.SQC_LEG_SIGN ?? 1) < 0 ? -1 : 1,
    kneeMin: Number(env.SQC_LEG_KNEE ?? -0.6),
  };
}

/** 支撑门控：蹲姿/释放后/未判死/足够深屈/脚承重。 */
function legSupportActive(w: World, st: CS | undefined, side: 'l' | 'r', p: ReturnType<typeof legSupportParams>): boolean {
  if (!p.on || !st || baseState() !== 'squat' || !st.released || st.fall >= 0) return false;
  const ki = w.body.dofByName(`knee_${side}`, 2);
  if (ki < 0 || w.body.dofs[ki]!.angle > p.kneeMin) return false;
  const bw = w.sk.massTotal * 9.81;
  return w.body.footNormalForce(side, w.dt) >= 0.1 * bw;
}

export function squatPairBase(w: World, ctl: ControlModule, st?: CS): void {
  if (baseState() !== 'squat') return;
  const baseBuf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  if (!baseBuf) return;   // 未捕获 → 蹲姿不写 pair
  const body = w.body;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const bp = baseParams() as unknown as { pairC?: number };
  const cPair = Number(env.SQC_PAIR_C ?? bp.pairC ?? 0.7);
  const vecMode = String(env.SQC_ANKLE_VEC ?? '1') !== '0';   // 3D 矢量转接口模式
  const lsp = legSupportParams();
  const legTau = new Map<'l' | 'r', { tauA: number; tauK: number }>();
  if (lsp.on) {
    for (const side of ['l', 'r'] as const) {
      if (!legSupportActive(w, st, side, lsp)) continue;
      const t = legSupportTorque(w, side, lsp.up);
      legTau.set(side, { tauA: t.tauA, tauK: t.tauK });
    }
  }
  for (const d of body.dofs) {
    if (d.engineMotor) continue;
    // ★ 预环（ring0）已被物理锁死 [rest,rest]，写手 skip（防脏账/浪费算力）
    if (d.preRing) continue;
    // ★ 基础力全走矢状面：foot/ankle 只放行 pitch（轴 2）；侧向/扭转（0/1）不给权限
    //   vecMode：foot/ankle 全部交给 ankleVec 的 3D 分配器，pair 不再写脚踝
    // ★ vec 模式：基础力只允许矢状轴 2；hip/knee/spine/neck 的轴 0 也排除
    if (vecMode && d.axis !== 2) continue;
    const isTrunkLeg = /^(hip|knee|spine|neck)/.test(d.name) && (d.axis === 0 || d.axis === 2);
    const isFootPitch = !vecMode && /^(foot|ankle)/.test(d.name) && d.axis === 2;
    if (!(isTrunkLeg || isFootPitch)) continue;
    let base = baseBuf[d.dofIndex] ?? 0;
    if (/^knee_/.test(d.name) && d.axis === 2) {
      const side = d.name.endsWith('_l') ? 'l' : 'r';
      base += (legTau.get(side)?.tauK ?? 0) * lsp.signK;
    }
    const ref = baseAng(d.name, d.axis) ?? d.angle;
    propose({ dof: d.dofIndex, kind: 'pair', pri: PRI.action, c: cPair, rad: ref, tau: base, src: 'squat.pairBase' });
  }
}

// ── 蹲姿编排入口：法庭 + 注入（唯一入口）──
export {
  squatCourtSetup,
  courtStep,
  courtInject,
  type CourtState,
} from '../court';

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
  const useHipChain = String(env.SQC_HIP_CHAIN ?? '1') === '1';
  const kpHipChain = Number(env.SQC_HIP_CHAIN_KP ?? 100);
  const kdHipChain = Number(env.SQC_HIP_CHAIN_KD ?? 10);
  const capHipChain = Math.abs(Number(env.SQC_HIP_CHAIN_CAP ?? 100));
  const signHipChain = Number(env.SQC_HIP_CHAIN_SIGN ?? -1) < 0 ? -1 : 1;
  let hipChainF = 0;
  if (useHipChain) {
    const ti = body.indexByKey.get('torso');
    if (ti !== undefined) {
      const tb = body.bodies[ti]!;
      const tz = tb.translation().z;
      let tr = _hipChainRef.get(st);
      if (tr === undefined) { tr = tz; _hipChainRef.set(st, tr); }
      hipChainF = signHipChain * (kpHipChain * (tr - tz) - kdHipChain * tb.linvel().z);
      hipChainF = Math.max(-capHipChain, Math.min(capHipChain, hipChainF));
    }
  }
  for (const side of ['l', 'r'] as const) {
    const fz = body.footNormalForce(side, w.dt);
    if (fz < 1 || !body.footCoP(side, w.dt, cop)) continue;
    const pi = body.dofByName(`foot_${side}`, 2);
    const ri = body.dofByName(`foot_${side}`, 0);
    if (pi < 0) continue;
    const dPitch = body.dofs[pi]!;
    const ankX = dPitch.anchorWorld[0]!, ankZ = dPitch.anchorWorld[2]!;
    const rx = cop[0]! - ankX, rz = cop[1]! - ankZ;
    const useAnkleCop = String(env.SQC_ANKLE_COP ?? '1') === '1';
    let targetX = copXBase;
    let targetZ = cop[1]!;
    if (useAnkleCop || useCP) {
      const cp = ankleCoPTarget(
        ctl.sensors.com[0]!, ctl.sensors.com[2]!, ctl.sensors.comVel[0]!, ctl.sensors.comVel[2]!, ctl.sensors.com[1]!,
        copXBase, st.c0.z,
        { minX: ankX - 0.12, maxX: ankX + 0.12, minZ: ankZ - 0.06, maxZ: ankZ + 0.06 },
        lambdaCp,
      );
      targetX = cp.pX;
      targetZ = cp.pZ;
    }
    const Mbase = sagittalBaseMoment(FyHalf, targetX, ankX);   // 目标 CoP 随当前 CP 移动
    const rollSign = Number(env.SQC_COP_ROLL_SIGN ?? 1) < 0 ? -1 : 1;
    const rollK = Number(env.SQC_COP_ROLL_K ?? 0.3);
    const Mx = useAnkleCop ? rollSign * rollK * fz * (targetZ - cop[1]!) : (kpRoll * fz * rz - kd * (ri >= 0 ? body.dofs[ri]!.vel : 0));
    const Mz = Mbase[2] - kd * dPitch.vel;
    const Mpre = musclePreMoment(w, side);   // 申请制前馈：虚拟肌肉线 → 踝力矩
    const lsp = legSupportParams();
    const ls = legSupportActive(w, st, side, lsp)
      ? legSupportTorque(w, side, lsp.up)
      : { tauA: 0, tauK: 0 };
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
    const Mdes: [number, number, number] = [Mx + Mpre[0], My, Mz + Mpre[2] + ls.tauA * lsp.signA];
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
    if (useHipChain && Math.abs(hipChainF) > 1e-9) {
      const hi = body.dofByName(`hip_${side}`, 0);
      if (hi >= 0) {
        const hd = body.dofs[hi]!;
        const ha = hd.anchorWorld;
        const fa = dPitch.anchorWorld;
        const u = body.dofs[body.dofByName(`foot_${side}`, 0)]!.axisWorld;
        const rx = ha[0]! - fa[0]!, ry = ha[1]! - fa[1]!;
        const Jz = u[0]! * ry - u[1]! * rx;
        const t = Math.max(-30, Math.min(30, Jz * hipChainF));
        out.tau[0] = (out.tau[0] ?? 0) + t;
      }
    }
    // 侧向 fine task 的脚力矩（已由 squatFineLateral 算好，保留 ankleVec 阻尼/前馈）
    if (String(env.SQC_FINE_LAT ?? '1') === '1') out.tau[0] = (out.tau[0] ?? 0) + (side === 'l' ? _fineFootL : _fineFootR);
    for (let k = 0; k < 3; k++) {
      const i = idx[k]!;
      if (i < 0 || !axes[k]!.available) continue;
      propose({ dof: i, kind: 'ext', pri: PRI.reflex, tau: out.tau[k]!, src: 'squat.ankleVec' });
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

/** 蹲姿髋矢状稳定（申请制 PD，不是常值前馈）：
 *  只修 hip/2 残余角/速度；经 propose ext，单一写手、有预算、可审计。 */
export function squatHipStab(w: World, ctl: ControlModule, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const kp = Number(env.SQC_HIP_STAB_KP ?? 50);
  if (kp === 0) return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const kd = Number(env.SQC_HIP_STAB_KD ?? 5);
  const tmax = Math.abs(Number(env.SQC_HIP_STAB_TMAX ?? 200));
  const dbg = String(env.SQC_HIP_STAB_DBG ?? '0') === '1';
  const body = w.body;
  for (const side of ['l', 'r'] as const) {
    const hi = body.dofByName(`hip_${side}`, 2);
    if (hi < 0) continue;
    const d = body.dofs[hi]!;
    const ref = baseAng(`hip_${side}`, 2) ?? d.angle;
    const tau = Math.max(-tmax, Math.min(tmax, kp * (ref - d.angle) - kd * d.vel));
    propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.hipStab' });
    if (dbg) console.log(`HIPSTAB t=${st.t.toFixed(3)} ${side} ang=${(d.angle * 57.3).toFixed(1)}° v=${d.vel.toFixed(2)} ref=${(ref * 57.3).toFixed(1)}° tau=${tau.toFixed(0)}`);
  }
}

/** 侧向 fine：CoM→CoP + 躯干 roll（hip/0 + spine1） + knee/1 关节 P。 */
const _fineState = new WeakMap<CS, { integ: number; rollRef: number | null; hipRefL: number | null; hipRefR: number | null }>();
const _hipChainRef = new WeakMap<CS, number>();
let _fineFootL = 0, _fineFootR = 0;
function squatFineLateral(w: World, ctl: ControlModule, st: CS): void {
  _fineFootL = 0; _fineFootR = 0;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_FINE_LAT ?? '1') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;

  let fs = _fineState.get(st);
  if (!fs) { fs = { integ: 0, rollRef: null, hipRefL: null, hipRefR: null }; _fineState.set(st, fs); }
  const kcop = Number(env.SQC_FINE_KCOP ?? 8.0);
  const kpHip = Number(env.SQC_FINE_KP_HIP ?? 20);
  const ki = Number(env.SQC_FINE_KI ?? 0);
  const dead = Math.abs(Number(env.SQC_FINE_DEAD ?? 0.5)) / 1000;
  const cap = Math.abs(Number(env.SQC_FINE_CAP ?? 8));
  const sign = Number(env.SQC_FINE_SIGN ?? 1) < 0 ? -1 : 1;
  const useRoll = String(env.SQC_FINE_ROLL ?? '1') === '1';
  const kpRoll = Number(env.SQC_FINE_KP_ROLL ?? 5);
  const kdRoll = Number(env.SQC_FINE_KD_ROLL ?? 0.5);
  const capRoll = Math.abs(Number(env.SQC_FINE_CAP_ROLL ?? 3));
  const rollSign = Number(env.SQC_FINE_ROLL_SIGN ?? 1) < 0 ? -1 : 1;
  const useKnee = String(env.SQC_FINE_KNEE ?? '1') === '1';
  const kpKnee = Number(env.SQC_FINE_KP_KNEE ?? 300);
  const kpHip0 = Number(env.SQC_FINE_KP_HIP0 ?? 0);
  const kpPelvis = Number(env.SQC_FINE_KP_PELVIS ?? 0);
  const pelvisSign = Number(env.SQC_FINE_PELVIS_SIGN ?? 1) < 0 ? -1 : 1;
  const capHip0 = Math.abs(Number(env.SQC_FINE_CAP_HIP0 ?? 8));
  const capKnee = Math.abs(Number(env.SQC_FINE_CAP_KNEE ?? 20));

  const e = ctl.sensors.com[2]! - st.c0.z;
  if (Math.abs(e) >= dead) fs.integ += e * w.dt;
  fs.integ = Math.max(-0.02, Math.min(0.02, fs.integ));
  const dp = sign * (kcop * e + ki * fs.integ);
  const tCopHip = kpHip * e;

  if (fs.rollRef === null) fs.rollRef = ctl.sensors.torsoTilt[1]!;
  let tRoll = 0;
  if (useRoll) {
    const roll = ctl.sensors.torsoTilt[1]!;
    const rollRate = ctl.sensors.torsoAngVel[0]!;
    const eRoll = fs.rollRef - roll;
    if (Math.abs(eRoll) > 0.1 / 57.3) tRoll = Math.max(-capRoll, Math.min(capRoll, rollSign * (kpRoll * eRoll - kdRoll * rollRate)));
  }
  const tRollHip = tRoll * Number(env.SQC_FINE_ROLL_HIP ?? 0.7);
  const tRollSpine = tRoll * Number(env.SQC_FINE_ROLL_SPINE ?? 0.3);
  if (Math.abs(tRollSpine) > 1e-9) {
    const si = w.body.dofByName('spine1', 0);
    if (si >= 0) propose({ dof: si, kind: 'ext', pri: PRI.direct, tau: tRollSpine, src: 'squat.fineTask.roll' });
  }

  for (const side of ['l', 'r'] as const) {
    const hi = w.body.dofByName(`hip_${side}`, 0);
    let eHip0 = 0;
    if (hi >= 0) {
      const hd = w.body.dofs[hi]!;
      eHip0 = (baseAng(`hip_${side}`, 0) ?? hd.angle) - hd.angle;
      if (Math.abs(eHip0) < 0.1 / 57.3) eHip0 = 0;
    }
    const tHip = Math.max(-capHip0, Math.min(capHip0, tCopHip + tRollHip + kpHip0 * eHip0));
    if (hi >= 0 && Math.abs(tHip) > 1e-9) {
      propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau: tHip, src: 'squat.fineTask' });
    }
    const fzSide = w.body.footNormalForce(side, w.dt);
    // 正常承重膝由 passiveLock 管；fine knee 只给悬空/卸载腿
    if (useKnee && fzSide < 0.1 * w.sk.massTotal * 9.81) {
      const ki2 = w.body.dofByName(`knee_${side}`, 1);
      if (ki2 >= 0) {
        const kd = w.body.dofs[ki2]!;
        const eK = (baseAng(`knee_${side}`, 1) ?? kd.angle) - kd.angle;
        if (Math.abs(eK) > 0.1 / 57.3) {
          const tK = Math.max(-capKnee, Math.min(capKnee, kpKnee * eK));
          if (Math.abs(tK) > 1e-9) propose({ dof: ki2, kind: 'ext', pri: PRI.reflex, tau: tK, src: 'squat.fineTask.knee' });
        }
      }
    }
    // pelvis 内移 → 脚 CoP 同向/反向偏移（不直接写 hip q，避免矢状耦合）
    let ePelvis = 0;
    const hbi = w.body.indexByKey.get(`thigh_${side}`);
    if (hbi !== undefined) {
      const hz = w.body.bodies[hbi]!.translation().z;
      let hr = side === 'l' ? fs.hipRefL : fs.hipRefR;
      if (hr === null) { hr = hz; if (side === 'l') fs.hipRefL = hr; else fs.hipRefR = hr; }
      ePelvis = hz - hr;
    }
    const fz = fzSide;
    const dpSide = dp + pelvisSign * kpPelvis * ePelvis;
    const tf = String(env.SQC_ANKLE_COP ?? '1') === '1' ? 0 : Math.max(-cap, Math.min(cap, fz * dpSide));
    if (side === 'l') _fineFootL = tf; else _fineFootR = tf;
    if (String(env.SQC_FINE_DBG ?? '0') === '1' && st.t >= 2.0 && st.t <= 2.4 && Math.round(st.t * 240) % 12 === 0) {
      console.log(`FINECOP t=${st.t.toFixed(3)} ${side} e=${(e * 1000).toFixed(2)}mm dp=${(dp * 1000).toFixed(2)}mm fz=${fz.toFixed(0)} tf=${tf.toFixed(2)} th=${tHip.toFixed(2)}`);
    }
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
  const useHipLock = String(env.SQC_LOCK_HIP ?? '1') === '1';
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
    if (Math.abs(tau) > 1e-9) propose({ dof: ki, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.passiveLock' });
    if (useHipLock) {
      for (const [ax, kh, kload, cH] of [[0, 10, 150, 15]] as const) {
        const hi = w.body.dofByName(`hip_${side}`, ax);
        if (hi < 0) continue;
        const hd = w.body.dofs[hi]!;
        const eh = (baseAng(`hip_${side}`, ax) ?? hd.angle) - hd.angle;
        if (Math.abs(eh) < deadH) continue;
        const Kh = kh + kload * (fz / W);
        const th = Math.max(-cH, Math.min(cH, Kh * eh - kd * hd.vel));
        if (Math.abs(th) > 1e-9) propose({ dof: hi, kind: 'ext', pri: PRI.reflex, tau: th, src: 'squat.passiveLock.hip' });
      }
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
        if (Math.abs(tau) > 1e-9) propose({ dof: di, kind: 'ext', pri: PRI.reflex, tau, src: 'squat.passiveLock.spine' });
      }
    }
  }
}

/** 蹲姿每物理步：法庭（目标/判死）+ 当前写手链 */
export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  squatPairBase(w, ctl, st);
  squatFineLateral(w, ctl, st);
  squatAnkleVector(w, ctl, st);
  squatHipStab(w, ctl, st);
  squatPassiveLock(w, ctl, st);
  courtInject(w, ctl);
}
