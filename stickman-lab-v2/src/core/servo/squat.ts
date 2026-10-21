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

import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep, courtInject } from '../court';

/** 基础力缓存（释放瞬间捕获一次；离开蹲姿清空） */
/**
 * 蹲姿每帧：唯一关节力写手（pair）。
 * 基础力 = 法庭 setup 时 captureSquatBase() 解一次（ctl.warner.sqBaseBuf），每帧原样读；
 * 回正力 = pair 的 kp·(ref−θ) − kd·ω（ref = captureAngFrom 的标准姿势）；
 * foot/ankle 完全排除（不主动发力；由引擎限位 + drive 阻尼维持）。
 */
export function squatPairBase(w: World, ctl: ControlModule): void {
  if (baseState() !== 'squat') return;
  const baseBuf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  if (!baseBuf) return;   // 未捕获 → 蹲姿不写 pair
  const body = w.body;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const bp = baseParams() as unknown as { pairC?: number };
  const cPair = Number(env.SQC_PAIR_C ?? bp.pairC ?? 0.7);
  const vecMode = String(env.SQC_ANKLE_VEC ?? '1') !== '0';   // 3D 矢量转接口模式
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
    // ★ 调试滑块：髋补充力（仅 hip 矢状轴）
    if (/^hip_/.test(d.name) && d.axis === 2) base += Number((globalThis as { __SQC_HIPBOOST?: number }).__SQC_HIPBOOST ?? 0);
    const ref = baseAng(d.name, d.axis) ?? d.angle;
    // ★ 调试：固定髋（高增益 PD 力矩；motor 通道对非引擎关节无效）
    const hipPin = Boolean((globalThis as { __SQC_HIPPIN?: boolean }).__SQC_HIPPIN) || String(env.SQC_HIPPIN ?? '0') === '1';
    if (hipPin && /^hip_/.test(d.name) && d.axis === 2) {
      const pinTau = 4000 * (ref - d.angle) - 200 * d.vel;
      propose({ dof: d.dofIndex, kind: 'ext', pri: PRI.direct, tau: pinTau, src: 'squat.hipPin' });
    }
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
  const kpPitch = Number(env.SQC_VEC_KP_PITCH ?? env.SQC_VEC_KP ?? -0.5);
  const kd = Number(env.SQC_VEC_KD ?? 0.2);
  const lambda = Number(env.SQC_VEC_LAMBDA ?? 1e-4);
  const debug = String(env.SQC_VEC_DBG ?? '0') === '1';
  const copXBase = st.c0.x;
  for (const side of ['l', 'r'] as const) {
    const fz = body.footNormalForce(side, w.dt);
    if (fz < 1 || !body.footCoP(side, w.dt, cop)) continue;
    const pi = body.dofByName(`foot_${side}`, 2);
    const ri = body.dofByName(`foot_${side}`, 0);
    if (pi < 0) continue;
    const dPitch = body.dofs[pi]!;
    const ankX = dPitch.anchorWorld[0]!, ankZ = dPitch.anchorWorld[2]!;
    const rx = cop[0]! - ankX, rz = cop[1]! - ankZ;
    const Mbase = sagittalBaseMoment(FyHalf, copXBase, ankX);   // 只含 z
    const Mx = kpRoll * fz * rz - kd * (ri >= 0 ? body.dofs[ri]!.vel : 0);
    const Mz = Mbase[2] - kpPitch * fz * (rx - (copXBase - ankX)) - kd * dPitch.vel;
    const Mpre = musclePreMoment(w, side);   // 申请制前馈：虚拟肌肉线 → 踝力矩
    const Mdes: [number, number, number] = [Mx + Mpre[0], 0, Mz + Mpre[2]];
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

/** 蹲姿每物理步：法庭（目标/判死）+ 当前写手链 */
export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  squatPairBase(w, ctl);     // base/pair：hip/knee/spine/neck axis 2
  squatAnkleVector(w, ctl, st); // 踝 3D vector（含肌肉线前馈）
  squatHipStab(w, ctl, st);  // hip/2 PD
  courtInject(w, ctl);
}
